"""
kimiSole — entrypoint da Web UI.

Uso:
    .venv\\Scripts\\python.exe app.py
    (ou iniciar.bat)

Sobe o servidor em http://127.0.0.1:8765 e abre o navegador.
"""

import os
import socket
import sys
import threading
import webbrowser

from dotenv import load_dotenv

load_dotenv()

HOST = "127.0.0.1"
PORT = int(os.environ.get("KIMI_PORT", "8765"))


def _port_in_use(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def main() -> None:
    api_key = os.environ.get("MOONSHOT_API_KEY")
    if not api_key or api_key == "sua_chave_aqui":
        sys.exit(
            "ERRO: defina MOONSHOT_API_KEY no arquivo .env\n"
            "Obtenha sua chave em: https://platform.kimi.ai/console/api-keys"
        )

    import uvicorn

    url = f"http://{HOST}:{PORT}"

    if _port_in_use(HOST, PORT):
        print(f"\n  ATENCAO: ja existe um servidor em {url}", flush=True)
        print("  Abrindo navegador...\n", flush=True)
        webbrowser.open(url)
        return

    print(f"\n  kimiSole Web UI -> {url}", flush=True)
    print("  Abrindo navegador em 1s... (Ctrl+C para encerrar)\n", flush=True)
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    try:
        uvicorn.run("kimi.server:app", host=HOST, port=PORT, log_level="warning")
    except KeyboardInterrupt:
        print("\n  Servidor encerrado.", flush=True)


if __name__ == "__main__":
    main()
