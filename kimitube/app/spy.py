"""Spy de canal — estatísticas completas de um canal do YouTube.

resolve o canal (handle/URL/ID) → uploads playlist → últimos ~50 vídeos
(batched) → calcula estatísticas agregadas.
"""

import re
from collections import Counter
from datetime import datetime, timezone
from statistics import mean

from . import config, db, youtube


def _parse_dt(iso: str | None) -> datetime | None:
    if not iso:
        return None
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def compute_posting_frequency(published_dates: list[datetime]) -> dict:
    """Frequência de postagem: vídeos/semana e intervalo médio entre posts."""
    if len(published_dates) < 2:
        return {"videos_per_week": None, "avg_days_between_posts": None}
    dates = sorted(published_dates)
    span_days = max((dates[-1] - dates[0]).days, 1)
    return {
        "videos_per_week": round(len(dates) / (span_days / 7), 2),
        "avg_days_between_posts": round(span_days / (len(dates) - 1), 1),
    }


def compute_best_time(published_dates: list[datetime]) -> dict:
    """Melhor dia da semana e horário (UTC) com mais publicações."""
    if not published_dates:
        return {"best_weekday": None, "best_hour_utc": None}
    weekdays = Counter(d.strftime("%A") for d in published_dates)
    hours = Counter(d.hour for d in published_dates)
    return {
        "best_weekday": weekdays.most_common(1)[0][0],
        "best_hour_utc": hours.most_common(1)[0][0],
    }


def compute_title_patterns(titles: list[str]) -> dict:
    """Padrões de título: % com números, perguntas, maiúsculas, tamanho médio."""
    if not titles:
        return {"avg_length": None, "pct_with_numbers": 0, "pct_questions": 0,
                "pct_all_caps_words": 0}
    total = len(titles)
    with_numbers = sum(1 for t in titles if re.search(r"\d", t))
    questions = sum(1 for t in titles if "?" in t)
    caps = sum(1 for t in titles
               if any(w.isupper() and len(w) > 2 for w in t.split()))
    return {
        "avg_length": round(mean(len(t) for t in titles), 1),
        "pct_with_numbers": round(100 * with_numbers / total, 1),
        "pct_questions": round(100 * questions / total, 1),
        "pct_all_caps_words": round(100 * caps / total, 1),
    }


def compute_video_outliers(videos: list[dict]) -> list[dict]:
    """Outliers de vídeos nas primeiras 24-72h pelo multiplicador de views."""
    now = datetime.now(timezone.utc)
    window = []
    for v in videos:
        dt = _parse_dt(v.get("published_at"))
        if not dt:
            continue
        age_hours = (now - dt).total_seconds() / 3600
        if 24 <= age_hours <= 72:
            window.append({**v, "age_hours": round(age_hours, 1)})
    if not window:
        return []
    baseline = mean(v.get("views", 0) for v in window) or 1
    outliers = []
    for v in window:
        mult = v.get("views", 0) / baseline
        if mult >= 1.5:
            outliers.append({
                "id": v["id"],
                "title": v["title"],
                "views": v.get("views", 0),
                "age_hours": v["age_hours"],
                "multiplier": round(mult, 2),
                "is_short": bool(v.get("is_short")),
                "thumbnail_url": v.get("thumbnail_url"),
            })
    outliers.sort(key=lambda x: x["multiplier"], reverse=True)
    return outliers[:5]


def spy_channel(query: str, max_videos: int = config.SPY_MAX_VIDEOS,
                client: youtube.YouTubeClient | None = None) -> dict:
    """Espiona um canal e retorna o pacote completo de estatísticas."""
    own_client = client is None
    client = client or youtube.YouTubeClient()
    try:
        item = client.resolve_channel(query)
        if not item:
            raise ValueError(f"Canal não encontrado: {query}")

        record = youtube.channel_to_record(item)
        stats = item.get("statistics", {})
        subs = int(stats.get("subscriberCount", 0))
        total_views = int(stats.get("viewCount", 0))
        video_count = int(stats.get("videoCount", 0))

        uploads_id = client.get_uploads_playlist_id(item)
        video_ids = client.list_uploads(uploads_id, max_items=max_videos)
        video_items = client.get_videos(video_ids)

        # Persiste canal e vídeos para o histórico local.
        conn = client.conn
        db.upsert_channel(conn, record)
        videos = []
        for v in video_items:
            vrec = youtube.video_to_record(v, record["id"])
            db.upsert_video(conn, vrec)
            vst = v.get("statistics", {})
            videos.append({**vrec, "views": int(vst.get("viewCount", 0)),
                           "likes": int(vst.get("likeCount", 0)),
                           "comments": int(vst.get("commentCount", 0))})

        # Crescimento local (se o canal já é monitorado há algum tempo).
        snapshots = db.get_channel_snapshots(conn, record["id"])
        growth_pct = None
        if len(snapshots) >= 2 and snapshots[0]["subs"] > 0:
            growth_pct = round(
                100 * (snapshots[-1]["subs"] - snapshots[0]["subs"]) / snapshots[0]["subs"], 2)

        # Agregados dos vídeos recentes.
        dates = [d for d in (_parse_dt(v["published_at"]) for v in videos) if d]
        views_list = [v["views"] for v in videos]
        likes_list = [v["likes"] for v in videos]
        comments_list = [v["comments"] for v in videos]
        shorts = [v for v in videos if v["is_short"]]
        all_tags = Counter(t for v in videos for t in (v.get("tags") or []))
        top_videos = sorted(videos, key=lambda v: v["views"], reverse=True)[:10]

        total_eng = sum(likes_list) + sum(comments_list)
        total_recent_views = sum(views_list)
        engagement_pct = (round(100 * total_eng / total_recent_views, 2)
                          if total_recent_views else 0.0)

        return {
            "channel": {
                **record,
                "subs": subs,
                "total_views": total_views,
                "video_count": video_count,
                "tracked": bool(db.get_channel(conn, record["id"])["tracked"])
                    if db.get_channel(conn, record["id"]) else False,
            },
            "growth_pct_local": growth_pct,
            "posting_frequency": compute_posting_frequency(dates),
            "best_time": compute_best_time(dates),
            "averages": {
                "views": round(mean(views_list)) if views_list else 0,
                "likes": round(mean(likes_list)) if likes_list else 0,
                "comments": round(mean(comments_list)) if comments_list else 0,
            },
            "engagement_pct": engagement_pct,
            "shorts_vs_long": {
                "shorts": len(shorts),
                "longs": len(videos) - len(shorts),
                "pct_shorts": round(100 * len(shorts) / len(videos), 1) if videos else 0,
            },
            "top_videos": [{
                "id": v["id"], "title": v["title"], "views": v["views"],
                "likes": v["likes"], "comments": v["comments"],
                "published_at": v["published_at"], "is_short": bool(v["is_short"]),
                "thumbnail_url": v["thumbnail_url"],
            } for v in top_videos],
            "top_tags": all_tags.most_common(20),
            "title_patterns": compute_title_patterns([v["title"] for v in videos]),
            "video_outliers_24_72h": compute_video_outliers(videos),
            "videos_analyzed": len(videos),
            "quota_used_today": db.get_quota_usage(conn),
        }
    finally:
        if own_client:
            client.close()
