"""
Kimi Code — Agent loop com streaming de eventos.

run_agent() e um gerador assincrono que emite eventos (dicts) para a UI:
  {"type": "text_delta", "text": "..."}          — trecho da resposta em streaming
  {"type": "tool_call", "id", "name", "args"}     — modelo pediu uma tool
  {"type": "tool_confirm", "id", "name", "args"}  — tool destrutiva aguardando aprovacao
  {"type": "tool_result", "id", "name", "result"} — resultado da execucao
  {"type": "tool_denied", "id", "name"}           — usuario rejeitou
  {"type": "error", "message": "..."}
  {"type": "done"}

Confirmacoes: quando uma tool exige aprovacao, o gerador emite tool_confirm e
aguarda a decisao via asyncio.Event registrado em PENDING_CONFIRMATIONS.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any, AsyncGenerator

from dotenv import load_dotenv
from openai import AsyncOpenAI

from .tools import REGISTRY, get_roots, tool_specs
from . import storage

load_dotenv()

BASE_URL = os.environ.get("MOONSHOT_BASE_URL", "https://api.moonshot.ai/v1")
MODEL = os.environ.get("KIMI_MODEL", "kimi-k2.7-code")

_client: AsyncOpenAI | None = None


def client() -> AsyncOpenAI:
    global _client
    if _client is None:
        api_key = os.environ.get("MOONSHOT_API_KEY")
        if not api_key or api_key == "sua_chave_aqui":
            raise RuntimeError("MOONSHOT_API_KEY nao definida no .env")
        _client = AsyncOpenAI(api_key=api_key, base_url=BASE_URL)
    return _client


# sessoes: session_id -> lista de mensagens
SESSIONS: dict[str, list[dict]] = {}

# lock por sessao: evita que duas requisicoes processem a mesma conversa ao mesmo tempo
SESSION_LOCKS: dict[str, asyncio.Lock] = {}

# confirmacoes pendentes: confirm_id -> {"event": asyncio.Event, "approved": bool}
PENDING_CONFIRMATIONS: dict[str, dict] = {}


def _get_session_lock(session_id: str) -> asyncio.Lock:
    if session_id not in SESSION_LOCKS:
        SESSION_LOCKS[session_id] = asyncio.Lock()
    return SESSION_LOCKS[session_id]


def get_session_status(session_id: str) -> dict[str, Any]:
    """Retorna o status de processamento da sessao e confirmacoes pendentes."""
    lock = SESSION_LOCKS.get(session_id)
    pending = [
        {"confirm_id": cid, "name": entry.get("name", "?"), "args": entry.get("args", {})}
        for cid, entry in PENDING_CONFIRMATIONS.items()
    ]
    return {
        "session_id": session_id,
        "busy": lock.locked() if lock else False,
        "pending_confirmations": pending,
    }


def _system_prompt() -> str:
    roots = "\n".join(f"- {r}" for r in get_roots()) or "(nenhuma pasta marcada ainda)"
    return (
        "Voce e o Kimi Code, um agente de programacao senior que conversa em portugues "
        "do Brasil. Voce tem ferramentas para ler, buscar, editar e criar arquivos, "
        "executar comandos, usar git e pesquisar na web.\n\n"
        "Pastas autorizadas para analise (marcadas pelo usuario):\n"
        f"{roots}\n\n"
        "Diretrizes:\n"
        "- Use as ferramentas proativamente para inspecionar o codigo antes de responder.\n"
        "- Ao analisar um projeto, comece com list_directory e leia os arquivos relevantes.\n"
        "- Seja objetivo; use markdown e blocos de codigo nas respostas.\n"
        "- Nunca invente conteudo de arquivos: leia-os de verdade com as ferramentas."
    )


def get_session(session_id: str) -> list[dict]:
    if session_id not in SESSIONS:
        data = storage.load_session(session_id)
        SESSIONS[session_id] = data["messages"] if data else []
    return SESSIONS[session_id]


def get_session_title(session_id: str) -> str | None:
    data = storage.load_session(session_id)
    return data.get("title") if data else None


async def _wait_confirmation(confirm_id: str, session_id: str, messages: list[dict], name: str = "", args: dict | None = None) -> bool:
    entry = {"event": asyncio.Event(), "approved": False, "name": name, "args": args or {}}
    PENDING_CONFIRMATIONS[confirm_id] = entry
    try:
        # Se o cliente desconectar (reload/crash), o CancelledError aborta a espera.
        await asyncio.wait_for(entry["event"].wait(), timeout=300)
    except asyncio.TimeoutError:
        # Se o usuario nao respondeu a tempo, limpamos a mensagem assistant
        # com tool_call pendente para evitar estado inconsistente.
        if messages and messages[-1].get("role") == "assistant" and messages[-1].get("tool_calls"):
            messages.pop()
            storage.save_session(session_id, messages)
        return False
    except asyncio.CancelledError:
        # Cliente desconectou; descarta a mensagem assistant incompleta.
        if messages and messages[-1].get("role") == "assistant" and messages[-1].get("tool_calls"):
            messages.pop()
            storage.save_session(session_id, messages)
        raise
    finally:
        PENDING_CONFIRMATIONS.pop(confirm_id, None)
    return entry["approved"]


def resolve_confirmation(confirm_id: str, approved: bool) -> bool:
    entry = PENDING_CONFIRMATIONS.get(confirm_id)
    if not entry:
        return False
    entry["approved"] = approved
    entry["event"].set()
    return True


def delete_session(session_id: str) -> bool:
    ok = bool(SESSIONS.pop(session_id, None) is not None)
    return storage.delete_session(session_id) or ok


async def _execute_tool(name: str, args: dict) -> str:
    tool = REGISTRY.get(name)
    if not tool:
        return f"Ferramenta desconhecida: {name}"
    try:
        # roda impl sincrona em thread para nao travar o event loop
        return await asyncio.to_thread(tool.impl, **args)
    except TypeError as exc:
        return f"Argumentos invalidos para {name}: {exc}"
    except Exception as exc:
        return f"Erro ao executar {name}: {exc}"


async def run_agent(session_id: str, user_message: str, max_turns: int = 25) -> AsyncGenerator[dict, None]:
    """
    Processa uma mensagem do usuario de forma atomica (um lock por sessao).
    Persiste a mensagem do usuario imediatamente e, em caso de cancelamento
    do cliente, deixa a conversa em estado recuperavel.
    """
    lock = _get_session_lock(session_id)
    # Nao enfileira requisicoes: se a sessao ja esta ocupada, recusa imediatamente.
    if lock.locked():
        yield {"type": "error", "message": "A sessao ja esta processando uma mensagem. Aguarde a resposta atual ou recarregue a pagina."}
        yield {"type": "done"}
        return

    acquired = await lock.acquire()
    try:
        messages = get_session(session_id)
        storage.log_event("chat.start", {"session_id": session_id, "message_len": len(user_message)})

        if not messages:
            messages.append({"role": "system", "content": _system_prompt()})
        else:
            # atualiza o system prompt (pastas marcadas podem ter mudado)
            messages[0] = {"role": "system", "content": _system_prompt()}

        messages.append({"role": "user", "content": user_message})
        storage.save_session(session_id, messages)

        try:
            async for event in _run_agent_turns(session_id, messages, max_turns):
                yield event
        except asyncio.CancelledError:
            # Cliente desconectou: remove mensagem assistant incompleta e salva.
            if messages and messages[-1].get("role") == "assistant" and messages[-1].get("tool_calls"):
                messages.pop()
                storage.save_session(session_id, messages)
            raise
    finally:
        if acquired:
            lock.release()


async def _run_agent_turns(session_id: str, messages: list[dict], max_turns: int) -> AsyncGenerator[dict, None]:
    for turn in range(max_turns):
        try:
            stream = await client().chat.completions.create(
                model=MODEL,
                messages=messages,
                tools=tool_specs(),
                temperature=1.0,
                top_p=0.95,
                max_tokens=32768,
                stream=True,
                timeout=120,
                extra_body={"thinking": {"type": "enabled"}},
            )
        except Exception as exc:
            storage.log_event("chat.error", {"session_id": session_id, "error": str(exc)})
            yield {"type": "error", "message": str(exc)}
            yield {"type": "done"}
            return

        content_parts: list[str] = []
        tool_calls: dict[int, dict[str, Any]] = {}

        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta is None:
                continue
            if delta.content:
                content_parts.append(delta.content)
                yield {"type": "text_delta", "text": delta.content}
            for tc in delta.tool_calls or []:
                slot = tool_calls.setdefault(tc.index, {"id": "", "name": "", "arguments": ""})
                if tc.id:
                    slot["id"] = tc.id
                if tc.function:
                    if tc.function.name:
                        slot["name"] = tc.function.name
                    if tc.function.arguments:
                        slot["arguments"] += tc.function.arguments

        content = "".join(content_parts)

        if not tool_calls:
            messages.append({"role": "assistant", "content": content})
            storage.save_session(session_id, messages)
            storage.log_event("chat.done", {"session_id": session_id, "turns": turn + 1})
            yield {"type": "done"}
            return

        # registra a mensagem do assistente com as tool calls
        assistant_msg = {
            "role": "assistant",
            "content": content or None,
            "tool_calls": [
                {
                    "id": tc["id"],
                    "type": "function",
                    "function": {"name": tc["name"], "arguments": tc["arguments"]},
                }
                for tc in tool_calls.values()
            ],
        }
        messages.append(assistant_msg)

        for tc in tool_calls.values():
            name, call_id = tc["name"], tc["id"]
            try:
                args = json.loads(tc["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}

            tool = REGISTRY.get(name)
            yield {"type": "tool_call", "id": call_id, "name": name, "args": args}
            storage.log_event("tool.call", {"session_id": session_id, "call_id": call_id, "name": name, "args": args})

            if tool and tool.requires_confirmation:
                yield {"type": "tool_confirm", "id": call_id, "name": name, "args": args}
                storage.log_event("tool.confirm", {"session_id": session_id, "call_id": call_id, "name": name, "args": args})
                approved = await _wait_confirmation(call_id, session_id, messages, name=name, args=args)
                if not approved:
                    result = "O usuario REJEITOU a execucao desta ferramenta. Nao tente novamente sem perguntar."
                    yield {"type": "tool_denied", "id": call_id, "name": name}
                    storage.log_event("tool.denied", {"session_id": session_id, "call_id": call_id, "name": name})
                    messages.append({"role": "tool", "tool_call_id": call_id, "content": result})
                    storage.save_session(session_id, messages)
                    continue

            result = await _execute_tool(name, args)
            display = result if len(result) <= 4000 else result[:4000] + "\n... [truncado na UI]"
            yield {"type": "tool_result", "id": call_id, "name": name, "result": display}
            storage.log_event("tool.result", {"session_id": session_id, "call_id": call_id, "name": name, "result_preview": display[:200]})
            messages.append({"role": "tool", "tool_call_id": call_id, "content": result})

    # Se chegou aqui e a ultima mensagem do assistant ainda nao tem todos os resultados,
    # remove-a para nao travar a sessao em estado inconsistente.
    if messages and messages[-1].get("role") == "assistant" and messages[-1].get("tool_calls"):
        messages.pop()
    storage.save_session(session_id, messages)
    storage.log_event("chat.limit", {"session_id": session_id, "turns": max_turns})
    yield {"type": "error", "message": "Limite de turnos do agente atingido."}
    yield {"type": "done"}
