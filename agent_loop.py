"""
Kimi Code — Agent loop com tool calling (kimi-k2.7-code)
Docs: https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart

Baseado no exemplo oficial do quickstart: um loop de agente que expoe
ferramentas (tools) ao modelo e executa as chamadas ate a resposta final.

O exemplo oficial usa uma tool de video (watch_video_clip, que requer
ffmpeg/ffprobe). Aqui incluimos tools de codigo mais uteis no dia a dia:
  - read_file: le um arquivo do diretorio do projeto
  - list_directory: lista arquivos de um diretorio
  - run_python: executa um trecho de codigo Python e retorna a saida

Uso:
    python agent_loop.py "Liste os arquivos deste projeto e explique o quickstart.py"
"""

import json
import os
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

API_KEY = os.environ.get("MOONSHOT_API_KEY")
BASE_URL = os.environ.get("MOONSHOT_BASE_URL", "https://api.moonshot.ai/v1")
MODEL = os.environ.get("KIMI_MODEL", "kimi-k2.7-code")

if not API_KEY or API_KEY == "sua_chave_aqui":
    sys.exit(
        "ERRO: defina MOONSHOT_API_KEY no arquivo .env\n"
        "Obtenha sua chave em: https://platform.kimi.ai/console/api-keys"
    )

client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

PROJECT_ROOT = Path(__file__).parent.resolve()

# ---------------------------------------------------------------------------
# Definicao das tools (formato OpenAI function calling)
# ---------------------------------------------------------------------------
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Le o conteudo de um arquivo texto dentro do projeto.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Caminho relativo do arquivo a partir da raiz do projeto.",
                    }
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_directory",
            "description": "Lista arquivos e pastas de um diretorio do projeto.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Caminho relativo do diretorio ('.' para a raiz).",
                    }
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_python",
            "description": "Executa um trecho curto de codigo Python e retorna stdout/stderr.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Codigo Python a executar.",
                    }
                },
                "required": ["code"],
            },
        },
    },
]


def _safe_path(rel: str) -> Path:
    """Resolve um caminho relativo garantindo que fique dentro do projeto."""
    p = (PROJECT_ROOT / rel).resolve()
    if not str(p).startswith(str(PROJECT_ROOT)):
        raise ValueError(f"Acesso negado fora do projeto: {rel}")
    return p


def read_file(path: str) -> str:
    p = _safe_path(path)
    if not p.is_file():
        return f"Arquivo nao encontrado: {path}"
    return p.read_text(encoding="utf-8", errors="replace")[:20000]


def list_directory(path: str) -> str:
    p = _safe_path(path)
    if not p.is_dir():
        return f"Diretorio nao encontrado: {path}"
    entries = sorted(e.name + ("/" if e.is_dir() else "") for e in p.iterdir())
    return "\n".join(entries) or "(vazio)"


def run_python(code: str) -> str:
    result = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        timeout=30,
        cwd=PROJECT_ROOT,
    )
    out = result.stdout.strip()
    err = result.stderr.strip()
    return f"stdout:\n{out}\n\nstderr:\n{err}" if err else (out or "(sem saida)")


TOOL_IMPLS = {
    "read_file": read_file,
    "list_directory": list_directory,
    "run_python": run_python,
}


# ---------------------------------------------------------------------------
# Loop do agente (padrao do quickstart oficial)
# ---------------------------------------------------------------------------
def agent_loop(user_prompt: str, max_turns: int = 20) -> str:
    messages = [
        {
            "role": "system",
            "content": (
                "Voce e um agente de programacao senior. Use as ferramentas "
                "disponiveis quando precisar inspecionar arquivos ou executar codigo."
            ),
        },
        {"role": "user", "content": user_prompt},
    ]

    for _ in range(max_turns):
        response = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=TOOLS,
            temperature=1.0,
            top_p=0.95,
            max_tokens=32768,
            extra_body={"thinking": {"type": "enabled"}},
        )
        msg = response.choices[0].message
        messages.append(msg.model_dump(exclude_none=True))

        if not msg.tool_calls:
            return msg.content or "(resposta vazia)"

        for tc in msg.tool_calls:
            fn_name = tc.function.name
            try:
                args = json.loads(tc.function.arguments or "{}")
                result = TOOL_IMPLS[fn_name](**args)
            except Exception as exc:  # devolve o erro ao modelo
                result = f"Erro ao executar {fn_name}: {exc}"
            print(f"[tool] {fn_name}({tc.function.arguments})")
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": str(result),
                }
            )

    return "(limite de turnos atingido)"


if __name__ == "__main__":
    prompt = (
        sys.argv[1]
        if len(sys.argv) > 1
        else "Liste os arquivos deste projeto e explique o que o quickstart.py faz."
    )
    print(f"Modelo: {MODEL}\nPrompt: {prompt}\n" + "=" * 60)
    print(agent_loop(prompt))
