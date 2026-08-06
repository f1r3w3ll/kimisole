"""Kimitube — FastAPI app: rotas REST + static/ + scheduler."""

import csv
import io
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import alerts, collector, config, db, discovery, metadata_gen, radar, spy, youtube
from .scheduler import create_scheduler

logger = logging.getLogger(__name__)

scheduler = create_scheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    metadata_gen.THUMBS_DIR.mkdir(parents=True, exist_ok=True)
    scheduler.start()
    logger.info("Kimitube iniciado. DB em %s", config.DB_PATH)
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="Kimitube", version="0.1.0", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Models de request
# ---------------------------------------------------------------------------

class SpyRequest(BaseModel):
    query: str = Field(..., description="Handle (@x), URL youtube.com/... ou channel ID")
    max_videos: int = Field(default=config.SPY_MAX_VIDEOS, ge=1, le=200)


class TrackRequest(BaseModel):
    channel_id: str
    niche: str | None = None
    tracked: bool = True


class KeywordRequest(BaseModel):
    term: str
    niche: str | None = None
    active: bool = True


class DiscoverRequest(BaseModel):
    seed: str = Field(..., description="Canal (@handle, URL ou ID) ou keyword/termo de busca")
    strategy: str = Field(default="related", description="related (por canal) ou keyword (por termo)")
    max_results: int = Field(default=25, ge=1, le=50)
    min_subs: int | None = Field(default=None, ge=0)
    max_subs: int | None = Field(default=None, ge=0)
    min_score: float = Field(default=0.0, ge=0.0, le=100.0)


class CompareRequest(BaseModel):
    queries: list[str] = Field(..., min_length=2, max_length=4,
                                 description="Lista de 2 a 4 canais (handle, URL ou ID)")


class AutoDiscoverRequest(BaseModel):
    max_per_seed: int = Field(default=10, ge=1, le=25)
    include_tracked: bool = True
    include_keywords: bool = True

    min_score: float = Field(default=0.0, ge=0.0, le=100.0)


class MetadataRequest(BaseModel):
    query: str = Field(..., description="video_id ou URL do vídeo no YouTube")


class ApiKeyRequest(BaseModel):
    key: str = Field(..., min_length=10, description="Chave da YouTube Data API v3")


# ---------------------------------------------------------------------------
# Spy / tracking
# ---------------------------------------------------------------------------

@app.post("/api/spy")
def api_spy(req: SpyRequest):
    """Espiona um canal: estatísticas completas dos últimos vídeos."""
    try:
        return spy.spy_channel(req.query, max_videos=req.max_videos)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except (youtube.QuotaExceededAPIError, youtube.YouTubeAPIError) as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/channels/track")
def api_track(req: TrackRequest):
    """Adiciona/remove canal do radar (tracked=1), com nicho opcional."""
    with db.get_conn() as conn:
        channel = db.get_channel(conn, req.channel_id)
        if not channel:
            raise HTTPException(
                status_code=404,
                detail="Canal não encontrado no banco local. Rode POST /api/spy primeiro.",
            )
        db.set_tracked(conn, req.channel_id, req.tracked, req.niche)
        updated = db.get_channel(conn, req.channel_id)
    return {"ok": True, "channel": dict(updated)}


@app.post("/api/compare")
def api_compare(req: CompareRequest):
    """Comparação lado a lado de concorrentes (2 a 4 canais)."""
    rows = []
    for query in req.queries:
        try:
            data = spy.spy_channel(query, max_videos=30)
            channel = data["channel"]
            rows.append({
                "query": query,
                "id": channel["id"],
                "title": channel["title"],
                "subs": channel["subs"],
                "views_total": channel["total_views"],
                "engagement_pct": data["engagement_pct"],
                "videos_per_week": data["posting_frequency"]["videos_per_week"],
                "pct_shorts": data["shorts_vs_long"]["pct_shorts"],
                "avg_views": data["averages"]["views"],
            })
        except Exception as e:  # noqa: BLE001
            rows.append({"query": query, "error": str(e)})
    ok = [r for r in rows if "error" not in r]
    leader = max(ok, key=lambda r: (r["avg_views"], r["engagement_pct"])) if ok else None
    return {"items": rows, "leader": leader}


# ---------------------------------------------------------------------------
# Radar
# ---------------------------------------------------------------------------

@app.get("/api/radar/channels")
def api_radar_channels(
    niche: str | None = None,
    min_subs: int | None = None,
    max_subs: int | None = None,
    min_growth_30d: float | None = None,
    min_consistency: float | None = None,
):
    """Canais tracked com crescimento 30/90/150d, consistência e views/dia."""
    with db.get_conn() as conn:
        return radar.radar_channels(conn, niche=niche, min_subs=min_subs,
                                    max_subs=max_subs, min_growth_30d=min_growth_30d,
                                    min_consistency=min_consistency)


@app.get("/api/radar/channels/{channel_id}/snapshots")
def api_channel_snapshots(channel_id: str):
    """Série de snapshots do canal (datas, subs, views) para o gráfico."""
    with db.get_conn() as conn:
        if not db.get_channel(conn, channel_id):
            raise HTTPException(status_code=404, detail="Canal não encontrado.")
        return [dict(s) for s in db.get_channel_snapshots(conn, channel_id)]


@app.get("/api/radar/outliers")
def api_radar_outliers(niche: str | None = None):
    """Radar score 0-100 por canal (z-score contra pares do nicho/faixa)."""
    with db.get_conn() as conn:
        return radar.radar_outliers(conn, niche=niche)


@app.get("/api/radar/shorts-vs-long")
def api_radar_shorts_vs_long():
    """Comparativo Shorts vs long-form por nicho."""
    with db.get_conn() as conn:
        return radar.shorts_vs_long_by_niche(conn)


@app.get("/api/radar/revenue-estimate")
def api_radar_revenue_estimate(rpm_min: float = 1.0, rpm_max: float = 4.0):
    """Estimativa de receita mensal por nicho com faixa de RPM."""
    with db.get_conn() as conn:
        return radar.estimate_revenue_by_niche(conn, rpm_min=rpm_min, rpm_max=rpm_max)


@app.get("/api/radar/keywords")
def api_radar_keywords():
    """Keywords ativas com sinais de aquecimento (views recentes + trends)."""
    with db.get_conn() as conn:
        return radar.radar_keywords(conn)


@app.post("/api/keywords")
def api_add_keyword(req: KeywordRequest):
    """Cadastra/atualiza uma keyword para monitoramento diário."""
    with db.get_conn() as conn:
        keyword_id = db.upsert_keyword(conn, req.term, req.niche, req.active)
    return {"ok": True, "keyword_id": keyword_id}


# ---------------------------------------------------------------------------
# Descoberta de canais similares
# ---------------------------------------------------------------------------

@app.post("/api/discover")
def api_discover(req: DiscoverRequest):
    """Descobre canais similares a partir de um canal ou keyword."""
    try:
        if req.strategy == "keyword":
            return discovery.discover_by_keyword(
                req.seed, max_results=req.max_results,
                min_subs=req.min_subs, max_subs=req.max_subs,
                min_score=req.min_score,
            )
        return discovery.discover_by_channel(
            req.seed, max_results=req.max_results,
            min_subs=req.min_subs, max_subs=req.max_subs,
            min_score=req.min_score,
        )
    except discovery.DiscoveryError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except (youtube.QuotaExceededAPIError, youtube.YouTubeAPIError) as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/discover/auto")
def api_discover_auto(req: AutoDiscoverRequest):
    """Executa descoberta automática por canais monitorados e keywords ativas."""
    with db.get_conn() as conn:
        tracked = db.get_tracked_channels(conn) if req.include_tracked else []
        keywords = db.get_active_keywords(conn) if req.include_keywords else []

    runs = []
    errors = []
    for ch in tracked:
        try:
            result = discovery.discover_by_channel(ch["id"], max_results=req.max_per_seed,
                                                     min_score=req.min_score)
            runs.append({
                "type": "channel",
                "seed": ch["id"],
                "candidates": len(result.get("candidates", [])),
            })
        except Exception as e:  # noqa: BLE001
            errors.append({"type": "channel", "seed": ch["id"], "error": str(e)})

    for kw in keywords:
        try:
            result = discovery.discover_by_keyword(kw["term"], max_results=req.max_per_seed,
                                                   min_score=req.min_score)
            runs.append({
                "type": "keyword",
                "seed": kw["term"],
                "candidates": len(result.get("candidates", [])),
            })
        except Exception as e:  # noqa: BLE001
            errors.append({"type": "keyword", "seed": kw["term"], "error": str(e)})

    return {
        "runs": runs,
        "errors": errors,
        "processed": len(runs),
        "failed": len(errors),
    }


@app.get("/api/discover/candidates")
def api_discover_candidates(
    tracked: bool | None = None,
    min_score: float | None = None,
    seed_channel_id: str | None = None,
    seed_keyword: str | None = None,
    limit: int = 100,
):
    """Lista candidatos descobertos previamente."""
    with db.get_conn() as conn:
        rows = db.get_discovery_candidates(
            conn, tracked=tracked, min_score=min_score,
            seed_channel_id=seed_channel_id, seed_keyword=seed_keyword,
            limit=limit,
        )
        return [dict(r) for r in rows]


@app.post("/api/discover/candidates/{channel_id}/track")
def api_discover_track(channel_id: str, niche: str | None = None):
    """Promove um candidato descoberto para monitorado no radar."""
    with db.get_conn() as conn:
        channel = db.get_channel(conn, channel_id)
        if not channel:
            raise HTTPException(status_code=404, detail="Canal não encontrado.")
        db.set_tracked(conn, channel_id, True, niche)
        updated = db.get_channel(conn, channel_id)
    return {"ok": True, "channel": dict(updated)}


# ---------------------------------------------------------------------------
# Export CSV/PDF de watchlists
# ---------------------------------------------------------------------------

def _simple_pdf_from_lines(lines: list[str]) -> bytes:
    text = "\\n".join(line.replace("(", "[").replace(")", "]") for line in lines)
    stream = f"BT /F1 10 Tf 40 800 Td ({text}) Tj ET"
    objects = [
        b"1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
        b"2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
        b"3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>endobj\n",
        b"4 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
        f"5 0 obj<< /Length {len(stream.encode('latin-1', errors='ignore'))} >>stream\n{stream}\nendstream endobj\n".encode("latin-1", errors="ignore"),
    ]
    out = b"%PDF-1.4\n"
    offsets = [0]
    for obj in objects:
        offsets.append(len(out))
        out += obj
    xref_pos = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode("latin-1")
    out += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        out += f"{off:010d} 00000 n \n".encode("latin-1")
    out += f"trailer<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF".encode("latin-1")
    return out


@app.get("/api/watchlist/export.csv")
def api_watchlist_export_csv():
    """Exporta watchlist (canais monitorados) em CSV."""
    with db.get_conn() as conn:
        rows = radar.radar_channels(conn)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["channel_id", "title", "niche", "subs", "growth_30d_pct", "growth_90d_pct", "views_per_day_30d"])
    for r in rows:
        writer.writerow([r["id"], r["title"], r["niche"], r["subs"], r["growth_30d_pct"], r["growth_90d_pct"], r["views_per_day_30d"]])
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=watchlist.csv"},
    )


@app.get("/api/watchlist/export.pdf")
def api_watchlist_export_pdf():
    """Exporta watchlist (canais monitorados) em PDF simples."""
    with db.get_conn() as conn:
        rows = radar.radar_channels(conn)
    lines = ["Kimitube Watchlist", ""]
    for r in rows[:30]:
        lines.append(f"{r['title']} | niche={r['niche'] or '-'} | subs={r['subs'] or 0} | g30={r['growth_30d_pct']}")
    pdf = _simple_pdf_from_lines(lines)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=watchlist.pdf"},
    )


# ---------------------------------------------------------------------------
# Coleta manual / quota
# ---------------------------------------------------------------------------

@app.post("/api/collect")
def api_collect_now():
    """Dispara o coletor diário manualmente (snapshots de canais tracked)."""
    try:
        return collector.collect_channel_snapshots()
    except (youtube.QuotaExceededAPIError, youtube.YouTubeAPIError) as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/quota")
def api_quota():
    """Consumo de quota do dia."""
    with db.get_conn() as conn:
        used = db.get_quota_usage(conn)
    return {"units_used_today": used, "daily_limit": config.DAILY_QUOTA_LIMIT}


# ---------------------------------------------------------------------------
# Metadados com IA / Alertas / Configurações
# ---------------------------------------------------------------------------

@app.post("/api/settings/api-key")
def api_save_api_key(req: ApiKeyRequest):
    """Salva a chave da YouTube API no .env e aplica em tempo de execução."""
    config.save_env_var("YOUTUBE_API_KEY", req.key.strip())
    return {"ok": True, "status": config.get_api_key_status()}


@app.get("/api/settings")
def api_settings():
    """Configurações atuais da aplicação (chaves mascaradas)."""
    return {
        "youtube_api_key": config.get_api_key_status(),
        "daily_quota_limit": config.DAILY_QUOTA_LIMIT,
        "smtp_configured": bool(config.SMTP_HOST and config.SMTP_USER and config.SMTP_PASS and config.ALERT_EMAIL_TO),
        "moonshot_configured": bool(config.MOONSHOT_API_KEY),
    }


@app.post("/api/metadata")
def api_metadata(req: MetadataRequest):
    """Gera capa (prompt IA), títulos, descrição e tags prontos para publicar."""
    try:
        return metadata_gen.generate_metadata(req.query)
    except metadata_gen.MetadataUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except metadata_gen.MetadataError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except (youtube.QuotaExceededAPIError, youtube.YouTubeAPIError) as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/alerts/check")
def api_alerts_check():
    """Executa o polling RSS manualmente e retorna os vídeos novos."""
    return alerts.check_new_videos()


@app.get("/api/alerts")
def api_alerts_history(limit: int = 100):
    """Histórico de alertas enviados/registrados."""
    with db.get_conn() as conn:
        return [dict(r) for r in db.get_alerts(conn, limit=limit)]


# ---------------------------------------------------------------------------
# Static / frontend
# ---------------------------------------------------------------------------

STATIC_DIR = config.BASE_DIR / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
metadata_gen.THUMBS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/thumbnails", StaticFiles(directory=metadata_gen.THUMBS_DIR), name="thumbnails")


@app.get("/")
def index():
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"app": "kimitube", "docs": "/docs", "frontend": "fase 2"}
