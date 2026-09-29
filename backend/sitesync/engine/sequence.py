"""Sequence-sanity checks using predecessor logic and current actuals."""
from __future__ import annotations

from datetime import date


def check(ext: dict, a: dict, state, as_of: str, by_id: dict) -> list[dict]:
    warnings: list[dict] = []
    event = (ext.get("status") or {}).get("value") or "progress"
    st = state.get(a["activity_id"], as_of)
    for p in a.get("predecessors", []):
        pa = by_id.get(p)
        if not pa:
            continue
        ps = state.get(p, as_of)
        if not ps["finished"]:
            warnings.append({
                "type": "predecessor_incomplete",
                "predecessor_id": p,
                "message": f"'{a['name']}' reported as {event}, but predecessor '{pa['name']}' ({p}) is only "
                           f"{ps['pct']:.0f}% complete.",
                "message_hi": f"'{a['name']}' {event} bataya gaya, lekin pehle wala kaam '{pa['name']}' "
                              f"abhi sirf {ps['pct']:.0f}% hua hai.",
            })
    if st["finished"] and event in ("start", "progress", "complete"):
        warnings.append({
            "type": "already_complete",
            "message": f"'{a['name']}' is already marked complete (last update {st['last_update']}).",
            "message_hi": f"'{a['name']}' pehle hi complete mark ho chuka hai.",
        })
    qty = ext.get("quantity")
    if qty and qty["mode"] == "cumulative" and st["qty_done"] and qty["value"] < st["qty_done"] - 1e-6:
        warnings.append({
            "type": "quantity_regression",
            "message": f"Reported {qty['value']:g} {a['unit']} cumulative, but ledger already has "
                       f"{st['qty_done']:g} {a['unit']}.",
            "message_hi": f"Report me {qty['value']:g} hai, lekin ledger me pehle se {st['qty_done']:g} hai.",
        })
    ev_date = date.fromisoformat(ext["date"]["value"])
    ps_date = date.fromisoformat(a["planned_start"])
    if (ps_date - ev_date).days > 30:
        warnings.append({
            "type": "far_ahead_of_plan",
            "message": f"Reported {(ps_date - ev_date).days} days before planned start ({a['planned_start']}).",
            "message_hi": f"Yeh kaam plan se {(ps_date - ev_date).days} din pehle report hua hai.",
        })
    return warnings
