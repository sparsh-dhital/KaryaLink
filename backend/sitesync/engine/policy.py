"""Decision policy: auto-apply / clarify / planner review / confirm sequence / propose new activity.

Nothing is ever dropped: every report ends in exactly one of these outcomes and is logged.
"""
from __future__ import annotations

from .lexicon import PHASE_LABEL

AUTO_APPLY = "AUTO_APPLY"
CLARIFY = "CLARIFY"
REVIEW = "REVIEW"
CONFIRM_SEQUENCE = "CONFIRM_SEQUENCE"
NEW_ACTIVITY = "NEW_ACTIVITY"
DECISIONS = [AUTO_APPLY, CLARIFY, REVIEW, CONFIRM_SEQUENCE, NEW_ACTIVITY]


def _distinguish(c1: dict, c2: dict) -> tuple[str, str, str]:
    """(attribute, english label for c1-vs-c2 question, hindi)."""
    a1, a2 = c1["activity"], c2["activity"]
    if a1["tag"] != a2["tag"]:
        return "tag", f"Which one: {a1['tag']} or {a2['tag']}?", f"Kaunsa: {a1['tag']} ya {a2['tag']}?"
    if a1["phase"] != a2["phase"]:
        p1, p2 = PHASE_LABEL.get(a1["phase"], a1["phase"]), PHASE_LABEL.get(a2["phase"], a2["phase"])
        return ("phase", f"For {a1['tag']}: was it {p1.lower()} or {p2.lower()}?",
                f"{a1['tag']} ka kaunsa kaam: {p1.lower()} ya {p2.lower()}?")
    return "name", f"Which one: {a1['name']} or {a2['name']}?", f"Kaunsa: {a1['name']} ya {a2['name']}?"


def _option_label(c: dict, attr: str) -> str:
    a = c["activity"]
    if attr == "tag":
        return a["tag"]
    if attr == "phase":
        return PHASE_LABEL.get(a["phase"], a["phase"])
    return a["name"]


def decide(ext: dict, cands: list[dict], warnings: list[dict], thresholds: dict, l4_parent: str | None) -> dict:
    t_auto, t_rev = thresholds["auto_apply"], thresholds["review"]
    p1 = cands[0]["confidence"] if cands else 0.0
    p2 = cands[1]["confidence"] if len(cands) > 1 else 0.0
    status = (ext.get("status") or {}).get("value")

    if not cands or p1 < t_rev:
        phase = (ext.get("phase") or {}).get("value")
        name = f"{PHASE_LABEL.get(phase, 'Work')} (new) - {ext['text'][:70]}"
        return {
            "kind": NEW_ACTIVITY, "activity_id": None, "confidence": round(1.0 - p1, 3),
            "proposal": {"name": name, "parent_wbs": l4_parent,
                         "discipline": (ext.get("discipline") or {}).get("value"),
                         "area": (ext.get("area") or {}).get("value")},
            "message": "No planned activity fits well enough - proposed as NEW activity for planner approval.",
        }

    top = cands[0]
    if warnings and any(w["type"] in ("predecessor_incomplete", "already_complete", "quantity_regression")
                        for w in warnings):
        return {"kind": CONFIRM_SEQUENCE, "activity_id": top["activity_id"], "confidence": p1,
                "warnings": warnings,
                "question": warnings[0]["message"] + " Please confirm this update is correct.",
                "question_hi": warnings[0]["message_hi"] + " Kya yeh update sahi hai?",
                "options": [{"value": "confirm", "label": "Yes, confirm"}, {"value": "reject", "label": "No, cancel"}]}

    close = len(cands) > 1 and (p1 - p2) <= thresholds["clarify_gap"] and p2 >= t_rev * 0.5
    if p1 >= t_auto and (p1 - p2) >= thresholds["margin"]:
        if status is None:
            return {"kind": CLARIFY, "clarify_type": "status", "activity_id": top["activity_id"], "confidence": p1,
                    "question": f"{top['activity']['name']}: has it started, is it in progress, or completed?",
                    "question_hi": f"{top['activity']['name']}: shuru hua, chal raha hai, ya pura ho gaya?",
                    "options": [{"value": "start", "label": "Started"}, {"value": "progress", "label": "In progress"},
                                {"value": "complete", "label": "Completed"}]}
        return {"kind": AUTO_APPLY, "activity_id": top["activity_id"], "confidence": p1,
                "message": "High confidence - applied to actuals automatically."}
    if close:
        opts = cands[:3] if len(cands) > 2 and cands[2]["confidence"] >= p1 - thresholds["clarify_gap"] else cands[:2]
        attr, q_en, q_hi = _distinguish(opts[0], opts[1])
        return {"kind": CLARIFY, "clarify_type": "candidate", "activity_id": top["activity_id"], "confidence": p1,
                "question": q_en, "question_hi": q_hi,
                "options": [{"value": c["activity_id"], "label": _option_label(c, attr)} for c in opts]
                + [{"value": "none", "label": "None of these"}]}
    return {"kind": REVIEW, "activity_id": top["activity_id"], "confidence": p1,
            "message": "Medium confidence - sent to planner review queue."}
