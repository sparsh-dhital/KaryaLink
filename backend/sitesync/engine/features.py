"""Per (report, candidate) features + human-readable "why" reasons."""
from __future__ import annotations

import math
from datetime import date

from .candidates import Candidate, tag_conflict
from .lexicon import PHASE_LABEL

FEATURE_NAMES = [
    "tag", "tag_conflict", "has_tag", "disc", "area", "phase", "tfidf", "fuzzy", "pred_ok",
    "status_ok", "window", "active", "qty_ok", "unit_ok", "new_cue", "rank", "recency",
]
DISC_LABEL = {"CIV": "Civil", "PIP": "Piping", "ELE": "Electrical", "INS": "Instrumentation",
              "MEC": "Mechanical", "HSE": "HSE"}


def _match(x, y) -> float:
    if not x:
        return 0.5
    return 1.0 if x == y else 0.0


def compute(ext: dict, a: dict, cand: Candidate, rank: int, state, as_of: str, by_id: dict) -> tuple[list[float], list[dict]]:
    ev_date = date.fromisoformat(ext["date"]["value"])
    st = state.get(a["activity_id"], as_of)
    event = (ext.get("status") or {}).get("value")
    phase = (ext.get("phase") or {}).get("value")
    qty = ext.get("quantity")
    reasons: list[dict] = []

    f_tag = cand.tag
    f_conf = tag_conflict(ext.get("tags", []), a, cand.tag)
    has_tag = 1.0 if ext.get("tags") else 0.0
    if f_tag >= 0.95:
        reasons.append({"label": f"Tag match {a['tag']}", "polarity": "+"})
    elif f_tag > 0:
        reasons.append({"label": f"Partial tag '{cand.tag_evidence}' ~ {a['tag']}", "polarity": "+"})
    elif f_conf:
        reasons.append({"label": "Report names a different tag", "polarity": "-"})

    f_disc = _match((ext.get("discipline") or {}).get("value"), a["discipline"])
    f_area = _match((ext.get("area") or {}).get("value"), a["area"])
    if f_disc == 1:
        reasons.append({"label": f"Discipline {DISC_LABEL[a['discipline']]}", "polarity": "+"})
    elif f_disc == 0:
        reasons.append({"label": f"Discipline differs ({DISC_LABEL[a['discipline']]})", "polarity": "-"})
    if f_area == 1:
        reasons.append({"label": f"Area {a['area']}", "polarity": "+"})
    elif f_area == 0:
        reasons.append({"label": f"Area differs ({a['area']})", "polarity": "-"})

    if phase is None:
        f_phase = 0.5
    elif phase == a["phase"]:
        f_phase = 1.0
        reasons.append({"label": f"Phase fits: {PHASE_LABEL[a['phase']]}", "polarity": "+"})
    elif a["phase"] in (ext.get("phases_all") or []):
        f_phase = 0.6
    else:
        f_phase = 0.0
        reasons.append({"label": f"Phase differs ({PHASE_LABEL.get(a['phase'], a['phase'])})", "polarity": "-"})

    # predecessor plausibility
    preds = [p for p in a.get("predecessors", []) if p in by_id]
    if preds:
        done = [state.get(p, as_of) for p in preds]
        f_pred = sum(1.0 if d["finished"] else 0.5 if d["started"] else 0.0 for d in done) / len(preds)
        if f_pred == 1:
            reasons.append({"label": "Predecessors complete", "polarity": "+"})
        elif f_pred < 0.5:
            reasons.append({"label": "Predecessor not complete", "polarity": "-"})
    else:
        f_pred = 1.0

    # status plausibility against current actuals
    if event is None:
        f_status = 0.5
    elif st["finished"]:
        f_status = 0.05
        reasons.append({"label": "Already marked complete", "polarity": "-"})
    elif st["started"]:
        f_status = 0.4 if event == "start" else 1.0
        if event != "start":
            reasons.append({"label": f"In progress ({st['pct']:.0f}%)", "polarity": "+"})
    else:
        f_status = 1.0 if event == "start" else 0.6

    ps, pf = date.fromisoformat(a["planned_start"]), date.fromisoformat(a["planned_finish"])
    dist = 0 if ps <= ev_date <= pf else (ps - ev_date).days if ev_date < ps else (ev_date - pf).days
    f_window = math.exp(-dist / 25.0)
    if dist == 0:
        reasons.append({"label": "Within planned window", "polarity": "+"})
    elif dist > 20:
        reasons.append({"label": f"{dist} d outside planned window", "polarity": "-"})

    f_active = 1.0 if st["started"] and not st["finished"] else 0.0
    last = st.get("last_update")
    f_recency = math.exp(-max(0, (ev_date - date.fromisoformat(last)).days) / 10.0) if last else 0.0

    # quantity plausibility
    f_qty, f_unit = 0.5, 0.5
    if qty:
        unit = qty.get("unit")
        if unit and unit != "%":
            f_unit = 1.0 if unit == a["unit"] or (unit == "nos" and a["unit"] in ("spools", "joints", "nos")) else 0.0
        if qty["mode"] == "cumulative" and qty.get("total"):
            if abs(qty["total"] - a["quantity"]) < 0.5:
                f_qty = 1.0
                reasons.append({"label": f"Total qty {qty['total']:g} {a['unit']} matches plan", "polarity": "+"})
            elif qty["value"] > a["quantity"] * 1.05:
                f_qty = 0.0
            else:
                f_qty = 0.15
                reasons.append({"label": f"Total qty differs (plan {a['quantity']:g})", "polarity": "-"})
        elif qty["mode"].startswith("incremental"):
            f_qty = 0.8 if st["qty_done"] + qty["value"] <= a["quantity"] * 1.05 else 0.1
        if f_unit == 0.0:
            reasons.append({"label": f"Unit differs (plan in {a['unit']})", "polarity": "-"})

    f_new = 1.0 if ext.get("new_work_cue") else 0.0
    if cand.tfidf > 0.35:
        reasons.append({"label": f"Text similarity {cand.tfidf:.2f}", "polarity": "+"})

    x = [f_tag, f_conf, has_tag, f_disc, f_area, f_phase, cand.tfidf, cand.fuzzy, f_pred, f_status, f_window,
         f_active, f_qty, f_unit, f_new, 1.0 - rank / 5.0, f_recency]
    return x, reasons
