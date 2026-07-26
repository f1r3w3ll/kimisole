"""
Kimi Code — Persistencia local de sessoes de chat.

- Cada sessao e um arquivo JSON em data/sessions/
- O arquivo e atualizado apos cada interacao completa do agente
- Em caso de falha/timeout, remove mensagens assistant pendentes de tool_calls
  para evitar loops quando a conversa for retomada.
"""

from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

APP_DIR = Path(__file__).parent.parent.resolve()
DATA_DIR = APP_DIR / "data"
SESSIONS_DIR = DATA_DIR / "sessions"
EXPORTS_DIR = DATA_DIR / "exports"
LOGS_DIR = DATA_DIR / "logs"


def _ensure_dirs() -> None:
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Raizes autorizadas persistentes
# ---------------------------------------------------------------------------
ROOTS_FILE = DATA_DIR / "roots.json"


def load_roots() -> list[str]:
    _ensure_dirs()
    if not ROOTS_FILE.exists():
        return []
    try:
        data = json.loads(ROOTS_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return [str(p) for p in data if isinstance(p, str)]
    except Exception:
        pass
    return []


def save_roots(roots: list[str]) -> None:
    _ensure_dirs()
    tmp = ROOTS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(roots, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(ROOTS_FILE)


def _session_path(session_id: str) -> Path:
    # Sanitiza para evitar path traversal
    safe = re.sub(r"[^a-zA-Z0-9_.-]", "_", session_id)
    return SESSIONS_DIR / f"{safe}.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def now_safe() -> str:
    """Timestamp seguro para nomes de arquivo."""
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")


def list_sessions() -> list[dict[str, Any]]:
    _ensure_dirs()
    sessions: list[dict[str, Any]] = []
    for path in sorted(SESSIONS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        sessions.append({
            "id": data.get("id", path.stem),
            "title": data.get("title", "Conversa sem titulo"),
            "created_at": data.get("created_at", _now_iso()),
            "updated_at": data.get("updated_at", _now_iso()),
            "message_count": len(data.get("messages", [])),
        })
    return sessions


def load_session(session_id: str) -> dict[str, Any] | None:
    _ensure_dirs()
    path = _session_path(session_id)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None

    messages = data.get("messages", [])
    messages = _sanitize_messages(messages)
    data["messages"] = messages
    return data


def _sanitize_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Remove mensagens do assistente que contem tool_calls sem os respectivos
    resultados de tool. Isso acontece quando o processo e interrompido enquanto
    aguardava aprovacao/executacao de uma ferramenta.
    """
    if not messages:
        return messages

    # IDs de tool_calls ja respondidos
    answered_tool_ids = {
        m.get("tool_call_id")
        for m in messages
        if m.get("role") == "tool" and m.get("tool_call_id")
    }

    cleaned: list[dict[str, Any]] = []
    for msg in messages:
        if msg.get("role") == "assistant" and msg.get("tool_calls"):
            pending = [tc for tc in msg["tool_calls"] if tc.get("id") not in answered_tool_ids]
            if pending:
                # Mensagem assistant incompleta: descarta para nao travar o modelo
                continue
        cleaned.append(msg)
    return cleaned


def save_session(session_id: str, messages: list[dict[str, Any]], title: str | None = None) -> None:
    _ensure_dirs()
    path = _session_path(session_id)

    existing = load_session(session_id) or {}
    created_at = existing.get("created_at", _now_iso())

    data = {
        "id": session_id,
        "title": title or existing.get("title") or _infer_title(messages),
        "created_at": created_at,
        "updated_at": _now_iso(),
        "messages": messages,
    }
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _infer_title(messages: list[dict[str, Any]]) -> str:
    for msg in messages:
        if msg.get("role") == "user":
            text = msg.get("content", "") or ""
            text = re.sub(r"\s+", " ", text).strip()
            if text:
                return (text[:60] + "...") if len(text) > 60 else text
    return "Nova conversa"


def rename_session(session_id: str, title: str) -> bool:
    data = load_session(session_id)
    if not data:
        return False
    data["title"] = title.strip() or data.get("title", "Conversa sem titulo")
    data["updated_at"] = _now_iso()
    path = _session_path(session_id)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return True


def delete_session(session_id: str) -> bool:
    path = _session_path(session_id)
    if not path.exists():
        return False
    path.unlink()
    return True


def export_session_markdown(session_id: str) -> Path | None:
    data = load_session(session_id)
    if not data:
        return None

    lines = [f"# {data.get('title', 'Conversa')}\n"]
    lines.append(f"- Criada em: {data.get('created_at', '')}")
    lines.append(f"- Atualizada em: {data.get('updated_at', '')}")
    lines.append("")

    for msg in data.get("messages", []):
        role = msg.get("role", "")
        if role == "system":
            continue
        if role == "user":
            lines.append(f"## Usuario\n\n{msg.get('content', '')}\n")
        elif role == "assistant":
            lines.append(f"## Kimi\n\n{msg.get('content') or ''}\n")
            for tc in msg.get("tool_calls", []):
                fn = tc.get("function", {})
                lines.append(
                    f"\n> Tool: `{fn.get('name', '')}`\n>\n> ```json\n> {fn.get('arguments', '')}\n> ```\n"
                )
        elif role == "tool":
            lines.append(f"### Resultado de tool (`{msg.get('tool_call_id', '')}`)\n\n```\n{msg.get('content', '')}\n```\n")

    _ensure_dirs()
    safe_title = re.sub(r"[^a-zA-Z0-9_\-]", "_", data.get("title", "conversa"))[:40]
    filename = f"{session_id}_{safe_title}.md"
    path = EXPORTS_DIR / filename
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# Logs simples de eventos / monitoramento
# ---------------------------------------------------------------------------
def log_event(event: str, detail: dict[str, Any] | None = None) -> None:
    _ensure_dirs()
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    path = LOGS_DIR / f"events-{date}.log"
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "detail": detail or {},
    }
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def get_recent_events(limit: int = 50) -> list[dict[str, Any]]:
    """Retorna os ultimos eventos do log (mais recentes primeiro)."""
    _ensure_dirs()
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    path = LOGS_DIR / f"events-{date}.log"
    if not path.exists():
        return []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except Exception:
        return []
    events: list[dict[str, Any]] = []
    for line in reversed(lines[-limit:]):
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except Exception:
            continue
    return events


def get_stats() -> dict[str, Any]:
    _ensure_dirs()
    sessions = list_sessions()
    total_messages = sum(s["message_count"] for s in sessions)
    return {
        "sessions": len(sessions),
        "total_messages": total_messages,
        "data_dir": str(DATA_DIR),
    }
