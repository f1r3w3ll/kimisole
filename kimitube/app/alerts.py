"""Alertas de novos vídeos — polling RSS (grátis, 0 quota) + e-mail SMTP.

Para cada canal tracked, lê o feed Atom do YouTube. Vídeo novo (não existe em
`videos` nem em `alerts`) → envia e-mail (se SMTP configurado) e registra em
`alerts` para não duplicar.
"""

import logging
import smtplib
import sqlite3
import xml.etree.ElementTree as ET
from email.message import EmailMessage

import httpx

from . import config, db

logger = logging.getLogger(__name__)

ATOM = "{http://www.w3.org/2005/Atom}"
YT = "{http://www.youtube.com/xml/schemas/2015}"


def parse_feed(xml_text: str) -> list[dict]:
    """Parse do feed Atom do YouTube → lista de {video_id, title, published, link}."""
    root = ET.fromstring(xml_text)
    entries = []
    for entry in root.findall(f"{ATOM}entry"):
        video_id_el = entry.find(f"{YT}videoId")
        title_el = entry.find(f"{ATOM}title")
        published_el = entry.find(f"{ATOM}published")
        link_el = entry.find(f"{ATOM}link")
        if video_id_el is None or not video_id_el.text:
            continue
        entries.append({
            "video_id": video_id_el.text,
            "title": title_el.text if title_el is not None else "",
            "published": published_el.text if published_el is not None else None,
            "link": (link_el.get("href") if link_el is not None else None)
                    or f"https://www.youtube.com/watch?v={video_id_el.text}",
        })
    return entries


def smtp_configured() -> bool:
    """True se as credenciais SMTP mínimas estão no .env."""
    return bool(config.SMTP_HOST and config.SMTP_USER and config.SMTP_PASS
                and config.ALERT_EMAIL_TO)


def send_email(subject: str, html_body: str) -> None:
    """Envia e-mail via SMTP com STARTTLS (porta 587 por padrão)."""
    if not smtp_configured():
        raise RuntimeError("SMTP não configurado (SMTP_HOST/USER/PASS, ALERT_EMAIL_TO).")
    msg = EmailMessage()
    msg["From"] = config.SMTP_USER
    msg["To"] = config.ALERT_EMAIL_TO
    msg["Subject"] = subject
    msg.set_content("Seu cliente de e-mail não suporta HTML.")
    msg.add_alternative(html_body, subtype="html")
    with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=30) as smtp:
        smtp.starttls()
        smtp.login(config.SMTP_USER, config.SMTP_PASS)
        smtp.send_message(msg)


def _video_email_html(channel_title: str, video: dict) -> str:
    thumb = f"https://i.ytimg.com/vi/{video['video_id']}/hqdefault.jpg"
    return f"""
    <h2>Novo vídeo de {channel_title}</h2>
    <p><a href="{video['link']}"><strong>{video['title']}</strong></a></p>
    <p><a href="{video['link']}"><img src="{thumb}" alt="thumbnail" width="480"></a></p>
    <p>Publicado em: {video.get('published') or 'desconhecido'}</p>
    """


def check_new_videos(conn: sqlite3.Connection | None = None,
                     send: bool = True) -> dict:
    """Polling RSS de todos os canais tracked. Retorna os vídeos novos.

    Sem SMTP configurado, apenas registra/loga os vídeos novos (sem quebrar).
    """
    own_conn = conn is None
    conn = conn or db.get_conn()
    found, emails_sent, errors = [], 0, []
    try:
        channels = db.get_tracked_channels(conn)
        with httpx.Client(timeout=30.0) as http:
            for ch in channels:
                url = config.RSS_URL_TEMPLATE.format(channel_id=ch["id"])
                try:
                    resp = http.get(url)
                    if resp.status_code != 200:
                        errors.append({"channel_id": ch["id"],
                                       "error": f"RSS HTTP {resp.status_code}"})
                        continue
                    for entry in parse_feed(resp.text):
                        vid = entry["video_id"]
                        if db.video_exists(conn, vid) or db.alert_exists(conn, ch["id"], vid):
                            continue
                        entry["channel_id"] = ch["id"]
                        entry["channel_title"] = ch["title"]
                        entry["email_sent"] = False
                        if send and smtp_configured():
                            try:
                                send_email(
                                    f"[Kimitube] Novo vídeo: {entry['title']}",
                                    _video_email_html(ch["title"], entry),
                                )
                                entry["email_sent"] = True
                                emails_sent += 1
                            except Exception as e:  # noqa: BLE001 — e-mail não deve derrubar o job
                                logger.exception("Falha ao enviar e-mail de alerta")
                                entry["email_error"] = str(e)
                        elif send:
                            logger.warning("SMTP não configurado — vídeo novo apenas registrado: %s", vid)
                        db.insert_alert(conn, ch["id"], vid)
                        found.append(entry)
                except Exception as e:  # noqa: BLE001 — loga e segue para o próximo canal
                    logger.exception("Erro no polling RSS do canal %s", ch["id"])
                    errors.append({"channel_id": ch["id"], "error": str(e)})
        result = {
            "new_videos": found,
            "emails_sent": emails_sent,
            "smtp_configured": smtp_configured(),
            "channels_checked": len(channels),
            "errors": errors,
        }
        logger.info("Polling RSS concluído: %d vídeos novos, %d e-mails enviados",
                    len(found), emails_sent)
        return result
    finally:
        if own_conn:
            conn.close()
