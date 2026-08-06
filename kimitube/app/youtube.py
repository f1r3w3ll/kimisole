"""Cliente da YouTube Data API v3 (httpx) com batching e quota tracker.

Custos de quota: chamadas list = 1 unidade; search.list = 100 unidades.
Cada chamada é registrada em quota_usage via db.add_quota_usage.
"""

import re
import sqlite3
from datetime import datetime, timedelta, timezone

import httpx

from . import config, db

BATCH_SIZE = 50  # máximo de IDs por chamada videos.list


class YouTubeAPIError(Exception):
    """Erro genérico da YouTube Data API."""


class QuotaExceededAPIError(YouTubeAPIError):
    """A API respondeu quotaExceeded (403)."""


def parse_duration(iso8601: str | None) -> int:
    """Converte duração ISO 8601 (PT1H2M3S) para segundos."""
    if not iso8601:
        return 0
    m = re.fullmatch(
        r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso8601
    )
    if not m:
        return 0
    hours, minutes, seconds = (int(g) if g else 0 for g in m.groups())
    return hours * 3600 + minutes * 60 + seconds


class YouTubeClient:
    def __init__(self, api_key: str | None = None, conn: sqlite3.Connection | None = None):
        self.api_key = api_key or config.YOUTUBE_API_KEY
        self.conn = conn or db.get_conn()
        self._client = httpx.Client(base_url=config.YOUTUBE_API_BASE, timeout=30.0)

    def close(self) -> None:
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # ------------------------------------------------------------------
    # Chamada base com contabilização de quota
    # ------------------------------------------------------------------

    def _get(self, endpoint: str, params: dict, cost: int = config.QUOTA_COST_LIST) -> dict:
        if not self.api_key:
            raise YouTubeAPIError(
                "YOUTUBE_API_KEY não configurada. Defina no arquivo .env (veja .env.example)."
            )
        params = {**params, "key": self.api_key}
        try:
            db.add_quota_usage(self.conn, cost)
        except db.QuotaExceededError as e:
            raise QuotaExceededAPIError(str(e)) from e

        resp = self._client.get(endpoint, params=params)
        if resp.status_code == 403:
            payload = resp.json()
            reason = ""
            try:
                reason = payload["error"]["errors"][0].get("reason", "")
            except (KeyError, IndexError):
                pass
            if "quota" in reason.lower():
                raise QuotaExceededAPIError(
                    "Quota diária da YouTube Data API excedida (resposta 403 quotaExceeded). "
                    "Tente novamente após o reset diário (meia-noite, horário do Pacífico)."
                )
            raise YouTubeAPIError(f"YouTube API 403: {payload.get('error', {}).get('message', resp.text)}")
        if resp.status_code != 200:
            raise YouTubeAPIError(f"YouTube API {resp.status_code}: {resp.text[:300]}")
        return resp.json()

    # ------------------------------------------------------------------
    # Canais
    # ------------------------------------------------------------------

    def get_channel_by_handle(self, handle: str) -> dict | None:
        """channels.list?forHandle=@x — retorna o item ou None."""
        handle = handle.lstrip("@")
        data = self._get("channels", {
            "part": "snippet,statistics,contentDetails",
            "forHandle": handle,
        })
        items = data.get("items", [])
        return items[0] if items else None

    def get_channel_by_id(self, channel_id: str) -> dict | None:
        data = self._get("channels", {
            "part": "snippet,statistics,contentDetails",
            "id": channel_id,
        })
        items = data.get("items", [])
        return items[0] if items else None

    def resolve_channel(self, query: str) -> dict | None:
        """Aceita handle (@x), URL youtube.com/... ou channel ID (UC...)."""
        query = query.strip()
        handle = None
        channel_id = None

        if "youtube.com" in query or "youtu.be" in query:
            m = re.search(r"youtube\.com/@([\w.\-]+)", query)
            if m:
                handle = m.group(1)
            else:
                m = re.search(r"youtube\.com/channel/(UC[\w\-]+)", query)
                if m:
                    channel_id = m.group(1)
        elif query.startswith("@"):
            handle = query[1:]
        elif re.fullmatch(r"UC[\w\-]{20,}", query):
            channel_id = query
        else:
            handle = query  # tenta como handle sem @

        if channel_id:
            return self.get_channel_by_id(channel_id)
        return self.get_channel_by_handle(handle)

    # ------------------------------------------------------------------
    # Vídeos
    # ------------------------------------------------------------------

    def get_uploads_playlist_id(self, channel_item: dict) -> str:
        return channel_item["contentDetails"]["relatedPlaylists"]["uploads"]

    def list_uploads(self, uploads_playlist_id: str, max_items: int = 50) -> list[dict]:
        """playlistItems.list paginado — retorna os IDs dos vídeos mais recentes."""
        video_ids: list[str] = []
        page_token = None
        while len(video_ids) < max_items:
            params = {
                "part": "contentDetails",
                "playlistId": uploads_playlist_id,
                "maxResults": min(BATCH_SIZE, max_items - len(video_ids)),
            }
            if page_token:
                params["pageToken"] = page_token
            data = self._get("playlistItems", params)
            for item in data.get("items", []):
                video_ids.append(item["contentDetails"]["videoId"])
            page_token = data.get("nextPageToken")
            if not page_token:
                break
        return video_ids

    def get_videos(self, video_ids: list[str]) -> list[dict]:
        """videos.list com batching de até 50 IDs por chamada (1 un. por batch)."""
        videos: list[dict] = []
        for i in range(0, len(video_ids), BATCH_SIZE):
            batch = video_ids[i:i + BATCH_SIZE]
            data = self._get("videos", {
                "part": "snippet,statistics,contentDetails",
                "id": ",".join(batch),
            })
            videos.extend(data.get("items", []))
        return videos

    # ------------------------------------------------------------------
    # Keywords (search.list — 100 unidades por chamada)
    # ------------------------------------------------------------------

    def search_recent_videos(self, term: str, days: int = 30,
                             max_results: int = 25) -> list[dict]:
        """search.list order=viewCount para vídeos recentes de um termo.

        Custa 100 unidades de quota. Retorna os items de busca (sem stats).
        """
        published_after = (
            datetime.now(timezone.utc) - timedelta(days=days)
        ).isoformat().replace("+00:00", "Z")
        data = self._get("search", {
            "part": "snippet",
            "q": term,
            "type": "video",
            "order": "viewCount",
            "publishedAfter": published_after,
            "maxResults": max_results,
        }, cost=config.QUOTA_COST_SEARCH)
        return data.get("items", [])


def channel_to_record(item: dict) -> dict:
    """Converte item channels.list em registro para db.upsert_channel."""
    snippet = item.get("snippet", {})
    thumbs = snippet.get("thumbnails", {})
    thumb = (thumbs.get("medium") or thumbs.get("default") or {}).get("url")
    return {
        "id": item["id"],
        "title": snippet.get("title", ""),
        "handle": snippet.get("customUrl"),
        "custom_url": snippet.get("customUrl"),
        "thumbnail_url": thumb,
    }


def video_to_record(item: dict, channel_id: str) -> dict:
    """Converte item videos.list em registro para db.upsert_video."""
    snippet = item.get("snippet", {})
    duration_s = parse_duration(item.get("contentDetails", {}).get("duration"))
    thumbs = snippet.get("thumbnails", {})
    thumb = (thumbs.get("medium") or thumbs.get("default") or {}).get("url")
    return {
        "id": item["id"],
        "channel_id": channel_id,
        "title": snippet.get("title", ""),
        "published_at": snippet.get("publishedAt"),
        "duration_s": duration_s,
        "is_short": 0 < duration_s <= config.SHORTS_MAX_DURATION_S,
        "tags": snippet.get("tags", []),
        "thumbnail_url": thumb,
    }
