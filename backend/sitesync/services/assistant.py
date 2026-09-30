"""Site Assistant: context-aware two-way conversation with a supervisor (English / Hindi / Hinglish).

The browser does speech-to-text and text-to-speech; this module decides what to do and say.
Every turn is routed by intent, with a small per-session context (last report, last activity,
pending question, pending photo):

  pending answer    tap / spoken answer to a clarification, sequence check or end-of-day question
  control           help, thanks, undo, "why?", language switch, cancel
  correction        "no, it was line 1022" -> re-link the last update
  queries           status of a tag, today's plan, delays, my reports, institutional memory
  end of day        missing-update chaser
  progress report   one or several updates in one message, with context carry-over ("aur 2 ho gaye")

Replies in hi-IN mode are romanised Hinglish (what site teams actually type).
"""
from __future__ import annotations

import re
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import ledger
from ..db import Activity, ActualEvent, ChatMessage, Photo, Report
from ..engine import policy
from ..engine.candidates import activity_keys, tag_score
from ..engine.extractor import extract
from ..engine.lexicon import PHASE_LABEL
from . import dashboard
from . import memory as memory_svc
from . import reports as R
from .core import DbState, get_engine, get_setting, project_today, set_setting

# ------------------------------------------------------------------ intent patterns
ORDINALS = {0: r"\b(first|1st|pehl[aie]|one|ek|number one|upar wala)\b", 1: r"\b(second|2nd|dusr[aie]|doosr[aie]|two|number two|neeche wala)\b",
            2: r"\b(third|3rd|teesr[aie]|three|teen)\b"}
YES = r"\b(yes|haan|han|ha|haa|confirm|correct|sahi|theek|ok|okay|ji haan|bilkul)\b"
NO = r"\b(no|nahi|nahin|nope|cancel|galat|wrong|reject)\b"
NONE = r"\b(none|neither|koi nahi|dono nahi|kuch nahi|not these|none of these)\b"
STATUS_WORDS = {"complete": r"complet|\bdone\b|finish|ho gaya|ho gya|\bpura\b|khatam",
                "start": r"\bstart|shuru|begin|began", "progress": r"progress|chal raha|jaari|ongoing|continu|kaam hua|worked"}
GREETING = r"^\s*(hi|hello|hey|namaste|namaskar|good (morning|evening|afternoon)|ram ram)\b"
EOD = r"\b(end of (the )?day|eod|din khatam|aaj ka kaam khatam|day end|shift over|chaser|missing updates?)\b"
HELP = r"^\s*(help|madad|what can you do|kya kar sakte|commands|options|guide)\b|\bhow (do|can) i (use|report)\b"
THANKS = r"^\s*(thanks|thank you|thx|ty|shukriya|dhanyavad|dhanyawad|ok thanks|great|badhiya)\b\W*$"
UNDO = r"^\s*(undo|revert|galti ho gayi|galat update|wapas lo|hatao|remove (that|it|last)|delete (that|it|last)|cancel (that|last)( update)?|last update (was )?wrong)\b"
WHY = r"^\s*(why|kyon|kyun|kyu|explain|reason|kaise pata)\b"
LANG_HI = r"\b(hindi (me|mein|main|mai)|speak hindi|hindi please|hindi mein bolo)\b"
LANG_EN = r"\b(english (me|mein|please)|speak english|in english)\b"
CANCEL = r"^\s*(cancel|chhodo|rehne do|never ?mind|skip it|baad me)\b"
CORRECT = r"^\s*(no|nahi|nahin|not|galat|wrong|actually|sorry|i meant|matlab)\b|\b(it was|woh|wo) .{0,30}\b(tha|thi|was)\b|\bchange (it|that) to\b"
QUESTION = (r"\?\s*$|^\s*(what|whats|what's|how|when|which|where|is|are|has|have|did|does|kya|kitna|kitni|kitne|kab|kaun|kaunsa|"
            r"kaise|batao|bataiye|bata|tell me|show me|give me|list)\b|\b(status of|progress of|kitna hua|kya status|kaha tak|how far|how much|batao)\b")
DELAY_Q = r"delay|late|behind|slip|peeche|\bder\b|overdue|stuck|lagging"
PLAN_Q = r"\btoday\b|\baaj\b|\bplan|schedule|planned|kya karna|what should|to ?do|kaam hai|next"
MY_Q = r"\bmy\b|\bmaine\b|\bmera\b|\bmere\b|what did i|i reported|reported today|kya report"
MEMORY_Q = r"typical|average|usually|normally|how long|kitna time|kitne din|productivity|duration|historically"
STATUS_Q = r"status|progress|kitna|how much|how far|kaha tak|done|complete|hua"
SPLIT_HARD = re.compile(r"\s*(?:[;\n]+|(?<=[a-z0-9%)])\.\s+)\s*", re.I)
SPLIT_SOFT = re.compile(r"\s+(?:and|aur|also|plus|then|phir)\s+|\s*,\s+(?=\S)", re.I)


# ------------------------------------------------------------------ session + message helpers
def _session(db: Session, sid: str) -> dict:
    return dict(get_setting(db, f"session:{sid}", {}))


def _save_session(db: Session, sid: str, s: dict) -> None:
    set_setting(db, f"session:{sid}", s)


def _hi(lang: str) -> bool:
    return lang.lower().startswith("hi")


def _t(lang: str, en: str, hi: str) -> str:
    return hi if _hi(lang) else en


def _user(db: Session, sid: str, text: str, lang: str, **payload) -> None:
    db.add(ChatMessage(session_id=sid, role="user", text=text, lang=lang, payload=payload))
    db.flush()


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


def clear_history(db: Session, sid: str) -> None:
    for m in db.execute(select(ChatMessage).where(ChatMessage.session_id == sid)).scalars():
        db.delete(m)
    _save_session(db, sid, {})


def _sug(lang: str, *keys: str) -> list[dict]:
    en = {"plan": ("What's planned today?", "what is planned today"), "delay": ("What's delayed?", "what is delayed"),
          "eod": ("End of day", "end of day"), "help": ("What can you do?", "help"), "undo": ("Undo", "undo"),
          "why": ("Why?", "why"), "mine": ("My updates today", "what did i report today")}
    hi = {"plan": ("Aaj ka plan", "aaj kya plan hai"), "delay": ("Kya delay hai?", "kya delay hai"),
          "eod": ("Din khatam", "din khatam"), "help": ("Madad", "madad"), "undo": ("Undo", "undo"),
          "why": ("Kyun?", "why"), "mine": ("Mere updates", "maine aaj kya report kiya")}
    src = hi if _hi(lang) else en
    return [{"label": src[k][0], "text": src[k][1]} for k in keys]


def _flag(a: Activity, today: date) -> str | None:
    f = dashboard.delay_status(a, today)
    return f["level"] if f else None


def _item(a: Activity, today: date) -> dict:
    return {"activity_id": a.activity_id, "name": a.name, "tag": a.tag, "pct": round(a.pct, 1), "planned_start": a.planned_start,
            "planned_finish": a.planned_finish, "actual_start": a.actual_start, "actual_finish": a.actual_finish,
            "last_update": a.last_update, "flag": _flag(a, today)}


# ------------------------------------------------------------------ report replies
def reply_for_report(db: Session, sid: str, r: Report, lang: str, context_note: str | None = None) -> dict:
    dec = r.analysis["decision"]
    cands = r.analysis["candidates"]
    kind = dec["kind"]
    note = f" ({context_note})" if context_note else ""
    if r.status in ("applied", "new_activity_created"):
        a = db.get(Activity, r.activity_id)
        ev = db.execute(select(ActualEvent).where(ActualEvent.report_id == r.id).order_by(ActualEvent.id.desc())).scalars().first()
        credit = f" ({ev.credit_note})" if ev and ev.credit_note and not _hi(lang) else ""
        photo = _t(lang, " Photo saved as evidence.", " Photo evidence save ho gayi.") if r.photo_id else ""
        txt = _t(lang, f"Got it{note}. {a.name} is now {a.pct:.0f}% complete{credit}.{photo}",
                 f"Update ho gaya{note}: {a.name} ab {a.pct:.0f}% hai.{photo}")
        return _say(db, sid, txt, lang, r.id, kind="update", decision=kind, confidence=r.confidence,
                    activity_id=a.activity_id, status="applied", pct=a.pct, activity_name=a.name,
                    suggestions=_sug(lang, "undo", "why", "plan"))
    if kind in (policy.CLARIFY, policy.CONFIRM_SEQUENCE) and r.status == "awaiting_supervisor":
        q = dec.get("question_hi") if _hi(lang) else dec.get("question")
        if kind == policy.CONFIRM_SEQUENCE:
            q = _t(lang, "Sequence check: ", "Dhyan dein: ") + q
        s = _session(db, sid)
        s["pending"] = {"type": "question", "report_id": r.id, "options": dec.get("options", [])}
        _save_session(db, sid, s)
        return _say(db, sid, q, lang, r.id, kind="question", decision=kind, confidence=r.confidence,
                    options=dec.get("options", []), question=True)
    if kind == policy.NEW_ACTIVITY:
        prop = dec.get("proposal") or {}
        txt = _t(lang, "This doesn't match any planned activity, so I've flagged it as possible NEW work for the planner"
                       f"{' under ' + prop['parent_wbs'] if prop.get('parent_wbs') else ''}.",
                 "Yeh kisi planned activity se match nahi hua. Planner ke liye NEW activity ke roop me flag kar diya.")
        return _say(db, sid, txt, lang, r.id, kind="update", decision=kind, confidence=r.confidence,
                    suggestions=_sug(lang, "why", "plan"))
    top = cands[0]["activity"]["name"] if cands else "an activity"
    txt = _t(lang, f"I think this is '{top}' ({r.confidence * 100:.0f}% confidence), but I'm not sure enough, "
                   "so I've sent it to the planner for review.",
             f"Mujhe lagta hai yeh '{top}' hai ({r.confidence * 100:.0f}% confidence), par pakka nahi - planner ko review ke liye bhej diya.")
    return _say(db, sid, txt, lang, r.id, kind="update", decision=kind, confidence=r.confidence,
                suggestions=_sug(lang, "why", "delay"))


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
        if i < len(options) and re.search(rx, low) and options[i]["value"] != "none":
            return options[i]["value"]
    return None


def _normalized_for_matching(text: str) -> str:
    """Spoken answers may arrive in Devanagari ("पहला वाला", "हाँ"): match on the normalised form."""
    from ..engine.extractor import Normalized

    return Normalized(text).norm + " " + text.lower()


def answer(db: Session, sid: str, value: str, lang: str, reporter: str, label: str | None = None) -> list[dict]:
    s = _session(db, sid)
    p = s.get("pending")
    if not p:
        return [_say(db, sid, _t(lang, "There's no question waiting for an answer.", "Koi sawaal pending nahi hai."), lang,
                     suggestions=_sug(lang, "plan", "help"))]
    opt = next((o for o in p.get("options", []) if o["value"] == value), None)
    _user(db, sid, label or (opt["label"] if opt else value), lang, channel="tap")
    if p["type"] == "chaser":
        return _chaser_answer(db, sid, value, "", lang, reporter)
    s.pop("pending", None)
    _save_session(db, sid, s)
    return _resolve_question(db, sid, p["report_id"], value, lang, reporter)


def _resolve_question(db: Session, sid: str, report_id: int, value: str, lang: str, reporter: str) -> list[dict]:
    r = R.answer(db, report_id, value, actor=reporter)
    _remember(db, sid, r)
    if r.status == "applied":
        return [reply_for_report(db, sid, r, lang)]
    if r.status == "rejected":
        return [_say(db, sid, _t(lang, "OK, I've cancelled that update. It's still recorded in the audit log.",
                                 "Theek hai, update cancel kar diya (audit log me record hai)."), lang, r.id,
                     suggestions=_sug(lang, "plan"))]
    return [_say(db, sid, _t(lang, "OK, I've passed it to the planner to decide.", "Theek hai, planner ko bhej diya."),
                 lang, r.id, suggestions=_sug(lang, "plan", "delay"))]


def _remember(db: Session, sid: str, r: Report) -> None:
    s = _session(db, sid)
    s["last_report_id"] = r.id
    if r.activity_id:
        s["last_activity_id"] = r.activity_id
    _save_session(db, sid, s)


# ------------------------------------------------------------------ main entry point
def message(db: Session, sid: str, text: str, lang: str = "en-IN", reporter: str = "Site supervisor",
            discipline: str | None = None, photo_id: int | None = None, channel: str = "chat") -> list[dict]:
    text = (text or "").strip()
    s = _session(db, sid)
    s.update(reporter=reporter, discipline=discipline, lang=lang)
    _save_session(db, sid, s)
    if not text and photo_id:
        return _photo_only(db, sid, photo_id, lang, reporter)
    if not text:
        return [_say(db, sid, _t(lang, "I didn't catch that - please say it again.", "Kuch sunai nahi diya, dobara boliye."), lang)]
    _user(db, sid, text, lang, photo_id=photo_id, channel=channel)
    low = text.lower()
    norm = _normalized_for_matching(text)
    from ..engine.extractor import Normalized

    norm_only = Normalized(text).norm

    def said(rx: str) -> bool:
        return bool(re.search(rx, low) or re.search(rx, norm_only))

    # 1) answer to a pending question (a message naming a *different* tag is a new report, not an answer)
    p = s.get("pending")
    if p:
        v = _match_option(norm, p["options"])
        if v and p["type"] == "chaser":
            tags = extract(text, date.fromisoformat(project_today(db)))["tags"]
            cur = db.get(Activity, p["queue"][p["idx"]])
            if tags and cur and not any(t["value"].upper() in cur.tag.upper() or cur.tag.upper().endswith(t["value"].upper())
                                        for t in tags):
                v = None
        if v:
            if p["type"] == "chaser":
                return _chaser_answer(db, sid, v, text, lang, reporter)
            s.pop("pending", None)
            _save_session(db, sid, s)
            return _resolve_question(db, sid, p["report_id"], v, lang, reporter)
        if said(CANCEL):
            return [_park_pending(db, sid, lang, explicit=True)]

    # 2) control intents
    if said(HELP):
        return [_help(db, sid, lang)]
    if said(LANG_HI):
        return [_say(db, sid, "Theek hai, ab main Hinglish me jawab dunga.", "hi-IN", set_lang="hi-IN", suggestions=_sug("hi-IN", "plan", "help"))]
    if said(LANG_EN):
        return [_say(db, sid, "Sure - I'll reply in English from now on.", "en-IN", set_lang="en-IN", suggestions=_sug("en-IN", "plan", "help"))]
    if said(THANKS):
        return [_say(db, sid, _t(lang, "You're welcome! Send the next update whenever you're ready.", "Koi baat nahi! Agla update jab chahe bhejiye."),
                     lang, suggestions=_sug(lang, "plan", "eod"))]
    if said(UNDO):
        return [_undo(db, sid, lang, reporter)]
    if said(WHY) and len(text) < 40:
        return [_why(db, sid, lang)]

    ext = extract(text, date.fromisoformat(project_today(db)), discipline)
    has_tag = bool(ext["tags"])

    # 3) correction of the previous update ("no, it was line 1022")
    if has_tag and s.get("last_report_id") and said(CORRECT) and not ext["quantity"]:
        out = _correct_last(db, sid, ext, lang, reporter)
        if out:
            return [out]

    # 4) end of day
    if said(EOD):
        if p:
            _park_pending(db, sid, lang)
        return end_of_day(db, sid, lang, reporter, discipline, log_user=False)

    # 5) questions
    if said(QUESTION) and not (ext["quantity"] and ext["status"] and not text.rstrip().endswith("?")):
        return [_query(db, sid, text, norm, ext, lang, discipline, reporter)]

    has_content = ext["phase"] or ext["tags"] or ext["quantity"] or ext["status"]
    if said(GREETING) and not has_content:
        return [_say(db, sid, _t(lang, "Hello! Tell me today's progress - for example 'F-12 concrete pour completed, 42 cum'. "
                                       "You can also ask 'what's planned today?' or 'status of line 1021'.",
                                 "Namaste! Aaj ka progress boliye - jaise 'line 1021 ke 3 spool erect ho gaye'. "
                                 "Aap 'aaj kya plan hai?' bhi puch sakte hain."), lang, suggestions=_sug(lang, "plan", "delay", "help"))]
    if not has_content:
        return [_say(db, sid, _t(lang, "I couldn't find progress details. Which work, on which tag or line, and how much was done?",
                                 "Mujhe progress details nahi mili. Kaunsa kaam, kis tag/line pe, aur kitna hua?"),
                     lang, suggestions=_sug(lang, "help", "plan"))]

    # 6) progress report(s)
    if p:
        _park_pending(db, sid, lang)
    if not photo_id and s.get("pending_photo_id"):
        photo_id = s["pending_photo_id"]
        s = _session(db, sid)
        s.pop("pending_photo_id", None)
        _save_session(db, sid, s)
    return _progress(db, sid, text, lang, reporter, discipline, photo_id, channel)


def _park_pending(db: Session, sid: str, lang: str, explicit: bool = False) -> dict | None:
    """Supervisor moved on without answering: the item goes to the planner so nothing is stuck."""
    s = _session(db, sid)
    p = s.pop("pending", None)
    _save_session(db, sid, s)
    if p and p["type"] == "question":
        r = db.get(Report, p["report_id"])
        if r and r.status == "awaiting_supervisor":
            r.status = "awaiting_planner"
            ledger.append(db, "CLARIFICATION_UNANSWERED", {"moved_to": "planner queue"}, report_id=r.id, actor="assistant")
    if explicit:
        return _say(db, sid, _t(lang, "OK, I've left that one for the planner.", "Theek hai, woh planner dekh lenge."), lang,
                    suggestions=_sug(lang, "plan"))
    return None


# ------------------------------------------------------------------ progress (multi-update + context)
def split_updates(text: str, today: date) -> list[str]:
    """Split 'F-12 pour done and CT-B-07 pulling started' into separate updates (each part needs a tag)."""
    parts = [p for p in SPLIT_HARD.split(text) if p and p.strip()]
    out: list[str] = []
    for part in parts:
        soft = [x for x in SPLIT_SOFT.split(part) if x and x.strip()]
        if len(soft) > 1 and all(extract(x, today)["tags"] for x in soft):
            out.extend(x.strip() for x in soft)
        else:
            out.append(part.strip())
    # a trailing fragment without any content belongs to the previous part ("... done. Thanks")
    merged: list[str] = []
    for x in out:
        e = extract(x, today)
        if merged and not (e["phase"] or e["tags"] or e["quantity"] or e["status"]):
            merged[-1] = f"{merged[-1]} {x}"
        else:
            merged.append(x)
    return merged or [text]


def _with_context(db: Session, sid: str, text: str, today: date) -> tuple[str, str | None]:
    """'aur 2 ho gaye' right after a line-1021 update -> attach line 1021 (transparently)."""
    s = _session(db, sid)
    aid = s.get("last_activity_id")
    if not aid:
        return text, None
    a = db.get(Activity, aid)
    if a is None or a.actual_finish:
        return text, None
    e = extract(text, today)
    if e["tags"] or e["area"]:
        return text, None
    same_phase = e["phase"] and e["phase"]["value"] == a.phase
    if (e["quantity"] or e["status"]) and (e["phase"] is None or same_phase):
        label = PHASE_LABEL.get(a.phase, a.phase).lower()
        return f"{a.tag} {label}: {text}", f"assuming {a.tag} {label} from your last update"
    return text, None


def _progress(db: Session, sid: str, text: str, lang: str, reporter: str, discipline: str | None,
              photo_id: int | None, channel: str) -> list[dict]:
    today = date.fromisoformat(project_today(db))
    parts = split_updates(text, today)
    out: list[dict] = []
    asked = False
    if len(parts) > 1:
        out.append(_say(db, sid, _t(lang, f"I found {len(parts)} separate updates in that message:",
                                    f"Is message me {len(parts)} alag updates mile:"), lang, kind="info"))
    for i, part in enumerate(parts):
        eff, note = _with_context(db, sid, part, today)
        r = R.submit_report(db, eff, reporter=reporter, reporter_discipline=discipline, channel=channel,
                            photo_id=photo_id if i == 0 else None, session_id=sid)
        if note:
            r.analysis = {**r.analysis, "context_note": note, "original_text": part}
        if r.status == "awaiting_supervisor" and asked:
            r.status = "awaiting_planner"  # only one open question at a time; the rest go to the planner
        elif r.status == "awaiting_supervisor":
            asked = True
        _remember(db, sid, r)
        out.append(reply_for_report(db, sid, r, lang, context_note=note))
    return out


def _photo_only(db: Session, sid: str, photo_id: int, lang: str, reporter: str) -> list[dict]:
    _user(db, sid, _t(lang, "📷 Photo", "📷 Photo"), lang, photo_id=photo_id, channel="photo")
    s = _session(db, sid)
    r = db.get(Report, s["last_report_id"]) if s.get("last_report_id") else None
    if r and r.photo_id is None and r.report_date == project_today(db):
        r.photo_id = photo_id
        p = db.get(Photo, photo_id)
        if p:
            p.report_id = r.id
        ledger.append(db, "PHOTO_ATTACHED", {"photo": {"id": photo_id, "sha256": p.sha256 if p else None}},
                      report_id=r.id, activity_id=r.activity_id, actor=reporter)
        name = db.get(Activity, r.activity_id).name if r.activity_id else "your last update"
        return [_say(db, sid, _t(lang, f"Photo attached as evidence to {name}.", f"Photo {name} ke saath evidence me jod di."),
                     lang, r.id, kind="info", suggestions=_sug(lang, "plan"))]
    s["pending_photo_id"] = photo_id
    _save_session(db, sid, s)
    return [_say(db, sid, _t(lang, "Got the photo. What work does it show? I'll attach it to that update.",
                             "Photo mil gayi. Isme kaunsa kaam hai? Main use us update ke saath jod dunga."), lang)]


# ------------------------------------------------------------------ control intents
def _help(db: Session, sid: str, lang: str) -> dict:
    caps = [
        (_t(lang, "Report progress", "Progress batayein"), "F-12 pour done 42 cum · line 1021 ke 3 of 12 spool erect"),
        (_t(lang, "Several updates at once", "Ek saath kai updates"), "F-12 pour done and CT-B-07 cable pulling started"),
        (_t(lang, "Follow-ups", "Aage ka update"), "aur 2 ho gaye (uses your last activity)"),
        (_t(lang, "Ask status", "Status puchein"), "status of line 1021? · F-12 kitna hua?"),
        (_t(lang, "Today's plan / delays", "Aaj ka plan / delay"), "what's planned today? · kya delay hai?"),
        (_t(lang, "Fix mistakes", "Galti sudharein"), "undo · no, it was line 1022"),
        (_t(lang, "Explain", "Samjhayein"), "why?"),
        (_t(lang, "Photo evidence", "Photo evidence"), "attach a photo, then send the update"),
        (_t(lang, "End of day", "Din khatam"), "end of day - I'll chase missing updates"),
        (_t(lang, "History", "Purana data"), "typical duration for piping erection"),
    ]
    txt = _t(lang, "Here's what I can do - just speak or type naturally:", "Main yeh sab kar sakta hoon - bas bol dijiye ya likhiye:")
    return _say(db, sid, txt, lang, kind="help", items=[{"title": a, "detail": b} for a, b in caps],
                suggestions=_sug(lang, "plan", "delay", "eod"))


def _undo(db: Session, sid: str, lang: str, reporter: str) -> dict:
    s = _session(db, sid)
    rid = s.get("last_report_id")
    r = db.get(Report, rid) if rid else None
    if r is None:
        return _say(db, sid, _t(lang, "There's no recent update of yours to undo.", "Undo karne ke liye koi haal ka update nahi hai."), lang)
    if r.status in ("awaiting_planner", "awaiting_supervisor"):
        R.planner_action(db, r.id, "reject", planner=f"{reporter} (withdrawn)")
        s.pop("pending", None)
        _save_session(db, sid, s)
        return _say(db, sid, _t(lang, "Withdrawn - that update won't be applied. It stays in the audit log.",
                                "Woh update wapas le liya - apply nahi hoga. Audit log me record rahega."), lang, r.id,
                    kind="info", suggestions=_sug(lang, "plan"))
    try:
        a = R.revert_report(db, r.id, reporter)
    except R.WorkflowError as e:
        return _say(db, sid, str(e), lang, r.id)
    return _say(db, sid, _t(lang, f"Undone. {a.name} is back to {a.pct:.0f}%. The reversal is logged in the audit trail.",
                            f"Undo ho gaya. {a.name} wapas {a.pct:.0f}% par hai. Audit trail me log hai."), lang, r.id,
                kind="update", status="reverted", activity_id=a.activity_id, pct=a.pct, activity_name=a.name,
                suggestions=_sug(lang, "plan"))


def _why(db: Session, sid: str, lang: str) -> dict:
    s = _session(db, sid)
    r = db.get(Report, s["last_report_id"]) if s.get("last_report_id") else None
    if r is None or not r.analysis.get("candidates"):
        return _say(db, sid, _t(lang, "Send me an update first - then I can explain how I linked it.",
                                "Pehle ek update bhejiye - phir main bataunga maine use kaise link kiya."), lang)
    c = r.analysis["candidates"][0]
    pos = [x["label"] for x in c["reasons"] if x["polarity"] == "+"][:4]
    neg = [x["label"] for x in c["reasons"] if x["polarity"] == "-"][:3]
    seen, ev = set(), []
    for x in r.analysis.get("evidence_spans", []):
        w = r.text[x["start"]:x["end"]]
        if x["field"] in ("phase", "status", "quantity", "tag", "date", "new_work_cue") and w.lower() not in seen:
            seen.add(w.lower())
            ev.append((w, x["field"]))
    words = ", ".join(f"'{w}' ({f})" for w, f in ev[:5])
    txt = _t(lang,
             f"Best match was {c['activity']['name']} at {c['confidence'] * 100:.0f}% confidence. "
             f"I read {words or 'no clear evidence'}. For: {', '.join(pos) or 'none'}."
             + (f" Against: {', '.join(neg)}." if neg else ""),
             f"Sabse accha match {c['activity']['name']} tha ({c['confidence'] * 100:.0f}% confidence). "
             f"Maine padha: {words or 'kuch saaf nahi'}. Paksh me: {', '.join(pos) or 'kuch nahi'}."
             + (f" Vipaksh me: {', '.join(neg)}." if neg else ""))
    return _say(db, sid, txt, lang, r.id, kind="why", reasons=c["reasons"], confidence=c["confidence"],
                suggestions=_sug(lang, "undo", "plan"))


def _find_by_tags(db: Session, ext: dict, phase: str | None = None) -> list[Activity]:
    acts = list(db.execute(select(Activity)).scalars())
    scored = []
    for a in acts:
        d = {"tag": a.tag, "tag_type": a.tag_type}
        try:
            sc, _ = tag_score(ext["tags"], d, activity_keys(d))
        except (AttributeError, KeyError, TypeError):
            continue
        if sc >= 0.45:  # a misheard service letter still matches on the line number
            scored.append((sc, a))
    if not scored:
        return []
    best = max(s for s, _ in scored)
    out = [a for s, a in scored if s >= best - 1e-9]
    if phase:
        out = [a for a in out if a.phase == phase] or out
    return sorted(out, key=lambda a: a.planned_start)


def _correct_last(db: Session, sid: str, ext: dict, lang: str, reporter: str) -> dict | None:
    s = _session(db, sid)
    r = db.get(Report, s["last_report_id"])
    if r is None:
        return None
    prev = db.get(Activity, r.activity_id) if r.activity_id else None
    phase = (ext.get("phase") or {}).get("value") or (prev.phase if prev else None)
    matches = _find_by_tags(db, ext, phase)
    if phase:
        matches = [a for a in matches if a.phase == phase]
    if len(matches) != 1:
        return None
    target = matches[0]
    try:
        R.supervisor_fix(db, r.id, target.activity_id, reporter)
    except R.WorkflowError as e:
        return _say(db, sid, str(e), lang, r.id)
    _remember(db, sid, r)
    return _say(db, sid, _t(lang, f"Corrected: that update now counts for {target.name} ({target.pct:.0f}%)"
                                  f"{', and ' + prev.name + ' was restored' if prev else ''}. I'll learn from this.",
                            f"Sudhar diya: update ab {target.name} ({target.pct:.0f}%) me gaya"
                            f"{', ' + prev.name + ' wapas pehle jaisa' if prev else ''}. Main isse seekhunga."),
                lang, r.id, kind="update", status="applied", decision="REVIEW", activity_id=target.activity_id,
                pct=target.pct, activity_name=target.name, suggestions=_sug(lang, "undo", "plan"))


# ------------------------------------------------------------------ queries
def _query(db: Session, sid: str, text: str, norm: str, ext: dict, lang: str, discipline: str | None, reporter: str) -> dict:
    today = date.fromisoformat(project_today(db))
    low = norm.lower()
    if ext["tags"]:
        return _status(db, sid, ext, lang, today)
    if re.search(MEMORY_Q, low):
        res = memory_svc.ask(db, text)
        return _say(db, sid, res["answer"] + " " + _t(lang, "(synthetic-data demo)", "(synthetic data demo)"), lang,
                    kind="memory", note=res.get("note"), suggestions=_sug(lang, "plan", "delay"))
    if re.search(DELAY_Q, low):
        area = (ext.get("area") or {}).get("value")
        dl = dashboard.delays(db, discipline, area)
        if not dl:
            return _say(db, sid, _t(lang, "Nothing is flagged as delayed for you right now.", "Abhi aapke liye koi delay flag nahi hai."),
                        lang, kind="list", items=[], suggestions=_sug(lang, "plan"))
        red = sum(1 for x in dl if x["level"] == "red")
        top = "; ".join(x["name"] for x in dl[:3])
        scope = f"{area} " if area else ""
        txt = _t(lang, f"{len(dl)} {scope}activities are flagged ({red} red). Most urgent: {top}.",
                 f"{len(dl)} {scope}activities flag hain ({red} red). Sabse zaroori: {top}.")
        return _say(db, sid, txt, lang, kind="list", title=_t(lang, "Delay flags", "Delay flags"),
                    items=[{"activity_id": x["activity_id"], "name": x["name"], "pct": x["pct"], "flag": x["level"],
                            "detail": "; ".join(x["reasons"])} for x in dl[:8]], suggestions=_sug(lang, "plan", "eod"))
    if re.search(MY_Q, low):
        rows = list(db.execute(select(Report).where(Report.session_id == sid, Report.report_date == today.isoformat())
                               .order_by(Report.id)).scalars())
        if not rows:
            return _say(db, sid, _t(lang, "You haven't sent any updates today yet.", "Aapne aaj abhi tak koi update nahi bheja."), lang,
                        suggestions=_sug(lang, "plan"))
        from collections import Counter

        cnt = Counter(r.status for r in rows)
        label = {"applied": ("applied", "apply"), "awaiting_planner": ("with the planner", "planner ke paas"),
                 "awaiting_supervisor": ("waiting for your answer", "aapke jawab ka intezaar"),
                 "reverted": ("undone", "undo"), "rejected": ("withdrawn", "wapas"),
                 "new_activity_created": ("new activities", "nayi activity")}
        parts = ", ".join(f"{n} {_t(lang, *label.get(k, (k, k)))}" for k, n in cnt.most_common())
        txt = _t(lang, f"You've sent {len(rows)} update(s) today: {parts}.", f"Aaj aapne {len(rows)} update bheje: {parts}.")
        items = []
        for r in rows[-8:]:
            a = db.get(Activity, r.activity_id) if r.activity_id else None
            items.append({"activity_id": r.activity_id, "name": a.name if a else r.text[:60], "pct": a.pct if a else None,
                          "detail": f"{r.status.replace('_', ' ')} · “{r.text[:50]}”"})
        return _say(db, sid, txt, lang, kind="list", title=_t(lang, "Your updates today", "Aaj ke updates"), items=items,
                    suggestions=_sug(lang, "eod"))
    if re.search(PLAN_Q, low):
        return _plan_today(db, sid, lang, discipline, today)
    s = _session(db, sid)
    if re.search(STATUS_Q, low) and s.get("last_activity_id"):
        a = db.get(Activity, s["last_activity_id"])
        if a:
            return _status_items(db, sid, [a], lang, today, a.tag)
    return _say(db, sid, _t(lang, "I can answer: status of a tag ('status of line 1021?'), today's plan, delays, your updates today, "
                                  "or history ('typical duration for piping erection'). Which one?",
                            "Main bata sakta hoon: kisi tag ka status ('line 1021 kitna hua?'), aaj ka plan, delay, aapke updates, "
                            "ya purana data. Kya chahiye?"), lang, suggestions=_sug(lang, "plan", "delay", "mine"))


def _status(db: Session, sid: str, ext: dict, lang: str, today: date) -> dict:
    phase = (ext.get("phase") or {}).get("value")
    acts = _find_by_tags(db, ext, phase)
    if not acts:
        tag = ", ".join(t["value"] for t in ext["tags"])
        return _say(db, sid, _t(lang, f"I couldn't find {tag} in the schedule.", f"{tag} schedule me nahi mila."), lang,
                    suggestions=_sug(lang, "plan", "help"))
    return _status_items(db, sid, acts[:8], lang, today, acts[0].tag)


def _status_items(db: Session, sid: str, acts: list[Activity], lang: str, today: date, tag: str) -> dict:
    def phrase(a: Activity) -> str:
        p = PHASE_LABEL.get(a.phase, a.phase)
        if a.actual_finish:
            return _t(lang, f"{p} done", f"{p} pura")
        if a.actual_start:
            return f"{p} {a.pct:.0f}%"
        return _t(lang, f"{p} not started", f"{p} shuru nahi")
    summary = ", ".join(phrase(a) for a in acts)
    nxt = next((a for a in acts if not a.actual_finish), None)
    tail = ""
    if nxt is not None:
        f = _flag(nxt, today)
        tail = _t(lang, f" Next: {PHASE_LABEL.get(nxt.phase, nxt.phase).lower()}, planned finish {nxt.planned_finish}"
                        f"{' - flagged ' + f if f else ''}.",
                  f" Agla: {PHASE_LABEL.get(nxt.phase, nxt.phase).lower()}, plan finish {nxt.planned_finish}"
                  f"{' - ' + f + ' flag' if f else ''}.")
    s = _session(db, sid)
    s["last_activity_id"] = (nxt or acts[-1]).activity_id
    _save_session(db, sid, s)
    return _say(db, sid, f"{tag}: {summary}.{tail}", lang, kind="status", title=tag,
                items=[_item(a, today) for a in acts], suggestions=_sug(lang, "plan", "delay"))


def _plan_today(db: Session, sid: str, lang: str, discipline: str | None, today: date) -> dict:
    iso = today.isoformat()
    q = select(Activity).where(Activity.actual_finish.is_(None), Activity.planned_start <= iso, Activity.planned_finish >= iso)
    if discipline:
        q = q.where(Activity.discipline == discipline)
    acts = sorted(db.execute(q).scalars(), key=lambda a: a.planned_finish)
    if not acts:
        return _say(db, sid, _t(lang, "Nothing is planned for you today.", "Aaj aapke liye kuch planned nahi hai."), lang,
                    suggestions=_sug(lang, "delay"))
    updated = {e.activity_id for e in db.execute(select(ActualEvent).where(ActualEvent.event_date == iso)).scalars()}
    pend = [a for a in acts if a.activity_id not in updated]
    txt = _t(lang, f"{len(acts)} activities are planned today; {len(pend)} still have no update. First up: "
                   + "; ".join(a.name for a in pend[:3] or acts[:3]) + ".",
             f"Aaj {len(acts)} activities planned hain; {len(pend)} ka update abhi baaki hai. Pehle: "
             + "; ".join(a.name for a in pend[:3] or acts[:3]) + ".")
    items = [{**_item(a, today), "detail": _t(lang, "updated today", "aaj update hua") if a.activity_id in updated else
              _t(lang, f"due {a.planned_finish}", f"due {a.planned_finish}")} for a in acts[:10]]
    return _say(db, sid, txt, lang, kind="list", title=_t(lang, "Planned today", "Aaj ka plan"), items=items,
                suggestions=_sug(lang, "eod", "delay"))


# ------------------------------------------------------------------ file upload through the assistant
def upload(db: Session, sid: str, raw: bytes, name: str, lang: str, reporter: str, discipline: str | None,
           photo_id: int | None = None) -> list[dict]:
    _user(db, sid, f"📎 {name}", lang, channel="file", photo_id=photo_id)
    out = R.ingest_file(db, raw, name, reporter, discipline, photo_id, session_id=sid)
    reps: list[Report] = out["reports"]
    auto = sum(1 for r in reps if r.status == "applied")
    review = sum(1 for r in reps if r.status.startswith("awaiting"))
    info = out["informational_lines"]
    for r in reps:
        if r.status == "awaiting_supervisor":
            r.status = "awaiting_planner"
    if reps:
        _remember(db, sid, reps[-1])
    items = []
    for r in reps:
        a = db.get(Activity, r.activity_id) if r.activity_id else None
        items.append({"activity_id": r.activity_id, "name": r.text[:80], "pct": a.pct if a and r.status == "applied" else None,
                      "detail": {"applied": _t(lang, f"applied → {a.name}" if a else "applied", f"apply → {a.name}" if a else "apply")}.get(
                          r.status, r.decision.replace("_", " ").lower())})
    txt = _t(lang, f"I read {len(reps)} progress line(s) from {name}: {auto} applied automatically, {review} sent for planner review."
                   + (f" {len(info)} informational line(s) kept in the log, not dropped." if info else ""),
             f"{name} se {len(reps)} progress lines mili: {auto} auto-apply, {review} planner review ke liye."
             + (f" {len(info)} info lines log me rakhi." if info else ""))
    return [_say(db, sid, txt, lang, kind="list", title=name, items=items, suggestions=_sug(lang, "plan", "eod"))]


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


def end_of_day(db: Session, sid: str, lang: str, reporter: str, discipline: str | None, log_user: bool = True) -> list[dict]:
    if log_user:
        _user(db, sid, _t(lang, "End of day check", "Din khatam - check karo"), lang, channel="eod")
    gaps = gaps_for_today(db, discipline)
    ledger.append(db, "END_OF_DAY_CHECK", {"discipline": discipline, "gaps": [a.activity_id for a in gaps]}, actor=reporter)
    if not gaps:
        return [_say(db, sid, _t(lang, "Every activity planned for today has an update. Thank you!",
                                 "Aaj ke sabhi planned kaam ka update aa gaya hai. Shukriya!"), lang, suggestions=_sug(lang, "delay"))]
    today = date.fromisoformat(project_today(db))
    names = ", ".join(a.name for a in gaps[:3]) + (f" (+{len(gaps) - 3} more)" if len(gaps) > 3 else "")
    queue = [a.activity_id for a in gaps[:5]]
    s = _session(db, sid)
    s["pending"] = {"type": "chaser", "queue": queue, "idx": 0, "options": CHASER_OPTIONS_MATCH}
    _save_session(db, sid, s)
    intro = _t(lang, f"End of day check: {len(gaps)} planned activities have no update today: {names}.",
               f"Din ka check: {len(gaps)} planned kaam ka aaj update nahi aaya: {names}.")
    out = [_say(db, sid, intro, lang, kind="list", title=_t(lang, "Missing updates", "Baaki updates"),
                items=[_item(a, today) for a in gaps[:10]], gaps=[{"activity_id": a.activity_id, "name": a.name} for a in gaps])]
    out.append(_ask_chaser(db, sid, gaps[0], lang, 1, len(queue)))
    return out


def _ask_chaser(db: Session, sid: str, a: Activity, lang: str, n: int, total: int) -> dict:
    q = _t(lang, f"({n}/{total}) {a.name}: what happened today?", f"({n}/{total}) {a.name}: aaj kya hua?")
    return _say(db, sid, q, lang, kind="question", options=CHASER_OPTIONS, question=True, chaser_activity=a.activity_id)


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
        _remember(db, sid, r)
        out.append(reply_for_report(db, sid, r, lang))
    elif value == "no_work":
        ledger.append(db, "NO_WORK_REPORTED", {"activity": {"id": a.activity_id, "name": a.name}, "date": today},
                      activity_id=a.activity_id, actor=reporter)
        out.append(_say(db, sid, _t(lang, "Noted: no work today. Logged for the planner.", "Noted: aaj kaam nahi hua."), lang))
    p["idx"] += 1
    s = _session(db, sid)
    if p["idx"] < len(p["queue"]) and value != "stop":
        s["pending"] = p
        _save_session(db, sid, s)
        out.append(_ask_chaser(db, sid, db.get(Activity, p["queue"][p["idx"]]), lang, p["idx"] + 1, len(p["queue"])))
    else:
        s.pop("pending", None)
        _save_session(db, sid, s)
        out.append(_say(db, sid, _t(lang, "That's all the gaps. Thanks - stay safe!", "Ho gaya, shukriya! Safe raho."), lang,
                        suggestions=_sug(lang, "mine", "delay")))
    return out


def submit_confirmed(db: Session, text: str, activity_id: str, event: str, reporter: str, sid: str | None) -> Report:
    """A supervisor explicitly answered for a named activity (end-of-day chaser)."""
    eng = get_engine(db)
    rd = project_today(db)
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


def context(db: Session, sid: str, discipline: str | None) -> dict:
    """Read-only side-panel context for the supervisor screen (does not write chat messages)."""
    today = date.fromisoformat(project_today(db))
    iso = today.isoformat()
    q = select(Activity).where(Activity.actual_finish.is_(None), Activity.planned_start <= iso, Activity.planned_finish >= iso)
    if discipline:
        q = q.where(Activity.discipline == discipline)
    planned = sorted(db.execute(q).scalars(), key=lambda a: a.planned_finish)
    updated = {e.activity_id for e in db.execute(select(ActualEvent).where(ActualEvent.event_date == iso)).scalars()}
    mine = list(db.execute(select(Report).where(Report.session_id == sid, Report.report_date == iso)).scalars())
    s = _session(db, sid)
    last = db.get(Activity, s["last_activity_id"]) if s.get("last_activity_id") else None
    return {
        "data_date": iso,
        "planned_today": [{**_item(a, today), "updated_today": a.activity_id in updated} for a in planned[:12]],
        "planned_total": len(planned),
        "pending_today": sum(1 for a in planned if a.activity_id not in updated),
        "delays": len(dashboard.delays(db, discipline)),
        "my_updates_today": len(mine),
        "my_applied_today": sum(1 for r in mine if r.status == "applied"),
        "last_activity": _item(last, today) if last else None,
        "pending": (s.get("pending") or {}).get("type"),
    }
