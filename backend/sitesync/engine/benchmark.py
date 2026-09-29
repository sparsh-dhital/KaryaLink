"""Training + evaluation on the synthetic benchmark splits. All numbers are computed, never hard-coded."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import numpy as np

from ..config import DATA_DIR
from ..seed.actuals import TruthEvent, TruthState
from . import policy
from .features import FEATURE_NAMES
from .pipeline import Engine
from .scorer import Scorer


def load_reports(split: str, data_dir: Path = DATA_DIR) -> list[dict]:
    with open(data_dir / "reports" / f"{split}.jsonl", encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


def load_labels(data_dir: Path = DATA_DIR) -> dict:
    return json.loads((data_dir / "labels.json").read_text(encoding="utf-8"))


def load_schedule(data_dir: Path = DATA_DIR) -> dict:
    return json.loads((data_dir / "schedule.json").read_text(encoding="utf-8"))


def load_truth(data_dir: Path = DATA_DIR) -> TruthState:
    evs = json.loads((data_dir / "truth_events.json").read_text(encoding="utf-8"))
    return TruthState([TruthEvent(**e) for e in evs])


def _view(ts: TruthState, lab: dict):
    return ts.view(lab.get("truth_event_id"))


def build_rows(engine: Engine, reports: list[dict], labels: dict, ts: TruthState):
    Xs, ys = [], []
    for r in reports:
        lab = labels[r["report_id"]]
        _, cands, X, _ = engine.featurize(r["text"], date.fromisoformat(r["report_date"]),
                                          r.get("reporter_discipline"), _view(ts, lab))
        if len(cands) == 0:
            continue
        Xs.append(X)
        ys.append(np.array([1 if c.activity_id == lab["activity_id"] else 0 for c in cands]))
    return np.vstack(Xs), np.concatenate(ys)


def train(engine: Engine, reports: list[dict], labels: dict, ts: TruthState, version: str,
          extra: tuple[np.ndarray, np.ndarray] | None = None, meta: dict | None = None) -> Scorer:
    X, y = build_rows(engine, reports, labels, ts)
    n_corr = 0
    if extra is not None and len(extra[1]):
        X, y = np.vstack([X, extra[0]]), np.concatenate([y, extra[1]])
        n_corr = int(len(extra[1]))
    return Scorer().fit(X, y, version, {"train_reports": len(reports), "correction_rows": n_corr, **(meta or {})})


def evaluate(engine: Engine, reports: list[dict], labels: dict, ts: TruthState, split: str) -> dict:
    t_auto = engine.thresholds["auto_apply"]
    rows = []
    for r in reports:
        lab = labels[r["report_id"]]
        res = engine.analyze(r["text"], date.fromisoformat(r["report_date"]), r.get("reporter_discipline"),
                             _view(ts, lab))
        cands = res["candidates"]
        ids = [c["activity_id"] for c in cands]
        ext = res["extraction"]
        rows.append({
            "report_id": r["report_id"], "text": r["text"], "truth": lab["activity_id"], "is_new": lab["is_new"],
            "truth_disc": lab["discipline"], "top_ids": ids, "p1": cands[0]["confidence"] if cands else 0.0,
            "pred_disc": cands[0]["activity"]["discipline"] if cands else None,
            "decision": res["decision"]["kind"], "decided_id": res["decision"].get("activity_id"),
            "event_pred": (ext.get("status") or {}).get("value"), "event_true": lab["event"],
            "date_pred": ext["date"]["value"], "date_true": lab["event_date"],
        })
    planned = [x for x in rows if not x["is_new"]]
    new = [x for x in rows if x["is_new"]]

    def correct(x):  # the system's final top-1 is right
        return (not x["is_new"]) and x["top_ids"][:1] == [x["truth"]]

    top1 = np.mean([correct(x) for x in planned]) if planned else 0.0
    top3 = np.mean([x["truth"] in x["top_ids"][:3] for x in planned]) if planned else 0.0
    top5 = np.mean([x["truth"] in x["top_ids"][:5] for x in planned]) if planned else 0.0
    auto = [x for x in rows if x["decision"] == policy.AUTO_APPLY]
    prec_auto = np.mean([x["decided_id"] == x["truth"] and not x["is_new"] for x in auto]) if auto else None
    new_dec = [x for x in rows if x["decision"] == policy.NEW_ACTIVITY]
    new_recall = np.mean([x["decision"] == policy.NEW_ACTIVITY for x in new]) if new else None
    new_prec = np.mean([x["is_new"] for x in new_dec]) if new_dec else None

    curve = []
    for t in np.round(np.arange(0.0, 1.0001, 0.02), 2):
        sel = [x for x in rows if x["p1"] >= t]
        curve.append({"threshold": float(t), "coverage": len(sel) / len(rows),
                      "precision": float(np.mean([correct(x) for x in sel])) if sel else None})

    bins = []
    for lo in np.arange(0, 1.0, 0.1):
        sel = [x for x in rows if lo <= x["p1"] < lo + 0.1 or (lo >= 0.9 and x["p1"] == 1.0)]
        if sel:
            bins.append({"bin": f"{lo:.1f}-{lo + 0.1:.1f}", "mean_conf": float(np.mean([x["p1"] for x in sel])),
                         "accuracy": float(np.mean([correct(x) for x in sel])), "n": len(sel)})

    discs = ["CIV", "PIP", "ELE", "INS", "MEC", "HSE", "NEW"]
    conf = {d: {e: 0 for e in discs} for d in discs}
    for x in rows:
        tr = "NEW" if x["is_new"] else x["truth_disc"]
        pr = "NEW" if x["decision"] == policy.NEW_ACTIVITY or not x["pred_disc"] else x["pred_disc"]
        conf[tr][pr] += 1
    per_disc = {}
    for d in discs[:-1]:
        sel = [x for x in planned if x["truth_disc"] == d]
        if sel:
            per_disc[d] = {"n": len(sel), "top1": float(np.mean([correct(x) for x in sel]))}

    ev = [x for x in planned if x["event_pred"]]
    decisions = {k: sum(1 for x in rows if x["decision"] == k) for k in policy.DECISIONS}
    errors = [{"report_id": x["report_id"], "text": x["text"], "truth": x["truth"] or "NEW",
               "predicted": x["top_ids"][0] if x["top_ids"] else None, "confidence": x["p1"],
               "decision": x["decision"]}
              for x in rows if not correct(x) and not (x["is_new"] and x["decision"] == policy.NEW_ACTIVITY)][:12]
    return {
        "split": split, "n": len(rows), "n_planned": len(planned), "n_new": len(new),
        "top1_accuracy": float(top1), "top3_recall": float(top3), "top5_recall": float(top5),
        "auto_apply_threshold": t_auto,
        "precision_at_auto": None if prec_auto is None else float(prec_auto),
        "coverage_auto": len(auto) / len(rows) if rows else 0.0,
        "new_activity_recall": None if new_recall is None else float(new_recall),
        "new_activity_precision": None if new_prec is None else float(new_prec),
        "event_type_accuracy": float(np.mean([x["event_pred"] == x["event_true"] for x in ev])) if ev else None,
        "event_type_extracted": len(ev) / len(planned) if planned else 0.0,
        "date_accuracy": float(np.mean([x["date_pred"] == x["date_true"] for x in planned])) if planned else None,
        "decisions": decisions, "curve": curve, "calibration": bins, "confusion": conf, "per_discipline": per_disc,
        "errors": errors, "model_version": engine.scorer.version, "feature_names": FEATURE_NAMES,
        "label": "synthetic benchmark",
    }
