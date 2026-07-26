"""
Kimi Code — Servidor FastAPI.

Endpoints:
  GET  /              -> web/index.html
  GET  /app.js, /styles.css
  GET  /api/roots     -> pastas marcadas
  POST /api/roots     -> adiciona pasta  {"path": "..."}
  DELETE /api/roots   -> remove pasta    {"path": "..."}
  GET  /api/tree      -> arvore de arquivos ?root=...
  POST /api/chat      -> SSE de eventos do agente {"session_id", "message"}
  POST /api/confirm   -> {"confirm_id", "approved"}
  POST /api/reset     -> limpa a conversa {"session_id"}
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from . import agent, storage, tools

APP_DIR = Path(__file__).parent.parent
WEB_DIR = APP_DIR / "web"

app = FastAPI(title="Kimi Code", docs_url=None, redoc_url=None)

# raiz inicial: a pasta do proprio projeto + raizes persistidas (sem duplicar)
persisted = storage.load_roots()
initial_roots = [str(APP_DIR)] + [p for p in persisted if p.lower() != str(APP_DIR).lower()]
tools.set_roots(initial_roots)

_IGNORE = tools._IGNORE_DIRS


# ---------------------------------------------------------------------------
# Estaticos
# ---------------------------------------------------------------------------
@app.get("/")
async def index():
    return FileResponse(WEB_DIR / "index.html")


@app.get("/app.js")
async def app_js():
    return FileResponse(WEB_DIR / "app.js", media_type="application/javascript")


@app.get("/styles.css")
async def styles():
    return FileResponse(WEB_DIR / "styles.css", media_type="text/css")


# ---------------------------------------------------------------------------
# Pastas marcadas (roots)
# ---------------------------------------------------------------------------
class RootBody(BaseModel):
    path: str


@app.get("/api/roots")
async def list_roots():
    return {"roots": [str(r) for r in tools.get_roots()]}


@app.post("/api/roots")
async def add_root(body: RootBody):
    try:
        rp = tools.add_root(body.path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "root": str(rp)}


@app.delete("/api/roots")
async def remove_root(body: RootBody):
    tools.remove_root(body.path)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Arvore de arquivos
# ---------------------------------------------------------------------------
def _build_tree(path: Path, depth: int = 0, max_depth: int = 6) -> list[dict]:
    if depth > max_depth:
        return []
    nodes = []
    try:
        entries = sorted(path.iterdir(), key=lambda x: (x.is_file(), x.name.lower()))
    except PermissionError:
        return []
    for e in entries:
        if e.name in _IGNORE or e.name.startswith("."):
            # mostra dotfiles comuns uteis, esconde o resto
            if e.name not in {".env.example", ".gitignore"}:
                continue
        if e.is_dir():
            nodes.append({
                "name": e.name, "path": str(e), "type": "dir",
                "children": _build_tree(e, depth + 1, max_depth),
            })
        else:
            nodes.append({"name": e.name, "path": str(e), "type": "file"})
    return nodes


@app.get("/api/tree")
async def tree(root: str):
    rp = Path(root).resolve()
    if rp not in tools.get_roots():
        raise HTTPException(status_code=403, detail="Pasta nao autorizada.")
    return {"root": str(rp), "tree": _build_tree(rp)}


# ---------------------------------------------------------------------------
# Sessoes de chat (persistencia)
# ---------------------------------------------------------------------------
class SessionCreate(BaseModel):
    title: str | None = None


class SessionRename(BaseModel):
    title: str


@app.get("/api/sessions")
async def list_sessions():
    return {"sessions": storage.list_sessions()}


@app.post("/api/sessions")
async def create_session(body: SessionCreate):
    session_id = f"web-{storage.now_safe()}-{uuid.uuid4().hex[:6]}"
    storage.save_session(session_id, [], title=body.title or "Nova conversa")
    return {"id": session_id, "title": body.title or "Nova conversa"}


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str):
    data = storage.load_session(session_id)
    if not data:
        raise HTTPException(status_code=404, detail="Sessao nao encontrada.")
    return data


@app.patch("/api/sessions/{session_id}")
async def rename_session(session_id: str, body: SessionRename):
    ok = storage.rename_session(session_id, body.title)
    if not ok:
        raise HTTPException(status_code=404, detail="Sessao nao encontrada.")
    return {"ok": True}


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    ok = agent.delete_session(session_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Sessao nao encontrada.")
    return {"ok": True}


@app.post("/api/sessions/{session_id}/export")
async def export_session(session_id: str):
    path = storage.export_session_markdown(session_id)
    if not path:
        raise HTTPException(status_code=404, detail="Sessao nao encontrada.")
    return FileResponse(path, media_type="text/markdown", filename=path.name)


@app.get("/api/stats")
async def stats():
    return storage.get_stats()


@app.get("/api/events")
async def events(limit: int = 30):
    return {"events": storage.get_recent_events(limit=limit)}


@app.get("/api/status/{session_id}")
async def session_status(session_id: str):
    return agent.get_session_status(session_id)


# ---------------------------------------------------------------------------
# Chat (SSE)
# ---------------------------------------------------------------------------
class ChatBody(BaseModel):
    session_id: str
    message: str


@app.post("/api/chat")
async def chat(body: ChatBody):
    async def event_stream():
        try:
            async for event in agent.run_agent(body.session_id, body.message):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:
            err = {"type": "error", "message": str(exc)}
            yield f"data: {json.dumps(err, ensure_ascii=False)}\n\n"
            yield f'data: {{"type": "done"}}\n\n'

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class ConfirmBody(BaseModel):
    confirm_id: str
    approved: bool


@app.post("/api/confirm")
async def confirm(body: ConfirmBody):
    ok = agent.resolve_confirmation(body.confirm_id, body.approved)
    if not ok:
        raise HTTPException(status_code=404, detail="Confirmacao nao encontrada ou expirada.")
    return {"ok": True}


class ResetBody(BaseModel):
    session_id: str


@app.post("/api/reset")
async def reset(body: ResetBody):
    agent.SESSIONS.pop(body.session_id, None)
    storage.delete_session(body.session_id)
    return {"ok": True}
