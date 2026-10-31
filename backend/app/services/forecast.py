"""Probabilistic delivery forecasting (Monte Carlo over historical throughput).

Instead of a single "velocity" number, we resample the team's actual daily
throughput (points completed per working day) to simulate thousands of
possible futures. Output: probability of finishing the remaining scope by a
deadline, and P50/P85/P95 completion dates.
"""
from __future__ import annotations

import random
from datetime import date, timedelta

from .scheduling import WEEKEND, add_working_days, working_days_between


def daily_throughput(completions: list[tuple[date, float]], window_end: date, window_days: int = 28) -> list[float]:
    """Points completed per working day across the trailing window (zeros included)."""
    start = window_end - timedelta(days=window_days - 1)
    buckets: dict[date, float] = {}
    d = start
    while d <= window_end:
        if d.weekday() not in WEEKEND:
            buckets[d] = 0.0
        d += timedelta(days=1)
    for day, pts in completions:
        if day in buckets:
            buckets[day] += pts
    return list(buckets.values())


def simulate(
    remaining: float,
    samples: list[float],
    today: date,
    deadline: date | None = None,
    runs: int = 5000,
    max_days: int = 365,
    seed: int | None = 7,
) -> dict:
    if remaining <= 0:
        return {
            "remaining_points": 0,
            "probability_on_time": 1.0 if deadline else None,
            "p50": today.isoformat(),
            "p85": today.isoformat(),
            "p95": today.isoformat(),
            "runs": 0,
            "basis": "nothing remaining",
        }
    if not samples or sum(samples) == 0:
        return {
            "remaining_points": remaining,
            "probability_on_time": None,
            "p50": None,
            "p85": None,
            "p95": None,
            "runs": 0,
            "basis": "insufficient history",
        }
    rng = random.Random(seed)
    days_needed = []
    for _ in range(runs):
        done, days = 0.0, 0
        while done < remaining and days < max_days:
            done += rng.choice(samples)
            days += 1
        days_needed.append(days)
    days_needed.sort()

    def pct(p: float) -> date:
        n = days_needed[min(len(days_needed) - 1, int(p * len(days_needed)))]
        return add_working_days(today, max(0, n - 1))

    prob = None
    if deadline is not None:
        budget = working_days_between(today, deadline) + (0 if today.weekday() in WEEKEND else 1)
        prob = round(sum(1 for d in days_needed if d <= budget) / runs, 3)
    return {
        "remaining_points": remaining,
        "probability_on_time": prob,
        "p50": pct(0.50).isoformat(),
        "p85": pct(0.85).isoformat(),
        "p95": pct(0.95).isoformat(),
        "runs": runs,
        "basis": f"{len(samples)} working days of history, mean {sum(samples) / len(samples):.2f} pts/day",
    }
