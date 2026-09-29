"""Report lifecycle: submit -> decide -> (clarify | confirm | review) -> apply. Nothing is silently dropped."""
from __future__ import annotations

import io
import re
from datetime import date, timedelta

import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import ledger
from ..db import Activity, ActualEvent, Correction, Photo, Report, SequenceWarning, WbsNode
from ..engine import policy, rollup
from ..engine.lexicon import PHASE_LABEL
from .core import DbState, get_engine, invalidate_engine, project_today, thresholds

CONVERSATIONAL = ("chat", "voice", "chaser")
STATUS_FOR = {
    policy.AUTO_APPLY: "applied",
    policy.CLARIFY: "awaiting_supervisor",
    policy.CONFIRM_SEQUENCE: "awaiting_supervisor",
    policy.REVIEW: "awaiting_planner",
    policy.NEW_ACTIVITY: "awaiting_planner",
}


class WorkflowError(ValueError):
    pass


def _ext_summary(ext: dict) -> dict:
    def f(k):
        v = ext.get(k)
        return None if not v else {"value": v.get("value"), "evidence": v.get("evidence")}
    return {
        "phase": f("phase"), "status": f("status"), "date": f("date"), "area": f("area"),
        "discipline": f("discipline"), "new_work_cue": f("new_work_cue"),
        "quantity": None if not ext.get("quantity") else {k: ext["quantity"].get(k) for k in
                                                           ("value", "total", "unit", "mode", "evidence")},
        "tags": [{"value": t["value"], "type": t["type"], "evidence": t["evidence"]} for t in ext.get("tags", [])],
        "extractor": ext.get("extractor"),
    }


def _photo_info(db: Session, photo_id: int | None) -> dict | None:
    if not photo_id:
        return None
    p = db.get(Photo, photo_id)
    if not p:
        return None
    return {"id": p.id, "sha256": p.sha256, "taken_at": p.taken_at.isoformat(), "lat": p.lat, "lon": p.lon}


def _decision_payload(db: Session, r: Report) -> dict:
    a = r.analysis
    return {
        "report": {"text": r.text, "reporter": r.reporter, "channel": r.channel, "report_date": r.report_date,
                   "source_file": r.source_file},
        "evidence": _ext_summary(a["extraction"]),
        "candidates": [{"activity_id": c["activity_id"], "name": c["activity"]["name"], "confidence": c["confidence"],
                        "why": [x["label"] for x in c["reasons"]]} for c in a["candidates"]],
        "warnings": [w["message"] for w in a.get("warnings", [])],
        "decision": {k: v for k, v in a["decision"].items() if k in ("kind", "activity_id", "confidence", "question",
                                                                    "proposal", "clarify_type")},
        "model_version": r.model_version,
        "photo": _photo_info(db, r.photo_id),
    }


def submit_report(db: Session, text: str, reporter: str = "unknown", reporter_discipline: str | None = None,
                  channel: str = "chat", report_date: str | None = None, photo_id: int | None = None,
                  session_id: str | None = None, source_file: str | None = None,
                  external_id: str | None = None) -> Report:
    text = (text or "").strip()
    if not text:
        raise WorkflowError("Report text is empty")
    if len(text) > 2000:
        raise WorkflowError("Report text too long (max 2000 characters per report)")
    eng = get_engine(db)
    rd = report_date or project_today(db)
    state = DbState(db)
    res = eng.analyze(text, date.fromisoformat(rd), reporter_discipline, state)
    dec = res["decision"]
    kind = dec["kind"]
    status = STATUS_FOR[kind]
    if status == "awaiting_supervisor" and channel not in CONVERSATIONAL:
        status = "awaiting_planner"  # no one to ask in real time -> planner sees the question
    r = Report(text=text, reporter=reporter, reporter_discipline=reporter_discipline, channel=channel,
               report_date=rd, session_id=session_id, source_file=source_file, photo_id=photo_id,
               external_id=external_id, status=status if kind != policy.AUTO_APPLY else "processing",
               decision=kind, confidence=float(dec.get("confidence") or 0.0), activity_id=dec.get("activity_id"),
               analysis=res, model_version=res["model_version"])
    db.add(r)
    db.flush()
    if photo_id:
        p = db.get(Photo, photo_id)
        if p:
            p.report_id = r.id
    ledger.append(db, f"DECISION_{kind}", _decision_payload(db, r), report_id=r.id,
                  activity_id=dec.get("activity_id"), actor="engine")
    if kind == policy.CONFIRM_SEQUENCE:
        for w in dec.get("warnings", []):
            db.add(SequenceWarning(report_id=r.id, activity_id=dec["activity_id"], type=w["type"], message=w["message"]))
    if kind == policy.AUTO_APPLY:
        apply_to_activity(db, r, dec["activity_id"], approver="engine (auto-apply)", confidence=r.confidence)
    db.flush()
    return r


def apply_to_activity(db: Session, r: Report, activity_id: str, approver: str, confidence: float,
                      event_override: str | None = None) -> ActualEvent:
    a = db.get(Activity, activity_id)
    if a is None:
        raise WorkflowError(f"Unknown activity {activity_id}")
    ext = r.analysis["extraction"]
    event = event_override or (ext.get("status") or {}).get("value") or "progress"
    qty = ext.get("quantity")
    ev_date = ext["date"]["value"]
    cur = {"pct": a.pct, "qty_done": a.qty_done, "actual_start": a.actual_start, "actual_finish": a.actual_finish}
    out = rollup.apply_event(a.to_dict(), cur, event, qty, ev_date)
    st = out["state"]
    before = a.pct
    a.pct, a.qty_done = st["pct"], st["qty_done"] or 0.0
    a.actual_start, a.actual_finish = st["actual_start"], st["actual_finish"]
    a.last_update = max(a.last_update or ev_date, ev_date)
    ae = ActualEvent(activity_id=activity_id, report_id=r.id, event=event, event_date=ev_date,
                     qty_value=qty["value"] if qty else None, qty_mode=qty["mode"] if qty else None,
                     pct_before=before, pct_after=a.pct, qty_after=a.qty_done, credit_note=out["credit"],
                     confidence=confidence, approver=approver, model_version=r.model_version, source="live")
    db.add(ae)
    r.status, r.activity_id, r.resolved_by = "applied", activity_id, approver
    db.flush()
    ledger.append(db, "ACTUAL_APPLIED", {
        "activity": {"id": a.activity_id, "name": a.name}, "event": event, "event_date": ev_date,
        "quantity": None if not qty else {k: qty.get(k) for k in ("value", "total", "unit", "mode")},
        "pct_before": before, "pct_after": a.pct, "rule_of_credit": out["credit"], "approver": approver,
        "confidence": confidence, "model_version": r.model_version, "photo": _photo_info(db, r.photo_id),
    }, report_id=r.id, activity_id=activity_id, actor=approver)
    return ae


def _snapshot_for(db: Session, r: Report, extra: list[str]) -> dict:
    ids = {c["activity_id"] for c in r.analysis["candidates"]} | {x for x in extra if x}
    by = {a.activity_id: a for a in db.execute(select(Activity).where(Activity.activity_id.in_(ids))).scalars()}
    preds = {p for a in by.values() for p in (a.predecessors or [])}
    return DbState(db).snapshot(ids | preds)


def _record_correction(db: Session, r: Report, correct: str | None, kind: str, who: str) -> None:
    db.add(Correction(report_id=r.id, text=r.text, report_date=r.report_date,
                      reporter_discipline=r.reporter_discipline,
                      predicted_activity_id=(r.analysis["candidates"][0]["activity_id"] if r.analysis["candidates"] else None),
                      correct_activity_id=correct, kind=kind, state_snapshot=_snapshot_for(db, r, [correct]),
                      created_by=who))


def _get_report(db: Session, report_id: int) -> Report:
    r = db.get(Report, report_id)
    if r is None:
        raise WorkflowError(f"Report {report_id} not found")
    return r


def answer(db: Session, report_id: int, value: str, actor: str = "supervisor") -> Report:
    """Supervisor answer to a clarification question or a sequence warning."""
    r = _get_report(db, report_id)
    if r.status not in ("awaiting_supervisor", "awaiting_planner"):
        raise WorkflowError(f"Report {report_id} is already {r.status}")
    dec = r.analysis["decision"]
    if dec["kind"] == policy.CONFIRM_SEQUENCE:
        confirm = value in ("confirm", "yes", "true")
        for w in db.execute(select(SequenceWarning).where(SequenceWarning.report_id == r.id)).scalars():
            w.status, w.resolved_by = ("confirmed" if confirm else "rejected"), actor
        ledger.append(db, "SEQUENCE_CONFIRMED" if confirm else "SEQUENCE_REJECTED",
                      {"warnings": [w["message"] for w in dec.get("warnings", [])], "answer": value},
                      report_id=r.id, activity_id=dec["activity_id"], actor=actor)
        if not confirm:
            r.status, r.resolved_by = "rejected", actor
        elif r.confidence >= thresholds(db)["auto_apply"]:
            apply_to_activity(db, r, dec["activity_id"], approver=f"{actor} (confirmed sequence)",
                              confidence=r.confidence)
        else:
            r.status = "awaiting_planner"
        return r
    if dec["kind"] != policy.CLARIFY:
        raise WorkflowError("This report has no pending question")
    valid = {o["value"] for o in dec.get("options", [])}
    if value not in valid:
        raise WorkflowError(f"Answer must be one of {sorted(valid)}")
    ledger.append(db, "CLARIFICATION_ANSWERED", {"question": dec.get("question"), "answer": value},
                  report_id=r.id, activity_id=dec.get("activity_id"), actor=actor)
    if dec.get("clarify_type") == "status":
        apply_to_activity(db, r, dec["activity_id"], approver=f"{actor} (clarified status)", confidence=r.confidence,
                          event_override=value)
        return r
    if value == "none":
        r.status = "awaiting_planner"
        r.analysis = {**r.analysis, "supervisor_note": "Supervisor said none of the suggested activities match."}
        return r
    _record_correction(db, r, value, "clarification", actor)
    apply_to_activity(db, r, value, approver=f"{actor} (clarified)", confidence=r.confidence)
    return r


def _new_activity(db: Session, r: Report, name: str | None, parent_wbs: str | None) -> Activity:
    ext = r.analysis["extraction"]
    prop = r.analysis["decision"].get("proposal") or {}
    parent = parent_wbs or prop.get("parent_wbs")
    if not parent:
        top = r.analysis["candidates"][0]["activity"] if r.analysis["candidates"] else None
        if top is None:
            raise WorkflowError("No WBS parent available for new activity")
        parent = top["parent_wbs"].rsplit(".", 1)[0]
    pnode = db.get(WbsNode, parent)
    if pnode is None:
        raise WorkflowError(f"WBS parent {parent} does not exist")
    parts = parent.split(".")
    area = f"U-{parts[1][1:]}" if len(parts) > 1 and parts[1].startswith("U") else (prop.get("area") or "U-100")
    disc = parts[2] if len(parts) > 2 else (prop.get("discipline") or "CIV")
    n = db.execute(select(func.count()).select_from(Activity).where(Activity.source == "new_activity")).scalar_one()
    aid = f"{area.replace('-', '')}-{disc}-N{n + 1:03d}"
    code = f"{parent}.{aid}"
    tags = ext.get("tags") or []
    t0 = tags[0] if tags else None
    ttype = {"line": "line", "instrument": "instrument", "foundation": "foundation", "tray": "tray",
             "hydrant": "hydrant", "shower": "shower", "equipment": "equipment", "equipment_word": "equipment"}.get(
        t0["type"] if t0 else "", "other")
    qty = ext.get("quantity")
    ev_date = ext["date"]["value"]
    phase = (ext.get("phase") or {}).get("value") or "install"
    nm = name or f"{PHASE_LABEL.get(phase, 'Work')} - {(t0['value'] if t0 else r.text[:40])} (unplanned)"
    db.add(WbsNode(code=code, name=nm, level=5, parent=parent))
    a = Activity(activity_id=aid, name=nm, discipline=disc, area=area, area_name=pnode.name, wbs_code=code,
                 parent_wbs=code, level=5, tag=t0["value"] if t0 else aid, tag_type=ttype, phase=phase,
                 planned_start=ev_date, planned_finish=(date.fromisoformat(ev_date) + timedelta(days=6)).isoformat(),
                 duration=7, quantity=float(qty["total"]) if qty and qty.get("total") else 1.0,
                 unit=(qty.get("unit") if qty and qty.get("unit") not in (None, "%") else "nos"), weight=1.0,
                 credit_method="quantity" if qty and qty.get("total") else "milestone", predecessors=[],
                 source="new_activity")
    db.add(a)
    db.flush()
    ledger.append(db, "NEW_ACTIVITY_CREATED", {"activity_id": aid, "name": nm, "parent_wbs": parent,
                                               "from_report_text": r.text}, report_id=r.id, activity_id=aid,
                  actor="planner")
    invalidate_engine()
    return a


def planner_action(db: Session, report_id: int, action: str, activity_id: str | None = None,
                   planner: str = "planner", name: str | None = None, parent_wbs: str | None = None) -> Report:
    r = _get_report(db, report_id)
    if r.status in ("applied", "rejected", "new_activity_created"):
        raise WorkflowError(f"Report {report_id} is already {r.status}")
    dec = r.analysis["decision"]
    for w in db.execute(select(SequenceWarning).where(SequenceWarning.report_id == r.id,
                                                      SequenceWarning.status == "open")).scalars():
        w.status, w.resolved_by = ("rejected" if action == "reject" else "confirmed"), planner
    if action == "approve":
        if dec["kind"] == policy.NEW_ACTIVITY:
            action = "new_activity"
        else:
            target = dec.get("activity_id") or (r.analysis["candidates"][0]["activity_id"] if r.analysis["candidates"] else None)
            if not target:
                raise WorkflowError("Nothing to approve - no candidate")
            _record_correction(db, r, target, "approve", planner)
            ledger.append(db, "PLANNER_APPROVE", {"activity_id": target}, report_id=r.id, activity_id=target,
                          actor=planner)
            apply_to_activity(db, r, target, approver=planner, confidence=r.confidence)
            return r
    if action == "reassign":
        if not activity_id or db.get(Activity, activity_id) is None:
            raise WorkflowError("Reassign needs a valid activity_id")
        _record_correction(db, r, activity_id, "reassign", planner)
        ledger.append(db, "PLANNER_REASSIGN", {"from": dec.get("activity_id"), "to": activity_id},
                      report_id=r.id, activity_id=activity_id, actor=planner)
        apply_to_activity(db, r, activity_id, approver=planner, confidence=r.confidence)
        return r
    if action == "reject":
        _record_correction(db, r, None, "reject", planner)
        ledger.append(db, "PLANNER_REJECT", {"reason": "not a valid progress update"}, report_id=r.id,
                      actor=planner)
        r.status, r.resolved_by = "rejected", planner
        return r
    if action == "new_activity":
        _record_correction(db, r, None, "new_activity", planner)
        a = _new_activity(db, r, name, parent_wbs)
        apply_to_activity(db, r, a.activity_id, approver=planner, confidence=r.confidence)
        r.status = "new_activity_created"
        return r
    raise WorkflowError(f"Unknown action {action}")


def bulk_approve(db: Session, min_confidence: float, planner: str = "planner") -> list[int]:
    q = select(Report).where(Report.status == "awaiting_planner", Report.decision == policy.REVIEW,
                             Report.confidence >= min_confidence)
    done = []
    for r in db.execute(q).scalars().all():
        planner_action(db, r.id, "approve", planner=planner)
        done.append(r.id)
    return done


# ------------------------------------------------------------------ documents & spreadsheets
def _is_progress_line(eng, line: str, rd: date) -> bool:
    from ..engine.extractor import extract

    e = extract(line, rd)
    return bool(e["phase"] or e["tags"] or e["quantity"])


def split_document(text: str) -> list[str]:
    lines = []
    for raw in re.split(r"[\r\n]+", text):
        s = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", raw).strip()
        if s:
            lines.append(s)
    return lines


def submit_document(db: Session, text: str, reporter: str, reporter_discipline: str | None, channel: str,
                    source_file: str | None, report_date: str | None = None, photo_id: int | None = None) -> dict:
    eng = get_engine(db)
    rd = report_date or project_today(db)
    created, info = [], []
    for line in split_document(text):
        if _is_progress_line(eng, line, date.fromisoformat(rd)):
            created.append(submit_report(db, line, reporter, reporter_discipline, channel, rd, photo_id,
                                         source_file=source_file))
        else:
            info.append(line)
    ledger.append(db, "DOCUMENT_INGESTED", {"source_file": source_file, "progress_lines": len(created),
                                            "informational_lines": info}, actor=reporter)
    return {"reports": created, "informational_lines": info}


COLS = {
    "date": r"date|dt",
    "tag": r"line|tag|item|equipment|foundation|tray|loop|instrument",
    "activity": r"activity|work|description|desc|task|phase",
    "today": r"today|daily|qty\s*done|done\s*today",
    "cum": r"cum|cumulative|to\s*date|progress",
    "total": r"total|scope|planned\s*qty|boq",
    "unit": r"uom|unit\b|units",
    "area": r"^unit$|area|plant",
    "remarks": r"remark|status|comment|note",
}


def _find_cols(columns) -> dict:
    found = {}
    for key in ("area", "date", "tag", "activity", "today", "cum", "total", "unit", "remarks"):
        for c in columns:
            if c in found.values():
                continue
            if re.search(COLS[key], str(c).strip().lower()):
                found[key] = c
                break
    return found


def spreadsheet_rows_to_texts(content: bytes, filename: str) -> list[str]:
    if filename.lower().endswith((".xlsx", ".xlsm", ".xls")):
        df = pd.read_excel(io.BytesIO(content))
    else:
        df = pd.read_csv(io.BytesIO(content), encoding_errors="replace")
    df = df.dropna(how="all")
    cols = _find_cols(list(df.columns))
    texts = []
    for _, row in df.iterrows():
        def g(k):
            c = cols.get(k)
            if c is None:
                return ""
            v = row[c]
            if pd.isna(v):
                return ""
            if isinstance(v, pd.Timestamp):
                return v.strftime("%d-%m-%Y")
            if isinstance(v, float) and v.is_integer():
                return str(int(v))
            return str(v).strip()
        if cols.get("tag") or cols.get("activity"):
            parts = [g("tag"), g("activity")]
            if g("cum") and g("total"):
                parts.append(f"{g('cum')} of {g('total')} {g('unit')}")
            elif g("today"):
                parts.append(f"{g('today')} {g('unit')} more")
            parts += [g("remarks"), g("area"), g("date")]
            text = " ".join(p for p in parts if p)
        else:
            text = " ".join(str(v) for v in row.values if not pd.isna(v))
        if text.strip():
            texts.append(text)
    return texts
