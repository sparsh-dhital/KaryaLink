"""Seed / reset the demo database from the synthetic dataset."""
from __future__ import annotations

import hashlib
import json
import logging
import shutil
import time

from sqlalchemy import select

from .. import config, ledger
from ..db import Activity, ActualEvent, Report, SessionLocal, WbsNode, init_db
from ..engine import benchmark
from ..seed.dataset import build_dataset
from . import learning
from . import reports as R
from .core import invalidate_engine, set_setting

log = logging.getLogger("sitesync.seed")


def seed(regenerate: bool = True, verbose: bool = True) -> dict:
    t0 = time.time()
    say = print if verbose else log.info
    config.ensure_dirs()
    if regenerate or not (config.DATA_DIR / "schedule.json").exists():
        stats = build_dataset()
        say(f"[seed] synthetic dataset: {stats}")
    else:
        stats = {"regenerated": False}
    learning.reset_cache()
    invalidate_engine()
    init_db(drop=True)
    for p in config.PHOTO_DIR.glob("*"):
        if p.is_file():
            p.unlink()
    for p in config.MODEL_DIR.glob("scorer_*.pkl"):
        p.unlink()

    sched = benchmark.load_schedule()
    labels = benchmark.load_labels()
    backlog = benchmark.load_reports("backlog")
    backlog_events = {labels[r["report_id"]].get("truth_event_id") for r in backlog}
    truth = json.loads((config.DATA_DIR / "truth_events.json").read_text(encoding="utf-8"))

    with SessionLocal() as db:
        set_setting(db, "data_date", {"value": config.DATA_DATE.isoformat()})
        set_setting(db, "thresholds", dict(config.DEFAULT_THRESHOLDS))
        set_setting(db, "learned_lexicon", {})
        set_setting(db, "aliases", {})
        for n in sched["wbs"]:
            db.add(WbsNode(**n))
        for a in sched["activities"]:
            db.add(Activity(**a))
        db.flush()
        raw = (config.DATA_DIR / "schedule.csv").read_bytes()
        ledger.append(db, "SCHEDULE_IMPORTED", {"source": "synthetic schedule.csv", "activities": len(sched["activities"]),
                                                "wbs_nodes": len(sched["wbs"]), "sha256": hashlib.sha256(raw).hexdigest()},
                      actor="seed")

        # historical actuals (everything except the not-yet-reconciled backlog)
        acts = {a.activity_id: a for a in db.execute(select(Activity)).scalars()}
        # an activity's history stops at its first not-yet-reconciled (backlog) event
        cutoff: dict[str, str] = {}
        for e in truth:
            if e["event_id"] in backlog_events:
                cutoff[e["activity_id"]] = min(cutoff.get(e["activity_id"], e["date"]), e["date"])
        hist = [e for e in truth if e["event_id"] not in backlog_events
                and e["date"] < cutoff.get(e["activity_id"], "9999")]
        for e in hist:
            a = acts[e["activity_id"]]
            before = a.pct
            a.actual_start = a.actual_start or e["date"]
            a.pct, a.qty_done, a.last_update = e["pct"], e["qty_done"], e["date"]
            if e["event"] == "complete":
                a.actual_finish = e["date"]
            db.add(ActualEvent(activity_id=a.activity_id, event=e["event"], event_date=e["date"], qty_value=e["qty_done"],
                               qty_mode="cumulative", pct_before=before, pct_after=a.pct, qty_after=a.qty_done,
                               credit_note="historical import", confidence=1.0,
                               approver="historical import (synthetic)", source="historical-seed"))
        digest = hashlib.sha256(json.dumps(hist, sort_keys=True).encode()).hexdigest()
        ledger.append(db, "HISTORICAL_IMPORT", {"events": len(hist), "sha256": digest,
                                                "note": "synthetic ground-truth history up to data date, excluding backlog"},
                      actor="seed")
        db.commit()

        mv = learning.train_initial(db)
        db.commit()
        say(f"[seed] trained {mv.version}: test top-1 {mv.metrics_test['top1_accuracy']:.3f}, "
            f"hard top-1 {mv.metrics_hard['top1_accuracy']:.3f} (synthetic benchmark)")

        # backlog: recent reports processed by the engine -> auto-applied or queued for review
        for r in backlog:
            rep = R.submit_report(db, r["text"], reporter=r["reporter"], reporter_discipline=r.get("reporter_discipline"),
                                  channel=r["channel"], report_date=r["report_date"], external_id=r["report_id"])
            if rep.status == "awaiting_supervisor":
                rep.status = "awaiting_planner"  # historical: nobody is in a live chat for these
        db.commit()
        counts = {}
        for (st,) in db.execute(select(Report.status)).all():
            counts[st] = counts.get(st, 0) + 1
        say(f"[seed] backlog processed: {counts}")
    say(f"[seed] done in {time.time() - t0:.1f}s -> {config.DB_PATH}")
    return {"dataset": stats, "backlog": counts, "model": mv.version}


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="Seed the SiteSync demo database")
    ap.add_argument("--keep-data", action="store_true", help="reuse existing synthetic files")
    args = ap.parse_args()
    seed(regenerate=not args.keep_data)


if __name__ == "__main__":
    main()
