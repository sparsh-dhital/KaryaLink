"""Institutional memory: answer simple questions from stored actuals (synthetic-data demo)."""
from __future__ import annotations

import re
import statistics
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import Activity
from ..engine.extractor import extract
from ..engine.lexicon import PHASE_LABEL
from ..engine.features import DISC_LABEL

DISC_WORDS = {"civil": "CIV", "piping": "PIP", "pipe": "PIP", "electrical": "ELE", "instrument": "INS",
              "instrumentation": "INS", "mechanical": "MEC", "hse": "HSE", "safety": "HSE"}
EXAMPLES = ["typical duration for piping erection", "average slip for civil concrete pour",
            "productivity of cable pulling", "which activities in U-300 slipped most",
            "how many welding activities are complete", "kitna time lagta hai excavation me"]


def _pctl(xs: list[float], q: float) -> float:
    xs = sorted(xs)
    if not xs:
        return 0.0
    k = (len(xs) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def ask(db: Session, question: str) -> dict:
    q = question.strip()
    if not q:
        return {"answer": "Ask me something like: " + "; ".join(EXAMPLES[:3]), "examples": EXAMPLES}
    low = q.lower()
    ext = extract(q, date.today())
    phase = (ext.get("phase") or {}).get("value")
    disc = next((v for k, v in DISC_WORDS.items() if re.search(rf"\b{k}\b", low)), None)
    if disc is None and ext.get("discipline") and ext["discipline"].get("source") == "rule":
        disc = ext["discipline"]["value"]
    area = (ext.get("area") or {}).get("value")
    acts = list(db.execute(select(Activity)).scalars())
    sel = [a for a in acts if (not phase or a.phase == phase) and (not disc or a.discipline == disc)
           and (not area or a.area == area)]
    scope = " / ".join(x for x in [DISC_LABEL.get(disc, "") if disc else "", PHASE_LABEL.get(phase, "") if phase else "",
                                   area or ""] if x) or "all activities"
    done = [a for a in sel if a.actual_start and a.actual_finish]
    durs = [(date.fromisoformat(a.actual_finish) - date.fromisoformat(a.actual_start)).days + 1 for a in done]
    planned = [a.duration for a in done]
    slips = [(date.fromisoformat(a.actual_finish) - date.fromisoformat(a.planned_finish)).days for a in done]
    note = "Synthetic-data demo: computed from this prototype's stored actuals, not real project history."

    def base():
        return {"scope": scope, "n_matching": len(sel), "n_completed": len(done), "note": note}

    if not sel:
        return {**base(), "answer": f"No activities match '{q}'. Try: " + "; ".join(EXAMPLES[:3]), "examples": EXAMPLES}

    if re.search(r"slip|delay|late|behind|der\b|deri", low) and re.search(r"which|most|top|kaun", low):
        cand = []
        for a in sel:
            if a.actual_finish:
                s = (date.fromisoformat(a.actual_finish) - date.fromisoformat(a.planned_finish)).days
            elif a.actual_start:
                s = (date.fromisoformat(a.actual_start) - date.fromisoformat(a.planned_start)).days
            else:
                continue
            cand.append((s, a))
        cand.sort(key=lambda t: -t[0])
        rows = [{"activity_id": a.activity_id, "name": a.name, "slip_days": s} for s, a in cand[:5]]
        txt = "; ".join(f"{r['name']} (+{r['slip_days']} d)" for r in rows) or "no slipped activities recorded"
        return {**base(), "answer": f"Largest slips in {scope}: {txt}.", "rows": rows}

    if re.search(r"how many|count|kitne|number of", low):
        ip = sum(1 for a in sel if a.actual_start and not a.actual_finish)
        return {**base(), "answer": f"{scope}: {len(done)} completed, {ip} in progress, "
                                    f"{len(sel) - len(done) - ip} not started (of {len(sel)})."}

    if not done:
        return {**base(), "answer": f"No completed activities yet for {scope}, so there is no history to learn from."}

    if re.search(r"productiv|rate|per day|output|speed", low):
        rates = [a.quantity / d for a, d in zip(done, durs) if d > 0 and a.credit_method == "quantity"]
        if rates:
            unit = done[0].unit
            return {**base(), "answer": f"Typical productivity for {scope}: median {statistics.median(rates):.1f} {unit}/day "
                                        f"(P10 {_pctl(rates, .1):.1f}, P90 {_pctl(rates, .9):.1f}; n={len(rates)}).",
                    "stats": {"median_rate": statistics.median(rates), "unit": unit, "n": len(rates)}}

    if re.search(r"slip|delay|late|der\b", low):
        return {**base(), "answer": f"Average finish slip for {scope}: {statistics.mean(slips):+.1f} days "
                                    f"(median {statistics.median(slips):+.0f}, worst {max(slips):+d}; n={len(slips)}).",
                "stats": {"mean_slip": statistics.mean(slips), "n": len(slips)}}

    med = statistics.median(durs)
    ratio = statistics.mean(d / p for d, p in zip(durs, planned) if p) if planned else 1.0
    return {**base(),
            "answer": f"Typical actual duration for {scope}: median {med:.0f} days (P10 {_pctl(durs, .1):.0f}, "
                      f"P90 {_pctl(durs, .9):.0f}; n={len(durs)} completed). Planned median {statistics.median(planned):.0f} days, "
                      f"so actuals run at {ratio:.2f}x plan on average.",
            "stats": {"median_days": med, "p10": _pctl(durs, .1), "p90": _pctl(durs, .9), "n": len(durs),
                      "planned_median": statistics.median(planned), "actual_to_plan": ratio},
            "histogram": _hist(durs)}


def _hist(durs: list[int]) -> list[dict]:
    if not durs:
        return []
    lo, hi = min(durs), max(durs)
    step = max(1, (hi - lo + 1) // 8 or 1)
    out = []
    b = lo
    while b <= hi:
        out.append({"bin": f"{b}-{b + step - 1}d", "count": sum(1 for d in durs if b <= d < b + step)})
        b += step
    return out
