"""Candidate generation: filter by tag / discipline / area / phase, then rank with TF-IDF + rapidfuzz."""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

import numpy as np
from rapidfuzz import fuzz
from sklearn.feature_extraction.text import TfidfVectorizer

from .lexicon import PHASE_LABEL

DISC_NAMES = {"CIV": "civil", "PIP": "piping", "ELE": "electrical", "INS": "instrumentation",
              "MEC": "mechanical", "HSE": "hse safety"}
TAG_FAMILY = {"foundation": "foundation", "line": "line", "line_partial": "line", "line_num": "line",
              "instrument": "instrument", "tray": "tray", "equipment": "equipment", "equipment_word": "equipment",
              "hydrant": "hydrant", "shower": "shower", "number": "number"}


def activity_keys(a: dict) -> dict:
    t, tt = a["tag"], a["tag_type"]
    k = {"full": t.upper()}
    if tt == "line":
        m = re.match(r'(\d+)"-([A-Z])-(\d+)', t)
        k.update(svcnum=f"{m.group(2)}-{m.group(3)}", num=m.group(3))
    elif tt == "instrument":
        k.update(num=t.split("-")[1], itype=t.split("-")[0])
    elif tt == "equipment":
        k.update(base=re.sub(r"[A-Z]$", "", t) if re.search(r"\d[A-Z]$", t) else t)
    return k


def tag_score(ext_tags: list[dict], a: dict, keys: dict) -> tuple[float, str | None]:
    """Best match strength between any extracted tag and the activity tag (0..1) + which tag."""
    best, which = 0.0, None
    tt = a["tag_type"]
    for t in ext_tags:
        ty, v = t["type"], t["value"].upper()
        s = 0.0
        if tt == "line":
            if ty == "line":
                s = 1.0 if v == keys["full"] else 0.8 if t["svc"] + "-" + t["num"] == keys["svcnum"] else (
                    0.45 if t["num"] == keys["num"] else 0)
            elif ty == "line_partial":
                s = 0.9 if v == keys["svcnum"] else 0.5 if t["num"] == keys["num"] else 0
            elif ty == "line_num":
                s = 0.75 if t["num"] == keys["num"] else 0
            elif ty == "number":
                s = 0.6 if t["num"] == keys["num"] else 0
            elif ty == "instrument":
                s = 0.3 if t["num"] == keys["num"] else 0
        elif tt == "instrument":
            if ty == "instrument":
                s = 1.0 if v == keys["full"] else 0.6 if t["num"] == keys["num"] else 0
            elif ty == "number":
                s = 0.6 if t["num"] == keys["num"] else 0
            elif ty in ("line", "line_partial", "line_num"):
                s = 0.3 if t["num"] == keys["num"] else 0
        elif tt == "equipment":
            if ty in ("equipment", "equipment_word"):
                s = 1.0 if v == keys["full"] else 0.9 if t["base"] == keys["base"] else 0
                if s and ty == "equipment_word":
                    s = min(s, 0.9)
        elif tt in ("foundation", "tray", "hydrant", "shower"):
            if TAG_FAMILY.get(ty) == tt:
                s = 1.0 if v == keys["full"] else 0
        if s > best:
            best, which = s, t["value"]
    return best, which


def tag_conflict(ext_tags: list[dict], a: dict, score: float) -> float:
    """1 if the report names a tag of the same family as this activity but it doesn't match."""
    if score > 0:
        return 0.0
    fam = a["tag_type"]
    for t in ext_tags:
        f = TAG_FAMILY.get(t["type"])
        if f == fam or (fam == "equipment" and f == "equipment"):
            return 1.0
    return 0.0


@dataclass
class Candidate:
    activity_id: str
    retrieval: float
    tag: float
    tag_evidence: str | None
    tfidf: float
    fuzzy: float


class ScheduleIndex:
    """Holds the schedule and retrieval structures. Rebuild after schedule import or alias learning."""

    def __init__(self, activities: list[dict], aliases: dict[str, list[str]] | None = None):
        self.activities = activities
        self.by_id = {a["activity_id"]: a for a in activities}
        self.pos = {a["activity_id"]: i for i, a in enumerate(activities)}
        self.keys = [activity_keys(a) for a in activities]
        self.aliases = aliases or {}
        self.docs = [self._doc(a) for a in activities]
        self.vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), sublinear_tf=True, min_df=1)
        self.mat = self.vec.fit_transform(self.docs)
        self.disc = np.array([a["discipline"] for a in activities])
        self.area = np.array([a["area"] for a in activities])
        self.phase = np.array([a["phase"] for a in activities])
        # successors for sequence checks
        self.succ: dict[str, list[str]] = {a["activity_id"]: [] for a in activities}
        for a in activities:
            for p in a.get("predecessors", []):
                if p in self.succ:
                    self.succ[p].append(a["activity_id"])

    def _doc(self, a: dict) -> str:
        parts = [a["name"], a["tag"], a["tag"].replace("-", ""), a["area"], a.get("area_name", ""),
                 DISC_NAMES.get(a["discipline"], ""), PHASE_LABEL.get(a["phase"], a["phase"]), a["unit"]]
        parts += self.aliases.get(a["activity_id"], [])
        return " ".join(parts).lower()

    def prior(self, state, as_of: str, on) -> np.ndarray:
        """Schedule/actuals plausibility of each activity on the event date (used for under-specified reports)."""
        out = np.zeros(len(self.activities))
        for i, a in enumerate(self.activities):
            st = state.get(a["activity_id"], as_of)
            if st["started"] and not st["finished"]:
                out[i] = 1.0
            elif st["finished"]:
                out[i] = 0.1
            else:
                ps, pf = date.fromisoformat(a["planned_start"]), date.fromisoformat(a["planned_finish"])
                dist = 0 if ps <= on <= pf else (ps - on).days if on < ps else (on - pf).days
                out[i] = 0.6 * float(np.exp(-dist / 20.0))
        return out

    def candidates(self, ext: dict, k: int = 5, prior: np.ndarray | None = None) -> list[Candidate]:
        n = len(self.activities)
        tags = ext.get("tags", [])
        disc = (ext.get("discipline") or {}).get("value")
        area = (ext.get("area") or {}).get("value")
        phase = (ext.get("phase") or {}).get("value")
        phases_all = set(ext.get("phases_all") or [])

        tscore = np.zeros(n)
        tev: list[str | None] = [None] * n
        if tags:
            for i, a in enumerate(self.activities):
                tscore[i], tev[i] = tag_score(tags, a, self.keys[i])

        # ---- filter stage
        # keep activities that match on tag, or on all-but-one of the known attributes
        mask = tscore > 0
        known = sum(1 for x in (disc, area, phase) if x)
        hits = np.zeros(n, dtype=int)
        if disc:
            hits += self.disc == disc
        if area:
            hits += self.area == area
        if phase:
            hits += np.isin(self.phase, list(phases_all | {phase}))
        if known:
            mask |= hits >= max(1, known - 1)
        if mask.sum() < k:
            mask = np.ones(n, dtype=bool)
        idx = np.nonzero(mask)[0]

        # ---- ranking stage
        q = " ".join([ext["norm"]] + [t["value"] for t in tags] + ([PHASE_LABEL[phase]] if phase else [])).lower()
        qv = self.vec.transform([q])
        tf = (self.mat[idx] @ qv.T).toarray().ravel()
        base = (0.45 * tscore[idx] + 0.25 * tf
                + 0.12 * (self.disc[idx] == disc if disc else 0.5)
                + 0.08 * (self.area[idx] == area if area else 0.5)
                + 0.15 * (self.phase[idx] == phase if phase else 0.3))
        if prior is not None:
            base = base + 0.2 * prior[idx]
        top = idx[np.argsort(-base)[: max(20, k * 4)]]
        scored = []
        for i in top:
            fz = fuzz.token_set_ratio(q, self.docs[i]) / 100.0
            tfi = float(tf[np.where(idx == i)[0][0]])
            r = float(base[np.where(idx == i)[0][0]] + 0.1 * fz)
            scored.append(Candidate(self.activities[i]["activity_id"], r, float(tscore[i]), tev[i], tfi, fz))
        scored.sort(key=lambda c: -c.retrieval)
        return scored[:k]

    def candidate_for(self, ext: dict, activity_id: str) -> Candidate:
        """Build a Candidate for a specific activity (e.g. the planner's correct answer outside the top-k)."""
        i = self.pos[activity_id]
        a = self.activities[i]
        ts, tev = tag_score(ext.get("tags", []), a, self.keys[i]) if ext.get("tags") else (0.0, None)
        phase = (ext.get("phase") or {}).get("value")
        q = " ".join([ext["norm"]] + [t["value"] for t in ext.get("tags", [])]
                     + ([PHASE_LABEL[phase]] if phase else [])).lower()
        tf = float((self.mat[i] @ self.vec.transform([q]).T).toarray().ravel()[0])
        fz = fuzz.token_set_ratio(q, self.docs[i]) / 100.0
        return Candidate(activity_id, 0.0, float(ts), tev, tf, fz)
