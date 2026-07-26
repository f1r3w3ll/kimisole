"""
Kimi Code — Registry de ferramentas (tools) do agente.

Cada tool declara:
  - spec: definicao no formato OpenAI function-calling (enviada ao modelo)
  - impl: funcao Python que executa a acao
  - requires_confirmation: se True, a UI pede aprovacao antes de executar

Seguranca: todas as tools que tocam o disco/shell sao confinadas as "raizes
autorizadas" (as pastas que o usuario marca na UI). _safe_path garante que o
caminho resolvido esteja dentro de alguma raiz autorizada.
"""

from __future__ import annotations

import os
import re
import signal
import subprocess
import sys
from pathlib import Path
from typing import Callable

import httpx

# ---------------------------------------------------------------------------
# Raizes autorizadas (pastas marcadas pelo usuario)
# ---------------------------------------------------------------------------
_ROOTS: list[Path] = []

_IGNORE_DIRS = {".venv", ".git", "node_modules", "__pycache__", ".idea", ".vscode", "dist", "build"}
_TEXT_EXCLUDE_SUFFIXES = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz",
    ".exe", ".dll", ".pyc", ".so", ".bin", ".mp4", ".mp3", ".wav", ".woff",
    ".woff2", ".ttf", ".otf",
}

# arquivos com segredos: nunca lidos/buscados/escritos pelas tools
_SECRET_FILES = {".env", ".env.local", ".env.production", "credentials.json", "secrets.json"}


def _is_secret(p: Path) -> bool:
    return p.name.lower() in _SECRET_FILES


def set_roots(paths: list[str]) -> None:
    """Define as raizes autorizadas a partir de caminhos absolutos existentes."""
    global _ROOTS
    roots = []
    for p in paths:
        rp = Path(p).expanduser().resolve()
        if rp.is_dir():
            roots.append(rp)
    _ROOTS = roots


def get_roots() -> list[Path]:
    return list(_ROOTS)


def _persist_roots() -> None:
    from . import storage
    storage.save_roots([str(r) for r in _ROOTS])


def add_root(path: str) -> Path:
    # Normaliza barras invertidas do Windows para que d:\pasta funcione mesmo
    # quando vinda de JSON/entrada do usuario.
    normalized = path.replace("\\", "/")
    rp = Path(normalized).expanduser().resolve()
    if not rp.is_dir():
        raise ValueError(f"Diretorio nao existe: {path}")
    if rp not in _ROOTS:
        _ROOTS.append(rp)
        _persist_roots()
    return rp


def remove_root(path: str) -> None:
    rp = Path(path).expanduser().resolve()
    global _ROOTS
    new_roots = [r for r in _ROOTS if r != rp]
    if len(new_roots) != len(_ROOTS):
        _ROOTS = new_roots
        _persist_roots()


def _safe_path(rel_or_abs: str) -> Path:
    """
    Resolve um caminho (relativo a 1a raiz, ou absoluto) garantindo que fique
    dentro de alguma raiz autorizada.
    """
    if not _ROOTS:
        raise ValueError("Nenhuma pasta autorizada. Marque uma pasta na barra lateral.")

    candidate = Path(rel_or_abs).expanduser()
    if candidate.is_absolute():
        resolved = candidate.resolve()
    else:
        # relativo: tenta a partir de cada raiz, prioriza a que existir
        resolved = (_ROOTS[0] / candidate).resolve()
        for root in _ROOTS:
            test = (root / candidate).resolve()
            if test.exists():
                resolved = test
                break

    for root in _ROOTS:
        try:
            resolved.relative_to(root)
            return resolved
        except ValueError:
            continue
    raise ValueError(f"Acesso negado: '{rel_or_abs}' esta fora das pastas autorizadas.")


def _primary_root() -> Path:
    if not _ROOTS:
        raise ValueError("Nenhuma pasta autorizada.")
    return _ROOTS[0]


# ---------------------------------------------------------------------------
# Implementacoes das tools
# ---------------------------------------------------------------------------
def list_directory(path: str = ".") -> str:
    p = _safe_path(path)
    if not p.is_dir():
        return f"Diretorio nao encontrado: {path}"
    entries = []
    for e in sorted(p.iterdir(), key=lambda x: (x.is_file(), x.name.lower())):
        if e.name in _IGNORE_DIRS:
            continue
        entries.append(e.name + ("/" if e.is_dir() else ""))
    return "\n".join(entries) or "(vazio)"


def read_file(path: str) -> str:
    p = _safe_path(path)
    if _is_secret(p):
        return "Acesso negado: este arquivo contem segredos (.env/credenciais)."
    if not p.is_file():
        return f"Arquivo nao encontrado: {path}"
    text = p.read_text(encoding="utf-8", errors="replace")
    if len(text) > 40000:
        text = text[:40000] + "\n\n... [truncado em 40000 caracteres]"
    return text


def search_code(query: str, path: str = ".", max_results: int = 60) -> str:
    """Busca textual (regex) recursiva nos arquivos de codigo."""
    root = _safe_path(path)
    try:
        pattern = re.compile(query, re.IGNORECASE)
    except re.error as exc:
        return f"Regex invalido: {exc}"

    results: list[str] = []
    for f in root.rglob("*"):
        if len(results) >= max_results:
            results.append("... [mais resultados omitidos]")
            break
        if not f.is_file():
            continue
        if any(part in _IGNORE_DIRS for part in f.parts):
            continue
        if f.suffix.lower() in _TEXT_EXCLUDE_SUFFIXES:
            continue
        if _is_secret(f):
            continue
        try:
            for i, line in enumerate(f.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
                if pattern.search(line):
                    rel = f.relative_to(root)
                    results.append(f"{rel}:{i}: {line.strip()[:200]}")
                    if len(results) >= max_results:
                        break
        except Exception:
            continue
    return "\n".join(results) if results else f"Nenhum resultado para '{query}'."


def write_file(path: str, content: str) -> str:
    p = _safe_path(path)
    if _is_secret(p):
        return "Acesso negado: nao e permitido escrever em arquivos de segredos."
    p.parent.mkdir(parents=True, exist_ok=True)
    existed = p.exists()
    p.write_text(content, encoding="utf-8")
    verb = "sobrescrito" if existed else "criado"
    return f"Arquivo {verb}: {p} ({len(content)} caracteres)"


def edit_file(path: str, old: str, new: str) -> str:
    p = _safe_path(path)
    if _is_secret(p):
        return "Acesso negado: nao e permitido editar arquivos de segredos."
    if not p.is_file():
        return f"Arquivo nao encontrado: {path}"
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count == 0:
        return "Erro: trecho 'old' nao encontrado no arquivo."
    if count > 1:
        return f"Erro: trecho 'old' aparece {count} vezes; torne-o unico para editar com seguranca."
    p.write_text(text.replace(old, new, 1), encoding="utf-8")
    return f"Arquivo editado: {p}"


def _kill_process_tree(pid: int) -> None:
    """Mata o processo e seus filhos (Windows)."""
    try:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(pid)], capture_output=True, text=True)
    except Exception:
        pass
    # Segunda tentativa por nome, util quando subprocessos escapam do /T
    try:
        subprocess.run(["taskkill", "/F", "/IM", "node.exe"], capture_output=True, text=True)
    except Exception:
        pass


# Comandos que normalmente nao terminam sozinhos (servidores, watchers)
_LONG_RUNNING_RE = re.compile(r"\b(run\s+(dev|start|serve)|npm\s+run\s+(dev|start|serve)|yarn\s+(dev|start|serve)|pnpm\s+(dev|start|serve)|vite|webpack\s+serve|nodemon|ts-node-dev)\b", re.IGNORECASE)


def run_command(command: str, timeout: int = 60) -> str:
    """Executa um comando de shell na raiz principal. Timeout configuravel (padrao 60s, maximo 300s)."""
    import signal

    # Limita timeout para comandos que parecem servidores, a menos que o usuario tenha definido explicitamente um curto.
    original_timeout = timeout
    if _LONG_RUNNING_RE.search(command) and timeout > 15:
        timeout = 15

    try:
        flags = 0
        if sys.platform == "win32":
            flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
        proc = subprocess.Popen(
            command,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=_primary_root(),
            creationflags=flags,
        )
        try:
            out, err = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            # Tenta enviar CTRL_BREAK para o grupo de processos antes do taskkill
            try:
                if sys.platform == "win32":
                    os.kill(proc.pid, signal.CTRL_BREAK_EVENT)
                    proc.wait(timeout=3)
            except Exception:
                pass
            _kill_process_tree(proc.pid)
            try:
                proc.wait(timeout=5)
            except Exception:
                pass
            hint = ""
            if original_timeout > 15 and _LONG_RUNNING_RE.search(command):
                hint = "\n\nDica: este comando parece iniciar um servidor/watcher. Para testes rapidos use timeout curto (ex: 5s) ou execute em terminal separado."
            return f"[timeout: {timeout}s] O comando foi abortado porque excedeu o tempo limite.{hint}\n\nPara comandos que nao terminam sozinhos (npm run dev, etc.), informe um timeout pequeno na propria mensagem ou execute-os fora do kimiSole."
    except Exception as exc:
        return f"Erro ao executar comando: {exc}"

    out = (out or "").strip()
    err = (err or "").strip()
    parts = [f"[exit code: {proc.returncode}]"]
    if out:
        parts.append("stdout:\n" + out[:8000])
    if err:
        parts.append("stderr:\n" + err[:4000])
    return "\n\n".join(parts)


def git(args: str, timeout: int = 60) -> str:
    """Executa 'git <args>' na raiz principal. Timeout configuravel."""
    return run_command(f"git {args}", timeout=timeout)


def run_python(code: str) -> str:
    """Executa um trecho de codigo Python (timeout 30s)."""
    try:
        result = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=_primary_root(),
        )
    except subprocess.TimeoutExpired:
        return "Erro: execucao excedeu 30s."
    out = (result.stdout or "").strip()
    err = (result.stderr or "").strip()
    return f"stdout:\n{out}\n\nstderr:\n{err}" if err else (out or "(sem saida)")


def web_search(query: str, max_results: int = 6) -> str:
    """Busca na web via DuckDuckGo HTML (sem API key)."""
    try:
        resp = httpx.post(
            "https://html.duckduckgo.com/html/",
            data={"q": query},
            headers={"User-Agent": "Mozilla/5.0 (compatible; KimiCode/0.2)"},
            timeout=20,
            follow_redirects=True,
        )
        resp.raise_for_status()
    except Exception as exc:
        return f"Erro na busca web: {exc}"

    html = resp.text
    # extrai titulo+link e snippet com regex simples
    links = re.findall(r'<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', html, re.S)
    snippets = re.findall(r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>', html, re.S)

    def clean(s: str) -> str:
        return re.sub(r"<[^>]+>", "", s).replace("&amp;", "&").replace("&#x27;", "'").strip()

    out = []
    for i, (href, title) in enumerate(links[:max_results]):
        snip = clean(snippets[i]) if i < len(snippets) else ""
        out.append(f"{i+1}. {clean(title)}\n   {href}\n   {snip}")
    return "\n\n".join(out) if out else "Nenhum resultado encontrado."


def web_fetch(url: str) -> str:
    """Baixa uma URL e retorna o texto limpo (sem tags)."""
    if not url.startswith(("http://", "https://")):
        return "URL invalida (use http:// ou https://)."
    try:
        resp = httpx.get(
            url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; KimiCode/0.2)"},
            timeout=25,
            follow_redirects=True,
        )
        resp.raise_for_status()
    except Exception as exc:
        return f"Erro ao buscar URL: {exc}"
    text = resp.text
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", text, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:12000] + ("\n\n... [truncado]" if len(text) > 12000 else "")


# ---------------------------------------------------------------------------
# Registry: spec (OpenAI) + impl + confirmacao
# ---------------------------------------------------------------------------
class Tool:
    def __init__(self, spec: dict, impl: Callable, requires_confirmation: bool = False):
        self.spec = spec
        self.impl = impl
        self.requires_confirmation = requires_confirmation

    @property
    def name(self) -> str:
        return self.spec["function"]["name"]


def _fn(name: str, description: str, params: dict, required: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": params, "required": required},
        },
    }


_STR = {"type": "string"}
_INT = {"type": "integer"}

REGISTRY: dict[str, Tool] = {}


def _register(tool: Tool) -> None:
    REGISTRY[tool.name] = tool


_register(Tool(
    _fn("list_directory", "Lista arquivos e pastas de um diretorio autorizado.",
        {"path": {**_STR, "description": "Caminho relativo/absoluto ('.' = raiz)."}}, ["path"]),
    list_directory,
))
_register(Tool(
    _fn("read_file", "Le o conteudo de um arquivo de texto.",
        {"path": {**_STR, "description": "Caminho do arquivo."}}, ["path"]),
    read_file,
))
_register(Tool(
    _fn("search_code", "Busca um padrao (regex) no codigo dos arquivos, recursivamente.",
        {"query": {**_STR, "description": "Padrao regex a buscar."},
         "path": {**_STR, "description": "Diretorio raiz da busca ('.' = raiz)."}}, ["query"]),
    search_code,
))
_register(Tool(
    _fn("web_search", "Busca na web (DuckDuckGo) e retorna titulos, links e trechos.",
        {"query": {**_STR, "description": "Termo de busca."}}, ["query"]),
    web_search,
))
_register(Tool(
    _fn("web_fetch", "Baixa uma URL e retorna o texto limpo da pagina.",
        {"url": {**_STR, "description": "URL http(s) a baixar."}}, ["url"]),
    web_fetch,
))
_register(Tool(
    _fn("run_python", "Executa um trecho curto de Python e retorna a saida.",
        {"code": {**_STR, "description": "Codigo Python a executar."}}, ["code"]),
    run_python,
))
# --- tools que exigem confirmacao ---
_register(Tool(
    _fn("write_file", "Cria ou sobrescreve um arquivo com o conteudo dado.",
        {"path": {**_STR, "description": "Caminho do arquivo."},
         "content": {**_STR, "description": "Conteudo completo do arquivo."}}, ["path", "content"]),
    write_file, requires_confirmation=True,
))
_register(Tool(
    _fn("edit_file", "Substitui um trecho exato ('old') por outro ('new') num arquivo.",
        {"path": {**_STR, "description": "Caminho do arquivo."},
         "old": {**_STR, "description": "Trecho exato a substituir (deve ser unico)."},
         "new": {**_STR, "description": "Novo trecho."}}, ["path", "old", "new"]),
    edit_file, requires_confirmation=True,
))
_register(Tool(
    _fn("run_command", "Executa um comando de shell no diretorio do projeto. Comandos que nao terminam sozinhos (ex: npm run dev, npm start, vite, nodemon) devem ser usados APENAS com timeout curto (5-15s) para verificar se sobem, ou executados fora do kimiSole. NUNCA deixe timeout grande para servidores/watches.",
        {"command": {**_STR, "description": "Comando de shell."},
         "timeout": {**_INT, "description": "Timeout em segundos (padrao 60, maximo 300; use 5-15s para servidores)."}}, ["command"]),
    run_command, requires_confirmation=True,
))
_register(Tool(
    _fn("git", "Executa 'git <args>' no projeto (status, diff, log, add, commit...).",
        {"args": {**_STR, "description": "Argumentos do git, ex: 'status' ou 'commit -m msg'."},
         "timeout": {**_INT, "description": "Timeout em segundos (padrao 60, maximo 300)."}}, ["args"]),
    git, requires_confirmation=True,
))


def tool_specs() -> list[dict]:
    return [t.spec for t in REGISTRY.values()]
