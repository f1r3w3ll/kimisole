"""Scheduler APScheduler — jobs do Kimitube.

- 02:00  coletor diário (snapshots de canais + vídeos recentes)
- 03:00  keywords (search.list + pytrends)
- a cada 30 min  polling RSS de alertas (0 quota)
"""

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from . import alerts, collector

logger = logging.getLogger(__name__)


def create_scheduler() -> BackgroundScheduler:
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        collector.collect_channel_snapshots,
        CronTrigger(hour=2, minute=0),
        id="daily_collector",
        name="Coletor diário de canais/vídeos",
        replace_existing=True,
    )
    scheduler.add_job(
        collector.collect_keyword_snapshots,
        CronTrigger(hour=3, minute=0),
        id="keyword_collector",
        name="Coletor diário de keywords",
        replace_existing=True,
    )
    scheduler.add_job(
        alerts.check_new_videos,
        IntervalTrigger(minutes=30),
        id="rss_alerts",
        name="Polling RSS de alertas",
        replace_existing=True,
    )
    return scheduler
