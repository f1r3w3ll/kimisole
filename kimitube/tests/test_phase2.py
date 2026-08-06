"""Testes unitários de alerts (parse RSS) e metadata_gen (extração) — sem rede."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import alerts, metadata_gen  # noqa: E402

SAMPLE_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <title>Canal Teste</title>
  <entry>
    <yt:videoId>abc123def45</yt:videoId>
    <yt:channelId>UCxxxxxxxxxxxxxxxxxxxxxx</yt:channelId>
    <title>Meu vídeo novo</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc123def45"/>
    <published>2026-08-01T12:00:00+00:00</published>
  </entry>
  <entry>
    <yt:videoId>xyz987uvw65</yt:videoId>
    <yt:channelId>UCxxxxxxxxxxxxxxxxxxxxxx</yt:channelId>
    <title>Outro vídeo</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=xyz987uvw65"/>
    <published>2026-07-28T18:30:00+00:00</published>
  </entry>
</feed>
"""


class TestParseFeed:
    def test_parses_entries(self):
        entries = alerts.parse_feed(SAMPLE_FEED)
        assert len(entries) == 2
        assert entries[0]["video_id"] == "abc123def45"
        assert entries[0]["title"] == "Meu vídeo novo"
        assert entries[0]["published"] == "2026-08-01T12:00:00+00:00"
        assert entries[0]["link"] == "https://www.youtube.com/watch?v=abc123def45"

    def test_empty_feed(self):
        xml = ('<feed xmlns="http://www.w3.org/2005/Atom" '
               'xmlns:yt="http://www.youtube.com/xml/schemas/2015"><title>x</title></feed>')
        assert alerts.parse_feed(xml) == []


class TestExtractVideoId:
    def test_watch_url(self):
        assert metadata_gen.extract_video_id(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s") == "dQw4w9WgXcQ"

    def test_short_url(self):
        assert metadata_gen.extract_video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_shorts_url(self):
        assert metadata_gen.extract_video_id(
            "https://www.youtube.com/shorts/dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_raw_id(self):
        assert metadata_gen.extract_video_id("dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_invalid(self):
        assert metadata_gen.extract_video_id("não é url nem id") is None


class TestExtractJson:
    def test_plain_json(self):
        assert metadata_gen._extract_json('{"a": 1}') == {"a": 1}

    def test_fenced_json(self):
        assert metadata_gen._extract_json('```json\n{"a": 1}\n```') == {"a": 1}

    def test_json_with_surrounding_text(self):
        assert metadata_gen._extract_json('Aqui está: {"a": 1} fim.') == {"a": 1}

    def test_no_json(self):
        assert metadata_gen._extract_json("sem json aqui") is None
