"""SQLite persistence (SQLAlchemy 2.0 ORM)."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from .config import DB_PATH, ensure_dirs


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Activity(Base):
    __tablename__ = "activities"
    activity_id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    discipline: Mapped[str] = mapped_column(String, index=True)
    area: Mapped[str] = mapped_column(String, index=True)
    area_name: Mapped[str] = mapped_column(String, default="")
    wbs_code: Mapped[str] = mapped_column(String)
    parent_wbs: Mapped[str] = mapped_column(String, index=True)
    level: Mapped[int] = mapped_column(Integer)
    tag: Mapped[str] = mapped_column(String, index=True)
    tag_type: Mapped[str] = mapped_column(String)
    phase: Mapped[str] = mapped_column(String)
    planned_start: Mapped[str] = mapped_column(String)
    planned_finish: Mapped[str] = mapped_column(String)
    duration: Mapped[int] = mapped_column(Integer)
    quantity: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String)
    weight: Mapped[float] = mapped_column(Float, default=1.0)
    credit_method: Mapped[str] = mapped_column(String, default="quantity")
    predecessors: Mapped[list] = mapped_column(JSON, default=list)
    # actuals
    pct: Mapped[float] = mapped_column(Float, default=0.0)
    qty_done: Mapped[float] = mapped_column(Float, default=0.0)
    actual_start: Mapped[str | None] = mapped_column(String, nullable=True)
    actual_finish: Mapped[str | None] = mapped_column(String, nullable=True)
    last_update: Mapped[str | None] = mapped_column(String, nullable=True)
    source: Mapped[str] = mapped_column(String, default="schedule")  # schedule | new_activity

    def to_dict(self) -> dict:
        return {c.name: getattr(self, c.name) for c in self.__table__.columns}


class WbsNode(Base):
    __tablename__ = "wbs"
    code: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    level: Mapped[int] = mapped_column(Integer)
    parent: Mapped[str | None] = mapped_column(String, nullable=True)


class Photo(Base):
    __tablename__ = "photos"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    filename: Mapped[str] = mapped_column(String)
    content_type: Mapped[str] = mapped_column(String)
    sha256: Mapped[str] = mapped_column(String)
    taken_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    report_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    external_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    text: Mapped[str] = mapped_column(Text)
    reporter: Mapped[str] = mapped_column(String, default="unknown")
    reporter_discipline: Mapped[str | None] = mapped_column(String, nullable=True)
    channel: Mapped[str] = mapped_column(String, default="chat")  # chat | voice | spreadsheet | file | email
    report_date: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    session_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    source_file: Mapped[str | None] = mapped_column(String, nullable=True)
    photo_id: Mapped[int | None] = mapped_column(ForeignKey("photos.id"), nullable=True)
    # awaiting_supervisor | awaiting_planner | applied | rejected | new_activity_created
    status: Mapped[str] = mapped_column(String, index=True)
    decision: Mapped[str] = mapped_column(String, index=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    activity_id: Mapped[str | None] = mapped_column(String, nullable=True)  # final linked activity
    analysis: Mapped[dict] = mapped_column(JSON)
    model_version: Mapped[str] = mapped_column(String, default="")
    resolved_by: Mapped[str | None] = mapped_column(String, nullable=True)


class ActualEvent(Base):
    __tablename__ = "actual_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    activity_id: Mapped[str] = mapped_column(String, index=True)
    report_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    event: Mapped[str] = mapped_column(String)
    event_date: Mapped[str] = mapped_column(String, index=True)
    qty_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    qty_mode: Mapped[str | None] = mapped_column(String, nullable=True)
    pct_before: Mapped[float] = mapped_column(Float)
    pct_after: Mapped[float] = mapped_column(Float)
    qty_after: Mapped[float] = mapped_column(Float, default=0.0)
    credit_note: Mapped[str] = mapped_column(Text, default="")
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    approver: Mapped[str] = mapped_column(String, default="system")
    model_version: Mapped[str] = mapped_column(String, default="")
    source: Mapped[str] = mapped_column(String, default="live")  # live | historical-seed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    reverted_by: Mapped[int | None] = mapped_column(Integer, nullable=True)  # id of the "revert" event


class Correction(Base):
    __tablename__ = "corrections"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    report_date: Mapped[str] = mapped_column(String)
    reporter_discipline: Mapped[str | None] = mapped_column(String, nullable=True)
    predicted_activity_id: Mapped[str | None] = mapped_column(String, nullable=True)
    correct_activity_id: Mapped[str | None] = mapped_column(String, nullable=True)  # None -> no match / new
    kind: Mapped[str] = mapped_column(String)  # approve | reassign | reject | new_activity | clarification
    state_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    created_by: Mapped[str] = mapped_column(String, default="planner")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    used_in_version: Mapped[str | None] = mapped_column(String, nullable=True)


class SequenceWarning(Base):
    __tablename__ = "sequence_warnings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(Integer, index=True)
    activity_id: Mapped[str] = mapped_column(String)
    type: Mapped[str] = mapped_column(String)
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, default="open")  # open | confirmed | rejected
    resolved_by: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LedgerEntry(Base):
    __tablename__ = "ledger"
    seq: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String, index=True)
    report_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    activity_id: Mapped[str | None] = mapped_column(String, nullable=True)
    actor: Mapped[str] = mapped_column(String, default="system")
    payload: Mapped[dict] = mapped_column(JSON)
    prev_hash: Mapped[str] = mapped_column(String)
    hash: Mapped[str] = mapped_column(String)


class ModelVersion(Base):
    __tablename__ = "model_versions"
    version: Mapped[str] = mapped_column(String, primary_key=True)
    round: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    kind: Mapped[str] = mapped_column(String, default="trained")  # baseline | trained
    n_corrections: Mapped[int] = mapped_column(Integer, default=0)
    n_learned_terms: Mapped[int] = mapped_column(Integer, default=0)
    metrics_test: Mapped[dict] = mapped_column(JSON, default=dict)
    metrics_hard: Mapped[dict] = mapped_column(JSON, default=dict)
    path: Mapped[str | None] = mapped_column(String, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String, index=True)
    role: Mapped[str] = mapped_column(String)  # user | assistant
    text: Mapped[str] = mapped_column(Text)
    lang: Mapped[str] = mapped_column(String, default="en-IN")
    report_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[dict | list] = mapped_column(JSON)


_engine = None
_Session = None


def get_engine(path=None):
    global _engine, _Session
    if _engine is None or path is not None:
        ensure_dirs()
        url = f"sqlite:///{path or DB_PATH}"
        _engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})

        @event.listens_for(_engine, "connect")
        def _pragma(dbapi_conn, _):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()

        _Session = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def SessionLocal():
    get_engine()
    return _Session()


def init_db(drop: bool = False) -> None:
    eng = get_engine()
    if drop:
        Base.metadata.drop_all(eng)
    Base.metadata.create_all(eng)
    _add_missing_columns(eng)


def _add_missing_columns(eng) -> None:
    """Tiny forward-only migration: add nullable columns introduced after a DB was created."""
    from sqlalchemy import inspect, text

    insp = inspect(eng)
    with eng.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            have = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name not in have and col.nullable:
                    conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN "{col.name}" {col.type.compile(eng.dialect)}'))
