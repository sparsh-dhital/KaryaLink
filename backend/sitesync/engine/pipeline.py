"""End-to-end engine: extract -> candidates -> features -> calibrated score -> sequence check -> decision."""
from __future__ import annotations

from datetime import date

import numpy as np

from . import llm, policy, sequence
from .candidates import ScheduleIndex
from .extractor import evidence_spans, extract
from .features import FEATURE_NAMES, compute
from .scorer import Scorer

ACTIVITY_PUBLIC = ("activity_id", "name", "discipline", "area", "tag", "tag_type", "phase", "planned_start",
                   "planned_finish", "quantity", "unit", "parent_wbs", "level", "credit_method")


def l4_of(a: dict) -> str:
    return a["parent_wbs"].rsplit(".", 1)[0]


class Engine:
    def __init__(self, activities: list[dict], scorer: Scorer | None, thresholds: dict,
                 aliases: dict[str, list[str]] | None = None, learned: dict[str, str] | None = None,
                 use_llm: bool = True):
        self.activities = activities
        self.scorer = scorer or Scorer()
        self.thresholds = dict(thresholds)
        self.learned = dict(learned or {})
        self.use_llm = use_llm
        self.index = ScheduleIndex(activities, aliases)
        self.by_id = self.index.by_id
        self.l4: dict[tuple[str, str], str] = {}
        for a in activities:
            self.l4.setdefault((a["area"], a["discipline"]), l4_of(a))

    # ------------------------------------------------------------------
    def featurize(self, text: str, report_date: date, reporter_discipline: str | None, state,
                  as_of: str | None = None, force_ids: list[str] | None = None):
        ext = extract(text, report_date, reporter_discipline, self.learned)
        if self.use_llm:
            ext = llm.enrich(ext)
        as_of = as_of or report_date.isoformat()
        prior = self.index.prior(state, as_of, date.fromisoformat(ext["date"]["value"]))
        cands = self.index.candidates(ext, k=5, prior=prior)
        for fid in force_ids or []:
            if fid in self.by_id and fid not in {c.activity_id for c in cands}:
                cands.append(self.index.candidate_for(ext, fid))
        X, reasons = [], []
        for r, c in enumerate(cands):
            x, why = compute(ext, self.by_id[c.activity_id], c, r, state, as_of, self.by_id)
            X.append(x)
            reasons.append(why)
        return ext, cands, np.array(X, dtype=float).reshape(-1, len(FEATURE_NAMES)), reasons

    def analyze(self, text: str, report_date: date, reporter_discipline: str | None, state,
                as_of: str | None = None) -> dict:
        as_of = as_of or report_date.isoformat()
        ext, cands, X, reasons = self.featurize(text, report_date, reporter_discipline, state, as_of)
        probs, raw = self.scorer.predict(X)
        order = sorted(range(len(cands)), key=lambda i: (-probs[i], -raw[i]))
        out = []
        for i in order:
            a = self.by_id[cands[i].activity_id]
            out.append({
                "activity_id": a["activity_id"],
                "activity": {k: a[k] for k in ACTIVITY_PUBLIC},
                "confidence": round(float(probs[i]), 4),
                "raw_score": round(float(raw[i]), 4),
                "features": {n: round(float(v), 4) for n, v in zip(FEATURE_NAMES, X[i])},
                "reasons": reasons[i],
            })
        warnings = sequence.check(ext, self.by_id[out[0]["activity_id"]], state, as_of, self.by_id) if out else []
        disc = (ext.get("discipline") or {}).get("value")
        area = (ext.get("area") or {}).get("value")
        parent = self.l4.get((area, disc)) if disc and area else None
        if parent is None and out:
            parent = l4_of(self.by_id[out[0]["activity_id"]])
        decision = policy.decide(ext, out, warnings if out and out[0]["confidence"] >= self.thresholds["review"] else [],
                                 self.thresholds, parent)
        return {
            "extraction": ext,
            "evidence_spans": evidence_spans(ext),
            "candidates": out,
            "warnings": warnings,
            "decision": decision,
            "model_version": self.scorer.version,
        }
