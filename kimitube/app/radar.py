"""Radar — crescimento de canais, keywords aquecendo e radar score (outliers).

Todos os cálculos são funções puras (testáveis sem rede/banco); as funções de
alto nível leem snapshots do SQLite.
"""

import sqlite3
from datetime import date, timedelta
from statistics import mean, median, pstdev

from . import db

WINDOWS_DAYS = (30, 90, 150)  # janelas de crescimento conforme plano


# ---------------------------------------------------------------------------
# Funções puras de cálculo
# ---------------------------------------------------------------------------

def growth_pct(current: float, past: float) -> float | None:
    """Crescimento percentual entre dois pontos; None se base inválida."""
    if past <= 0:
        return None
    return round(100 * (current - past) / past, 2)


def growth_over_window(snapshots: list[tuple[str, int]], days: int,
                       today: date | None = None) -> float | None:
    """Crescimento % de `subs` na janela de N dias, dado [(date_iso, subs)] ordenado.

    Usa o snapshot mais antigo dentro da janela como base (ou o mais antigo
    disponível, se todos forem mais recentes — dados desde a instalação).
    """
    if len(snapshots) < 2:
        return None
    today = today or date.today()
    cutoff = (today - timedelta(days=days)).isoformat()
    current = snapshots[-1][1]
    in_window = [(d, s) for d, s in snapshots if d >= cutoff]
    base = in_window[0][1] if len(in_window) >= 2 else snapshots[0][1]
    return growth_pct(current, base)


def consistency_ratio(snapshots: list[tuple[str, int]]) -> float | None:
    """% de semanas com crescimento positivo (0-100).

    snapshots: [(date_iso, subs)] ordenado cronologicamente. Agrupa por
    semana ISO e compara o último valor de cada semana com o da anterior.
    """
    if len(snapshots) < 2:
        return None
    weekly: dict[tuple[int, int], int] = {}
    for d, subs in snapshots:
        dt = date.fromisoformat(d)
        iso = dt.isocalendar()
        weekly[(iso[0], iso[1])] = subs  # último valor da semana sobrescreve
    weeks = sorted(weekly)
    if len(weeks) < 2:
        return None
    positive = sum(
        1 for a, b in zip(weeks, weeks[1:]) if weekly[b] > weekly[a]
    )
    return round(100 * positive / (len(weeks) - 1), 1)


def views_gained_per_day(snapshots: list[tuple[str, int, int]],
                         days: int = 30,
                         today: date | None = None) -> float | None:
    """Views ganhas por dia na janela, dado [(date_iso, subs, total_views)]."""
    if len(snapshots) < 2:
        return None
    today = today or date.today()
    cutoff = (today - timedelta(days=days)).isoformat()
    in_window = [s for s in snapshots if s[0] >= cutoff]
    if len(in_window) >= 2:
        first, last = in_window[0], in_window[-1]
    else:
        first, last = snapshots[0], snapshots[-1]
    span = (date.fromisoformat(last[0]) - date.fromisoformat(first[0])).days
    if span <= 0:
        return None
    return round((last[2] - first[2]) / span, 1)


def zscore(value: float, population: list[float]) -> float | None:
    """Z-score de value contra a população; None se desvio = 0."""
    if len(population) < 2:
        return None
    sd = pstdev(population)
    if sd == 0:
        return None
    return (value - mean(population)) / sd


def radar_score(views_30d_per_sub: float, recent_views_per_day_per_sub: float,
                acceleration: float, peers: dict[str, list[float]]) -> dict:
    """Radar score 0-100 combinando z-scores contra pares do mesmo nicho/faixa.

    Componentes (conforme plano):
    a) views-30d/inscritos vs mediana dos pares
    b) views/dia dos últimos vídeos por inscrito
    c) aceleração (crescimento 30d vs 90d)

    peers: {"views_per_sub": [...], "vpd_per_sub": [...], "acceleration": [...]}
    """
    components = {}
    zs = []
    for key, value in (("views_per_sub", views_30d_per_sub),
                       ("vpd_per_sub", recent_views_per_day_per_sub),
                       ("acceleration", acceleration)):
        z = zscore(value, peers.get(key, []))
        components[key] = {"value": round(value, 4), "zscore": round(z, 2) if z is not None else None}
        if z is not None:
            zs.append(z)
    if not zs:
        return {"score": None, "components": components}
    # z médio → 0-100 com tanh suave: z=0 → 50, z=+2 → ~96, z=-2 → ~4
    import math
    z_avg = sum(zs) / len(zs)
    score = round(50 * (1 + math.tanh(z_avg / 2)), 1)
    return {"score": max(0.0, min(100.0, score)), "components": components}


def sub_tier(subs: int) -> str:
    """Faixa de inscritos para comparar canais com pares equivalentes."""
    if subs < 1_000:
        return "micro"
    if subs < 10_000:
        return "pequeno"
    if subs < 100_000:
        return "medio"
    if subs < 1_000_000:
        return "grande"
    return "gigante"


# ---------------------------------------------------------------------------
# Consultas de alto nível (lêem o banco)
# ---------------------------------------------------------------------------

def _channel_metrics(conn: sqlite3.Connection, channel: sqlite3.Row,
                     today: date | None = None) -> dict:
    snaps = db.get_channel_snapshots(conn, channel["id"])
    sub_snaps = [(s["date"], s["subs"]) for s in snaps]
    view_snaps = [(s["date"], s["subs"], s["total_views"]) for s in snaps]
    growth = {f"growth_{d}d_pct": growth_over_window(sub_snaps, d, today)
              for d in WINDOWS_DAYS}
    consistency = consistency_ratio(sub_snaps)
    vpd = views_gained_per_day(view_snaps, 30, today)
    acceleration = None
    g30, g90 = growth["growth_30d_pct"], growth["growth_90d_pct"]
    if g30 is not None and g90 is not None:
        acceleration = round(g30 - g90 / 3, 2)  # ritmo 30d vs ritmo médio 90d
    return {
        "id": channel["id"],
        "title": channel["title"],
        "handle": channel["handle"],
        "thumbnail_url": channel["thumbnail_url"],
        "niche": channel["niche"],
        "subs": snaps[-1]["subs"] if snaps else None,
        "tier": sub_tier(snaps[-1]["subs"]) if snaps else None,
        "consistency_pct": consistency,
        "views_per_day_30d": vpd,
        "acceleration": acceleration,
        "snapshots_count": len(snaps),
        **growth,
    }


def radar_channels(conn: sqlite3.Connection, niche: str | None = None,
                   min_subs: int | None = None, max_subs: int | None = None,
                   min_growth_30d: float | None = None,
                   min_consistency: float | None = None) -> list[dict]:
    """Lista canais tracked com métricas de crescimento e filtros."""
    channels = db.get_tracked_channels(conn)
    result = []
    for ch in channels:
        m = _channel_metrics(conn, ch)
        if niche and (m["niche"] or "") != niche:
            continue
        if min_subs is not None and (m["subs"] or 0) < min_subs:
            continue
        if max_subs is not None and (m["subs"] or 0) > max_subs:
            continue
        if min_growth_30d is not None and (m["growth_30d_pct"] or 0) < min_growth_30d:
            continue
        if min_consistency is not None and (m["consistency_pct"] or 0) < min_consistency:
            continue
        result.append(m)
    result.sort(key=lambda m: m["growth_30d_pct"] if m["growth_30d_pct"] is not None else -1,
                reverse=True)
    return result


def radar_outliers(conn: sqlite3.Connection, niche: str | None = None) -> list[dict]:
    """Canais tracked com radar score 0-100 (z-score vs pares do nicho/faixa)."""
    metrics = [m for m in (_channel_metrics(conn, ch)
                           for ch in db.get_tracked_channels(conn))
               if m["subs"]]
    if niche:
        metrics = [m for m in metrics if (m["niche"] or "") == niche]

    scored = []
    for m in metrics:
        # pares = mesmo nicho e mesma faixa de inscritos
        peers = [p for p in metrics if p is not m
                 and (p["niche"] or "") == (m["niche"] or "")
                 and p["tier"] == m["tier"]]
        views_30d = (m["views_per_day_30d"] or 0) * 30
        peer_group = {
            "views_per_sub": [(p["views_per_day_30d"] or 0) * 30 / p["subs"] for p in peers],
            "vpd_per_sub": [(p["views_per_day_30d"] or 0) / p["subs"] for p in peers],
            "acceleration": [p["acceleration"] or 0 for p in peers],
        }
        s = radar_score(views_30d / m["subs"],
                        (m["views_per_day_30d"] or 0) / m["subs"],
                        m["acceleration"] or 0, peer_group)
        scored.append({**m, "radar_score": s["score"], "score_components": s["components"],
                       "peers_count": len(peers)})
    scored.sort(key=lambda m: m["radar_score"] if m["radar_score"] is not None else -1,
                reverse=True)
    return scored


def shorts_vs_long_by_niche(conn: sqlite3.Connection) -> list[dict]:
    """Compara Shorts vs long-form por nicho com base em vídeos já coletados."""
    tracked = db.get_tracked_channels(conn)
    groups: dict[str, dict] = {}
    for ch in tracked:
        niche = ch["niche"] or "Sem nicho"
        bucket = groups.setdefault(niche, {
            "niche": niche,
            "shorts_count": 0,
            "longs_count": 0,
            "shorts_avg_views": None,
            "longs_avg_views": None,
            "dominant_format": "—",
        })
        recent = db.get_recent_videos(conn, ch["id"], limit=50)
        short_views = []
        long_views = []
        for v in recent:
            snaps = db.get_video_snapshots(conn, v["id"])
            last_views = snaps[-1]["views"] if snaps else 0
            if v["is_short"]:
                bucket["shorts_count"] += 1
                short_views.append(last_views)
            else:
                bucket["longs_count"] += 1
                long_views.append(last_views)
        if short_views:
            bucket["shorts_avg_views"] = round(mean(short_views), 1)
        if long_views:
            bucket["longs_avg_views"] = round(mean(long_views), 1)

    for b in groups.values():
        s = b["shorts_avg_views"] or 0
        l = b["longs_avg_views"] or 0
        if s > l:
            b["dominant_format"] = "shorts"
        elif l > s:
            b["dominant_format"] = "long-form"
        else:
            b["dominant_format"] = "equilibrado"
    return sorted(groups.values(), key=lambda x: x["niche"])


def estimate_revenue_by_niche(conn: sqlite3.Connection, rpm_min: float = 1.0,
                              rpm_max: float = 4.0) -> list[dict]:
    """Estimativa mensal de receita por nicho via views/dia e faixa de RPM."""
    tracked = db.get_tracked_channels(conn)
    buckets: dict[str, dict] = {}
    for ch in tracked:
        m = _channel_metrics(conn, ch)
        views_per_day = m["views_per_day_30d"] or 0
        niche = m["niche"] or "Sem nicho"
        b = buckets.setdefault(niche, {"niche": niche, "channels": 0, "views_per_day": 0.0})
        b["channels"] += 1
        b["views_per_day"] += views_per_day

    result = []
    for b in buckets.values():
        monthly_views = b["views_per_day"] * 30
        rev_min = (monthly_views / 1000) * rpm_min
        rev_max = (monthly_views / 1000) * rpm_max
        result.append({
            "niche": b["niche"],
            "channels": b["channels"],
            "views_per_day": round(b["views_per_day"], 1),
            "monthly_views_est": round(monthly_views, 1),
            "revenue_min_est": round(rev_min, 2),
            "revenue_max_est": round(rev_max, 2),
        })
    result.sort(key=lambda x: x["monthly_views_est"], reverse=True)
    return result

def radar_keywords(conn: sqlite3.Connection) -> list[dict]:
    """Keywords ativas com o snapshot mais recente e tendência semanal."""
    result = []
    for kw in db.get_active_keywords(conn):
        snaps = conn.execute(
            "SELECT * FROM keyword_snapshots WHERE keyword_id = ? ORDER BY date",
            (kw["id"],),
        ).fetchall()
        latest = snaps[-1] if snaps else None
        trend = None
        if len(snaps) >= 2:
            prev = snaps[max(0, len(snaps) - 8)]  # ~1 semana atrás (coleta diária)
            if prev["avg_views_recent"]:
                trend = growth_pct(latest["avg_views_recent"], prev["avg_views_recent"])
        result.append({
            "id": kw["id"],
            "term": kw["term"],
            "niche": kw["niche"],
            "avg_views_recent": latest["avg_views_recent"] if latest else None,
            "video_count_recent": latest["video_count_recent"] if latest else None,
            "trends_index": latest["trends_index"] if latest else None,
            "weekly_growth_pct": trend,
            "snapshots_count": len(snaps),
        })
    result.sort(key=lambda k: k["weekly_growth_pct"] if k["weekly_growth_pct"] is not None else -1,
                reverse=True)
    return result