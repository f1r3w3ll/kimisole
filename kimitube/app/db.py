"""Camada de dados do Kimitube — SQLite via stdlib sqlite3.

Schema conforme plano:
- channels(id, title, handle, custom_url, thumbnail_url, niche, tracked, added_at)
- channel_snapshots(channel_id, date, subs, total_views, video_count) UNIQUE(channel_id, date)
- videos(id, channel_id, title, published_at, duration_s, is_short, tags, thumbnail_url)
- video_snapshots(video_id, date, views, likes, comments) UNIQUE(video_id, date)
- keywords(id, term, niche, active)
- keyword_snapshots(keyword_id, date, avg_views_recent, video_count_recent, trends_index)
- quota_usage(date, units_used) UNIQUE(date)
- alerts(id, channel_id, video_id, sent_at)
"""

import json
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    handle TEXT,
    custom_url TEXT,
    thumbnail_url TEXT,
    niche TEXT,
    tracked INTEGER NOT NULL DEFAULT 0,
    source TEXT,              -- origem: spy, discover:channel:<id>, discover:keyword:<term>
    discovered_at TEXT,       -- quando foi descoberto (ISO)
    added_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_snapshots (
    channel_id TEXT NOT NULL REFERENCES channels(id),
    date TEXT NOT NULL,
    subs INTEGER NOT NULL,
    total_views INTEGER NOT NULL,
    video_count INTEGER NOT NULL,
    UNIQUE(channel_id, date)
);

CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id),
    title TEXT NOT NULL,
    published_at TEXT,
    duration_s INTEGER,
    is_short INTEGER NOT NULL DEFAULT 0,
    tags TEXT,             -- JSON array
    thumbnail_url TEXT
);

CREATE TABLE IF NOT EXISTS video_snapshots (
    video_id TEXT NOT NULL REFERENCES videos(id),
    date TEXT NOT NULL,
    views INTEGER NOT NULL,
    likes INTEGER NOT NULL,
    comments INTEGER NOT NULL,
    UNIQUE(video_id, date)
);

CREATE TABLE IF NOT EXISTS keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    term TEXT NOT NULL,
    niche TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(term, niche)
);

CREATE TABLE IF NOT EXISTS keyword_snapshots (
    keyword_id INTEGER NOT NULL REFERENCES keywords(id),
    date TEXT NOT NULL,
    avg_views_recent REAL,
    video_count_recent INTEGER,
    trends_index REAL,
    UNIQUE(keyword_id, date)
);

CREATE TABLE IF NOT EXISTS quota_usage (
    date TEXT PRIMARY KEY,
    units_used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    video_id TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    UNIQUE(channel_id, video_id)
);

CREATE TABLE IF NOT EXISTS discovery_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL REFERENCES channels(id),
    seed_channel_id TEXT,
    seed_keyword TEXT,
    score REAL NOT NULL DEFAULT 0,
    reason TEXT,
    common_tags TEXT,         -- JSON array
    discovered_at TEXT NOT NULL,
    UNIQUE(channel_id, seed_channel_id, seed_keyword)
);
CREATE INDEX IF NOT EXISTS idx_discovery_score ON discovery_candidates(score DESC);
"""


def get_conn(db_path: Path | None = None) -> sqlite3.Connection:
    """Abre conexão SQLite com row_factory em dict-like."""
    path = db_path or config.DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(db_path: Path | None = None) -> None:
    """Cria o schema se não existir e aplica migrações leves."""
    with get_conn(db_path) as conn:
        conn.executescript(SCHEMA)
        # Migrações leves para bancos existentes.
        for sql in (
            "ALTER TABLE channels ADD COLUMN source TEXT",
            "ALTER TABLE channels ADD COLUMN discovered_at TEXT",
        ):
            try:
                conn.execute(sql)
            except sqlite3.OperationalError:
                pass  # coluna já existe
        conn.commit()


# ---------------------------------------------------------------------------
# Channels
# ---------------------------------------------------------------------------

def upsert_channel(conn: sqlite3.Connection, channel: dict) -> None:
    """Insere/atualiza um canal. Campos: id, title, handle, custom_url,
    thumbnail_url, niche (opcional), source (opcional), discovered_at (opcional).
    Não altera o flag tracked."""
    conn.execute(
        """
        INSERT INTO channels (id, title, handle, custom_url, thumbnail_url, niche, source, discovered_at, added_at)
        VALUES (:id, :title, :handle, :custom_url, :thumbnail_url, :niche, :source, :discovered_at, :added_at)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            handle = excluded.handle,
            custom_url = excluded.custom_url,
            thumbnail_url = excluded.thumbnail_url,
            niche = COALESCE(excluded.niche, channels.niche),
            source = COALESCE(excluded.source, channels.source),
            discovered_at = COALESCE(excluded.discovered_at, channels.discovered_at)
        """,
        {
            "id": channel["id"],
            "title": channel.get("title", ""),
            "handle": channel.get("handle"),
            "custom_url": channel.get("custom_url"),
            "thumbnail_url": channel.get("thumbnail_url"),
            "niche": channel.get("niche"),
            "source": channel.get("source"),
            "discovered_at": channel.get("discovered_at"),
            "added_at": channel.get("added_at", datetime.utcnow().isoformat()),
        },
    )
    conn.commit()


def set_tracked(conn: sqlite3.Connection, channel_id: str, tracked: bool,
                niche: str | None = None) -> None:
    """Marca/desmarca canal como monitorado (radar). Atualiza nicho se dado."""
    conn.execute(
        "UPDATE channels SET tracked = ?, niche = COALESCE(?, niche) WHERE id = ?",
        (int(tracked), niche, channel_id),
    )
    conn.commit()


def get_tracked_channels(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM channels WHERE tracked = 1 ORDER BY title"
    ).fetchall()


def get_channel(conn: sqlite3.Connection, channel_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM channels WHERE id = ?", (channel_id,)).fetchone()


# ---------------------------------------------------------------------------
# Snapshots de canais
# ---------------------------------------------------------------------------

def upsert_channel_snapshot(conn: sqlite3.Connection, channel_id: str, subs: int,
                            total_views: int, video_count: int,
                            snap_date: str | None = None) -> None:
    """Grava snapshot diário do canal (idempotente por data)."""
    conn.execute(
        """
        INSERT INTO channel_snapshots (channel_id, date, subs, total_views, video_count)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(channel_id, date) DO UPDATE SET
            subs = excluded.subs,
            total_views = excluded.total_views,
            video_count = excluded.video_count
        """,
        (channel_id, snap_date or date.today().isoformat(), subs, total_views, video_count),
    )
    conn.commit()


def get_channel_snapshots(conn: sqlite3.Connection, channel_id: str) -> list[sqlite3.Row]:
    """Snapshots do canal em ordem cronológica."""
    return conn.execute(
        "SELECT * FROM channel_snapshots WHERE channel_id = ? ORDER BY date",
        (channel_id,),
    ).fetchall()


# ---------------------------------------------------------------------------
# Videos
# ---------------------------------------------------------------------------

def upsert_video(conn: sqlite3.Connection, video: dict) -> None:
    """Insere/atualiza metadados de um vídeo. tags pode ser lista (vira JSON)."""
    tags = video.get("tags")
    if isinstance(tags, (list, tuple)):
        tags = json.dumps(list(tags), ensure_ascii=False)
    conn.execute(
        """
        INSERT INTO videos (id, channel_id, title, published_at, duration_s, is_short, tags, thumbnail_url)
        VALUES (:id, :channel_id, :title, :published_at, :duration_s, :is_short, :tags, :thumbnail_url)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            published_at = excluded.published_at,
            duration_s = excluded.duration_s,
            is_short = excluded.is_short,
            tags = excluded.tags,
            thumbnail_url = excluded.thumbnail_url
        """,
        {
            "id": video["id"],
            "channel_id": video["channel_id"],
            "title": video.get("title", ""),
            "published_at": video.get("published_at"),
            "duration_s": video.get("duration_s"),
            "is_short": int(bool(video.get("is_short"))),
            "tags": tags,
            "thumbnail_url": video.get("thumbnail_url"),
        },
    )
    conn.commit()


def get_recent_videos(conn: sqlite3.Connection, channel_id: str,
                      limit: int = 50) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM videos WHERE channel_id = ? ORDER BY published_at DESC LIMIT ?",
        (channel_id, limit),
    ).fetchall()


def upsert_video_snapshot(conn: sqlite3.Connection, video_id: str, views: int,
                          likes: int, comments: int,
                          snap_date: str | None = None) -> None:
    conn.execute(
        """
        INSERT INTO video_snapshots (video_id, date, views, likes, comments)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(video_id, date) DO UPDATE SET
            views = excluded.views,
            likes = excluded.likes,
            comments = excluded.comments
        """,
        (video_id, snap_date or date.today().isoformat(), views, likes, comments),
    )
    conn.commit()


def get_video_snapshots(conn: sqlite3.Connection, video_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM video_snapshots WHERE video_id = ? ORDER BY date", (video_id,)
    ).fetchall()


# ---------------------------------------------------------------------------
# Keywords
# ---------------------------------------------------------------------------

def upsert_keyword(conn: sqlite3.Connection, term: str, niche: str | None = None,
                   active: bool = True) -> int:
    conn.execute(
        """
        INSERT INTO keywords (term, niche, active) VALUES (?, ?, ?)
        ON CONFLICT(term, niche) DO UPDATE SET active = excluded.active
        """,
        (term, niche, int(active)),
    )
    conn.commit()
    row = conn.execute(
        "SELECT id FROM keywords WHERE term = ? AND niche IS ?",
        (term, niche),
    ).fetchone()
    return row["id"]


def get_active_keywords(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM keywords WHERE active = 1 ORDER BY term"
    ).fetchall()


def upsert_keyword_snapshot(conn: sqlite3.Connection, keyword_id: int,
                            avg_views_recent: float, video_count_recent: int,
                            trends_index: float | None,
                            snap_date: str | None = None) -> None:
    conn.execute(
        """
        INSERT INTO keyword_snapshots (keyword_id, date, avg_views_recent, video_count_recent, trends_index)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(keyword_id, date) DO UPDATE SET
            avg_views_recent = excluded.avg_views_recent,
            video_count_recent = excluded.video_count_recent,
            trends_index = excluded.trends_index
        """,
        (keyword_id, snap_date or date.today().isoformat(),
         avg_views_recent, video_count_recent, trends_index),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Quota tracker
# ---------------------------------------------------------------------------

class QuotaExceededError(Exception):
    """Quota diária da YouTube Data API excedida (ou quase)."""


def add_quota_usage(conn: sqlite3.Connection, units: int,
                    usage_date: str | None = None) -> int:
    """Registra consumo de quota no dia e retorna o total do dia.

    Levanta QuotaExceededError se o total ultrapassar o limite diário.
    """
    day = usage_date or date.today().isoformat()
    conn.execute(
        """
        INSERT INTO quota_usage (date, units_used) VALUES (?, ?)
        ON CONFLICT(date) DO UPDATE SET units_used = units_used + excluded.units_used
        """,
        (day, units),
    )
    conn.commit()
    total = get_quota_usage(conn, day)
    if total > config.DAILY_QUOTA_LIMIT:
        raise QuotaExceededError(
            f"Quota diária da YouTube API excedida: {total}/{config.DAILY_QUOTA_LIMIT} unidades em {day}."
        )
    return total


def get_quota_usage(conn: sqlite3.Connection, usage_date: str | None = None) -> int:
    """Unidades consumidas no dia (hoje por padrão)."""
    day = usage_date or date.today().isoformat()
    row = conn.execute("SELECT units_used FROM quota_usage WHERE date = ?", (day,)).fetchone()
    return row["units_used"] if row else 0


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------

def video_exists(conn: sqlite3.Connection, video_id: str) -> bool:
    return conn.execute("SELECT 1 FROM videos WHERE id = ?", (video_id,)).fetchone() is not None


def alert_exists(conn: sqlite3.Connection, channel_id: str, video_id: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM alerts WHERE channel_id = ? AND video_id = ?",
        (channel_id, video_id),
    ).fetchone() is not None


def insert_alert(conn: sqlite3.Connection, channel_id: str, video_id: str,
                 sent_at: str | None = None) -> None:
    """Registra alerta (idempotente por canal+vídeo) para não duplicar e-mails."""
    conn.execute(
        """
        INSERT INTO alerts (channel_id, video_id, sent_at) VALUES (?, ?, ?)
        ON CONFLICT(channel_id, video_id) DO NOTHING
        """,
        (channel_id, video_id, sent_at or datetime.utcnow().isoformat()),
    )
    conn.commit()


def get_alerts(conn: sqlite3.Connection, limit: int = 100) -> list[sqlite3.Row]:
    """Histórico de alertas, mais recentes primeiro, com título do canal."""
    return conn.execute(
        """
        SELECT a.*, c.title AS channel_title, v.title AS video_title
        FROM alerts a
        LEFT JOIN channels c ON c.id = a.channel_id
        LEFT JOIN videos v ON v.id = a.video_id
        ORDER BY a.sent_at DESC LIMIT ?
        """,
        (limit,),
    ).fetchall()


# ---------------------------------------------------------------------------
# Descoberta de canais
# ---------------------------------------------------------------------------

def upsert_discovery_candidate(conn: sqlite3.Connection, candidate: dict) -> None:
    """Persiste/atualiza um candidato da descoberta."""
    tags = candidate.get("common_tags")
    if isinstance(tags, (list, tuple)):
        tags = json.dumps(list(tags), ensure_ascii=False)
    conn.execute(
        """
        INSERT INTO discovery_candidates
            (channel_id, seed_channel_id, seed_keyword, score, reason, common_tags, discovered_at)
        VALUES (:channel_id, :seed_channel_id, :seed_keyword, :score, :reason, :common_tags, :discovered_at)
        ON CONFLICT(channel_id, seed_channel_id, seed_keyword) DO UPDATE SET
            score = excluded.score,
            reason = excluded.reason,
            common_tags = excluded.common_tags,
            discovered_at = excluded.discovered_at
        """,
        {
            "channel_id": candidate["channel_id"],
            "seed_channel_id": candidate.get("seed_channel_id"),
            "seed_keyword": candidate.get("seed_keyword"),
            "score": candidate.get("score", 0),
            "reason": candidate.get("reason"),
            "common_tags": tags,
            "discovered_at": candidate.get("discovered_at", datetime.now(timezone.utc).isoformat()),
        },
    )
    conn.commit()


def get_discovery_candidates(conn: sqlite3.Connection,
                             tracked: bool | None = None,
                             min_score: float | None = None,
                             seed_channel_id: str | None = None,
                             seed_keyword: str | None = None,
                             limit: int = 100) -> list[sqlite3.Row]:
    """Candidatos descobertos, juntos com dados do canal."""
    where = ["1=1"]
    params: list = []
    if tracked is not None:
        where.append("c.tracked = ?")
        params.append(int(tracked))
    if min_score is not None:
        where.append("dc.score >= ?")
        params.append(min_score)
    if seed_channel_id is not None:
        where.append("dc.seed_channel_id = ?")
        params.append(seed_channel_id)
    if seed_keyword is not None:
        where.append("dc.seed_keyword = ?")
        params.append(seed_keyword)

    sql = f"""
        SELECT dc.*, c.title, c.handle, c.thumbnail_url, c.niche, c.tracked
        FROM discovery_candidates dc
        JOIN channels c ON c.id = dc.channel_id
        WHERE {' AND '.join(where)}
        ORDER BY dc.score DESC, dc.discovered_at DESC
        LIMIT ?
    """
    params.append(limit)
    return conn.execute(sql, params).fetchall()
