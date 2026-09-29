"""Site Assistant: short two-way conversation with a supervisor (English / Hindi / Hinglish).

The browser does speech-to-text and text-to-speech; this module decides what to say.
Replies in hi-IN mode are romanised Hinglish (what site teams actually type), spoken by the
browser's Hindi voice when available.
"""
from __future__ import annotations

import re
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import ledger
from ..db import Activity, ActualEvent, ChatMessage, Report
from ..engine import policy
from ..engine.extractor import extract
from ..engine.lexicon import PHASE_LABEL
from . import reports as R
from .core import get_engine, get_setting, project_today, set_setting

ORDINALS = {0: r"\b(first|1st|pehl[aie]|one|ek|number one)\b", 1: r"\b(second|2nd|dusr[aie]|doosr[aie]|two|number two)\b",
            2: r"\b(third|3rd|teesr[aie]|three|teen)\b"}
YES = r"\b(yes|haan|han|ha|haa|confirm|correct|sahi|theek|ok|okay|ji)\b"
NO = r"\b(no|nahi|nahin|nope|cancel|galat|wrong|reject)\b"
NONE = r"\b(none|neither|koi nahi|dono nahi|kuch nahi|not these)\b"
STATUS_WORDS = {"complete": r"complet|done|finish|ho gaya|ho gya|pura|khatam",
                "start": r"start|shuru|begin|began", "progress": r"progress|chal raha|jaari|ongoing|continu|kaam hua"}
GREETING = r"^\s*(hi|hello|hey|namaste|namaskar|good (morning|evening|afternoon))\b"
EOD = r"\b(end of (the )?day|eod|din khatam|aaj ka kaam khatam|day end|shift over|chaser)\b"


def _session(db: Session, sid: str) -> dict:
    return dict(get_setting(db, f"session:{sid}", {}))


def _save_session(db: Session, sid: str, s: dict) -> None:
    set_setting(db, f"session:{sid}", s)


def _say(db: Session, sid: str, text: str, lang: str, report_id: int | None = None, **payload) -> dict:
    m = ChatMessage(session_id=sid, role="assistant", text=text, lang=lang, report_id=report_id, payload=payload)
    db.add(m)
    db.flush()
    return {"id": m.id, "role": "assistant", "text": text, "lang": lang, "report_id": report_id, "payload": payload,
            "created_at": m.created_at.isoformat()}


def history(db: Session, sid: str) -> list[dict]:
    q = select(ChatMessage).where(ChatMessage.session_id == sid).order_by(ChatMessage.id)
    return [{"id": m.id, "role": m.role, "text": m.text, "lang": m.lang, "report_id": m.report_id,
             "payload": m.payload, "created_at": m.created_at.isoformat()} for m in db.execute(q).scalars()]


def _hi(lang: str) -> bool:
    return lang.lower().startswith("hi")


def reply_for_report(db: Session, sid: str, r: Report, lang: str) -> dict:
    dec = r.analysis["decision"]
    hi = _hi(lang)
    cands = r.analysis["candidates"]
    kind = dec["kind"]
    if kind == policy.AUTO_APPLY or r.status == "applied":
        a = db.get(Activity, r.activity_id)
        ev = db.execute(select(ActualEvent).where(ActualEvent.report_id == r.id)).scalars().first()
        credit = f" ({ev.credit_note})" if ev and ev.credit_note else ""
        photo = (" Photo saved as evidence." if not hi else " Photo evidence ke roop me save ho gayi.") if r.photo_id else ""
        txt = (f"Update ho gaya: {a.name} ab {a.pct:.0f}% hai.{photo} Aur kuch?" if hi else
               f"Got it. {a.name} is now {a.pct:.0f}% complete{credit}.{photo} Anything else?")
        return _say(db, sid, txt, lang, r.id, decision=kind, confidence=r.confidence, activity_id=a.activity_id,
                    status="applied", resolved_by=r.resolved_by)
    if kind in (policy.CLARIFY, policy.CONFIRM_SEQUENCE):
        q = dec.get("question_hi") if hi else dec.get("question")
        if kind == policy.CONFIRM_SEQUENCE:
            q = ("Dhyan dein: " if hi else "Sequence check: ") + q
        s = _session(db, sid)
        s["pending"] = {"type": "question", "report_id": r.id, "options": dec.get("options", [])}
        _save_session(db, sid, s)
        return _say(db, sid, q, lang, r.id, decision=kind, confidence=r.confidence, options=dec.get("options", []),
                    question=True)
    if kind == policy.REVIEW:
        top = cands[0]["activity"]["name"] if cands else "an activity"
        txt = (f"Mujhe lagta hai yeh '{top}' hai ({r.confidence * 100:.0f}% confidence), par pakka nahi - planner ko review ke liye bhej diya."
               if hi else f"I think this is '{top}' ({r.confidence * 100:.0f}% confidence), but I'm not sure enough, "
                          f"so I've sent it to the planner for review.")
        return _say(db, sid, txt, lang, r.id, decision=kind, confidence=r.confidence)
    prop = dec.get("proposal") or {}
    txt = ("Yeh kisi planned activity se match nahi hua. Planner ke liye NEW activity ke roop me flag kar diya."
           if hi else "This doesn't match any planned activity. I've flagged it as possible NEW work for the planner"
                      f"{' under ' + prop['parent_wbs'] if prop.get('parent_wbs') else ''}.")
    return _say(db, sid, txt, lang, r.id, decision=kind, confidence=r.confidence)


def _match_option(text: str, options: list[dict]) -> str | None:
    low = text.lower()
    vals = [o["value"] for o in options]
    if "confirm" in vals and re.search(YES, low):
        return "confirm"
    if "reject" in vals and re.search(NO, low):
        return "reject"
    if "none" in vals and re.search(NONE, low):
        return "none"
    for o in options:  # label mentioned (tag / phase / name)
        lab = o["label"].lower()
        core = re.sub(r"[^a-z0-9]", "", lab)
        if lab and (lab in low or (len(core) >= 3 and core in re.sub(r"[^a-z0-9]", "", low))):
            return o["value"]
    for o in options:  # distinctive number in label, e.g. "1022"
        nums = re.findall(r"\d{3,4}", o["label"])
        if nums and any(n in low for n in nums) and sum(1 for p in options if any(n in p["label"] for n in nums)) == 1:
            return o["value"]
    for st, rx in STATUS_WORDS.items():
        if st in vals and re.search(rx, low):
            return st
    for i, rx in ORDINALS.items():
        if i < len(options) and re.search(rx, low) and options[i]["value"] not in ("none",):
            return options[i]["value"]
    return None


def answer(db: Session, sid: str, value: str, lang: str, reporter: str) -> list[dict]:
    s = _session(db, sid)
    p = s.get("pending")
    if not p:
        return [_say(db, sid, "Koi sawaal pending nahi hai." if _hi(lang) else "There is no pending question.", lang)]
    if p["type"] == "chaser":
        return _chaser_answer(db, sid, value, "", lang, reporter)
    s.pop("pending", None)
    _save_session(db, sid, s)
    r = R.answer(db, p["report_id"], value, actor=reporter)
    out = []
    if r.status == "applied":
        out.append(reply_for_report(db, sid, r, lang))
    elif r.status == "rejected":
        out.append(_say(db, sid, "Theek hai, update cancel kar diya (log me record hai)." if _hi(lang) else
                        "OK, I've cancelled that update. It's still recorded in the audit log.", lang, r.id))
    else:
        out.append(_say(db, sid, "Theek hai, planner ko bhej diya." if _hi(lang) else
                        "OK, I've passed it to the planner to decide.", lang, r.id))
    return out


def message(db: Session, sid: str, text: str, lang: str = "en-IN", reporter: str = "Site supervisor",
            discipline: str | None = None, photo_id: int | None = None, channel: str = "chat") -> list[dict]:
    text = (text or "").strip()
    if not text:
        return [_say(db, sid, "Kuch sunai nahi diya, dobara boliye." if _hi(lang) else "I didn't catch that - please say it again.", lang)]
    db.add(ChatMessage(session_id=sid, role="user", text=text, lang=lang, payload={"photo_id": photo_id, "channel": channel}))
    db.flush()
    s = _session(db, sid)
    s.update(reporter=reporter, discipline=discipline)
    _save_session(db, sid, s)
    p = s.get("pending")
    if p:
        if p["type"] == "chaser":
            v = _match_option(text, p["options"])
            if v:
                return _chaser_answer(db, sid, v, text, lang, reporter)
        else:
            v = _match_option(text, p["options"])
            if v:
                return answer(db, sid, v, lang, reporter)
        # not an answer: park the earlier item for the planner so nothing is stuck, then continue
        if p["type"] == "question":
            r = db.get(Report, p["report_id"])
            if r and r.status == "awaiting_supervisor":
                r.status = "awaiting_planner"
                ledger.append(db, "CLARIFICATION_UNANSWERED", {"moved_to": "planner queue"}, report_id=r.id,
                              actor="assistant")
        s.pop("pending", None)
        _save_session(db, sid, s)
    if re.search(EOD, text.lower()):
        return end_of_day(db, sid, lang, reporter, discipline)
    ext = extract(text, date.fromisoformat(project_today(db)))
    has_content = ext["phase"] or ext["tags"] or ext["quantity"] or ext["status"]
    if re.search(GREETING, text.lower()) and not has_content:
        return [_say(db, sid, "Namaste! Aaj ka progress boliye - jaise 'line 1021 ke 3 spool erect ho gaye'." if _hi(lang)
                     else "Hello! Tell me today's progress - for example 'F-12 concrete pour completed, 42 cum'.", lang)]
    if not has_content:
        return [_say(db, sid, "Mujhe progress details nahi mili. Kaunsa kaam, kis tag/line pe, aur kitna hua?" if _hi(lang)
                     else "I couldn't find progress details. Which work, on which tag or line, and how much was done?", lang)]
    r = R.submit_report(db, text, reporter=reporter, reporter_discipline=discipline, channel=channel,
                        photo_id=photo_id, session_id=sid)
    return [reply_for_report(db, sid, r, lang)]


# ------------------------------------------------------------------ end-of-day missing-update chaser
CHASER_OPTIONS = [{"value": "progress", "label": "Worked - in progress"}, {"value": "complete", "label": "Completed"},
                  {"value": "no_work", "label": "No work today"}, {"value": "skip", "label": "Skip"},
                  {"value": "stop", "label": "Stop"}]
CHASER_OPTIONS_MATCH = CHASER_OPTIONS + [{"value": "no_work", "label": "nahi hua"}, {"value": "no_work", "label": "no work"},
                                         {"value": "skip", "label": "baad me"}, {"value": "stop", "label": "bas"},
                                         {"value": "progress", "label": "kaam hua"}, {"value": "progress", "label": "worked"}]


def gaps_for_today(db: Session, discipline: str | None = None) -> list[Activity]:
    today = project_today(db)
    q = select(Activity).where(Activity.actual_finish.is_(None), Activity.planned_start <= today,
                               Activity.planned_finish >= today)
    if discipline:
        q = q.where(Activity.discipline == discipline)
    planned_today = list(db.execute(q).scalars())
    reported = {e.activity_id for e in db.execute(select(ActualEvent).where(ActualEvent.event_date == today)).scalars()}
    reported |= {r.activity_id for r in db.execute(select(Report).where(Report.report_date == today)).scalars() if r.activity_id}
    gaps = [a for a in planned_today if a.activity_id not in reported]
    gaps.sort(key=lambda a: (a.planned_finish, a.activity_id))
    return gaps


def end_of_day(db: Session, sid: str, lang: str, reporter: str, discipline: str | None) -> list[dict]:
    gaps = gaps_for_today(db, discipline)
    hi = _hi(lang)
    ledger.append(db, "END_OF_DAY_CHECK", {"discipline": discipline, "gaps": [a.activity_id for a in gaps]}, actor=reporter)
    if not gaps:
        return [_say(db, sid, "Aaj ke sabhi planned kaam ka update aa gaya hai. Shukriya!" if hi else
                     "Every activity planned for today has an update. Thank you!", lang)]
    names = ", ".join(a.name for a in gaps[:3]) + (f" (+{len(gaps) - 3} more)" if len(gaps) > 3 else "")
    queue = [a.activity_id for a in gaps[:5]]
    s = _session(db, sid)
    s["pending"] = {"type": "chaser", "queue": queue, "idx": 0, "options": CHASER_OPTIONS_MATCH}
    _save_session(db, sid, s)
    intro = (f"End of day check: {len(gaps)} planned activities have no update today: {names}." if not hi else
             f"Din ka check: {len(gaps)} planned kaam ka aaj update nahi aaya: {names}.")
    out = [_say(db, sid, intro, lang, gaps=[{"activity_id": a.activity_id, "name": a.name} for a in gaps])]
    out.append(_ask_chaser(db, sid, gaps[0], lang))
    return out


def _ask_chaser(db: Session, sid: str, a: Activity, lang: str) -> dict:
    q = (f"{a.name}: aaj kya hua?" if _hi(lang) else f"{a.name}: what happened today?")
    return _say(db, sid, q, lang, options=CHASER_OPTIONS, question=True, chaser_activity=a.activity_id)


def _chaser_answer(db: Session, sid: str, value: str, text: str, lang: str, reporter: str) -> list[dict]:
    s = _session(db, sid)
    p = s["pending"]
    aid = p["queue"][p["idx"]]
    a = db.get(Activity, aid)
    out = []
    today = project_today(db)
    if value in ("progress", "complete"):
        word = "completed" if value == "complete" else "in progress"
        qty = ""
        e = extract(text, date.fromisoformat(today)) if text else None
        if e and e.get("quantity"):
            qty = " " + e["quantity"]["evidence"]
        rtext = f"{a.tag} {PHASE_LABEL.get(a.phase, a.phase).lower()} {word}{qty} today"
        r = submit_confirmed(db, rtext, a.activity_id, value, reporter, sid)
        out.append(reply_for_report(db, sid, r, lang))
    elif value == "no_work":
        ledger.append(db, "NO_WORK_REPORTED", {"activity": {"id": a.activity_id, "name": a.name}, "date": today},
                      activity_id=a.activity_id, actor=reporter)
        out.append(_say(db, sid, "Noted: aaj kaam nahi hua." if _hi(lang) else "Noted: no work today. Logged for the planner.", lang))
    p["idx"] += 1
    if p["idx"] < len(p["queue"]) and value != "stop":
        s["pending"] = p
        _save_session(db, sid, s)
        out.append(_ask_chaser(db, sid, db.get(Activity, p["queue"][p["idx"]]), lang))
    else:
        s.pop("pending", None)
        _save_session(db, sid, s)
        out.append(_say(db, sid, "Ho gaya, shukriya! Safe raho." if _hi(lang) else "That's all the gaps. Thanks - stay safe!", lang))
    return out


def submit_confirmed(db: Session, text: str, activity_id: str, event: str, reporter: str, sid: str | None) -> Report:
    """A supervisor explicitly answered for a named activity (end-of-day chaser)."""
    eng = get_engine(db)
    rd = project_today(db)
    from .core import DbState

    res = eng.analyze(text, date.fromisoformat(rd), None, DbState(db))
    a = db.get(Activity, activity_id)
    res["decision"] = {"kind": policy.AUTO_APPLY, "activity_id": activity_id, "confidence": 1.0,
                       "message": "Supervisor answered for this activity in the end-of-day check."}
    ext = res["extraction"]
    ext["status"] = {"value": event, "start": None, "end": None, "evidence": "end-of-day answer", "source": "supervisor"}
    r = Report(text=text, reporter=reporter, channel="chaser", report_date=rd, session_id=sid, status="processing",
               decision=policy.AUTO_APPLY, confidence=1.0, activity_id=activity_id, analysis=res,
               model_version=res["model_version"])
    db.add(r)
    db.flush()
    ledger.append(db, "DECISION_SUPERVISOR_CONFIRMED", {"activity": {"id": a.activity_id, "name": a.name},
                                                        "text": text, "event": event}, report_id=r.id,
                  activity_id=activity_id, actor=reporter)
    R.apply_to_activity(db, r, activity_id, approver=f"{reporter} (end-of-day check)", confidence=1.0,
                        event_override=event)
    return r
