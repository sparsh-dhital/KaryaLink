"""Scorer calibration, decision policy, rules of credit, sequence checks, LLM evidence guard."""
from datetime import date

import numpy as np

from sitesync.engine import policy, rollup
from sitesync.engine.scorer import Scorer

TH = {"auto_apply": 0.8, "review": 0.3, "margin": 0.1, "clarify_gap": 0.25}


def _cand(aid, conf, tag="F-11", phase="pour", name="Concrete pouring foundation F-11"):
    return {"activity_id": aid, "confidence": conf,
            "activity": {"activity_id": aid, "tag": tag, "phase": phase, "name": name}}


def _ext(status="complete"):
    return {"text": "F-11 pour done", "status": {"value": status} if status else None, "phase": {"value": "pour"}}


# ---------------------------------------------------------------- scorer
def test_scorer_outputs_calibrated_probabilities_and_roundtrips(tmp_path):
    rng = np.random.default_rng(0)
    n = 1200
    X = rng.random((n, 17))
    logit = 6 * X[:, 0] + 3 * X[:, 5] - 5
    y = (rng.random(n) < 1 / (1 + np.exp(-logit))).astype(int)
    s = Scorer().fit(X, y, "t1")
    p, raw = s.predict(X)
    assert p.min() >= 0 and p.max() <= 1
    # calibration: mean predicted probability close to observed positive rate
    assert abs(p.mean() - y.mean()) < 0.03
    # higher raw score -> not lower calibrated probability on average (monotone isotonic mapping)
    hi, lo = p[raw > np.median(raw)].mean(), p[raw <= np.median(raw)].mean()
    assert hi > lo
    s.save(tmp_path / "m.pkl")
    s2 = Scorer.load(tmp_path / "m.pkl")
    assert np.allclose(s2.predict(X)[0], p) and s2.version == "t1"


# ---------------------------------------------------------------- policy
def test_policy_auto_apply():
    d = policy.decide(_ext(), [_cand("A", 0.95), _cand("B", 0.2, tag="F-12")], [], TH, "P")
    assert d["kind"] == policy.AUTO_APPLY and d["activity_id"] == "A"


def test_policy_clarify_between_close_candidates():
    d = policy.decide(_ext(), [_cand("A", 0.55), _cand("B", 0.5, tag="F-12")], [], TH, "P")
    assert d["kind"] == policy.CLARIFY
    assert "F-11" in d["question"] and "F-12" in d["question"]
    assert [o["value"] for o in d["options"]] == ["A", "B", "none"]


def test_policy_review_when_middling_but_not_ambiguous():
    d = policy.decide(_ext(), [_cand("A", 0.6), _cand("B", 0.05)], [], TH, "P")
    assert d["kind"] == policy.REVIEW


def test_policy_new_activity_when_nothing_fits():
    d = policy.decide(_ext(), [_cand("A", 0.1)], [], TH, "GGS7.U100.CIV.FND")
    assert d["kind"] == policy.NEW_ACTIVITY and d["proposal"]["parent_wbs"] == "GGS7.U100.CIV.FND"
    assert policy.decide(_ext(), [], [], TH, None)["kind"] == policy.NEW_ACTIVITY  # never dropped


def test_policy_sequence_warning_requires_confirmation():
    w = [{"type": "predecessor_incomplete", "message": "pred open", "message_hi": "pred open"}]
    d = policy.decide(_ext(), [_cand("A", 0.95)], w, TH, "P")
    assert d["kind"] == policy.CONFIRM_SEQUENCE and d["options"][0]["value"] == "confirm"


def test_policy_asks_status_when_missing():
    d = policy.decide(_ext(status=None), [_cand("A", 0.95), _cand("B", 0.1)], [], TH, "P")
    assert d["kind"] == policy.CLARIFY and d["clarify_type"] == "status"


# ---------------------------------------------------------------- rules of credit
ACT = {"quantity": 12.0, "unit": "spools", "credit_method": "quantity"}
EMPTY = {"pct": 0.0, "qty_done": 0.0, "actual_start": None, "actual_finish": None}


def test_three_of_twelve_is_25_percent_and_sets_actual_start():
    out = rollup.apply_event(ACT, EMPTY, "progress", {"value": 3, "total": 12, "mode": "cumulative"}, "2026-09-29")
    assert out["state"]["pct"] == 25.0 and out["state"]["actual_start"] == "2026-09-29"
    assert out["state"]["actual_finish"] is None


def test_started_sets_actual_start_without_progress():
    out = rollup.apply_event(ACT, EMPTY, "start", None, "2026-09-20")
    assert out["state"]["actual_start"] == "2026-09-20" and out["state"]["pct"] == 0.0


def test_incremental_and_complete():
    s1 = rollup.apply_event(ACT, EMPTY, "progress", {"value": 3, "total": None, "mode": "incremental"}, "2026-09-20")["state"]
    s2 = rollup.apply_event(ACT, s1, "progress", {"value": 3, "total": None, "mode": "incremental"}, "2026-09-21")["state"]
    assert s2["pct"] == 50.0
    s3 = rollup.apply_event(ACT, s2, "complete", None, "2026-09-25")["state"]
    assert s3["pct"] == 100.0 and s3["actual_finish"] == "2026-09-25" and s3["actual_start"] == "2026-09-20"


def test_milestone_rule_is_0_or_100():
    m = {"quantity": 1.0, "unit": "test pack", "credit_method": "milestone"}
    assert rollup.apply_event(m, EMPTY, "progress", None, "2026-09-20")["state"]["pct"] == 0.0
    assert rollup.apply_event(m, EMPTY, "complete", None, "2026-09-20")["state"]["pct"] == 100.0


def test_rollup_weights_steps_by_rules_of_credit():
    acts = [
        {"activity_id": "a", "level": 6, "parent_wbs": "L5", "duration": 10, "weight": 0.3, "planned_start": "2026-01-01", "planned_finish": "2026-01-10"},
        {"activity_id": "b", "level": 6, "parent_wbs": "L5", "duration": 10, "weight": 0.7, "planned_start": "2026-01-11", "planned_finish": "2026-01-20"},
    ]
    wbs = [{"code": "L1", "parent": None}, {"code": "L5", "parent": "L1"}]
    r = rollup.rollup(acts, wbs, {"a": 100.0, "b": 0.0}, date(2026, 1, 10))
    assert r["L5"]["actual_pct"] == 30.0 and r["L1"]["actual_pct"] == 30.0
    assert r["L5"]["planned_pct"] == 30.0


# ---------------------------------------------------------------- LLM evidence guard
def test_llm_fields_without_evidence_are_rejected(monkeypatch):
    from sitesync import config
    from sitesync.engine import llm
    from sitesync.engine.extractor import extract

    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(llm, "available", lambda: True)
    monkeypatch.setattr(llm, "_call", lambda text: {
        "phase": {"value": "welding", "evidence": "welding"},        # NOT in text -> reject
        "status": {"value": "complete", "evidence": "ho gaya"},       # in text -> accept
        "tag": {"value": "F-99", "evidence": "F-99"},                 # NOT in text -> reject
        "area": {"value": None, "evidence": None},
    })
    ext = extract("sab kaam ho gaya", date(2026, 9, 29))
    ext["status"] = None
    out = llm.enrich(ext)
    assert out["status"]["value"] == "complete" and out["status"]["source"] == "llm"
    assert out["phase"] is None and out["tags"] == []
    assert {r["field"] for r in out["llm_rejected"]} == {"phase", "tag"}
