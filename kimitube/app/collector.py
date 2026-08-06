"""Coletor diário — snapshots de canais tracked e vídeos recentes.

Roda 1x/dia (02:00 via scheduler). Custo estimado: ~2-5 unidades de quota
por canal (1x channels.list + 1x playlistItems + 1x videos.list batched).
"""

import logging
from statistics import mean

from . import db, youtube

logger = logging.getLogger(__name__)


def collect_channel_snapshots(client: youtube.YouTubeClient | None = None) -> dict:
    """Grava snapshot do dia para cada canal tracked e dos vídeos recentes."""
    own_client = client is None
    client = client or youtube.YouTubeClient()
    conn = client.conn
    collected, errors = 0, []
    try:
        channels = db.get_tracked_channels(conn)
        for ch in channels:
            try:
                item = client.get_channel_by_id(ch["id"])
                if not item:
                    errors.append({"channel_id": ch["id"], "error": "canal não encontrado"})
                    continue
                stats = item.get("statistics", {})
                db.upsert_channel(conn, youtube.channel_to_record(item))
                db.upsert_channel_snapshot(
                    conn, ch["id"],
                    subs=int(stats.get("subscriberCount", 0)),
                    total_views=int(stats.get("viewCount", 0)),
                    video_count=int(stats.get("videoCount", 0)),
                )
                # Vídeos recentes: atualiza metadados + snapshot de stats.
                uploads_id = client.get_uploads_playlist_id(item)
                video_ids = client.list_uploads(uploads_id, max_items=50)
                for v in client.get_videos(video_ids):
                    vrec = youtube.video_to_record(v, ch["id"])
                    db.upsert_video(conn, vrec)
                    vst = v.get("statistics", {})
                    db.upsert_video_snapshot(
                        conn, v["id"],
                        views=int(vst.get("viewCount", 0)),
                        likes=int(vst.get("likeCount", 0)),
                        comments=int(vst.get("commentCount", 0)),
                    )
                collected += 1
            except Exception as e:  # noqa: BLE001 — loga e segue para o próximo canal
                logger.exception("Erro coletando canal %s", ch["id"])
                errors.append({"channel_id": ch["id"], "error": str(e)})
        result = {"channels_collected": collected, "errors": errors,
                  "quota_used_today": db.get_quota_usage(conn)}
        logger.info("Coleta diária concluída: %s", result)
        return result
    finally:
        if own_client:
            client.close()


def collect_keyword_snapshots(client: youtube.YouTubeClient | None = None,
                              use_trends: bool = True) -> dict:
    """Coleta diária de keywords: search.list (100 un.) + Google Trends.

    Fase 1: implementado, mas só roda com keywords cadastradas. Limitar a
    ~30 keywords ativas para não estourar a quota diária.
    """
    own_client = client is None
    client = client or youtube.YouTubeClient()
    conn = client.conn
    collected, errors = 0, []
    try:
        keywords = db.get_active_keywords(conn)
        if len(keywords) > 30:
            logger.warning("%d keywords ativas (>30) — risco de quota. Coletando as 30 primeiras.",
                           len(keywords))
            keywords = keywords[:30]
        for kw in keywords:
            try:
                items = client.search_recent_videos(kw["term"], days=30)
                video_ids = [i["id"]["videoId"] for i in items if "videoId" in i.get("id", {})]
                views = []
                if video_ids:
                    for v in client.get_videos(video_ids):
                        views.append(int(v.get("statistics", {}).get("viewCount", 0)))
                trends_index = None
                if use_trends:
                    trends_index = _trends_interest(kw["term"])
                db.upsert_keyword_snapshot(
                    conn, kw["id"],
                    avg_views_recent=round(mean(views), 1) if views else 0.0,
                    video_count_recent=len(items),
                    trends_index=trends_index,
                )
                collected += 1
            except Exception as e:  # noqa: BLE001
                logger.exception("Erro coletando keyword %s", kw["term"])
                errors.append({"term": kw["term"], "error": str(e)})
        return {"keywords_collected": collected, "errors": errors,
                "quota_used_today": db.get_quota_usage(conn)}
    finally:
        if own_client:
            client.close()


def _trends_interest(term: str) -> float | None:
    """Interesse médio no Google Trends (0-100) nos últimos 30 dias via pytrends."""
    try:
        from pytrends.request import TrendReq

        pt = TrendReq(hl="pt-BR", tz=180)
        pt.build_payload([term], timeframe="today 1-m")
        df = pt.interest_over_time()
        if df is None or df.empty or term not in df.columns:
            return None
        return round(float(df[term].mean()), 1)
    except Exception:  # noqa: BLE001 — pytrends é não-oficial, falha é tolerável
        logger.warning("pytrends falhou para termo %r", term, exc_info=True)
        return None
