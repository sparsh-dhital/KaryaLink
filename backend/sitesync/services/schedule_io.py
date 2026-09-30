"""Schedule import (CSV, MS Project MSPDI XML) and export (CSV, MSPDI XML, actuals dataset CSV)."""
from __future__ import annotations

import csv
import hashlib
import io
import re
import xml.etree.ElementTree as ET
from datetime import date, datetime
from xml.sax.saxutils import escape

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import ledger
from ..db import Activity, ActualEvent, Photo, Report, WbsNode
from ..engine.extractor import extract
from .core import invalidate_engine, project_today

NS = "http://schemas.microsoft.com/project"
# MS Project custom field IDs (Text1..Text5) used to round-trip KaryaLink attributes
FIELD_IDS = {"activity_id": "188743731", "discipline": "188743734", "area": "188743737", "tag": "188743740",
             "phase": "188743743"}
FIELD_ALIASES = {"activity_id": "Text1", "discipline": "Text2", "area": "Text3", "tag": "Text4", "phase": "Text5"}
REQUIRED = ("activity_id", "name", "planned_start", "planned_finish")


class ImportError_(ValueError):
    pass


def infer_fields(name: str) -> dict:
    """Infer discipline / area / tag / phase from an activity name when the source doesn't carry them."""
    e = extract(name, date.today())
    t = e["tags"][0] if e["tags"] else None
    ttype = {"line": "line", "instrument": "instrument", "foundation": "foundation", "tray": "tray",
             "hydrant": "hydrant", "shower": "shower", "equipment": "equipment",
             "equipment_word": "equipment"}.get(t["type"] if t else "", "other")
    return {"discipline": (e["discipline"] or {}).get("value") or "CIV",
            "area": (e["area"] or {}).get("value") or "U-100",
            "tag": t["value"] if t else "", "tag_type": ttype,
            "phase": (e["phase"] or {}).get("value") or "install"}


def _upsert(db: Session, rows: list[dict], wbs: list[dict], source: str, raw: bytes) -> dict:
    for n in wbs:
        node = db.get(WbsNode, n["code"])
        if node is None:
            db.add(WbsNode(**n))
        else:
            node.name, node.level, node.parent = n["name"], n["level"], n["parent"]
    added = updated = 0
    for r in rows:
        a = db.get(Activity, r["activity_id"])
        if a is None:
            db.add(Activity(**r))
            added += 1
        else:
            for k, v in r.items():
                setattr(a, k, v)
            updated += 1
    db.flush()
    res = {"activities_added": added, "activities_updated": updated, "wbs_nodes": len(wbs), "source": source}
    ledger.append(db, "SCHEDULE_IMPORTED", {**res, "sha256": hashlib.sha256(raw).hexdigest()}, actor="planner")
    invalidate_engine()
    return res


def _norm_date(s: str) -> str:
    s = str(s).strip()
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%d-%m-%Y", "%d/%m/%Y", "%d-%b-%Y", "%d-%b-%y"):
        try:
            return datetime.strptime(s[:19] if "T" in s else s, fmt).date().isoformat()
        except ValueError:
            continue
    raise ImportError_(f"Unrecognised date '{s}'")


def _wbs_chain(parent_code: str, names: dict[str, str]) -> list[dict]:
    parts = parent_code.split(".")
    out = []
    for i in range(1, len(parts) + 1):
        code = ".".join(parts[:i])
        out.append({"code": code, "name": names.get(code, code), "level": i, "parent": ".".join(parts[:i - 1]) or None})
    return out


def import_csv(db: Session, raw: bytes) -> dict:
    text = raw.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    cols = [c.strip() for c in (reader.fieldnames or [])]
    missing = [c for c in REQUIRED if c not in cols]
    if missing:
        raise ImportError_(f"CSV missing required columns: {', '.join(missing)}")
    rows, wbs, names = [], {}, {}
    for i, rec in enumerate(reader, start=2):
        rec = {k.strip(): (v or "").strip() for k, v in rec.items() if k}
        if not rec.get("activity_id"):
            continue
        try:
            ps, pf = _norm_date(rec["planned_start"]), _norm_date(rec["planned_finish"])
        except ImportError_ as e:
            raise ImportError_(f"Row {i}: {e}") from None
        inf = infer_fields(rec["name"]) if not (rec.get("discipline") and rec.get("tag")) else {}
        area = rec.get("area") or inf.get("area", "U-100")
        disc = rec.get("discipline") or inf.get("discipline", "CIV")
        parent = rec.get("parent_wbs") or f"PRJ.{area.replace('-', '')}.{disc}.{rec['activity_id']}"
        level = int(rec.get("level") or 6)
        dur = int(rec.get("duration") or ((date.fromisoformat(pf) - date.fromisoformat(ps)).days + 1))
        rows.append({
            "activity_id": rec["activity_id"], "name": rec["name"], "discipline": disc, "area": area,
            "area_name": rec.get("area_name", ""), "wbs_code": rec.get("wbs_code") or parent, "parent_wbs": parent,
            "level": level, "tag": rec.get("tag") or inf.get("tag", ""), "tag_type": rec.get("tag_type") or inf.get("tag_type", "other"),
            "phase": rec.get("phase") or inf.get("phase", "install"), "planned_start": ps, "planned_finish": pf,
            "duration": dur, "quantity": float(rec.get("quantity") or 1), "unit": rec.get("unit") or "nos",
            "weight": float(rec.get("weight") or 1), "credit_method": rec.get("credit_method") or "quantity",
            "predecessors": [p for p in re.split(r"[;,\s]+", rec.get("predecessors", "")) if p],
        })
        for n in _wbs_chain(parent, names):
            wbs.setdefault(n["code"], n)
    if not rows:
        raise ImportError_("CSV contains no activities")
    return _upsert(db, rows, list(wbs.values()), "csv", raw)


def _t(el, tag):
    x = el.find(f"{{{NS}}}{tag}")
    return x.text if x is not None else None


def import_mspdi(db: Session, raw: bytes) -> dict:
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        raise ImportError_(f"Invalid XML: {e}") from None
    if not root.tag.endswith("Project"):
        raise ImportError_("Not an MS Project XML (MSPDI) file")
    ns_tasks = root.find(f"{{{NS}}}Tasks")
    if ns_tasks is None:
        raise ImportError_("MSPDI file has no <Tasks>")
    fid_to_key = {v: k for k, v in FIELD_IDS.items()}
    tasks = []
    for t in ns_tasks.findall(f"{{{NS}}}Task"):
        if _t(t, "IsNull") == "1" or _t(t, "OutlineLevel") in (None, "0"):
            continue
        ext = {}
        for ea in t.findall(f"{{{NS}}}ExtendedAttribute"):
            k = fid_to_key.get(_t(ea, "FieldID") or "")
            if k:
                ext[k] = _t(ea, "Value")
        tasks.append({"uid": _t(t, "UID"), "name": _t(t, "Name") or "", "level": int(_t(t, "OutlineLevel")),
                      "outline": _t(t, "OutlineNumber") or "", "wbs": _t(t, "WBS"), "summary": _t(t, "Summary") == "1",
                      "start": _t(t, "Start"), "finish": _t(t, "Finish"), "ext": ext,
                      "preds": [_t(p, "PredecessorUID") for p in t.findall(f"{{{NS}}}PredecessorLink")]})
    by_outline = {x["outline"]: x for x in tasks}
    uid_to_id = {}
    for x in tasks:
        if not x["summary"]:
            uid_to_id[x["uid"]] = x["ext"].get("activity_id") or f"T{x['uid']}"
    wbs, rows = [], []
    for x in tasks:
        code = x["wbs"] or x["outline"]
        parent_outline = x["outline"].rsplit(".", 1)[0] if "." in x["outline"] else None
        parent = by_outline.get(parent_outline) if parent_outline else None
        pcode = (parent["wbs"] or parent["outline"]) if parent else None
        if x["summary"]:
            wbs.append({"code": code, "name": x["name"], "level": x["level"], "parent": pcode})
            continue
        inf = infer_fields(x["name"])
        ps, pf = _norm_date(x["start"]), _norm_date(x["finish"])
        is_l6 = parent is not None and x["level"] >= 6
        own = pcode if is_l6 else code
        if not is_l6:
            wbs.append({"code": code, "name": x["name"], "level": x["level"], "parent": pcode})
        rows.append({
            "activity_id": uid_to_id[x["uid"]], "name": x["name"],
            "discipline": x["ext"].get("discipline") or inf["discipline"], "area": x["ext"].get("area") or inf["area"],
            "area_name": "", "wbs_code": code, "parent_wbs": own or code, "level": 6 if is_l6 else 5,
            "tag": x["ext"].get("tag") or inf["tag"], "tag_type": inf["tag_type"],
            "phase": x["ext"].get("phase") or inf["phase"], "planned_start": ps, "planned_finish": pf,
            "duration": (date.fromisoformat(pf) - date.fromisoformat(ps)).days + 1, "quantity": 1.0, "unit": "nos",
            "weight": 1.0, "credit_method": "milestone",
            "predecessors": [uid_to_id[p] for p in x["preds"] if p in uid_to_id],
        })
    if not rows:
        raise ImportError_("MSPDI file contains no leaf tasks")
    # keep richer attributes (quantity, unit, weights) if the activity already exists
    for r in rows:
        a = db.get(Activity, r["activity_id"])
        if a is not None:
            r.update(quantity=a.quantity, unit=a.unit, weight=a.weight, credit_method=a.credit_method,
                     tag_type=a.tag_type, area_name=a.area_name, level=a.level, parent_wbs=a.parent_wbs,
                     wbs_code=a.wbs_code)
    return _upsert(db, rows, wbs, "mspdi", raw)


# ------------------------------------------------------------------ export
EXPORT_COLS = ["activity_id", "name", "wbs_code", "parent_wbs", "level", "discipline", "area", "tag", "phase",
               "planned_start", "planned_finish", "duration", "quantity", "unit", "qty_done", "pct",
               "actual_start", "actual_finish", "last_update", "source", "predecessors"]


def export_csv(db: Session) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(EXPORT_COLS)
    for a in db.execute(select(Activity).order_by(Activity.activity_id)).scalars():
        d = a.to_dict()
        d["predecessors"] = ";".join(a.predecessors or [])
        w.writerow([d.get(c) if d.get(c) is not None else "" for c in EXPORT_COLS])
    return buf.getvalue()


def _dt(d: str | None, end: bool = False) -> str:
    return f"{d}T{'17:00:00' if end else '08:00:00'}" if d else ""


def _dur(days: int) -> str:
    return f"PT{max(0, days) * 8}H0M0S"


def export_mspdi(db: Session) -> str:
    acts = list(db.execute(select(Activity)).scalars())
    nodes = {n.code: n for n in db.execute(select(WbsNode)).scalars()}
    children: dict[str | None, list[str]] = {}
    for n in nodes.values():
        children.setdefault(n.parent, []).append(n.code)
    leaf_by_node: dict[str, list[Activity]] = {}
    own_node: dict[str, Activity] = {}
    for a in acts:
        if a.level == 6:
            leaf_by_node.setdefault(a.parent_wbs, []).append(a)
        else:
            own_node[a.parent_wbs] = a
    today = project_today(db)
    starts = [a.planned_start for a in acts] or [today]
    finishes = [a.planned_finish for a in acts] or [today]
    out: list[str] = []
    uid = [0]
    uid_of: dict[str, int] = {}
    order: list[tuple] = []  # (kind, obj, outline, level)

    def walk(code: str, outline: str, level: int):
        order.append(("node", nodes[code], outline, level))
        kids = sorted(children.get(code, []))
        i = 0
        for k in kids:
            i += 1
            walk(k, f"{outline}.{i}", level + 1)
        for a in sorted(leaf_by_node.get(code, []), key=lambda x: x.planned_start):
            i += 1
            order.append(("act", a, f"{outline}.{i}", level + 1))

    roots = sorted(children.get(None, []))
    for i, r in enumerate(roots, start=1):
        walk(r, str(i), 1)
    for kind, obj, _, _ in order:
        uid[0] += 1
        key = obj.code if kind == "node" else obj.activity_id
        uid_of[key] = uid[0]
    for a in acts:  # L5 activities are emitted in place of their own WBS node
        if a.parent_wbs in uid_of:
            uid_of[a.activity_id] = uid_of[a.parent_wbs]

    def ext_attrs(a: Activity) -> str:
        return "".join(f"<ExtendedAttribute><FieldID>{FIELD_IDS[k]}</FieldID><Value>{escape(str(getattr(a, k)))}</Value>"
                       f"</ExtendedAttribute>" for k in FIELD_IDS)

    def task_xml(u: int, name: str, wbs: str, outline: str, level: int, start: str, finish: str, summary: bool,
                 pct: float, a_start=None, a_finish=None, milestone=False, preds=(), ext="", notes=None) -> str:
        days = (date.fromisoformat(finish) - date.fromisoformat(start)).days + 1
        x = [f"<Task><UID>{u}</UID><ID>{u}</ID><Name>{escape(name)}</Name><Type>1</Type>",
             f"<IsNull>0</IsNull><WBS>{escape(wbs)}</WBS><OutlineNumber>{outline}</OutlineNumber>",
             f"<OutlineLevel>{level}</OutlineLevel><Start>{_dt(start)}</Start><Finish>{_dt(finish, True)}</Finish>",
             f"<Duration>{_dur(days)}</Duration><DurationFormat>7</DurationFormat>",
             f"<Milestone>{1 if milestone else 0}</Milestone><Summary>{1 if summary else 0}</Summary>",
             f"<PercentComplete>{int(round(pct))}</PercentComplete>"]
        if a_start:
            x.append(f"<ActualStart>{_dt(a_start)}</ActualStart>")
        if a_finish:
            x.append(f"<ActualFinish>{_dt(a_finish, True)}</ActualFinish>")
        if notes:
            x.append(f"<Notes>{escape(notes)}</Notes>")
        for p in preds:
            x.append(f"<PredecessorLink><PredecessorUID>{p}</PredecessorUID><Type>1</Type></PredecessorLink>")
        x.append(ext)
        x.append("</Task>")
        return "".join(x)

    from ..engine.rollup import rollup as do_rollup

    roll = do_rollup([a.to_dict() for a in acts], [{"code": n.code, "parent": n.parent} for n in nodes.values()],
                     {a.activity_id: a.pct for a in acts}, date.fromisoformat(today))
    span: dict[str, list[str]] = {}
    for a in acts:
        node = a.parent_wbs
        while node:
            s = span.setdefault(node, [a.planned_start, a.planned_finish])
            s[0], s[1] = min(s[0], a.planned_start), max(s[1], a.planned_finish)
            node = nodes[node].parent if node in nodes else None

    tasks = [task_xml(0, "GGS-7 KaryaLink export", "0", "0", 0, min(starts), max(finishes), True, 0)]
    for kind, obj, outline, level in order:
        if kind == "node":
            a = own_node.get(obj.code)
            if a is not None and obj.code not in children and obj.code not in leaf_by_node:
                tasks.append(task_xml(uid_of[obj.code], a.name, obj.code, outline, level, a.planned_start,
                                      a.planned_finish, False, a.pct, a.actual_start, a.actual_finish,
                                      a.credit_method == "milestone" and a.duration <= 1,
                                      [uid_of[p] for p in (a.predecessors or []) if p in uid_of], ext_attrs(a)))
            else:
                s = span.get(obj.code, [today, today])
                tasks.append(task_xml(uid_of[obj.code], obj.name, obj.code, outline, level, s[0], s[1], True,
                                      roll.get(obj.code, {}).get("actual_pct", 0.0)))
        else:
            a = obj
            tasks.append(task_xml(uid_of[a.activity_id], a.name, a.wbs_code, outline, level, a.planned_start,
                                  a.planned_finish, False, a.pct, a.actual_start, a.actual_finish, False,
                                  [uid_of[p] for p in (a.predecessors or []) if p in uid_of], ext_attrs(a)))
    ext_defs = "".join(f"<ExtendedAttribute><FieldID>{FIELD_IDS[k]}</FieldID><FieldName>{FIELD_ALIASES[k]}</FieldName>"
                       f"<Alias>{k}</Alias></ExtendedAttribute>" for k in FIELD_IDS)
    out.append('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
    out.append(f'<Project xmlns="{NS}"><SaveVersion>14</SaveVersion><Name>GGS7_KaryaLink.xml</Name>'
               f"<Title>GGS-7 Gas Gathering Station (fictional) - KaryaLink actuals</Title>"
               f"<ScheduleFromStart>1</ScheduleFromStart><StartDate>{_dt(min(starts))}</StartDate>"
               f"<FinishDate>{_dt(max(finishes), True)}</FinishDate><CalendarUID>1</CalendarUID>"
               f"<MinutesPerDay>480</MinutesPerDay><MinutesPerWeek>2400</MinutesPerWeek><DaysPerMonth>20</DaysPerMonth>"
               f"<CurrentDate>{_dt(today)}</CurrentDate><StatusDate>{_dt(today, True)}</StatusDate>"
               f"<ExtendedAttributes>{ext_defs}</ExtendedAttributes>"
               f"<Calendars><Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar></Calendar></Calendars>"
               f"<Tasks>{''.join(tasks)}</Tasks></Project>")
    return "\n".join(out)


DATASET_COLS = ["event_id", "activity_id", "activity_name", "discipline", "area", "wbs", "phase", "event", "event_date",
                "qty_value", "qty_mode", "pct_before", "pct_after", "credit_note", "confidence", "approver",
                "model_version", "source", "report_id", "report_text", "reporter", "channel", "evidence_phase",
                "evidence_status", "evidence_quantity", "evidence_date", "photo_sha256", "recorded_at"]


def export_actuals_dataset(db: Session) -> str:
    acts = {a.activity_id: a for a in db.execute(select(Activity)).scalars()}
    reps = {r.id: r for r in db.execute(select(Report)).scalars()}
    photos = {p.id: p for p in db.execute(select(Photo)).scalars()}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(DATASET_COLS)
    for e in db.execute(select(ActualEvent).order_by(ActualEvent.event_date, ActualEvent.id)).scalars():
        a = acts.get(e.activity_id)
        r = reps.get(e.report_id) if e.report_id else None
        ext = r.analysis["extraction"] if r else {}
        ev = lambda k: ((ext.get(k) or {}).get("evidence") or "") if r else ""
        p = photos.get(r.photo_id) if r and r.photo_id else None
        w.writerow([e.id, e.activity_id, a.name if a else "", a.discipline if a else "", a.area if a else "",
                    a.parent_wbs if a else "", a.phase if a else "", e.event, e.event_date, e.qty_value, e.qty_mode,
                    e.pct_before, e.pct_after, e.credit_note, round(e.confidence, 4), e.approver, e.model_version,
                    e.source, e.report_id or "", r.text if r else "", r.reporter if r else "", r.channel if r else "",
                    ev("phase"), ev("status"), ev("quantity"), ev("date"), p.sha256 if p else "",
                    e.created_at.isoformat()])
    return buf.getvalue()
