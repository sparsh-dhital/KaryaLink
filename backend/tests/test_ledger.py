"""Hash-chain audit ledger: append, verify, detect tampering."""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from sitesync import ledger
from sitesync.db import Base, LedgerEntry


def _db(tmp_path):
    eng = create_engine(f"sqlite:///{tmp_path / 'l.db'}")
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng)()


def test_chain_verifies_and_links(tmp_path):
    db = _db(tmp_path)
    a = ledger.append(db, "DECISION_AUTO_APPLY", {"x": 1, "text": "F-12 pour done"}, report_id=1, activity_id="A")
    b = ledger.append(db, "ACTUAL_APPLIED", {"pct_after": 50.0}, report_id=1, activity_id="A", actor="planner")
    db.commit()
    assert a.prev_hash == ledger.GENESIS and b.prev_hash == a.hash
    res = ledger.verify(db)
    assert res["ok"] and res["entries"] == 2 and res["head"] == b.hash


def test_tampering_with_payload_is_detected(tmp_path):
    db = _db(tmp_path)
    for i in range(5):
        ledger.append(db, "E", {"i": i})
    db.commit()
    e = db.get(LedgerEntry, 3)
    e.payload = {"i": 999}
    db.commit()
    res = ledger.verify(db)
    assert not res["ok"] and res["broken_at"] == 3


def test_deleting_an_entry_is_detected(tmp_path):
    db = _db(tmp_path)
    for i in range(4):
        ledger.append(db, "E", {"i": i})
    db.commit()
    db.delete(db.get(LedgerEntry, 2))
    db.commit()
    res = ledger.verify(db)
    assert not res["ok"] and res["broken_at"] == 3
