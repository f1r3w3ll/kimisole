"""Geração de metadados prontos para publicação via API Kimi (Moonshot).

Fluxo: video_id/URL → videos.list (título/descrição/tags reais) → baixa a
thumbnail em alta (maxresdefault, fallback hqdefault) em data/thumbnails/ →
chama a API Kimi (OpenAI-compatible) para gerar prompt de capa, 5 títulos
alternativos, descrição formatada e tags.
"""

import json
import logging
import re
from pathlib import Path

import httpx

from . import config, youtube

logger = logging.getLogger(__name__)

THUMBS_DIR = config.DATA_DIR / "thumbnails"


class MetadataError(Exception):
    """Erro na geração de metadados."""


class MetadataUnavailableError(MetadataError):
    """MOONSHOT_API_KEY não configurada (mapear para HTTP 503)."""


def extract_video_id(query: str) -> str | None:
    """Extrai o video_id de uma URL do YouTube ou ID cru (11 chars)."""
    query = query.strip()
    patterns = [
        r"youtube\.com/watch\?[^#]*v=([\w\-]{11})",
        r"youtu\.be/([\w\-]{11})",
        r"youtube\.com/shorts/([\w\-]{11})",
        r"youtube\.com/embed/([\w\-]{11})",
    ]
    for pat in patterns:
        m = re.search(pat, query)
        if m:
            return m.group(1)
    if re.fullmatch(r"[\w\-]{11}", query):
        return query
    return None


def download_thumbnail(video_id: str, thumbs_dir: Path | None = None) -> Path:
    """Baixa a thumbnail em alta resolução; fallback para hqdefault se 404."""
    thumbs_dir = thumbs_dir or THUMBS_DIR
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    dest = thumbs_dir / f"{video_id}.jpg"
    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        for quality in ("maxresdefault", "hqdefault"):
            url = f"https://i.ytimg.com/vi/{video_id}/{quality}.jpg"
            resp = client.get(url)
            if resp.status_code == 200 and len(resp.content) > 1000:
                dest.write_bytes(resp.content)
                logger.info("Thumbnail salva: %s (%s)", dest, quality)
                return dest
    raise MetadataError(f"Não foi possível baixar a thumbnail do vídeo {video_id}.")


def _call_kimi(messages: list[dict]) -> str:
    """Chamada à API Kimi/Moonshot (OpenAI-compatible) via httpx."""
    if not config.MOONSHOT_API_KEY:
        raise MetadataUnavailableError(
            "MOONSHOT_API_KEY não configurada. Defina no arquivo .env (veja .env.example)."
        )
    resp = httpx.post(
        f"{config.MOONSHOT_BASE_URL.rstrip('/')}/chat/completions",
        headers={"Authorization": f"Bearer {config.MOONSHOT_API_KEY}"},
        json={"model": config.KIMI_MODEL, "messages": messages, "temperature": 0.7},
        timeout=90.0,
    )
    if resp.status_code != 200:
        raise MetadataError(f"Kimi API {resp.status_code}: {resp.text[:300]}")
    return resp.json()["choices"][0]["message"]["content"]


def _extract_json(text: str) -> dict | None:
    """Extrai o primeiro objeto JSON de uma resposta (com ou sem fences)."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE)
    m = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


_SYSTEM_PROMPT = """Você é um especialista em YouTube e criação de conteúdo para o mercado brasileiro.
Responda SEMPRE em português brasileiro e SOMENTE com um objeto JSON válido (sem markdown, sem texto fora do JSON), com exatamente estas chaves:
- "prompt_capa": string — um prompt de IA detalhado (em inglês, para usar em geradores de imagem como Midjourney/DALL-E) que descreve como recriar a capa do vídeo: estilo visual, composição, cores predominantes, iluminação, elementos gráficos e texto da capa. Baseie-se no título e no contexto do vídeo.
- "titulos_alternativos": array com exatamente 5 strings — títulos alternativos otimizados para CTR, em português.
- "descricao_pronta": string — descrição formatada pronta para colar no YouTube, com parágrafos curtos, call-to-action e hashtags no final.
- "tags": array de strings — 10 a 15 tags relevantes para o vídeo."""


def generate_metadata(query: str, client: youtube.YouTubeClient | None = None) -> dict:
    """Gera pacote completo de metadados para um vídeo (video_id ou URL)."""
    if not config.MOONSHOT_API_KEY:
        raise MetadataUnavailableError(
            "MOONSHOT_API_KEY não configurada. Defina no arquivo .env (veja .env.example)."
        )
    video_id = extract_video_id(query)
    if not video_id:
        raise ValueError(f"Não foi possível extrair o video_id de: {query}")

    own_client = client is None
    client = client or youtube.YouTubeClient()
    try:
        items = client.get_videos([video_id])
        if not items:
            raise ValueError(f"Vídeo não encontrado: {video_id}")
        snippet = items[0].get("snippet", {})
        title = snippet.get("title", "")
        description = snippet.get("description", "")
        tags = snippet.get("tags", [])
        channel_title = snippet.get("channelTitle", "")

        thumb_path = download_thumbnail(video_id)

        user_prompt = (
            f"Vídeo: {title}\n"
            f"Canal: {channel_title}\n"
            f"Tags atuais: {', '.join(tags) if tags else '(nenhuma)'}\n"
            f"Descrição atual (trecho):\n{description[:800]}\n\n"
            f"A capa original foi salva localmente e deve ser recriada pelo prompt_capa."
        )
        content = _call_kimi([
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ])
        parsed = _extract_json(content)
        if not parsed:
            raise MetadataError(f"Resposta da IA não continha JSON válido: {content[:200]}")

        return {
            "video_id": video_id,
            "original_title": title,
            "channel_title": channel_title,
            "original_tags": tags,
            "thumbnail_path": str(thumb_path),
            "thumbnail_url_local": f"/thumbnails/{video_id}.jpg",
            "prompt_capa": parsed.get("prompt_capa", ""),
            "titulos_alternativos": parsed.get("titulos_alternativos", []),
            "descricao_pronta": parsed.get("descricao_pronta", ""),
            "tags": parsed.get("tags", []),
        }
    finally:
        if own_client:
            client.close()
