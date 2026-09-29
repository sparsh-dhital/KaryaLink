"""Rules of credit: turn granular events into % complete / actual dates, and roll up the WBS."""
from __future__ import annotations

from datetime import date

# Step weights within an L5 work item (documented rules of credit per discipline).
RULES_OF_CREDIT = {
    "CIV": {"basis": "quantity (m3 / MT)", "steps": {"excavation": 10, "pcc": 5, "rebar": 25, "pour": 50, "backfill": 10}},
    "PIP": {"basis": "spools / joints; hydrotest 0-100", "steps": {"fabrication": 30, "erection": 30, "welding": 30, "hydrotest": 10}},
    "ELE": {"basis": "metres / terminations", "steps": {"install": 30, "cable_pull": 50, "termination": 20}},
    "INS": {"basis": "install & loop check 0-100, tubing metres", "steps": {"install": 40, "hookup": 40, "loop_check": 20}},
    "MEC": {"basis": "setting/alignment 0-100, grout m3", "steps": {"setting": 50, "alignment": 30, "grouting": 20}},
    "HSE": {"basis": "milestone / metres", "steps": {"barricading": 100, "install": 100, "audit": 100}},
}


def apply_event(a: dict, cur: dict, event: str | None, qty: dict | None, event_date: str) -> dict:
    """Return the new activity state and a human-readable credit explanation.

    cur: {pct, qty_done, actual_start, actual_finish}
    """
    new = dict(cur)
    total = float(a["quantity"]) or 1.0
    notes = []
    event = event or "progress"
    if new.get("actual_start") is None:
        new["actual_start"] = event_date
        notes.append(f"actual start set to {event_date}")
    if a["credit_method"] == "milestone":
        if event == "complete":
            new.update(pct=100.0, qty_done=total)
        notes.append("milestone rule: 0% until complete, then 100%")
    elif qty:
        if qty["mode"] == "cumulative" and qty.get("total"):
            done = qty["value"] * (total / qty["total"]) if abs(qty["total"] - total) > 0.5 else qty["value"]
            notes.append(f"{qty['value']:g} of {qty['total']:g} -> {done:g}/{total:g} {a['unit']}")
        elif qty["mode"] == "percent":
            done = total * qty["value"] / 100.0
            notes.append(f"{qty['value']:g}% reported")
        else:
            done = (cur.get("qty_done") or 0.0) + qty["value"]
            notes.append(f"+{qty['value']:g} {a['unit']} -> cumulative {min(done, total):g}/{total:g}")
        done = max(0.0, min(total, done))
        new["qty_done"] = max(done, cur.get("qty_done") or 0.0) if qty["mode"] != "cumulative" else done
        new["pct"] = round(100.0 * new["qty_done"] / total, 1)
    if event == "complete":
        new.update(pct=100.0, qty_done=total)
    if new["pct"] >= 100.0:
        new["actual_finish"] = new.get("actual_finish") or event_date
        notes.append(f"actual finish {new['actual_finish']}")
    else:
        new["actual_finish"] = None
    return {"state": new, "credit": "; ".join(notes)}


def leaf_budgets(activities: list[dict]) -> dict[str, float]:
    """Budget weight per leaf: step weight x total duration of its L5 item (L5 leaves: duration)."""
    item_dur: dict[str, float] = {}
    for a in activities:
        if a["level"] == 6:
            item_dur[a["parent_wbs"]] = item_dur.get(a["parent_wbs"], 0) + a["duration"]
    out = {}
    for a in activities:
        out[a["activity_id"]] = a["weight"] * item_dur[a["parent_wbs"]] if a["level"] == 6 else float(a["duration"])
    return out


def planned_pct(a: dict, on: date) -> float:
    ps, pf = date.fromisoformat(a["planned_start"]), date.fromisoformat(a["planned_finish"])
    if on < ps:
        return 0.0
    if on >= pf:
        return 100.0
    return 100.0 * ((on - ps).days + 1) / ((pf - ps).days + 1)


def rollup(activities: list[dict], wbs: list[dict], pct_of: dict[str, float], on: date) -> dict[str, dict]:
    """Earned % for every WBS node (and planned % on date) using leaf budgets."""
    budgets = leaf_budgets(activities)
    parent = {n["code"]: n["parent"] for n in wbs}
    agg: dict[str, list[float]] = {n["code"]: [0.0, 0.0, 0.0] for n in wbs}  # budget, earned, planned
    for a in activities:
        b = budgets[a["activity_id"]]
        node = a["parent_wbs"]
        e = b * pct_of.get(a["activity_id"], 0.0) / 100.0
        p = b * planned_pct(a, on) / 100.0
        while node is not None and node in agg:
            agg[node][0] += b
            agg[node][1] += e
            agg[node][2] += p
            node = parent.get(node)
    return {k: {"budget": v[0], "actual_pct": round(100 * v[1] / v[0], 1) if v[0] else 0.0,
                "planned_pct": round(100 * v[2] / v[0], 1) if v[0] else 0.0} for k, v in agg.items()}
