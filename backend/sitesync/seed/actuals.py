"""Simulate ground-truth actual progress events for a schedule up to the data date."""
from __future__ import annotations

import bisect
import math
import random
from dataclasses import dataclass
from datetime import date, timedelta

from .schedule import Activity


@dataclass
class TruthEvent:
    event_id: str
    activity_id: str
    date: str
    event: str          # start | progress | complete
    qty_done: float     # cumulative after this event
    qty_total: float
    pct: float          # cumulative percent after this event (0..100)
    out_of_order: bool = False


def simulate_actuals(activities: list[Activity], rng: random.Random, data_date: date):
    """Returns (events, actual_dates). Activities list must be topologically ordered."""
    by_id = {a.activity_id: a for a in activities}
    areas = sorted({a.area for a in activities})
    area_prod = {ar: rng.uniform(0.95, 1.30) for ar in areas}
    area_slip = {ar: rng.randint(0, 9) for ar in areas}
    actual: dict[str, dict] = {}
    events: list[TruthEvent] = []
    n = 0

    for a in activities:
        ps = date.fromisoformat(a.planned_start)
        start = ps + timedelta(days=area_slip[a.area] + max(0, round(rng.gauss(2, 3))))
        out_of_order = False
        for p in a.predecessors:
            pa = actual.get(p)
            if pa is None or pa.get("finish") is None:
                # predecessor unfinished: normally blocked; occasionally field starts early anyway
                if pa is not None and rng.random() < 0.06:
                    start = max(start, pa["start"] + timedelta(days=rng.randint(1, 3)))
                    out_of_order = True
                else:
                    start = None
                    break
            else:
                start = max(start, pa["finish"] + timedelta(days=1))
        if start is None or start > data_date:
            continue
        dur = max(1, round(a.duration * area_prod[a.area] * math.exp(rng.gauss(0, 0.2))))
        finish = start + timedelta(days=dur - 1)
        stalled = False
        if finish > data_date:
            finish = None
            stalled = rng.random() < 0.12
        actual[a.activity_id] = {"start": start, "finish": finish, "stalled": stalled}

        def ev(d: date, kind: str, done: float):
            nonlocal n
            n += 1
            pct = 100.0 if kind == "complete" else round(100.0 * done / a.quantity, 1)
            events.append(TruthEvent(f"E{n:05d}", a.activity_id, d.isoformat(), kind,
                                     float(done), float(a.quantity), pct, out_of_order))

        if a.credit_method == "milestone":
            if rng.random() < 0.6 or finish is None:
                ev(start, "start", 0)
            if finish is not None:
                ev(finish, "complete", a.quantity)
            continue

        # quantity-based: start, periodic cumulative progress, complete
        first_qty = 0 if rng.random() < 0.5 else max(1, round(a.quantity * rng.uniform(0.05, 0.15)))
        ev(start, "start", first_qty)
        last_day = finish if finish is not None else data_date - timedelta(days=1)
        if stalled:
            last_day = start + timedelta(days=max(1, (data_date - start).days // 3))
        span = max(1, dur)
        d = start + timedelta(days=rng.randint(1, 3))
        done = first_qty
        while d < last_day:
            frac = min(0.95, (d - start).days / span + rng.uniform(-0.05, 0.05))
            target = max(done + 1, round(a.quantity * frac))
            if target >= a.quantity:
                break
            done = target
            ev(d, "progress", done)
            d += timedelta(days=rng.randint(1, 3))
        if finish is not None:
            ev(finish, "complete", a.quantity)
        elif stalled:
            actual[a.activity_id]["last"] = d

    events.sort(key=lambda e: (e.date, e.event_id))
    return events, actual


class TruthState:
    """Point-in-time progress state reconstructed from ground-truth events.

    get(activity_id, as_of) considers only events strictly before `as_of` (ISO date),
    i.e. the state a planner would have seen before the report arrived.
    """

    def __init__(self, events: list[TruthEvent]):
        self._by: dict[str, list[TruthEvent]] = {}
        for e in sorted(events, key=lambda e: (e.date, e.event_id)):
            self._by.setdefault(e.activity_id, []).append(e)
        self._dates = {k: [e.date for e in v] for k, v in self._by.items()}

    def view(self, exclude_event: str | None) -> "TruthView":
        return TruthView(self, exclude_event)

    def get(self, activity_id: str, as_of: str, exclude: str | None = None) -> dict:
        evs = self._by.get(activity_id)
        if not evs:
            return {"pct": 0.0, "started": False, "finished": False, "last_update": None, "qty_done": 0.0}
        i = bisect.bisect_left(self._dates[activity_id], as_of)
        if exclude and any(e.event_id == exclude for e in evs[:i]):
            evs = [e for e in evs[:i] if e.event_id != exclude]
            i = len(evs)
        if i == 0:
            return {"pct": 0.0, "started": False, "finished": False, "last_update": None, "qty_done": 0.0}
        last = evs[i - 1]
        return {
            "pct": last.pct,
            "started": True,
            "finished": any(e.event == "complete" for e in evs[:i]),
            "last_update": last.date,
            "qty_done": last.qty_done,
        }


class TruthView:
    """State as a live system would see it when the report arrives: its own event is not yet applied."""

    def __init__(self, ts: TruthState, exclude_event: str | None):
        self.ts, self.exclude = ts, exclude_event

    def get(self, activity_id: str, as_of: str) -> dict:
        return self.ts.get(activity_id, as_of, self.exclude)
