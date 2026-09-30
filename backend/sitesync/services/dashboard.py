"""Dashboard read models: WBS roll-up, plan-vs-actual, S-curve, delay flags, summary KPIs."""
from __future__ import annotations

import bisect
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import config
from ..db import Activity, ActualEvent, Report, SequenceWarning, WbsNode
from ..engine.rollup import leaf_budgets, planned_pct, rollup
from .core import project_today


def _acts(db: Session, discipline: str | None = None, area: str | None = None) -> list[Activity]:
    q = select(Activity)
    if discipline:
        q = q.where(Activity.discipline == discipline)
    if area:
        q = q.where(Activity.area == area)
    return list(db.execute(q).scalars())


def delay_status(a: Activity, today: date) -> dict | None:
    """Early delay flag: due soon / overdue / started but silent, with no update for N days."""
    if a.actual_finish:
        return None
    ps, pf = date.fromisoformat(a.planned_start), date.fromisoformat(a.planned_finish)
    if ps > today:
        return None  # not yet due to start
    amber, red = config.DELAY_AMBER_DAYS, config.DELAY_RED_DAYS
    last = date.fromisoformat(a.last_update) if a.last_update else None
    silent = (today - last).days if last else (today - ps).days
    due_soon = (pf - today).days <= config.DELAY_DUE_WINDOW_DAYS
    rank = {"amber": 1, "red": 2}
    level, reasons = None, []

    def bump(lv: str, why: str):
        nonlocal level
        if level is None or rank[lv] > rank[level]:
            level = lv
        reasons.append(why)

    if pf < today:
        bump("red", f"planned finish {a.planned_finish} passed ({(today - pf).days} d overdue)")
    if a.actual_start is None:
        late = (today - ps).days
        if late >= red:
            bump("red", f"planned start {a.planned_start} passed {late} d ago, not started")
        elif late >= amber or (due_soon and late > 0):
            bump("amber", f"planned start {a.planned_start} passed, not started")
    elif silent >= amber and (due_soon or silent >= red):
        bump("red" if silent >= red else "amber", f"no update for {silent} d" + (" and due soon" if due_soon else ""))
    if level is None:
        return None
    return {"level": level, "reasons": reasons, "days_silent": silent}


def delays(db: Session, discipline: str | None = None, area: str | None = None) -> list[dict]:
    today = date.fromisoformat(project_today(db))
    out = []
    for a in _acts(db, discipline, area):
        f = delay_status(a, today)
        if f:
            out.append({"activity_id": a.activity_id, "name": a.name, "discipline": a.discipline, "area": a.area,
                        "planned_start": a.planned_start, "planned_finish": a.planned_finish, "pct": a.pct,
                        "last_update": a.last_update, **f})
    out.sort(key=lambda x: (x["level"] != "red", x["planned_finish"]))
    return out


def summary(db: Session) -> dict:
    today = date.fromisoformat(project_today(db))
    acts = _acts(db)
    dicts = [a.to_dict() for a in acts]
    nodes = [{"code": n.code, "parent": n.parent} for n in db.execute(select(WbsNode)).scalars()]
    roll = rollup(dicts, nodes, {a.activity_id: a.pct for a in acts}, today)
    root = next((n["code"] for n in nodes if n["parent"] is None), None)
    r = roll.get(root, {"actual_pct": 0, "planned_pct": 0})
    reports = db.execute(select(Report.status, Report.decision)).all()
    dl = delays(db)
    by_disc = {}
    budgets = leaf_budgets(dicts)
    for d in ("CIV", "PIP", "ELE", "INS", "MEC", "HSE"):
        sel = [a for a in acts if a.discipline == d]
        b = sum(budgets[a.activity_id] for a in sel) or 1
        by_disc[d] = {"actual_pct": round(sum(budgets[a.activity_id] * a.pct for a in sel) / b, 1),
                      "planned_pct": round(sum(budgets[a.activity_id] * planned_pct(a.to_dict(), today) for a in sel) / b, 1),
                      "activities": len(sel)}
    # per-unit portfolio (units are the "projects" inside this one synthetic facility)
    names = {n.code: n.name for n in db.execute(select(WbsNode).where(WbsNode.level == 2)).scalars()}
    flags = {x["activity_id"]: x["level"] for x in dl}
    by_area = []
    for area in sorted({a.area for a in acts}):
        sel = [a for a in acts if a.area == area]
        b = sum(budgets[a.activity_id] for a in sel) or 1
        act_pct = round(sum(budgets[a.activity_id] * a.pct for a in sel) / b, 1)
        plan_pct = round(sum(budgets[a.activity_id] * planned_pct(a.to_dict(), today) for a in sel) / b, 1)
        active = [a for a in sel if a.actual_start and not a.actual_finish]
        phases: dict[str, int] = {}
        for a in active:
            phases[a.phase] = phases.get(a.phase, 0) + 1
        gap = act_pct - plan_pct
        by_area.append({
            "area": area, "name": next((v for k, v in names.items() if k.endswith(area.replace("-", ""))), area),
            "actual_pct": act_pct, "planned_pct": plan_pct, "variance": round(gap, 1),
            "status": "complete" if act_pct >= 99.9 else "on_track" if gap >= -3 else "at_risk" if gap >= -10 else "behind",
            "activities": len(sel), "completed": sum(1 for a in sel if a.actual_finish), "in_progress": len(active),
            "red_flags": sum(1 for a in sel if flags.get(a.activity_id) == "red"),
            "amber_flags": sum(1 for a in sel if flags.get(a.activity_id) == "amber"),
            "current_phase": max(phases, key=phases.get) if phases else None,
            "last_update": max((a.last_update for a in sel if a.last_update), default=None),
        })
    iso = today.isoformat()
    todays = db.execute(select(Report.status, Report.decision).where(Report.report_date == iso)).all()
    return {
        "by_area": by_area,
        "updates_today": len(todays),
        "linked_today": sum(1 for s, _ in todays if s == "applied"),
        "project": "GGS-7 Gas Gathering Station (fictional)",
        "data_date": today.isoformat(),
        "actual_pct": r["actual_pct"], "planned_pct": r["planned_pct"],
        "spi": round(r["actual_pct"] / r["planned_pct"], 3) if r["planned_pct"] else None,
        "activities": len(acts),
        "completed": sum(1 for a in acts if a.actual_finish),
        "in_progress": sum(1 for a in acts if a.actual_start and not a.actual_finish),
        "not_started": sum(1 for a in acts if not a.actual_start),
        "new_activities": sum(1 for a in acts if a.source == "new_activity"),
        "reports_total": len(reports),
        "queue_planner": sum(1 for s, _ in reports if s == "awaiting_planner"),
        "queue_supervisor": sum(1 for s, _ in reports if s == "awaiting_supervisor"),
        "auto_applied": sum(1 for s, d in reports if d == "AUTO_APPLY"),
        "delays_red": sum(1 for x in dl if x["level"] == "red"),
        "delays_amber": sum(1 for x in dl if x["level"] == "amber"),
        "open_warnings": db.execute(select(SequenceWarning).where(SequenceWarning.status == "open")).scalars().all().__len__(),
        "by_discipline": by_disc,
    }


def wbs_tree(db: Session, discipline: str | None = None) -> dict:
    today = date.fromisoformat(project_today(db))
    acts = _acts(db)
    nodes = list(db.execute(select(WbsNode)).scalars())
    roll = rollup([a.to_dict() for a in acts], [{"code": n.code, "parent": n.parent} for n in nodes],
                  {a.activity_id: a.pct for a in acts}, today)
    kids: dict[str | None, list] = {}
    for n in nodes:
        kids.setdefault(n.parent, []).append(n)
    leafs: dict[str, list[Activity]] = {}
    for a in acts:
        if discipline and a.discipline != discipline:
            continue
        leafs.setdefault(a.parent_wbs, []).append(a)
    delay_map = {a.activity_id: delay_status(a, today) for a in acts}

    def build(n: WbsNode) -> dict | None:
        ch = [c for c in (build(k) for k in sorted(kids.get(n.code, []), key=lambda k: k.code)) if c]
        acts_here = [{"activity_id": a.activity_id, "name": a.name, "pct": a.pct, "level": a.level,
                      "planned_pct": round(planned_pct(a.to_dict(), today), 1), "actual_start": a.actual_start,
                      "actual_finish": a.actual_finish, "flag": (delay_map.get(a.activity_id) or {}).get("level")}
                     for a in sorted(leafs.get(n.code, []), key=lambda a: a.planned_start)]
        if discipline and not ch and not acts_here:
            return None
        rr = roll.get(n.code, {})
        return {"code": n.code, "name": n.name, "level": n.level, "actual_pct": rr.get("actual_pct", 0),
                "planned_pct": rr.get("planned_pct", 0), "children": ch, "activities": acts_here}

    roots = [build(r) for r in kids.get(None, [])]
    return {"roots": [r for r in roots if r]}


def gantt(db: Session, discipline: str | None = None, area: str | None = None, limit: int = 120) -> list[dict]:
    today = date.fromisoformat(project_today(db))
    acts = _acts(db, discipline, area)
    window = [a for a in acts if date.fromisoformat(a.planned_start) <= today + timedelta(days=21)
              and date.fromisoformat(a.planned_finish) >= today - timedelta(days=45)]
    window.sort(key=lambda a: (a.area, a.planned_start))
    out = []
    for a in window[:limit]:
        out.append({"activity_id": a.activity_id, "name": a.name, "discipline": a.discipline, "area": a.area,
                    "planned_start": a.planned_start, "planned_finish": a.planned_finish,
                    "actual_start": a.actual_start, "actual_finish": a.actual_finish, "pct": a.pct,
                    "planned_pct": round(planned_pct(a.to_dict(), today), 1),
                    "flag": (delay_status(a, today) or {}).get("level")})
    return out


def scurve(db: Session, discipline: str | None = None) -> list[dict]:
    today = date.fromisoformat(project_today(db))
    acts = _acts(db, discipline)
    if not acts:
        return []
    dicts = [a.to_dict() for a in acts]
    budgets = leaf_budgets(dicts)
    total = sum(budgets.values()) or 1
    hist: dict[str, list[tuple[str, float]]] = {}
    ids = {a.activity_id for a in acts}
    for e in db.execute(select(ActualEvent).order_by(ActualEvent.event_date, ActualEvent.id)).scalars():
        if e.activity_id in ids:
            hist.setdefault(e.activity_id, []).append((e.event_date, e.pct_after))
    keys = {k: [d for d, _ in v] for k, v in hist.items()}
    start = min(date.fromisoformat(a.planned_start) for a in acts)
    end = max(date.fromisoformat(a.planned_finish) for a in acts)
    out = []
    d = start
    while d <= end + timedelta(days=7):
        p = sum(budgets[a["activity_id"]] * planned_pct(a, d) for a in dicts) / total
        row = {"date": d.isoformat(), "planned": round(p, 2)}
        if d <= today:
            iso = d.isoformat()
            s = 0.0
            for aid, evs in hist.items():
                i = bisect.bisect_right(keys[aid], iso)
                if i:
                    s += budgets[aid] * evs[i - 1][1]
            row["actual"] = round(s / total, 2)
        out.append(row)
        d += timedelta(days=7)
    if out and out[-1]["date"] < today.isoformat() <= (date.fromisoformat(out[-1]["date"]) + timedelta(days=7)).isoformat():
        pass
    return out


def warnings(db: Session, status: str | None = None) -> list[dict]:
    q = select(SequenceWarning).order_by(SequenceWarning.id.desc())
    if status:
        q = q.where(SequenceWarning.status == status)
    return [{"id": w.id, "report_id": w.report_id, "activity_id": w.activity_id, "type": w.type,
             "message": w.message, "status": w.status, "resolved_by": w.resolved_by,
             "created_at": w.created_at.isoformat()} for w in db.execute(q).scalars()]
