"""Shared service plumbing: settings, live state provider, cached engine."""
from __future__ import annotations

import threading
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import config
from ..db import Activity, ModelVersion, Setting
from ..engine.pipeline import Engine
from ..engine.scorer import Scorer

ENGINE_FIELDS = ("activity_id", "name", "discipline", "area", "area_name", "wbs_code", "parent_wbs", "level", "tag",
                 "tag_type", "phase", "planned_start", "planned_finish", "duration", "quantity", "unit", "weight",
                 "credit_method", "predecessors")


def get_setting(db: Session, key: str, default):
    s = db.get(Setting, key)
    return s.value if s is not None else default


def set_setting(db: Session, key: str, value) -> None:
    s = db.get(Setting, key)
    if s is None:
        db.add(Setting(key=key, value=value))
    else:
        s.value = value


def thresholds(db: Session) -> dict:
    return {**config.DEFAULT_THRESHOLDS, **get_setting(db, "thresholds", {})}


def project_today(db: Session) -> str:
    return get_setting(db, "data_date", {"value": config.DATA_DATE.isoformat()})["value"]


def activity_state(a: Activity) -> dict:
    return {"pct": a.pct, "started": a.actual_start is not None, "finished": a.actual_finish is not None,
            "last_update": a.last_update, "qty_done": a.qty_done}


class DbState:
    """Current actuals from the database (a live system only knows the present)."""

    def __init__(self, db: Session):
        self._s = {a.activity_id: activity_state(a) for a in db.execute(select(Activity)).scalars()}

    def get(self, activity_id: str, as_of: str | None = None) -> dict:
        return self._s.get(activity_id, {"pct": 0.0, "started": False, "finished": False, "last_update": None,
                                         "qty_done": 0.0})

    def snapshot(self, ids) -> dict:
        return {i: self.get(i) for i in ids}


class SnapshotState:
    """Frozen state captured at decision time (used to rebuild correction features for retraining)."""

    def __init__(self, snap: dict, fallback):
        self.snap, self.fallback = snap, fallback

    def get(self, activity_id: str, as_of: str | None = None) -> dict:
        return self.snap.get(activity_id) or self.fallback.get(activity_id, as_of)


class _Holder:
    def __init__(self):
        self.engine: Engine | None = None
        self.lock = threading.RLock()


_holder = _Holder()


def active_model(db: Session) -> ModelVersion | None:
    return db.execute(select(ModelVersion).where(ModelVersion.is_active.is_(True))).scalar_one_or_none()


def build_engine(db: Session, scorer: Scorer | None = None) -> Engine:
    acts = [{k: getattr(a, k) for k in ENGINE_FIELDS} for a in db.execute(select(Activity)).scalars()]
    if scorer is None:
        mv = active_model(db)
        if mv and mv.path and Path(mv.path).exists():
            scorer = Scorer.load(Path(mv.path))
    return Engine(acts, scorer, thresholds(db), aliases=get_setting(db, "aliases", {}),
                  learned=get_setting(db, "learned_lexicon", {}), use_llm=True)


def get_engine(db: Session) -> Engine:
    with _holder.lock:
        if _holder.engine is None:
            _holder.engine = build_engine(db)
        return _holder.engine


def invalidate_engine() -> None:
    with _holder.lock:
        _holder.engine = None
