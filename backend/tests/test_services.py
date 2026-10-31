from datetime import date

import pytest

from app.services.forecast import daily_throughput, simulate
from app.services.ordering import rank_between
from app.services.scheduling import add_working_days, critical_path, would_create_cycle


def test_rank_between():
    assert rank_between(None, None) > 0
    assert rank_between(10, 20) == 15
    assert rank_between(None, 10) < 10
    assert rank_between(10, None) > 10


def test_cycle_detection():
    edges = [(1, 2), (2, 3)]
    assert would_create_cycle(edges, 3, 1)
    assert not would_create_cycle(edges, 1, 3)
    assert would_create_cycle(edges, 2, 2)


def test_critical_path_diamond():
    #   1(2) -> 2(5) -> 4(1)
    #   1(2) -> 3(1) -> 4(1)
    cpm = critical_path({1: 2, 2: 5, 3: 1, 4: 1}, [(1, 2), (1, 3), (2, 4), (3, 4)])
    assert cpm["length"] == 8
    assert cpm["chain"] == [1, 2, 4]
    assert cpm["nodes"][3].slack == 4


def test_critical_path_rejects_cycles():
    with pytest.raises(ValueError):
        critical_path({1: 1, 2: 1}, [(1, 2), (2, 1)])


def test_working_days_skip_weekend():
    friday = date(2026, 10, 30)
    assert add_working_days(friday, 1) == date(2026, 11, 2)  # Monday


def test_monte_carlo_bounds():
    samples = [2.0] * 10
    r = simulate(10, samples, date(2026, 11, 2), deadline=date(2026, 11, 6))  # Mon..Fri = 5 days, need 5
    assert r["probability_on_time"] == 1.0 and r["p50"] == "2026-11-06"
    r = simulate(10, samples, date(2026, 11, 2), deadline=date(2026, 11, 5))
    assert r["probability_on_time"] == 0.0
    assert simulate(5, [], date(2026, 11, 2))["basis"] == "insufficient history"


def test_daily_throughput_includes_zero_days():
    s = daily_throughput([(date(2026, 10, 29), 3.0)], date(2026, 10, 30), window_days=7)
    assert sum(s) == 3.0 and len(s) == 5
