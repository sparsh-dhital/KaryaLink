"""Offline rule + lexicon extractor.

Every extracted field carries an evidence span (start, end, text) into the ORIGINAL
report text. Matching runs on a normalised copy (lower-case, typo-corrected, number
words -> digits) with a character offset map back to the original.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any

from rapidfuzz import fuzz, process

from . import lexicon as L

TOKEN_RE = re.compile(r"[A-Za-zऀ-ॿ]+|\d+(?:\.\d+)?|\s+|.", re.UNICODE)
_UNIT_ALT = "|".join(f"(?:{u})" for u in L.UNITS)
UNIT_RE = re.compile(_UNIT_ALT)

_KNOWN_RE = re.compile("|".join(p for pats in list(L.PHASES.values()) + list(L.STATUSES.values()) for p in pats))


class Normalized:
    def __init__(self, text: str, learned: dict[str, str] | None = None):
        self.text = text
        parts: list[str] = []
        omap: list[int] = []
        self.corrections: list[dict] = []
        for m in TOKEN_RE.finditer(text):
            tok, s = m.group(0), m.start()
            low = tok.lower()
            rep = low
            if low in L.NUMBER_WORDS and low.isalpha():
                rep = str(L.NUMBER_WORDS[low])
            elif (len(low) >= 5 and low.isascii() and low.isalpha() and not _KNOWN_RE.fullmatch(low)
                  and low not in (learned or {})):
                best = process.extractOne(low, L.CORRECTION_VOCAB, scorer=fuzz.ratio, score_cutoff=84)
                if best and best[0] != low and best[0][0] == low[0]:
                    rep = best[0]
                    self.corrections.append({"from": tok, "to": rep, "start": s, "end": s + len(tok)})
            n = len(rep)
            for i in range(n):
                omap.append(s + (round(i * (len(tok) - 1) / (n - 1)) if n > 1 else 0))
            parts.append(rep)
        self.norm = "".join(parts)
        self.omap = omap
        self.claimed: list[tuple[int, int]] = []

    def span(self, ns: int, ne: int) -> tuple[int, int, str]:
        s = self.omap[ns]
        e = self.omap[ne - 1] + 1
        return s, e, self.text[s:e]

    def free(self, ns: int, ne: int) -> bool:
        return all(ne <= a or ns >= b for a, b in self.claimed)

    def claim(self, ns: int, ne: int) -> None:
        self.claimed.append((ns, ne))


def _field(nt: Normalized, m_start: int, m_end: int, value: Any, source: str = "rule", **extra) -> dict:
    s, e, ev = nt.span(m_start, m_end)
    return {"value": value, "start": s, "end": e, "evidence": ev, "source": source, **extra}


def _all_matches(nt: Normalized, table: dict[str, list[str]]):
    out = []
    for key, pats in table.items():
        for p in pats:
            for m in re.finditer(p, nt.norm):
                if m.end() > m.start():
                    out.append((m.start(), m.end(), key))
    # longest match wins on overlap
    out.sort(key=lambda t: (-(t[1] - t[0]), t[0]))
    chosen: list[tuple[int, int, str]] = []
    for s, e, k in out:
        if all(e <= cs or s >= ce for cs, ce, _ in chosen):
            chosen.append((s, e, k))
    chosen.sort()
    return chosen


# ---------------------------------------------------------------- dates
_MON = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*"
_UNIT_LOOKAHEAD = rf"(?!\s*(?:{_UNIT_ALT}))"
DATE_PATTERNS = [
    ("iso", re.compile(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b")),
    ("dmy", re.compile(rf"\b(\d{{1,2}})[/.\-](\d{{1,2}})(?:[/.\-](\d{{2,4}}))?\b{_UNIT_LOOKAHEAD}")),
    ("d_mon", re.compile(rf"\b(\d{{1,2}})[\s\-]?{_MON}(?:[\s\-,]+(\d{{2,4}}))?\b")),
    ("mon_d", re.compile(rf"\b{_MON}[\s\-]+(\d{{1,2}})\b(?![/.\-]\d)")),
    ("ddmmyy", re.compile(r"\b([0-3]\d)([01]\d)(2[5-7])\b")),
]
REL_DATES = [
    (re.compile(r"day before yesterday|\bparso\b|परसों"), -2),
    (re.compile(r"\byesterday\b|\byday\b|\bystrdy\b|\bkal\b|कल"), -1),
    (re.compile(r"\btoday\b|\btdy\b|\b2day\b|\baaj\b|आज"), 0),
]


def _mk_date(y: int, m: int, d: int, report_date: date) -> date | None:
    try:
        dt = date(y, m, d)
    except ValueError:
        return None
    if dt > report_date + timedelta(days=1):
        # "14/10" reported on 29/09 is not a future date: try previous year, else reject
        try:
            dt = date(y - 1, m, d)
        except ValueError:
            return None
        if (report_date - dt).days > 200:
            return None
    return dt


def extract_date(nt: Normalized, report_date: date) -> dict | None:
    for kind, rx in DATE_PATTERNS:
        for m in rx.finditer(nt.norm):
            if not nt.free(m.start(), m.end()):
                continue
            g = m.groups()
            if kind == "iso":
                dt = _mk_date(int(g[0]), int(g[1]), int(g[2]), report_date)
            elif kind == "ddmmyy":
                dt = _mk_date(2000 + int(g[2]), int(g[1]), int(g[0]), report_date)
            elif kind == "dmy":
                y = int(g[2]) if g[2] else report_date.year
                y = y + 2000 if y < 100 else y
                dt = _mk_date(y, int(g[1]), int(g[0]), report_date)
            elif kind == "d_mon":
                y = int(g[2]) if g[2] else report_date.year
                y = y + 2000 if y < 100 else y
                dt = _mk_date(y, L.MONTHS[g[1][:3]], int(g[0]), report_date)
            else:
                dt = _mk_date(report_date.year, L.MONTHS[g[0][:3]], int(g[1]), report_date)
            if dt:
                nt.claim(m.start(), m.end())
                return _field(nt, m.start(), m.end(), dt.isoformat(), kind="explicit")
    for rx, off in REL_DATES:
        m = rx.search(nt.norm)
        if m:
            nt.claim(m.start(), m.end())
            return _field(nt, m.start(), m.end(), (report_date + timedelta(days=off)).isoformat(), kind="relative")
    return None


# ---------------------------------------------------------------- tags
EQUIP_WORD_LETTER = {"vessel": "V", "pump": "P", "compressor": "K", "cooler": "E", "tank": "T", "drum": "V",
                     "separator": "V"}
TAG_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("line", re.compile(r"(?<![\w.])(\d{1,2})\s*(?:\"|”|''|in\b|inch\b)\s*-?\s*([a-z])\s*-?\s*(\d{4})\b")),
    ("instrument", re.compile(r"\b(pt|ft|lt|tt|pg|tg|te|pi|fit|psv)\s*-?\s*(\d{3,4})\b")),
    ("tray", re.compile(r"\bct\s*-?\s*([a-f])\s*-?\s*(\d{1,2})\b")),
    ("tray", re.compile(r"\btray\s*(?:no\.?\s*)?([a-f])\s*-?\s*(\d{1,2})\b")),
    ("tray", re.compile(r"\b([a-f])\s*-?\s*(\d{1,2})\s*(?:cable\s*)?tray\b")),
    ("hydrant", re.compile(r"\b(?:hyd|hydrant)\s*(?:no\.?\s*)?-?\s*(\d{2})\b")),
    ("shower", re.compile(r"\b(?:ss|safety shower|shower)\s*(?:no\.?\s*)?-?\s*(\d{2})\b")),
    ("line_partial", re.compile(r"\b([pgwufdt])\s*-?\s*(\d{4})\b")),
    ("line_num", re.compile(r"\b(?:line|ln)\s*(?:no\.?\s*)?(\d{4})\b")),
    ("line_num", re.compile(r"\b(\d{4})\s*(?:line|ln)\b")),
    ("equipment", re.compile(r"\b([vpket])\s*-?\s*(\d{3})\s*([ab])?\b")),
    ("equipment_word", re.compile(r"\b(vessel|pump|compressor|cooler|tank|drum|separator)\s*(?:no\.?\s*)?(\d{3})\s*([ab])?\b")),
    ("foundation", re.compile(r"\b(?:foundation|fdn|fndn)\s*(?:no\.?\s*)?(?:f\s*-?\s*)?(\d{2})\b")),
    ("foundation", re.compile(r"\bf\s*-?\s*(\d{2})\b")),
    ("area", re.compile(r"\b(?:u|unit|area)\s*-?\s*([1-9]00)\b")),
    ("number", re.compile(r"\b(\d{4})\b(?!\s*(?:%|percent))")),
]


def _tag_value(kind: str, g: tuple) -> dict:
    if kind == "line":
        size, svc, num = g
        return {"value": f'{size}"-{svc.upper()}-{num}', "svc": svc.upper(), "num": num, "size": size}
    if kind == "line_partial":
        return {"value": f"{g[0].upper()}-{g[1]}", "svc": g[0].upper(), "num": g[1]}
    if kind in ("line_num", "number"):
        return {"value": g[0], "num": g[0]}
    if kind == "instrument":
        return {"value": f"{g[0].upper()}-{g[1]}", "itype": g[0].upper(), "num": g[1]}
    if kind == "tray":
        return {"value": f"CT-{g[0].upper()}-{int(g[1]):02d}"}
    if kind == "hydrant":
        return {"value": f"HYD-{g[0]}"}
    if kind == "shower":
        return {"value": f"SS-{g[0]}"}
    if kind == "equipment":
        base = f"{g[0].upper()}-{g[1]}"
        return {"value": base + (g[2].upper() if g[2] else ""), "base": base}
    if kind == "equipment_word":
        base = f"{EQUIP_WORD_LETTER[g[0]]}-{g[1]}"
        return {"value": base + (g[2].upper() if g[2] else ""), "base": base}
    if kind == "foundation":
        return {"value": f"F-{g[0]}"}
    if kind == "area":
        return {"value": f"U-{g[0]}"}
    raise ValueError(kind)


def extract_tags(nt: Normalized, bare_numbers: bool = False) -> tuple[list[dict], dict | None]:
    tags, area = [], None
    for kind, rx in TAG_PATTERNS:
        if (kind == "number") != bare_numbers:
            continue
        for m in rx.finditer(nt.norm):
            if not nt.free(m.start(), m.end()):
                continue
            if kind == "number" and int(m.group(1)) in (2026, 2027):
                continue  # a stray year, not a line / instrument number
            info = _tag_value(kind, m.groups())
            nt.claim(m.start(), m.end())
            f = _field(nt, m.start(), m.end(), info.pop("value"), type=kind, **info)
            if kind == "area":
                area = area or f
            else:
                tags.append(f)
    return tags, area


# ---------------------------------------------------------------- quantity
def _unit(s: str | None) -> str | None:
    if not s:
        return None
    for pat, u in L.UNITS.items():
        if re.fullmatch(pat, s.strip()) or re.match(pat, s.strip()):
            return u
    return None


Q_CUM = re.compile(rf"(\d+(?:\.\d+)?)\s*(?:of|out of|/)\s*(\d+(?:\.\d+)?)\s*({_UNIT_ALT})?")
Q_HI = re.compile(rf"(\d+(?:\.\d+)?)\s*(?:me se|mein se|में से)\s*(\d+(?:\.\d+)?)\s*({_UNIT_ALT})?")
Q_PCT = re.compile(r"(\d{1,3}(?:\.\d+)?)\s*(?:%|percent\b|pct\b|प्रतिशत)")
Q_INC = re.compile(rf"(\+\s*|\baur\s+)?(\d+(?:\.\d+)?)\s*(more\s+)?({_UNIT_ALT})(\s*(?:more|added|extra))?")
Q_IDS = re.compile(r"\b([sj])\s*-\s*(\d{1,3})\b")


def extract_quantity(nt: Normalized) -> tuple[dict | None, list[dict]]:
    ids = []
    for m in Q_IDS.finditer(nt.norm):
        if nt.free(m.start(), m.end()):
            nt.claim(m.start(), m.end())
            ids.append(_field(nt, m.start(), m.end(), f"{m.group(1).upper()}-{m.group(2)}"))
    for rx, hindi in ((Q_HI, True), (Q_CUM, False)):
        m = rx.search(nt.norm)
        if m and nt.free(m.start(), m.end()):
            a, b = float(m.group(1)), float(m.group(2))
            total, done = (a, b) if hindi else (b, a)
            if total > 0 and done <= total * 1.5:
                nt.claim(m.start(), m.end())
                return _field(nt, m.start(), m.end(), done, total=total, unit=_unit(m.group(3)),
                              mode="cumulative"), ids
    m = Q_PCT.search(nt.norm)
    if m and nt.free(m.start(), m.end()):
        nt.claim(m.start(), m.end())
        return _field(nt, m.start(), m.end(), float(m.group(1)), total=None, unit="%", mode="percent"), ids
    for m in Q_INC.finditer(nt.norm):
        if not nt.free(m.start(), m.end()):
            continue
        # "10 m" style units must follow a number directly; skip spans that are tags
        marker = bool(m.group(1) or m.group(3) or m.group(5))
        nt.claim(m.start(), m.end())
        return _field(nt, m.start(), m.end(), float(m.group(2)), total=None, unit=_unit(m.group(4)),
                      mode="incremental" if marker else "incremental_assumed"), ids
    if ids:
        unit = "spools" if ids[0]["value"].startswith("S") else "joints"
        s = min(i["start"] for i in ids)
        e = max(i["end"] for i in ids)
        return {"value": float(len(ids)), "total": None, "unit": unit, "mode": "incremental", "start": s,
                "end": e, "evidence": nt.text[s:e], "source": "rule"}, ids
    return None, ids


# ---------------------------------------------------------------- main
TAG_DISCIPLINE = {"foundation": "CIV", "line": "PIP", "line_partial": "PIP", "line_num": "PIP",
                  "instrument": "INS", "tray": "ELE", "equipment": "MEC", "equipment_word": "MEC",
                  "hydrant": "HSE", "shower": "HSE"}


def infer_area_from_tag(tag: dict) -> str | None:
    t, v = tag["type"], tag["value"]
    if t in ("line", "line_partial", "line_num", "instrument", "number"):
        d = tag["num"][0]
    elif t == "foundation":
        d = v.split("-")[1][0]
    elif t == "tray":
        d = str("ABCDEF".index(v.split("-")[1]) + 1)
    elif t in ("equipment", "equipment_word"):
        d = tag["base"].split("-")[1][0]
    elif t in ("hydrant", "shower"):
        d = v.split("-")[1][0]
    else:
        return None
    return f"U-{d}00" if d in "123456" else None


def extract(text: str, report_date: date, reporter_discipline: str | None = None,
            learned: dict[str, str] | None = None) -> dict:
    nt = Normalized(text, learned)
    dt = extract_date(nt, report_date)
    tags, area = extract_tags(nt)
    qty, ids = extract_quantity(nt)
    tags += extract_tags(nt, bare_numbers=True)[0]

    phase_table = {k: list(v) for k, v in L.PHASES.items()}
    for phrase, ph in (learned or {}).items():
        phase_table.setdefault(ph, []).append(rf"\b{re.escape(phrase)}\b")
    phases = _all_matches(nt, phase_table)
    learned_rx = {rf"\b{re.escape(p)}\b" for p in (learned or {})}
    phase = None
    if phases:
        keys = [k for _, _, k in phases]
        pick = phases[0]
        if "pcc" in keys:  # "PCC casting" is PCC, not the main pour
            pick = next(p for p in phases if p[2] == "pcc")
        s, e, k = pick
        src = "rule"
        if learned and nt.norm[s:e] in learned:
            src = "learned"
        phase = _field(nt, s, e, k, src, label=L.PHASE_LABEL[k])
    phases_all = sorted({k for _, _, k in phases})

    statuses = _all_matches(nt, L.STATUSES)
    status = None
    if statuses:
        kinds = [k for _, _, k in statuses]
        pick_kind = "complete" if "complete" in kinds else "progress" if "progress" in kinds else "start"
        s, e, _ = next(t for t in statuses if t[2] == pick_kind)
        status = _field(nt, s, e, pick_kind)
    if qty and qty["mode"] == "cumulative" and qty["total"]:
        if qty["value"] >= qty["total"]:
            status = status if status and status["value"] == "complete" else {**qty, "value": "complete", "source": "rule:qty"}
        elif status is None or status["value"] == "complete":
            status = {**{k: qty[k] for k in ("start", "end", "evidence")}, "value": "progress", "source": "rule:qty"}
    if qty and qty["mode"] == "percent" and qty["value"] < 100 and (status is None or status["value"] == "complete"):
        status = {**{k: qty[k] for k in ("start", "end", "evidence")}, "value": "progress", "source": "rule:qty"}
    if status is None and qty is not None:
        status = {**{k: qty[k] for k in ("start", "end", "evidence")}, "value": "progress", "source": "rule:qty"}

    # discipline votes
    votes: dict[str, float] = {}
    ev_for: dict[str, dict] = {}

    def vote(d, w, f):
        if d:
            votes[d] = votes.get(d, 0) + w
            if d not in ev_for or w > ev_for[d]["w"]:
                ev_for[d] = {"w": w, "start": f["start"], "end": f["end"], "evidence": f["evidence"]}

    for t in tags:
        vote(TAG_DISCIPLINE.get(t["type"]), 1.5 if t["type"] == "line_num" else 2.0, t)
    if phase:
        pd = L.PHASE_DISCIPLINE.get(phase["value"])
        if pd is None:  # "install": resolve via cue words below
            pass
        vote(pd, 2.0, phase)
    for d, pats in L.DISCIPLINE_CUES.items():
        for p in pats:
            m = re.search(p, nt.norm)
            if m:
                s, e, ev = nt.span(m.start(), m.end())
                vote(d, 1.0, {"start": s, "end": e, "evidence": ev})
                break
    discipline = None
    if votes:
        best = max(votes, key=votes.get)
        discipline = {"value": best, "source": "rule", **{k: ev_for[best][k] for k in ("start", "end", "evidence")},
                      "votes": votes}
    if reporter_discipline:
        if discipline is None:
            discipline = {"value": reporter_discipline, "source": "reporter_profile", "start": None, "end": None,
                          "evidence": "reporter profile", "votes": {}}
        elif discipline["value"] != reporter_discipline and votes.get(reporter_discipline, 0) + 1.5 > votes[discipline["value"]]:
            discipline = {**discipline, "value": reporter_discipline, "source": "reporter_profile"}

    if area is None:
        for t in tags:
            inf = infer_area_from_tag(t)
            if inf:
                area = {"value": inf, "start": t["start"], "end": t["end"], "evidence": t["evidence"],
                        "source": "inferred_from_tag"}
                break

    new_cue = None
    for p in L.NEW_WORK_CUES:
        m = re.search(p, nt.norm)
        if m:
            new_cue = _field(nt, m.start(), m.end(), True)
            break

    if dt is None:
        dt = {"value": report_date.isoformat(), "start": None, "end": None, "evidence": None, "source": "assumed",
              "kind": "assumed_report_date"}

    return {
        "text": text,
        "norm": nt.norm,
        "phase": phase,
        "phases_all": phases_all,
        "status": status,
        "tags": tags,
        "quantity": qty,
        "granular_ids": ids,
        "date": dt,
        "area": area,
        "discipline": discipline,
        "new_work_cue": new_cue,
        "corrections": nt.corrections,
        "extractor": "rules",
    }


EVIDENCE_FIELDS = ("phase", "status", "quantity", "date", "area", "discipline", "new_work_cue")


def evidence_spans(ext: dict) -> list[dict]:
    """Flat list of highlighted spans for the UI."""
    spans = []
    for k in EVIDENCE_FIELDS:
        f = ext.get(k)
        if f and f.get("start") is not None:
            spans.append({"field": k, "start": f["start"], "end": f["end"], "value": f["value"]})
    for t in ext.get("tags", []):
        spans.append({"field": "tag", "start": t["start"], "end": t["end"], "value": t["value"]})
    return spans
