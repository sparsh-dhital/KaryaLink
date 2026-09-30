"""KaryaLink HTTP API (FastAPI). Internal package name: sitesync."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from . import __version__, config, ledger
from .db import Activity, ActualEvent, LedgerEntry, ModelVersion, Photo, Report, SessionLocal, init_db
from .engine import llm, policy
from .engine.rollup import RULES_OF_CREDIT
from .services import assistant, dashboard, demo, learning, memory, schedule_io
from .services import reports as R
from .services.core import (DbState, active_model, get_engine, invalidate_engine, project_today, set_setting,
                            thresholds)

log = logging.getLogger("sitesync")
WRITE_LOCK = threading.RLock()
MAX_UPLOAD = 10 * 1024 * 1024


def _needs_seed() -> bool:
    if not config.DB_PATH.exists():
        return True
    try:
        with SessionLocal() as db:
            return db.execute(select(func.count()).select_from(Activity)).scalar_one() == 0
    except Exception:
        return True


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.ensure_dirs()
    if _needs_seed():
        log.warning("No seeded database found - seeding now (same as `npm run seed`)...")
        from .services.seeding import seed

        seed(regenerate=not (config.DATA_DIR / "schedule.json").exists(), verbose=True)
    else:
        init_db()
    yield


app = FastAPI(title="KaryaLink API", description="Site-to-Schedule Intelligence", version=__version__, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
RESETTING = threading.Event()
_ACTIVE = 0
_ACTIVE_COND = threading.Condition()


@app.middleware("http")
async def hold_during_reset(request: Request, call_next):
    """Reset drops and rebuilds tables: park new API calls while it runs, and let the reset wait
    for in-flight calls to finish first (so no request ever sees half-built tables)."""
    global _ACTIVE
    path = request.url.path
    if not path.startswith("/api/") or path == "/api/demo/reset":
        return await call_next(request)
    for _ in range(900):  # up to 90 s
        with _ACTIVE_COND:
            if not RESETTING.is_set():
                _ACTIVE += 1
                break
        await asyncio.sleep(0.1)
    else:
        return JSONResponse(status_code=503, content={"detail": "The demo database is being reset - try again in a moment."})
    try:
        return await call_next(request)
    finally:
        with _ACTIVE_COND:
            _ACTIVE -= 1
            _ACTIVE_COND.notify_all()


@app.exception_handler(R.WorkflowError)
async def _wf(_: Request, e: R.WorkflowError):
    return JSONResponse(status_code=400, content={"detail": str(e)})


@app.exception_handler(schedule_io.ImportError_)
async def _imp(_: Request, e: schedule_io.ImportError_):
    return JSONResponse(status_code=400, content={"detail": str(e)})


def get_db():
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def report_json(r: Report, full: bool = True) -> dict:
    d = {"id": r.id, "external_id": r.external_id, "text": r.text, "reporter": r.reporter,
         "reporter_discipline": r.reporter_discipline, "channel": r.channel, "report_date": r.report_date,
         "created_at": r.created_at.isoformat(), "status": r.status, "decision": r.decision,
         "confidence": r.confidence, "activity_id": r.activity_id, "model_version": r.model_version,
         "photo_id": r.photo_id, "source_file": r.source_file, "resolved_by": r.resolved_by}
    if full:
        a = r.analysis
        d.update(candidates=a["candidates"], decision_detail=a["decision"], warnings=a.get("warnings", []),
                 evidence_spans=a.get("evidence_spans", []), extraction=_public_ext(a["extraction"]),
                 supervisor_note=a.get("supervisor_note"))
    return d


def _public_ext(e: dict) -> dict:
    keep = ("phase", "phases_all", "status", "tags", "quantity", "granular_ids", "date", "area", "discipline",
            "new_work_cue", "corrections", "extractor", "llm_status", "llm_accepted", "llm_rejected")
    return {k: e.get(k) for k in keep}


# ------------------------------------------------------------------ meta / settings
@app.get("/api/health")
def health():
    return {"ok": True, "version": __version__}


@app.get("/api/meta")
def meta(db=Depends(get_db)):
    mv = active_model(db)
    return {"version": __version__, "project": "GGS-7 Gas Gathering Station (fictional)",
            "data_date": project_today(db), "thresholds": thresholds(db), "model_version": mv.version if mv else None,
            "llm_enabled": llm.available(), "llm_model": config.LLM_MODEL if llm.available() else None,
            "disciplines": {"CIV": "Civil", "PIP": "Piping", "ELE": "Electrical", "INS": "Instrumentation",
                            "MEC": "Mechanical", "HSE": "HSE"},
            "areas": sorted({a for (a,) in db.execute(select(Activity.area).distinct()).all()}),
            "rules_of_credit": RULES_OF_CREDIT,
            "delay_rules": {"due_window_days": config.DELAY_DUE_WINDOW_DAYS, "amber_days": config.DELAY_AMBER_DAYS,
                            "red_days": config.DELAY_RED_DAYS}}


class ThresholdsIn(BaseModel):
    auto_apply: float = Field(ge=0.05, le=0.999)
    review: float = Field(ge=0.0, le=0.95)
    margin: float = Field(default=0.10, ge=0, le=0.9)
    clarify_gap: float = Field(default=0.25, ge=0, le=0.9)


@app.put("/api/settings/thresholds")
def put_thresholds(body: ThresholdsIn, db=Depends(get_db)):
    if body.review >= body.auto_apply:
        raise HTTPException(400, "review threshold must be below auto-apply threshold")
    with WRITE_LOCK:
        set_setting(db, "thresholds", body.model_dump())
        ledger.append(db, "THRESHOLDS_CHANGED", body.model_dump(), actor="planner")
        db.flush()
        invalidate_engine()
        learning.recompute_active(db)
    return {"thresholds": thresholds(db)}


# ------------------------------------------------------------------ schedule
@app.post("/api/schedule/import")
async def import_schedule(file: UploadFile = File(...), db=Depends(get_db)):
    raw = await file.read()
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "File too large (max 10 MB)")
    name = (file.filename or "").lower()
    with WRITE_LOCK:
        if name.endswith(".xml"):
            return schedule_io.import_mspdi(db, raw)
        if name.endswith(".csv"):
            return schedule_io.import_csv(db, raw)
    raise HTTPException(400, "Upload a .csv schedule or an MS Project .xml (MSPDI) file")


@app.get("/api/activities")
def list_activities(q: str = "", discipline: str | None = None, area: str | None = None, limit: int = 50,
                    db=Depends(get_db)):
    stmt = select(Activity)
    if discipline:
        stmt = stmt.where(Activity.discipline == discipline)
    if area:
        stmt = stmt.where(Activity.area == area)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Activity.name.ilike(like), Activity.tag.ilike(like), Activity.activity_id.ilike(like)))
    rows = db.execute(stmt.order_by(Activity.activity_id).limit(min(limit, 500))).scalars()
    return [a.to_dict() for a in rows]


@app.get("/api/activities/{activity_id}")
def get_activity(activity_id: str, db=Depends(get_db)):
    a = db.get(Activity, activity_id)
    if not a:
        raise HTTPException(404, "Activity not found")
    evs = db.execute(select(ActualEvent).where(ActualEvent.activity_id == activity_id)
                     .order_by(ActualEvent.event_date, ActualEvent.id)).scalars()
    return {**a.to_dict(), "events": [_event_json(e) for e in evs]}


def _event_json(e: ActualEvent) -> dict:
    return {"id": e.id, "activity_id": e.activity_id, "report_id": e.report_id, "event": e.event,
            "event_date": e.event_date, "qty_value": e.qty_value, "qty_mode": e.qty_mode, "pct_before": e.pct_before,
            "pct_after": e.pct_after, "credit_note": e.credit_note, "confidence": e.confidence, "approver": e.approver,
            "model_version": e.model_version, "source": e.source, "created_at": e.created_at.isoformat()}


# ------------------------------------------------------------------ reports
class ReportIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    reporter: str = "Site supervisor"
    reporter_discipline: str | None = None
    channel: str = "chat"
    report_date: str | None = None
    photo_id: int | None = None
    session_id: str | None = None


@app.post("/api/reports")
def create_report(body: ReportIn, db=Depends(get_db)):
    with WRITE_LOCK:
        r = R.submit_report(db, body.text, body.reporter, body.reporter_discipline, body.channel, body.report_date,
                            body.photo_id, body.session_id)
    return report_json(r)


@app.post("/api/reports/preview")
def preview_report(body: ReportIn, db=Depends(get_db)):
    from datetime import date as _d

    res = get_engine(db).analyze(body.text, _d.fromisoformat(body.report_date or project_today(db)),
                                 body.reporter_discipline, DbState(db))
    return {"candidates": res["candidates"], "decision": res["decision"], "warnings": res["warnings"],
            "evidence_spans": res["evidence_spans"], "extraction": _public_ext(res["extraction"])}


@app.post("/api/reports/upload")
async def upload_report(file: UploadFile = File(...), reporter: str = Form("Site supervisor"),
                        reporter_discipline: str | None = Form(None), photo_id: int | None = Form(None),
                        db=Depends(get_db)):
    raw = await file.read()
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "File too large (max 10 MB)")
    with WRITE_LOCK:
        out = R.ingest_file(db, raw, file.filename or "upload", reporter, reporter_discipline, photo_id)
    return {"reports": [report_json(r) for r in out["reports"]], "informational_lines": out["informational_lines"]}


@app.get("/api/reports")
def list_reports(status: str | None = None, decision: str | None = None, channel: str | None = None, q: str = "",
                 limit: int = 100, offset: int = 0, db=Depends(get_db)):
    stmt = select(Report)
    if status:
        stmt = stmt.where(Report.status.in_(status.split(","))) if "," in status else stmt.where(Report.status == status)
    if decision:
        stmt = stmt.where(Report.decision == decision)
    if channel:
        stmt = stmt.where(Report.channel == channel)
    if q:
        stmt = stmt.where(or_(Report.text.ilike(f"%{q}%"), Report.reporter.ilike(f"%{q}%")))
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = list(db.execute(stmt.order_by(Report.id.desc()).offset(offset).limit(min(limit, 500))).scalars())
    ids = {r.activity_id for r in rows if r.activity_id} | {
        r.analysis["candidates"][0]["activity_id"] for r in rows if r.analysis.get("candidates")}
    names = {a.activity_id: a.name for a in db.execute(select(Activity).where(Activity.activity_id.in_(ids))).scalars()} if ids else {}
    items = []
    for r in rows:
        d = report_json(r, full=False)
        top = r.analysis["candidates"][0] if r.analysis.get("candidates") else None
        d["activity_name"] = names.get(r.activity_id) if r.activity_id else None
        d["top_candidate"] = {"activity_id": top["activity_id"], "name": names.get(top["activity_id"], top["activity"]["name"]),
                              "confidence": top["confidence"]} if top else None
        items.append(d)
    return {"total": total, "items": items}


@app.get("/api/reports/stats")
def report_stats(db=Depends(get_db)):
    """Live operational statistics over submitted reports (not the benchmark)."""
    rows = db.execute(select(Report.report_date, Report.decision, Report.status, Report.channel, Report.reporter_discipline)).all()
    by_day: dict[str, dict] = {}
    by_channel: dict[str, int] = {}
    by_decision: dict[str, int] = {}
    by_status: dict[str, int] = {}
    for d, dec, st, ch, _ in rows:
        day = by_day.setdefault(d, {"date": d, "total": 0, "auto": 0, "review": 0})
        day["total"] += 1
        day["auto" if dec == policy.AUTO_APPLY else "review"] += 1
        by_channel[ch] = by_channel.get(ch, 0) + 1
        by_decision[dec] = by_decision.get(dec, 0) + 1
        by_status[st] = by_status.get(st, 0) + 1
    return {"total": len(rows), "by_day": sorted(by_day.values(), key=lambda x: x["date"]), "by_channel": by_channel,
            "by_decision": by_decision, "by_status": by_status}


@app.get("/api/reports/{report_id}")
def get_report(report_id: int, db=Depends(get_db)):
    r = db.get(Report, report_id)
    if not r:
        raise HTTPException(404, "Report not found")
    return report_json(r)


@app.get("/api/queue")
def queue(db=Depends(get_db)):
    planner = db.execute(select(Report).where(Report.status == "awaiting_planner")
                         .order_by(Report.confidence.desc(), Report.id)).scalars()
    sup = db.execute(select(Report).where(Report.status == "awaiting_supervisor").order_by(Report.id.desc())).scalars()
    return {"planner": [report_json(r) for r in planner], "supervisor": [report_json(r) for r in sup]}


class ActionIn(BaseModel):
    action: str
    activity_id: str | None = None
    planner: str = "planner"
    name: str | None = None
    parent_wbs: str | None = None


@app.post("/api/reports/{report_id}/action")
def report_action(report_id: int, body: ActionIn, db=Depends(get_db)):
    if body.action not in ("approve", "reassign", "reject", "new_activity"):
        raise HTTPException(400, "action must be approve | reassign | reject | new_activity")
    with WRITE_LOCK:
        r = R.planner_action(db, report_id, body.action, body.activity_id, body.planner, body.name, body.parent_wbs)
    return report_json(r)


class AnswerIn(BaseModel):
    value: str
    actor: str = "supervisor"


@app.post("/api/reports/{report_id}/answer")
def report_answer(report_id: int, body: AnswerIn, db=Depends(get_db)):
    with WRITE_LOCK:
        r = R.answer(db, report_id, body.value, body.actor)
    return report_json(r)


class RevertIn(BaseModel):
    actor: str = "planner"
    reason: str = Field(default="reverted by planner", max_length=200)


@app.post("/api/reports/{report_id}/revert")
def report_revert(report_id: int, body: RevertIn, db=Depends(get_db)):
    with WRITE_LOCK:
        R.revert_report(db, report_id, body.actor, body.reason)
    return report_json(db.get(Report, report_id))


class BulkIn(BaseModel):
    min_confidence: float = Field(ge=0, le=1)
    planner: str = "planner"


@app.post("/api/queue/bulk-approve")
def bulk(body: BulkIn, db=Depends(get_db)):
    with WRITE_LOCK:
        ids = R.bulk_approve(db, body.min_confidence, body.planner)
    return {"approved": ids, "count": len(ids)}


@app.get("/api/clarifications")
def clarifications(db=Depends(get_db)):
    rows = db.execute(select(Report).where(Report.decision.in_([policy.CLARIFY, policy.CONFIRM_SEQUENCE]))
                      .order_by(Report.id.desc()).limit(100)).scalars()
    return [report_json(r) for r in rows]


# ------------------------------------------------------------------ actuals & dashboard
@app.get("/api/actuals")
def actuals(limit: int = 100, offset: int = 0, source: str | None = None, activity_id: str | None = None,
            db=Depends(get_db)):
    stmt = select(ActualEvent)
    if source:
        stmt = stmt.where(ActualEvent.source == source)
    if activity_id:
        stmt = stmt.where(ActualEvent.activity_id == activity_id)
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = db.execute(stmt.order_by(ActualEvent.id.desc()).offset(offset).limit(min(limit, 500))).scalars()
    return {"total": total, "items": [_event_json(e) for e in rows]}


@app.get("/api/rollup")
def rollup_tree(discipline: str | None = None, db=Depends(get_db)):
    return dashboard.wbs_tree(db, discipline)


@app.get("/api/dashboard/summary")
def dash_summary(db=Depends(get_db)):
    return dashboard.summary(db)


@app.get("/api/plan-vs-actual")
def plan_vs_actual(discipline: str | None = None, area: str | None = None, limit: int = 120, db=Depends(get_db)):
    return dashboard.gantt(db, discipline, area, limit)


@app.get("/api/dashboard/scurve")
def scurve(discipline: str | None = None, db=Depends(get_db)):
    return dashboard.scurve(db, discipline)


@app.get("/api/dashboard/delays")
def delays(discipline: str | None = None, area: str | None = None, db=Depends(get_db)):
    return dashboard.delays(db, discipline, area)


@app.get("/api/dashboard/warnings")
def seq_warnings(status: str | None = None, db=Depends(get_db)):
    return dashboard.warnings(db, status)


# ------------------------------------------------------------------ learning & metrics
@app.get("/api/metrics")
def metrics(split: str = Query("test", pattern="^(test|hard)$"), recompute: bool = False, db=Depends(get_db)):
    mv = active_model(db)
    if mv is None:
        raise HTTPException(409, "No trained model yet - run `npm run seed`")
    if recompute:
        with WRITE_LOCK:
            mv = learning.recompute_active(db)
    m = mv.metrics_test if split == "test" else mv.metrics_hard
    return {**m, "model_version": mv.version, "computed_at": mv.created_at.isoformat(), "label": "synthetic benchmark"}


@app.get("/api/metrics/history")
def metrics_history(db=Depends(get_db)):
    rows = db.execute(select(ModelVersion).order_by(ModelVersion.round)).scalars()
    return [{"version": m.version, "round": m.round, "kind": m.kind, "created_at": m.created_at.isoformat(),
             "n_corrections": m.n_corrections, "n_learned_terms": m.n_learned_terms, "is_active": m.is_active,
             "test": learning.summarize(m.metrics_test), "hard": learning.summarize(m.metrics_hard)} for m in rows]


@app.post("/api/retrain")
def retrain(db=Depends(get_db)):
    with WRITE_LOCK:
        mv = learning.retrain(db)
    return {"version": mv.version, "round": mv.round, "n_corrections": mv.n_corrections,
            "n_learned_terms": mv.n_learned_terms, "test": learning.summarize(mv.metrics_test),
            "hard": learning.summarize(mv.metrics_hard)}


@app.get("/api/learning/state")
def learning_state(db=Depends(get_db)):
    from .db import Correction
    from .services.core import get_setting

    cs = db.execute(select(Correction).order_by(Correction.id.desc())).scalars().all()
    return {"corrections": len(cs), "pending_corrections": sum(1 for c in cs if not c.used_in_version),
            "learned_lexicon": get_setting(db, "learned_lexicon", {}),
            "recent": [{"id": c.id, "text": c.text, "kind": c.kind, "predicted": c.predicted_activity_id,
                        "correct": c.correct_activity_id, "by": c.created_by, "used_in": c.used_in_version}
                       for c in cs[:20]]}


# ------------------------------------------------------------------ export
@app.get("/api/export/schedule.csv")
def export_csv(db=Depends(get_db)):
    return Response(schedule_io.export_csv(db), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=karyalink_schedule_actuals.csv"})


@app.get("/api/export/schedule.xml")
def export_xml(db=Depends(get_db)):
    return Response(schedule_io.export_mspdi(db), media_type="application/xml",
                    headers={"Content-Disposition": "attachment; filename=karyalink_schedule_mspdi.xml"})


@app.get("/api/export/actuals.csv")
def export_actuals(db=Depends(get_db)):
    return Response(schedule_io.export_actuals_dataset(db), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=karyalink_actuals_dataset.csv"})


# ------------------------------------------------------------------ audit
@app.get("/api/audit")
def audit(limit: int = 50, offset: int = 0, kind: str | None = None, report_id: int | None = None,
          db=Depends(get_db)):
    stmt = select(LedgerEntry)
    if kind:
        stmt = stmt.where(LedgerEntry.kind == kind)
    if report_id:
        stmt = stmt.where(LedgerEntry.report_id == report_id)
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = db.execute(stmt.order_by(LedgerEntry.seq.desc()).offset(offset).limit(min(limit, 200))).scalars()
    kinds = [k for (k,) in db.execute(select(LedgerEntry.kind).distinct()).all()]
    return {"total": total, "kinds": sorted(kinds), "items": [
        {"seq": e.seq, "ts": e.ts, "kind": e.kind, "report_id": e.report_id, "activity_id": e.activity_id,
         "actor": e.actor, "payload": e.payload, "prev_hash": e.prev_hash, "hash": e.hash} for e in rows]}


@app.get("/api/audit/verify")
def audit_verify(db=Depends(get_db)):
    return {**ledger.verify(db), "checked_at": datetime.now(timezone.utc).isoformat()}


# ------------------------------------------------------------------ photos
@app.post("/api/photos")
async def upload_photo(file: UploadFile = File(...), lat: float | None = Form(None), lon: float | None = Form(None),
                       db=Depends(get_db)):
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty photo")
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "Photo too large (max 10 MB)")
    ctype = file.content_type or "application/octet-stream"
    if not ctype.startswith("image/"):
        raise HTTPException(400, "Only image files can be attached as photo evidence")
    sha = hashlib.sha256(raw).hexdigest()
    ext = {"image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}.get(ctype, ".jpg")
    path = config.PHOTO_DIR / f"{sha[:24]}{ext}"
    path.write_bytes(raw)
    with WRITE_LOCK:
        p = Photo(filename=path.name, content_type=ctype, sha256=sha, lat=lat, lon=lon)
        db.add(p)
        db.flush()
    return {"id": p.id, "sha256": sha, "taken_at": p.taken_at.isoformat(), "lat": lat, "lon": lon,
            "url": f"/api/photos/{p.id}"}


@app.get("/api/photos/{photo_id}")
def get_photo(photo_id: int, db=Depends(get_db)):
    p = db.get(Photo, photo_id)
    if not p or not (config.PHOTO_DIR / p.filename).exists():
        raise HTTPException(404, "Photo not found")
    return FileResponse(config.PHOTO_DIR / p.filename, media_type=p.content_type)


# ------------------------------------------------------------------ assistant
class ChatIn(BaseModel):
    session_id: str = Field(min_length=1, max_length=80)
    text: str = Field(default="", max_length=2000)
    lang: str = "en-IN"
    reporter: str = "Site supervisor"
    discipline: str | None = None
    photo_id: int | None = None
    channel: str = "chat"


@app.post("/api/assistant/message")
def chat(body: ChatIn, db=Depends(get_db)):
    with WRITE_LOCK:
        msgs = assistant.message(db, body.session_id, body.text, body.lang, body.reporter, body.discipline,
                                 body.photo_id, body.channel if body.channel in ("chat", "voice") else "chat")
    return {"messages": msgs}


class ChatAnswerIn(BaseModel):
    session_id: str
    value: str
    lang: str = "en-IN"
    reporter: str = "Site supervisor"
    label: str | None = None


@app.post("/api/assistant/answer")
def chat_answer(body: ChatAnswerIn, db=Depends(get_db)):
    with WRITE_LOCK:
        msgs = assistant.answer(db, body.session_id, body.value, body.lang, body.reporter, body.label)
    return {"messages": msgs}


@app.post("/api/assistant/upload")
async def chat_upload(file: UploadFile = File(...), session_id: str = Form(...), lang: str = Form("en-IN"),
                      reporter: str = Form("Site supervisor"), discipline: str | None = Form(None),
                      photo_id: int | None = Form(None), db=Depends(get_db)):
    raw = await file.read()
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "File too large (max 10 MB)")
    with WRITE_LOCK:
        msgs = assistant.upload(db, session_id, raw, file.filename or "upload", lang, reporter, discipline, photo_id)
    return {"messages": msgs}


@app.delete("/api/assistant/history/{session_id}")
def chat_clear(session_id: str, db=Depends(get_db)):
    with WRITE_LOCK:
        assistant.clear_history(db, session_id)
    return {"ok": True}


class EodIn(BaseModel):
    session_id: str
    lang: str = "en-IN"
    reporter: str = "Site supervisor"
    discipline: str | None = None


@app.post("/api/assistant/end-of-day")
def end_of_day(body: EodIn, db=Depends(get_db)):
    with WRITE_LOCK:
        msgs = assistant.end_of_day(db, body.session_id, body.lang, body.reporter, body.discipline)
    return {"messages": msgs}


@app.get("/api/assistant/history/{session_id}")
def chat_history(session_id: str, db=Depends(get_db)):
    return assistant.history(db, session_id)


# ------------------------------------------------------------------ institutional memory
class AskIn(BaseModel):
    question: str = Field(default="", max_length=300)


@app.post("/api/memory/ask")
def memory_ask(body: AskIn, db=Depends(get_db)):
    return memory.ask(db, body.question)


# ------------------------------------------------------------------ demo
@app.post("/api/demo/reset")
def demo_reset():
    from .services.seeding import seed

    with WRITE_LOCK:
        with _ACTIVE_COND:
            RESETTING.set()
            _ACTIVE_COND.wait_for(lambda: _ACTIVE == 0, timeout=30)  # drain in-flight requests
        try:
            return seed(regenerate=False, verbose=False)
        finally:
            RESETTING.clear()


@app.get("/api/demo/script")
def demo_script(db=Depends(get_db)):
    return demo.build_script(db)


class BatchIn(BaseModel):
    n: int = Field(default=25, ge=1, le=200)


@app.post("/api/demo/planner-batch")
def demo_batch(body: BatchIn, db=Depends(get_db)):
    with WRITE_LOCK:
        return demo.planner_batch(db, body.n)


SAMPLES = {"daily_report_EI_civil.txt": "text/plain", "piping_daily_progress.csv": "text/csv",
           "piping_daily_progress.xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
           "schedule.csv": "text/csv"}


@app.get("/api/samples/{name}")
def sample(name: str):
    if name not in SAMPLES:
        raise HTTPException(404, "Unknown sample")
    path = (config.DATA_DIR / name) if name == "schedule.csv" else (config.SAMPLES_DIR / name)
    if not path.exists():
        raise HTTPException(404, "Sample not generated yet - run `npm run seed`")
    return FileResponse(path, media_type=SAMPLES[name], filename=name)


@app.get("/api/assistant/context/{session_id}")
def chat_context(session_id: str, discipline: str | None = None, db=Depends(get_db)):
    return assistant.context(db, session_id, discipline)


# ------------------------------------------------------------------ built frontend (optional, production mode)
_dist = Path(config.ROOT) / "frontend" / "dist"
if _dist.exists():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404)
        f = _dist / path
        return FileResponse(f if f.is_file() else _dist / "index.html")
