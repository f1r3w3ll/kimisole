"""Testes unitários dos cálculos de radar — dados sintéticos, sem rede.

Cobre: crescimento % em janelas, consistência semanal, views/dia,
z-score e radar score 0-100.
"""

import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import radar  # noqa: E402


def make_snapshots(start: date, daily_subs: list[int]) -> list[tuple[str, int]]:
    """Gera [(date_iso, subs)] diários a partir de start."""
    return [((start + timedelta(days=i)).isoformat(), subs)
            for i, subs in enumerate(daily_subs)]


# ---------------------------------------------------------------------------
# growth_pct / growth_over_window
# ---------------------------------------------------------------------------

class TestGrowthPct:
    def test_basic(self):
        assert radar.growth_pct(110, 100) == 10.0

    def test_negative(self):
        assert radar.growth_pct(90, 100) == -10.0

    def test_zero_base_returns_none(self):
        assert radar.growth_pct(100, 0) is None


class TestGrowthOverWindow:
    def test_30d_window_uses_oldest_inside_window(self):
        # 11 dias de dados: cresce 100 → 110 (10%)
        start = date(2026, 7, 25)
        snaps = make_snapshots(start, [100 + i for i in range(11)])
        today = date(2026, 8, 3)
        assert radar.growth_over_window(snaps, 30, today) == 10.0

    def test_window_with_full_history(self):
        # 100 dias de dados: dia 0 = 1000, dia 99 = 2000 → +100% em 90d
        start = date(2026, 1, 1)
        snaps = make_snapshots(start, [1000 + round(i * 1000 / 99) for i in range(100)])
        today = date(2026, 4, 10)
        result = radar.growth_over_window(snaps, 90, today)
        # base = snapshot mais antigo dentro da janela (~dia 9, subs ≈ 1091)
        base = snaps[9][1]
        assert result == round(100 * (snaps[-1][1] - base) / base, 2)

    def test_single_snapshot_returns_none(self):
        snaps = [("2026-08-01", 1000)]
        assert radar.growth_over_window(snaps, 30, date(2026, 8, 2)) is None

    def test_empty_returns_none(self):
        assert radar.growth_over_window([], 30) is None


# ---------------------------------------------------------------------------
# consistency_ratio
# ---------------------------------------------------------------------------

class TestConsistency:
    def test_all_positive_weeks(self):
        # 4 semanas, subs sempre subindo → 100%
        start = date(2026, 7, 6)  # segunda-feira
        snaps = make_snapshots(start, [100 + 10 * i for i in range(28)])
        assert radar.consistency_ratio(snaps) == 100.0

    def test_half_positive_weeks(self):
        # 3 semanas: sobe, desce, sobe → 1 de 2 transições positiva = 50%
        # semana 1 termina em 200, semana 2 em 100, semana 3 em 300
        snaps = [
            ("2026-07-06", 100), ("2026-07-12", 200),   # semana 28 → 200
            ("2026-07-13", 150), ("2026-07-19", 100),   # semana 29 → 100 (desceu)
            ("2026-07-20", 250), ("2026-07-26", 300),   # semana 30 → 300 (subiu)
        ]
        assert radar.consistency_ratio(snaps) == 50.0

    def test_single_week_returns_none(self):
        snaps = make_snapshots(date(2026, 7, 6), [100, 110, 120])
        assert radar.consistency_ratio(snaps) is None

    def test_stagnant_is_zero(self):
        # mesmos subs em todas as semanas → 0% semanas positivas
        snaps = [
            ("2026-07-06", 100), ("2026-07-12", 100),
            ("2026-07-13", 100), ("2026-07-19", 100),
        ]
        assert radar.consistency_ratio(snaps) == 0.0


# ---------------------------------------------------------------------------
# views_gained_per_day
# ---------------------------------------------------------------------------

class TestViewsPerDay:
    def test_basic(self):
        # (date, subs, total_views): 1000 views em 10 dias → 100/dia
        snaps = [(f"2026-07-{10 + i:02d}", 500, 10_000 + 100 * i) for i in range(11)]
        assert radar.views_gained_per_day(snaps, days=30, today=date(2026, 7, 20)) == 100.0

    def test_single_snapshot_returns_none(self):
        assert radar.views_gained_per_day([("2026-07-10", 500, 10_000)]) is None


# ---------------------------------------------------------------------------
# zscore / radar_score
# ---------------------------------------------------------------------------

class TestZScore:
    def test_outlier_has_high_z(self):
        population = [10.0, 11.0, 9.0, 10.5, 9.5, 10.2, 9.8]
        z = radar.zscore(30.0, population)
        assert z is not None and z > 3

    def test_mean_value_has_zero_z(self):
        population = [10.0, 20.0, 30.0]
        assert radar.zscore(20.0, population) == pytest.approx(0.0)

    def test_zero_stddev_returns_none(self):
        assert radar.zscore(5.0, [5.0, 5.0, 5.0]) is None

    def test_single_peer_returns_none(self):
        assert radar.zscore(5.0, [3.0]) is None


class TestRadarScore:
    def test_average_channel_scores_around_50(self):
        peers = {
            "views_per_sub": [1.0, 1.1, 0.9, 1.0],
            "vpd_per_sub": [0.05, 0.055, 0.045, 0.05],
            "acceleration": [2.0, 2.5, 1.5, 2.0],
        }
        result = radar.radar_score(1.0, 0.05, 2.0, peers)
        assert 40 <= result["score"] <= 60

    def test_outlier_scores_near_100(self):
        peers = {
            "views_per_sub": [1.0, 1.1, 0.9, 1.0, 1.05, 0.95],
            "vpd_per_sub": [0.05, 0.055, 0.045, 0.05, 0.052, 0.048],
            "acceleration": [2.0, 2.5, 1.5, 2.0, 2.2, 1.8],
        }
        result = radar.radar_score(10.0, 0.5, 20.0, peers)
        assert result["score"] >= 90

    def test_laggard_scores_low(self):
        peers = {
            "views_per_sub": [1.0, 1.1, 0.9, 1.0, 1.05, 0.95],
            "vpd_per_sub": [0.05, 0.055, 0.045, 0.05, 0.052, 0.048],
            "acceleration": [2.0, 2.5, 1.5, 2.0, 2.2, 1.8],
        }
        result = radar.radar_score(0.01, 0.001, -20.0, peers)
        assert result["score"] <= 10

    def test_no_peers_returns_none_score(self):
        result = radar.radar_score(1.0, 0.05, 2.0,
                                   {"views_per_sub": [], "vpd_per_sub": [], "acceleration": []})
        assert result["score"] is None

    def test_score_bounded_0_100(self):
        peers = {
            "views_per_sub": [1.0, 1.0, 1.0001, 0.9999],
            "vpd_per_sub": [0.05, 0.05, 0.05001, 0.04999],
            "acceleration": [2.0, 2.0, 2.0001, 1.9999],
        }
        result = radar.radar_score(1e9, 1e9, 1e9, peers)
        assert 0.0 <= result["score"] <= 100.0


# ---------------------------------------------------------------------------
# sub_tier
# ---------------------------------------------------------------------------

class TestSubTier:
    @pytest.mark.parametrize("subs,expected", [
        (500, "micro"),
        (5_000, "pequeno"),
        (50_000, "medio"),
        (500_000, "grande"),
        (5_000_000, "gigante"),
    ])
    def test_tiers(self, subs, expected):
        assert radar.sub_tier(subs) == expected
