"""Visible learning loop: corrections -> learned lexicon/aliases -> retrain -> re-evaluate on held-out sets."""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import date

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import config, ledger
from ..db import Correction, ModelVersion
from ..engine import benchmark
from ..engine import lexicon as L
from ..engine.extractor import extract
from ..engine.features import FEATURE_NAMES
from ..engine.scorer import Scorer
from .core import DbState, SnapshotState, build_engine, get_setting, invalidate_engine, set_setting

STOP = {"sir", "bhai", "team", "update", "status", "note", "please", "pls", "thx", "thanks", "today", "yesterday",
        "done", "with", "from", "that", "this", "unit", "area", "line", "hai", "kiya", "gaya", "hua", "raha", "kaam",
        "aaj", "kal", "namaste", "daily", "work", "site", "more", "added", "also", "some", "near", "wala", "wali",
        "karo", "kar", "diya", "liye", "tray", "cable", "spool", "spools", "joint", "joints", "foundation", "pipe",
        "nos", "meter", "mtr", "total", "fully", "start", "shuru", "chalu", "jaari", "pura", "khatam"}
_KNOWN = re.compile("|".join(p for group in (L.PHASES, L.STATUSES, L.DISCIPLINE_CUES) for pats in group.values()
                              for p in pats) + "|" + "|".join(L.NEW_WORK_CUES))


class _Cache:
    data = None


def bench_data():
    if _Cache.data is None:
        _Cache.data = {"labels": benchmark.load_labels(), "truth": benchmark.load_truth(),
                       "train": benchmark.load_reports("train"), "test": benchmark.load_reports("test"),
                       "hard": benchmark.load_reports("hard")}
    return _Cache.data


def reset_cache() -> None:
    _Cache.data = None


class RetrievalBaseline(Scorer):
    """Round-0 reference: no trained scorer, trust the retrieval ranking (confidence = rank score)."""

    def __init__(self):
        super().__init__()
        self.version = "v0-baseline"
        self._rank = FEATURE_NAMES.index("rank")

    def predict(self, X):
        X = np.asarray(X, dtype=float)
        if len(X) == 0:
            return np.zeros(0), np.zeros(0)
        return X[:, self._rank], X[:, self._rank]


def summarize(m: dict) -> dict:
    keys = ("top1_accuracy", "top3_recall", "precision_at_auto", "coverage_auto", "new_activity_recall", "n")
    return {k: m.get(k) for k in keys}


def evaluate(eng) -> tuple[dict, dict]:
    d = bench_data()
    test = benchmark.evaluate(eng, d["test"], d["labels"], d["truth"], "test")
    hard = benchmark.evaluate(eng, d["hard"], d["labels"], d["truth"], "hard")
    return test, hard


def learn_lexicon(db: Session, eng, corrections: list[Correction]) -> dict[str, str]:
    """Terms that planners' corrections consistently tie to one phase and the rules did not know."""
    counts: dict[str, Counter] = defaultdict(Counter)
    for c in corrections:
        a = eng.by_id.get(c.correct_activity_id or "")
        if a is None:
            continue
        ext = extract(c.text, date.fromisoformat(c.report_date))
        if ext["phase"] and ext["phase"]["value"] == a["phase"]:
            continue  # rules already got the phase right
        for tok in set(re.findall(r"[a-zऀ-ॿ]{4,}", ext["norm"])):
            if tok in STOP or tok in L.NUMBER_WORDS or _KNOWN.search(tok):
                continue
            counts[tok][a["phase"]] += 1
    learned = dict(get_setting(db, "learned_lexicon", {}))
    for tok, cnt in counts.items():
        phase, n = cnt.most_common(1)[0]
        if n >= 2 and n == sum(cnt.values()):
            learned[tok] = phase
    return learned


def learn_aliases(db: Session, corrections: list[Correction]) -> dict[str, list[str]]:
    aliases = {k: list(v) for k, v in get_setting(db, "aliases", {}).items()}
    for c in corrections:
        if c.correct_activity_id and c.kind in ("reassign", "clarification") and c.predicted_activity_id != c.correct_activity_id:
            lst = aliases.setdefault(c.correct_activity_id, [])
            t = c.text.lower()[:160]
            if t not in lst:
                lst.append(t)
            aliases[c.correct_activity_id] = lst[-3:]
    return aliases


def correction_rows(db: Session, eng, corrections: list[Correction]):
    live = DbState(db)
    Xs, ys = [], []
    for c in corrections:
        state = SnapshotState(c.state_snapshot or {}, live)
        force = [c.correct_activity_id] if c.correct_activity_id else []
        _, cands, X, _ = eng.featurize(c.text, date.fromisoformat(c.report_date), c.reporter_discipline, state,
                                       force_ids=force)
        if len(cands) == 0:
            continue
        Xs.append(X)
        ys.append(np.array([1 if cd.activity_id == c.correct_activity_id else 0 for cd in cands]))
    if not Xs:
        return None
    return np.vstack(Xs), np.concatenate(ys)


def _store_version(db: Session, version: str, rnd: int, kind: str, scorer: Scorer | None, test: dict, hard: dict,
                   n_corr: int, n_terms: int, activate: bool) -> ModelVersion:
    path = None
    if scorer is not None and kind == "trained":
        p = config.MODEL_DIR / f"scorer_{version}.pkl"
        scorer.save(p)
        path = str(p)
    if activate:
        for mv in db.execute(select(ModelVersion)).scalars():
            mv.is_active = False
    mv = ModelVersion(version=version, round=rnd, kind=kind, n_corrections=n_corr, n_learned_terms=n_terms,
                      metrics_test=test, metrics_hard=hard, path=path, is_active=activate)
    db.add(mv)
    db.flush()
    return mv


def train_initial(db: Session) -> ModelVersion:
    """Round 0 (retrieval baseline) + round 1 (scorer trained on the synthetic TRAIN split)."""
    d = bench_data()
    base_eng = build_engine(db, scorer=RetrievalBaseline())
    base_eng.use_llm = False
    t0, h0 = evaluate(base_eng)
    _store_version(db, "v0-baseline", 0, "baseline", None, t0, h0, 0, 0, activate=False)
    eng = build_engine(db, scorer=Scorer())
    eng.use_llm = False
    scorer = benchmark.train(eng, d["train"], d["labels"], d["truth"], "v1")
    eng.scorer = scorer
    t1, h1 = evaluate(eng)
    mv = _store_version(db, "v1", 1, "trained", scorer, t1, h1, 0, 0, activate=True)
    ledger.append(db, "MODEL_TRAINED", {"version": "v1", "train_reports": len(d["train"]),
                                        "test": summarize(t1), "hard": summarize(h1),
                                        "coefficients": scorer.coefficients()}, actor="system")
    invalidate_engine()
    return mv


def retrain(db: Session, actor: str = "planner") -> ModelVersion:
    d = bench_data()
    corrections = list(db.execute(select(Correction).order_by(Correction.id)).scalars())
    rnd = (db.execute(select(func.max(ModelVersion.round))).scalar_one() or 0) + 1
    version = f"v{rnd}"
    # learning step 1: vocabulary + aliases from planner/supervisor corrections
    probe = build_engine(db, scorer=Scorer())
    learned = learn_lexicon(db, probe, corrections)
    aliases = learn_aliases(db, corrections)
    set_setting(db, "learned_lexicon", learned)
    set_setting(db, "aliases", aliases)
    db.flush()
    # learning step 2: retrain the scorer on TRAIN split + correction rows
    eng = build_engine(db, scorer=Scorer())
    eng.use_llm = False
    extra = correction_rows(db, eng, corrections)
    scorer = benchmark.train(eng, d["train"], d["labels"], d["truth"], version, extra=extra,
                             meta={"corrections": len(corrections)})
    eng.scorer = scorer
    test, hard = evaluate(eng)
    mv = _store_version(db, version, rnd, "trained", scorer, test, hard, len(corrections), len(learned), activate=True)
    for c in corrections:
        c.used_in_version = c.used_in_version or version
    ledger.append(db, "MODEL_RETRAINED", {"version": version, "corrections_used": len(corrections),
                                          "correction_rows": int(len(extra[1])) if extra else 0,
                                          "learned_terms": learned, "test": summarize(test), "hard": summarize(hard)},
                  actor=actor)
    invalidate_engine()
    return mv


def recompute_active(db: Session) -> ModelVersion | None:
    """Re-run the evaluation for the active model right now (e.g. after thresholds change)."""
    from .core import active_model, get_engine

    mv = active_model(db)
    if mv is None:
        return None
    eng = get_engine(db)
    use = eng.use_llm
    eng.use_llm = False
    try:
        mv.metrics_test, mv.metrics_hard = evaluate(eng)
    finally:
        eng.use_llm = use
    return mv
