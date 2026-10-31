"""Dependency graph analysis: cycle detection and Critical Path Method (CPM).

Durations are task estimates in story points, interpreted as ideal working
days (default 1 when unestimated). Completed/cancelled tasks have duration 0,
so the critical path always describes the *remaining* work.
"""
from __future__ import annotations

import os
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import date, timedelta

WEEKEND = {int(d) for d in os.getenv("KAIROS_WEEKEND", "5,6").split(",") if d.strip()}  # Mon=0 .. Sun=6


def add_working_days(start: date, days: float) -> date:
    """Calendar date after `days` working days from `start` (start counts as day 0)."""
    d = start
    remaining = int(round(days))
    while d.weekday() in WEEKEND:
        d += timedelta(days=1)
    while remaining > 0:
        d += timedelta(days=1)
        if d.weekday() not in WEEKEND:
            remaining -= 1
    return d


def working_days_between(start: date, end: date) -> int:
    if end <= start:
        return 0
    n, d = 0, start
    while d < end:
        d += timedelta(days=1)
        if d.weekday() not in WEEKEND:
            n += 1
    return n


def would_create_cycle(edges: list[tuple[int, int]], blocker: int, blocked: int) -> bool:
    """True if adding blocker->blocked closes a cycle, i.e. blocked already reaches blocker."""
    if blocker == blocked:
        return True
    adj = defaultdict(list)
    for a, b in edges:
        adj[a].append(b)
    stack, seen = [blocked], set()
    while stack:
        n = stack.pop()
        if n == blocker:
            return True
        if n in seen:
            continue
        seen.add(n)
        stack.extend(adj[n])
    return False


@dataclass
class Node:
    id: int
    duration: float
    es: float = 0.0
    ef: float = 0.0
    ls: float = 0.0
    lf: float = 0.0

    @property
    def slack(self) -> float:
        return round(self.ls - self.es, 6)


def critical_path(durations: dict[int, float], edges: list[tuple[int, int]]) -> dict:
    """Forward/backward pass over a DAG.

    Returns per-node timings, the project length and the ordered critical chain
    (longest zero-slack path).
    """
    nodes = {i: Node(i, d) for i, d in durations.items()}
    edges = [(a, b) for a, b in edges if a in nodes and b in nodes]
    succ, pred = defaultdict(list), defaultdict(list)
    indeg = {i: 0 for i in nodes}
    for a, b in edges:
        succ[a].append(b)
        pred[b].append(a)
        indeg[b] += 1

    q = deque(sorted(i for i, d in indeg.items() if d == 0))
    order = []
    while q:
        n = q.popleft()
        order.append(n)
        for s in succ[n]:
            indeg[s] -= 1
            if indeg[s] == 0:
                q.append(s)
    if len(order) != len(nodes):
        raise ValueError("dependency graph contains a cycle")

    for n in order:
        node = nodes[n]
        node.es = max((nodes[p].ef for p in pred[n]), default=0.0)
        node.ef = node.es + node.duration
    length = max((n.ef for n in nodes.values()), default=0.0)
    for n in reversed(order):
        node = nodes[n]
        node.lf = min((nodes[s].ls for s in succ[n]), default=length)
        node.ls = node.lf - node.duration

    # Walk the critical chain: start from a zero-slack root, follow zero-slack successors
    # with the longest remaining tail.
    chain: list[int] = []
    critical = {i for i, n in nodes.items() if abs(n.slack) < 1e-9 and n.duration > 0}
    starts = [i for i in order if i in critical and not any(p in critical for p in pred[i])]
    if starts:
        cur = min(starts, key=lambda i: (nodes[i].es, i))
        while cur is not None:
            chain.append(cur)
            nxt = [s for s in succ[cur] if s in critical and abs(nodes[s].es - nodes[cur].ef) < 1e-9]
            cur = min(nxt) if nxt else None

    return {
        "length": length,
        "order": order,
        "nodes": nodes,
        "critical": sorted(critical),
        "chain": chain,
    }
