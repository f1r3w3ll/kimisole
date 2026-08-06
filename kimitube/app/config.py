"""Configuração do Kimitube — carrega .env e expõe constantes do projeto."""

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "kimitube.db"

load_dotenv(BASE_DIR / ".env")

# --- YouTube Data API v3 ---
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY", "")
YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"

# Custos de quota (unidades por chamada) e limite diário padrão.
QUOTA_COST_LIST = 1       # channels.list / videos.list / playlistItems.list
QUOTA_COST_SEARCH = 100   # search.list
DAILY_QUOTA_LIMIT = int(os.getenv("YOUTUBE_DAILY_QUOTA", "10000"))

# --- Kimi / Moonshot (fase 2: geração de metadados) ---
MOONSHOT_API_KEY = os.getenv("MOONSHOT_API_KEY", "")
MOONSHOT_BASE_URL = os.getenv("MOONSHOT_BASE_URL", "https://api.moonshot.ai/v1")
KIMI_MODEL = os.getenv("KIMI_MODEL", "kimi-k2.7-code")

# --- SMTP / alertas (fase 2) ---
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
ALERT_EMAIL_TO = os.getenv("ALERT_EMAIL_TO", "")

# --- Parâmetros do negócio ---
SPY_MAX_VIDEOS = 50          # quantos vídeos recentes o spy analisa
SHORTS_MAX_DURATION_S = 60   # duração máxima para considerar Short
RSS_URL_TEMPLATE = "https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"


# ---------------------------------------------------------------------------
# Persistência leve de variáveis no .env
# ---------------------------------------------------------------------------

ENV_FILE = BASE_DIR / ".env"


def _read_env_file() -> dict[str, str]:
    """Lê o .env como dict, ignorando linhas comentadas ou vazias."""
    env: dict[str, str] = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def save_env_var(key: str, value: str) -> None:
    """Salva/atualiza uma variável no arquivo .env e em os.environ.

    Também atualiza a variável correspondente no módulo config em tempo de
    execução, quando possível.
    """
    env = _read_env_file()
    env[key] = value
    lines = []
    if ENV_FILE.exists():
        for raw in ENV_FILE.read_text(encoding="utf-8").splitlines():
            stripped = raw.strip()
            if stripped.startswith("#") or "=" not in stripped:
                lines.append(raw)
                continue
            k = stripped.split("=", 1)[0].strip()
            if k == key:
                continue  # será reescrito no final
            lines.append(raw)
    # Reescreve a variável no final para garantir valor atualizado.
    lines.append(f"{key}={value}")
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.environ[key] = value

    # Atualiza a variável no módulo config, se existir.
    import app.config as cfg
    if hasattr(cfg, key):
        current = getattr(cfg, key)
        try:
            setattr(cfg, key, type(current)(value))
        except (ValueError, TypeError):
            setattr(cfg, key, value)


def get_api_key_status() -> dict:
    """Retorna status da chave da YouTube API (mascarada)."""
    key = YOUTUBE_API_KEY or ""
    masked = ""
    if len(key) > 8:
        masked = key[:4] + "..." + key[-4:]
    elif key:
        masked = "*" * len(key)
    return {
        "configured": bool(key),
        "masked_key": masked,
        "length": len(key),
    }
