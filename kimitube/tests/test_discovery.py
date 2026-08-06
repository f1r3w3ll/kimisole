"""Testes do módulo de descoberta — sem rede, usando cliente fake."""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest

from app import db, discovery


class FakeYouTubeClient:
    """Cliente fake com respostas configuráveis."""

    def __init__(self):
        self.conn = db.get_conn(Path(":memory:"))
        self.conn.executescript(db.SCHEMA)
        self.responses = {}
        self.calls = []

    def close(self):
        self.conn.close()

    def _get(self, endpoint, params, cost=1):
        self.calls.append((endpoint, params, cost))
        # lookup exato
        key = (endpoint, tuple(sorted(params.items())))
        if key in self.responses:
            return self.responses[key]
        # lookup por endpoint + query (útil para search.list com publishedAfter dinâmico)
        q = params.get("q")
        if endpoint == "search" and q in self.responses:
            return self.responses[q]
        if endpoint == "channels" and "id" in params:
            return self.responses.get(("channels", params["id"]), {"items": []})
        return {"items": []}

    def resolve_channel(self, query):
        return self.responses.get("resolve_channel")

    def get_channel_by_id(self, channel_id):
        return self.responses.get(f"channel:{channel_id}")

    def get_uploads_playlist_id(self, channel_item):
        return channel_item["contentDetails"]["relatedPlaylists"]["uploads"]

    def list_uploads(self, uploads_playlist_id, max_items=50):
        return self.responses.get(("uploads", uploads_playlist_id), [])

    def get_videos(self, video_ids):
        all_videos = self.responses.get("videos", [])
        return [v for v in all_videos if v["id"] in video_ids]


@pytest.fixture
def fake_client():
    client = FakeYouTubeClient()
    yield client
    client.close()


def _make_channel(cid, title, handle, subs=10000):
    return {
        "id": cid,
        "snippet": {"title": title, "customUrl": handle,
                    "thumbnails": {"medium": {"url": "http://t/" + cid}}},
        "statistics": {"subscriberCount": str(subs), "viewCount": "100000",
                       "videoCount": "50"},
        "contentDetails": {"relatedPlaylists": {"uploads": f"UU{cid[2:]}"}},
    }


def _make_video(vid, cid, title, tags=None, views=1000):
    return {
        "id": vid,
        "snippet": {"title": title, "channelId": cid, "publishedAt": "2026-08-01T12:00:00Z",
                    "tags": tags or [], "thumbnails": {"medium": {"url": ""}}},
        "statistics": {"viewCount": str(views), "likeCount": "10", "commentCount": "1"},
        "contentDetails": {"duration": "PT5M"},
    }


class TestExtractTerms:
    def test_extracts_tags_and_title_words(self):
        videos = [
            {"title": "Como ganhar dinheiro com inteligencia artificial", "tags": ["inteligencia", "dinheiro", "marketing"]},
            {"title": "Inteligencia artificial para advogados", "tags": ["inteligencia", "advogados"]},
        ]
        terms = discovery._extract_terms_from_videos(videos)
        assert terms[0][0] == "inteligencia"
        # termos mais frequentes devem estar no top 3
        top_terms = [t[0] for t in terms]
        assert "dinheiro" in top_terms or "advogados" in top_terms

    def test_ignores_stopwords_and_short_words(self):
        videos = [{"title": "a o de em", "tags": []}]
        terms = discovery._extract_terms_from_videos(videos)
        assert all(len(t[0]) >= 3 for t in terms)


class TestSearchResultsToOverlaps:
    def test_counts_overlaps(self, fake_client):
        fake_client.responses["ia"] = {
            "items": [
                {"snippet": {"channelId": "UC_A"}},
                {"snippet": {"channelId": "UC_B"}},
                {"snippet": {"channelId": "UC_A"}},
            ]
        }
        overlaps, terms = discovery._search_results_to_channel_overlaps(
            fake_client, ["ia"], results_per_term=25, days=90,
        )
        assert overlaps == {"UC_A": 2, "UC_B": 1}
        assert terms["UC_A"] == ["ia", "ia"]


class TestScoreCandidate:
    def test_high_overlap_and_similar_size_scores_well(self):
        ch = {"id": "UC_A", "subs": 10000, "hidden_subs": False}
        score, reason = discovery._score_candidate(
            ch, overlap_count=3, matched_terms=["ia"],
            seed_subs=12000, min_subs=None, max_subs=None,
            recent_velocity=500,
        )
        assert 0 <= score <= 100
        assert "ia" in reason

    def test_filters_by_sub_range(self):
        ch = {"id": "UC_A", "subs": 500, "hidden_subs": False}
        score, _ = discovery._score_candidate(
            ch, overlap_count=5, matched_terms=["x"],
            seed_subs=10000, min_subs=1000, max_subs=None,
            recent_velocity=100,
        )
        assert score == 0.0

    def test_hidden_subs_penalty(self):
        ch = {"id": "UC_A", "subs": 10000, "hidden_subs": True}
        score_vis, _ = discovery._score_candidate(
            ch, overlap_count=2, matched_terms=["x"],
            seed_subs=10000, min_subs=None, max_subs=None,
            recent_velocity=300,
        )
        ch["hidden_subs"] = False
        score_hidden, _ = discovery._score_candidate(
            ch, overlap_count=2, matched_terms=["x"],
            seed_subs=10000, min_subs=None, max_subs=None,
            recent_velocity=300,
        )
        assert score_vis < score_hidden


class TestDiscoverByChannel:
    def test_full_flow_persists_candidates(self, fake_client):
        seed = _make_channel("UC_SEED", "Canal Semente", "@seed", subs=15000)
        cand = _make_channel("UC_CAND", "Canal Similar", "@similar", subs=12000)

        fake_client.responses["resolve_channel"] = seed
        fake_client.responses[("uploads", "UU_SEED")] = ["v1", "v2"]
        fake_client.responses["videos"] = [
            _make_video("v1", "UC_SEED", "IA para iniciantes", tags=["ia", "tutorial"], views=5000),
            _make_video("v2", "UC_SEED", "Marketing com IA", tags=["ia", "marketing"], views=3000),
        ]

        # search.list para "inteligencia"
        fake_client.responses["inteligencia"] = {
            "items": [{"snippet": {"channelId": "UC_CAND"}}]
        }
        # search.list para "artificial" e "tutorial" retornam vazio por padrão.

        # channels.list para UC_CAND
        fake_client.responses[("channels", "UC_CAND")] = {"items": [cand]}

        # velocity de UC_CAND
        fake_client.responses["channel:UC_CAND"] = cand
        fake_client.responses[("uploads", "UU_CAND")] = ["cv1"]
        fake_client.responses["videos"] = [
            _make_video("v1", "UC_SEED", "IA para iniciantes", tags=["inteligencia", "tutorial"], views=5000),
            _make_video("v2", "UC_SEED", "Marketing com inteligencia artificial", tags=["inteligencia", "marketing"], views=3000),
            _make_video("cv1", "UC_CAND", "Vídeo", views=400),
        ]

        result = discovery.discover_by_channel("@seed", max_results=10, client=fake_client)

        assert result["seed_channel_id"] == "UC_SEED"
        assert any(c["channel"]["id"] == "UC_CAND" for c in result["candidates"])

        # Verifica persistência.
        row = fake_client.conn.execute(
            "SELECT * FROM discovery_candidates WHERE channel_id = ?", ("UC_CAND",)
        ).fetchone()
        assert row is not None
        assert row["score"] > 0
        assert row["seed_channel_id"] == "UC_SEED"

    def test_seed_not_found_raises(self, fake_client):
        fake_client.responses["resolve_channel"] = None
        with pytest.raises(discovery.DiscoveryError):
            discovery.discover_by_channel("@inexistente", client=fake_client)


class TestDiscoverByKeyword:
    def test_keyword_flow(self, fake_client):
        cand = _make_channel("UC_KW", "Canal Keyword", "@kw", subs=8000)
        fake_client.responses["finanças"] = {
            "items": [{"snippet": {"channelId": "UC_KW"}}]
        }
        fake_client.responses[("channels", "UC_KW")] = {"items": [cand]}
        fake_client.responses["channel:UC_KW"] = cand
        fake_client.responses[("uploads", "UU_KW")] = ["k1"]
        fake_client.responses["videos"] = [_make_video("k1", "UC_KW", "Vídeo", views=300)]

        result = discovery.discover_by_keyword("finanças", max_results=10, client=fake_client)
        assert result["seed_keyword"] == "finanças"
        assert any(c["channel"]["id"] == "UC_KW" for c in result["candidates"])

        row = fake_client.conn.execute(
            "SELECT * FROM discovery_candidates WHERE seed_keyword = ?", ("finanças",)
        ).fetchone()
        assert row is not None
