"""Módulo de descoberta de canais similares em crescimento.

Duas estratégias:
1. "related"  — a partir de um canal semente, extrai tags/títulos dos vídeos
   recentes e busca vídeos similares (search.list) para encontrar canais
   relacionados.
2. "keyword"  — busca direta por termo/keyword e extrai os canais dos
   resultados.

Toda a lógica de score é pura e testável; as funções de alto nível usam o
YouTubeClient e persistem no SQLite.
"""

import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from statistics import mean
from typing import Iterable

from . import config, db, youtube

# Quantos termos usar para buscar por similaridade.
MAX_SEARCH_TERMS = 3
# Resultados por termo de busca (search.list custa 100 unidades cada).
RESULTS_PER_TERM = 25
# Dias para trás na busca de vídeos similares.
SEARCH_DAYS = 90


class DiscoveryError(Exception):
    """Erro genérico do módulo de descoberta."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _extract_terms_from_videos(videos: list[dict]) -> list[tuple[str, int]]:
    """Extrai termos de busca relevantes de uma lista de vídeos.

    Combina palavras dos títulos (sem stopwords simples) e tags.
    Retorna lista de (termo, peso) ordenada por frequência.
    """
    stopwords = {
        "a", "o", "as", "os", "um", "uma", "de", "do", "da", "dos", "das",
        "em", "no", "na", "nos", "nas", "e", "ou", "para", "por", "com",
        "sem", "que", "se", "ao", "à", "the", "a", "an", "and", "or", "of",
        "to", "in", "on", "at", "for", "with", "without", "is", "are",
    }
    counter: Counter[str] = Counter()

    for v in videos:
        title = v.get("title", "")
        # palavras com 3+ caracteres
        words = [w.lower() for w in re.findall(r"\b\w+\b", title)
                 if len(w) >= 3 and w.lower() not in stopwords]
        counter.update(words)
        tags = v.get("tags") or []
        if isinstance(tags, str):
            try:
                import json
                tags = json.loads(tags)
            except Exception:
                tags = []
        counter.update(t.lower() for t in tags if len(t) >= 3)

    # Prioriza termos que aparecem em mais vídeos (frequência).
    return counter.most_common(MAX_SEARCH_TERMS)


def _search_results_to_channel_overlaps(
    client: youtube.YouTubeClient,
    terms: Iterable[str],
    results_per_term: int = RESULTS_PER_TERM,
    days: int = SEARCH_DAYS,
    exclude_channel_ids: set[str] | None = None,
    search_type: str = "video",
) -> tuple[dict[str, int], dict[str, list[str]]]:
    """Roda search.list para cada termo e conta quantas vezes cada canal aparece.

    search_type: "video" (padrão) ou "channel".
    Retorna ({channel_id: overlap_count}, {channel_id: [termo_que_achou]}).
    """
    overlaps: dict[str, int] = Counter()
    matched_terms: dict[str, list[str]] = {}
    exclude = exclude_channel_ids or set()

    published_after = (
        datetime.now(timezone.utc) - timedelta(days=days)
    ).isoformat().replace("+00:00", "Z")

    for term in terms:
        params = {
            "part": "snippet",
            "q": term,
            "type": search_type,
            "maxResults": results_per_term,
        }
        if search_type == "video":
            params["order"] = "viewCount"
            params["publishedAfter"] = published_after

        items = client._get("search", params, cost=config.QUOTA_COST_SEARCH)

        for item in items.get("items", []):
            snippet = item.get("snippet", {})
            ch_id = snippet.get("channelId")
            if not ch_id or ch_id in exclude:
                continue
            overlaps[ch_id] += 1
            matched_terms.setdefault(ch_id, []).append(term)

    return dict(overlaps), matched_terms


def _enrich_channels(
    client: youtube.YouTubeClient,
    channel_ids: Iterable[str],
) -> list[dict]:
    """Busca estatísticas de uma lista de canais em batches de 50."""
    enriched: list[dict] = []
    ids = list(channel_ids)
    for i in range(0, len(ids), youtube.BATCH_SIZE):
        batch = ids[i:i + youtube.BATCH_SIZE]
        data = client._get("channels", {
            "part": "snippet,statistics,contentDetails",
            "id": ",".join(batch),
        })
        for item in data.get("items", []):
            stats = item.get("statistics", {})
            record = youtube.channel_to_record(item)
            enriched.append({
                **record,
                "subs": int(stats.get("subscriberCount", 0)),
                "total_views": int(stats.get("viewCount", 0)),
                "video_count": int(stats.get("videoCount", 0)),
                "hidden_subs": stats.get("subscriberCount") is None,
            })
    return enriched


def _recent_video_velocity(
    client: youtube.YouTubeClient,
    channel_id: str,
    max_videos: int = 10,
) -> float:
    """Média de views dos últimos vídeos de um canal. Consome quota."""
    try:
        ch = client.get_channel_by_id(channel_id)
        if not ch:
            return 0.0
        uploads_id = client.get_uploads_playlist_id(ch)
        video_ids = client.list_uploads(uploads_id, max_items=max_videos)
        if not video_ids:
            return 0.0
        views = []
        for v in client.get_videos(video_ids):
            views.append(int(v.get("statistics", {}).get("viewCount", 0)))
        return round(mean(views), 1) if views else 0.0
    except Exception:  # noqa: BLE001
        return 0.0


def _score_candidate(
    channel: dict,
    overlap_count: int,
    matched_terms: list[str],
    seed_subs: int,
    min_subs: int | None,
    max_subs: int | None,
    recent_velocity: float,
) -> tuple[float, str]:
    """Calcula score 0-100 e uma razão textual para o candidato."""
    subs = channel.get("subs", 0)
    hidden = channel.get("hidden_subs", False)

    # Filtro absoluto de faixa de inscritos.
    if min_subs is not None and subs < min_subs:
        return 0.0, ""
    if max_subs is not None and subs > max_subs:
        return 0.0, ""

    score = 0.0
    # Overlap: quantos termos diferentes trouxeram este canal.
    score += min(overlap_count, 5) * 8  # até 40 pts

    # Proximidade de tamanho com a semente (canal do mesmo porte é mais relevante).
    if seed_subs and subs:
        ratio = min(subs, seed_subs) / max(subs, seed_subs)
        score += ratio * 20  # até 20 pts

    # Recent view velocity / subs (engajamento relativo).
    if subs and recent_velocity:
        velocity_ratio = recent_velocity / subs
        # Normaliza: 0.1 (10%) já é muito bom → 30 pts
        score += min(velocity_ratio * 300, 30)

    # Penalidade se inscritos ocultos (menos dados para comparar).
    if hidden:
        score *= 0.7

    # Bônus leve para canais pequenos em crescimento (5k-100k).
    if 5_000 <= subs <= 100_000:
        score += 10

    reason_terms = ", ".join(sorted(set(matched_terms)))
    reason = f"{overlap_count} vídeo(s) relacionado(s) via: {reason_terms}"
    return round(max(0.0, min(100.0, score)), 1), reason


def discover_by_channel(
    seed_query: str,
    max_results: int = 25,
    min_subs: int | None = None,
    max_subs: int | None = None,
    min_score: float = 0.0,
    client: youtube.YouTubeClient | None = None,
) -> dict:
    """Descobre canais similares a partir de um canal semente.

    Fluxo:
      1. resolve o canal semente
      2. pega vídeos recentes e extrai os termos mais comuns
      3. busca vídeos recentes para cada termo (search.list)
      4. enriquece os canais encontrados com statistics
      5. calcula score e persiste candidatos
    """
    own_client = client is None
    client = client or youtube.YouTubeClient()
    try:
        conn = client.conn
        seed_item = client.resolve_channel(seed_query)
        if not seed_item:
            raise DiscoveryError(f"Canal semente não encontrado: {seed_query}")

        seed_record = youtube.channel_to_record(seed_item)
        seed_id = seed_record["id"]
        seed_stats = seed_item.get("statistics", {})
        seed_subs = int(seed_stats.get("subscriberCount", 0))

        # Persiste semente (source=spy se já existir, senão discover:channel:<id>).
        seed_record["source"] = f"discover:channel:{seed_id}"
        seed_record["discovered_at"] = _now_iso()
        db.upsert_channel(conn, seed_record)

        # Vídeos recentes da semente para extrair termos.
        uploads_id = client.get_uploads_playlist_id(seed_item)
        video_ids = client.list_uploads(uploads_id, max_items=25)
        video_items = client.get_videos(video_ids) if video_ids else []
        videos = [youtube.video_to_record(v, seed_id) for v in video_items]

        terms = [t for t, _ in _extract_terms_from_videos(videos)]
        if not terms:
            terms = [seed_record.get("title", "").split()[0] or "youtube"]

        overlaps, matched_terms = _search_results_to_channel_overlaps(
            client, terms, exclude_channel_ids={seed_id},
            results_per_term=RESULTS_PER_TERM, days=SEARCH_DAYS,
        )

        candidate_ids = sorted(overlaps, key=lambda x: overlaps[x], reverse=True)[:max_results * 2]
        enriched = _enrich_channels(client, candidate_ids)

        candidates: list[dict] = []
        for ch in enriched:
            ch_id = ch["id"]
            velocity = _recent_video_velocity(client, ch_id, max_videos=5)
            score, reason = _score_candidate(
                ch, overlaps[ch_id], matched_terms.get(ch_id, []),
                seed_subs, min_subs, max_subs, velocity,
            )
            if score < min_score:
                continue

            # Persiste canal + candidato.
            ch["source"] = f"discover:channel:{seed_id}"
            ch["discovered_at"] = _now_iso()
            db.upsert_channel(conn, ch)
            db.upsert_discovery_candidate(conn, {
                "channel_id": ch_id,
                "seed_channel_id": seed_id,
                "score": score,
                "reason": reason,
                "common_tags": matched_terms.get(ch_id, []),
                "discovered_at": _now_iso(),
            })

            candidates.append({
                "channel": ch,
                "score": score,
                "reason": reason,
                "common_tags": matched_terms.get(ch_id, []),
                "recent_velocity": velocity,
            })

        candidates.sort(key=lambda x: x["score"], reverse=True)
        return {
            "seed_channel_id": seed_id,
            "seed_title": seed_record["title"],
            "terms_used": terms,
            "candidates": candidates[:max_results],
            "quota_used_today": db.get_quota_usage(conn),
        }
    finally:
        if own_client:
            client.close()


def discover_by_keyword(
    keyword: str,
    max_results: int = 25,
    min_subs: int | None = None,
    max_subs: int | None = None,
    min_score: float = 0.0,
    client: youtube.YouTubeClient | None = None,
) -> dict:
    """Descobre canais a partir de uma keyword/termo de busca."""
    own_client = client is None
    client = client or youtube.YouTubeClient()
    try:
        conn = client.conn
        terms = [keyword, f"{keyword} música", f"{keyword} playlist"]
        video_overlaps, video_terms = _search_results_to_channel_overlaps(
            client, terms, exclude_channel_ids=set(),
            results_per_term=max_results, days=SEARCH_DAYS, search_type="video",
        )
        channel_overlaps, channel_terms = _search_results_to_channel_overlaps(
            client, [keyword], exclude_channel_ids=set(),
            results_per_term=max_results, days=SEARCH_DAYS, search_type="channel",
        )

        overlaps: dict[str, int] = Counter(video_overlaps)
        matched_terms: dict[str, list[str]] = {k: list(v) for k, v in video_terms.items()}
        for ch_id, count in channel_overlaps.items():
            overlaps[ch_id] = overlaps.get(ch_id, 0) + (count * 2)
            matched_terms.setdefault(ch_id, []).extend(channel_terms.get(ch_id, []))

        candidate_ids = sorted(overlaps, key=lambda x: overlaps[x], reverse=True)[:max_results * 2]
        enriched = _enrich_channels(client, candidate_ids)

        candidates: list[dict] = []
        for ch in enriched:
            ch_id = ch["id"]
            velocity = _recent_video_velocity(client, ch_id, max_videos=5)
            score, reason = _score_candidate(
                ch, overlaps[ch_id], matched_terms.get(ch_id, []),
                seed_subs=0, min_subs=min_subs, max_subs=max_subs,
                recent_velocity=velocity,
            )
            if score < min_score:
                continue

            ch["source"] = f"discover:keyword:{keyword}"
            ch["discovered_at"] = _now_iso()
            db.upsert_channel(conn, ch)
            db.upsert_discovery_candidate(conn, {
                "channel_id": ch_id,
                "seed_keyword": keyword,
                "score": score,
                "reason": reason,
                "common_tags": matched_terms.get(ch_id, []),
                "discovered_at": _now_iso(),
            })

            candidates.append({
                "channel": ch,
                "score": score,
                "reason": reason,
                "common_tags": matched_terms.get(ch_id, []),
                "recent_velocity": velocity,
            })

        candidates.sort(key=lambda x: x["score"], reverse=True)
        return {
            "seed_keyword": keyword,
            "terms_used": terms,
            "candidates": candidates[:max_results],
            "quota_used_today": db.get_quota_usage(conn),
        }
    finally:
        if own_client:
            client.close()
