"""Append-only, hash-chained audit ledger (tamper-evident; NOT a blockchain).

hash_n = SHA-256( prev_hash || canonical_json({seq, ts, kind, report_id, activity_id, actor, payload}) )
Any edit / deletion / reordering of an entry breaks every later hash, which /api/audit/verify detects.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .db import LedgerEntry

GENESIS = "0" * 64


def _canonical(d: dict) -> str:
    return json.dumps(d, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def compute_hash(prev_hash: str, seq: int, ts: str, kind: str, report_id, activity_id, actor: str, payload: dict) -> str:
    body = _canonical({"seq": seq, "ts": ts, "kind": kind, "report_id": report_id, "activity_id": activity_id,
                       "actor": actor, "payload": payload})
    return hashlib.sha256((prev_hash + body).encode("utf-8")).hexdigest()


def append(db: Session, kind: str, payload: dict, report_id: int | None = None, activity_id: str | None = None,
           actor: str = "system") -> LedgerEntry:
    last = db.execute(select(LedgerEntry).order_by(LedgerEntry.seq.desc()).limit(1)).scalar_one_or_none()
    seq = (last.seq + 1) if last else 1
    prev = last.hash if last else GENESIS
    ts = datetime.now(timezone.utc).isoformat()
    payload = json.loads(_canonical(payload))  # normalise to what we will re-hash later
    h = compute_hash(prev, seq, ts, kind, report_id, activity_id, actor, payload)
    e = LedgerEntry(seq=seq, ts=ts, kind=kind, report_id=report_id, activity_id=activity_id, actor=actor,
                    payload=payload, prev_hash=prev, hash=h)
    db.add(e)
    db.flush()
    return e


def verify(db: Session) -> dict:
    prev = GENESIS
    n = 0
    for e in db.execute(select(LedgerEntry).order_by(LedgerEntry.seq)).scalars():
        n += 1
        if e.prev_hash != prev:
            return {"ok": False, "entries": n, "broken_at": e.seq, "reason": "prev_hash does not match previous entry"}
        h = compute_hash(e.prev_hash, e.seq, e.ts, e.kind, e.report_id, e.activity_id, e.actor, e.payload)
        if h != e.hash:
            return {"ok": False, "entries": n, "broken_at": e.seq, "reason": "entry content does not match its hash"}
        if e.seq != n:
            return {"ok": False, "entries": n, "broken_at": e.seq, "reason": "sequence gap (entry removed?)"}
        prev = e.hash
    return {"ok": True, "entries": n, "head": prev}


def count(db: Session) -> int:
    return db.execute(select(func.count()).select_from(LedgerEntry)).scalar_one()
