"""Logistic-regression scorer with isotonic calibration -> confidence is a probability."""
from __future__ import annotations

import pickle
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.linear_model import LogisticRegression

from .features import FEATURE_NAMES


class Scorer:
    def __init__(self):
        self.model: CalibratedClassifierCV | None = None
        self.raw: LogisticRegression | None = None
        self.version = "untrained"
        self.meta: dict = {}

    def fit(self, X: np.ndarray, y: np.ndarray, version: str, meta: dict | None = None) -> "Scorer":
        base = LogisticRegression(max_iter=3000, C=1.0, class_weight=None)
        self.model = CalibratedClassifierCV(base, method="isotonic", cv=5)
        self.model.fit(X, y)
        self.raw = LogisticRegression(max_iter=3000, C=1.0).fit(X, y)
        self.version = version
        self.meta = {"trained_at": datetime.now(timezone.utc).isoformat(), "n_rows": int(len(y)),
                     "n_pos": int(y.sum()), "features": FEATURE_NAMES, **(meta or {})}
        return self

    def predict(self, X: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Returns (calibrated probability, raw decision score for tie-breaking)."""
        if self.model is None or len(X) == 0:
            return np.zeros(len(X)), np.zeros(len(X))
        X = np.asarray(X, dtype=float)
        return self.model.predict_proba(X)[:, 1], self.raw.decision_function(X)

    def coefficients(self) -> dict[str, float]:
        if self.raw is None:
            return {}
        return {n: round(float(c), 3) for n, c in zip(FEATURE_NAMES, self.raw.coef_[0])}

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as f:
            pickle.dump({"model": self.model, "raw": self.raw, "version": self.version, "meta": self.meta}, f)

    @classmethod
    def load(cls, path: Path) -> "Scorer":
        s = cls()
        with open(path, "rb") as f:
            d = pickle.load(f)
        s.model, s.raw, s.version, s.meta = d["model"], d["raw"], d["version"], d["meta"]
        return s
