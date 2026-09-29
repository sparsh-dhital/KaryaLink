"""Demo Day: build a ~3-minute scripted scenario from the CURRENT database state.

Each step's message is chosen by dry-running the real engine (no writes) so the scenario reliably
shows the intended behaviour (auto-apply, clarification, sequence warning, new activity) even after
the model is retrained. Scripted planner actions use the synthetic ground-truth labels and are
labelled as such in the UI.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import Activity, Report
from ..engine import benchmark, policy
from . import reports as R
from .core import DbState, get_engine, project_today

SUPERVISORS = {
    "piping": {"reporter": "Anil Borah", "discipline": "PIP", "lang": "en-IN"},
    "electrical": {"reporter": "Priya Das", "discipline": "ELE", "lang": "en-IN"},
    "civil": {"reporter": "Rakesh Gogoi", "discipline": "CIV", "lang": "hi-IN"},
}


def _dry(db: Session, text: str, disc: str | None) -> dict:
    eng = get_engine(db)
    return eng.analyze(text, date.fromisoformat(project_today(db)), disc, DbState(db))


def _first(db: Session, texts: list[tuple[str, str | None]], want: set[str]) -> tuple[str, dict] | None:
    for t, disc in texts:
        res = _dry(db, t, disc)
        if res["decision"]["kind"] in want:
            return t, res
    return None


def _in_progress(db: Session, disc: str, phases: tuple[str, ...]) -> list[Activity]:
    q = select(Activity).where(Activity.discipline == disc, Activity.actual_start.is_not(None),
                               Activity.actual_finish.is_(None), Activity.phase.in_(phases),
                               Activity.credit_method == "quantity")
    return sorted(db.execute(q).scalars(), key=lambda a: a.last_update or "", reverse=True)


def build_script(db: Session) -> dict:
    steps: list[dict] = []
    notes: list[str] = []

    # 1) formal English chat - piping supervisor
    pip = _in_progress(db, "PIP", ("erection", "welding", "fabrication"))
    s1 = None
    for a in pip:
        nxt = min(a.quantity - 1, round(a.qty_done) + max(1, round(a.quantity * 0.1)))
        if nxt <= a.qty_done:
            continue
        verb = {"erection": "Erection", "welding": "Field welding", "fabrication": "Spool fabrication"}[a.phase]
        unit = a.unit
        t = f"{verb} progressing on line {a.tag} in {a.area}: {nxt:g} of {a.quantity:g} {unit} done today."
        r = _first(db, [(t, "PIP")], {policy.AUTO_APPLY})
        if r:
            s1 = {"text": t, "activity_id": a.activity_id, "expected": policy.AUTO_APPLY}
            break
    if s1:
        steps.append({"id": "formal", "type": "chat", "who": "piping", **SUPERVISORS["piping"], **s1,
                      "narration": "Supervisor 1 (piping) types a formal English update. High confidence: auto-applied with a 3-of-N rule of credit."})
    else:
        notes.append("No in-progress piping activity suitable for the formal-English step.")

    # 2) daily report file - electrical / civil supervisor
    steps.append({"id": "file", "type": "upload_sample", "who": "electrical", **SUPERVISORS["electrical"],
                  "sample": "daily_report_EI_civil.txt",
                  "narration": "Supervisor 2 uploads a daily progress report file. Each line is split, extracted and linked; non-progress lines are kept as informational, never dropped."})

    # 3) Hinglish voice-style - civil supervisor
    civ = _in_progress(db, "CIV", ("pour", "excavation", "backfill", "rebar"))
    s3 = None
    hi_phase = {"pour": "dhalai", "excavation": "khudai", "backfill": "mitti bharai", "rebar": "sariya bandhai"}
    for a in civ:
        nxt = min(a.quantity - 1, round(a.qty_done) + max(1, round(a.quantity * 0.15)))
        if nxt <= a.qty_done:
            continue
        unit = {"m3": "cum", "MT": "ton"}.get(a.unit, a.unit)
        num = a.tag.split("-")[1]
        for t in (f"aaj foundation f {num} ka {hi_phase[a.phase]} chal raha hai {a.quantity:g} me se {nxt:g} {unit} ho gaya",
                  f"aaj {a.tag} ka {hi_phase[a.phase]} {a.quantity:g} me se {nxt:g} {unit} ho gaya"):
            r = _first(db, [(t, "CIV")], {policy.AUTO_APPLY, policy.REVIEW})
            if r:
                s3 = {"text": t, "activity_id": a.activity_id, "expected": r[1]["decision"]["kind"]}
                break
        if s3:
            break
    if s3:
        steps.append({"id": "hinglish", "type": "voice", "who": "civil", **SUPERVISORS["civil"], **s3,
                      "narration": "Supervisor 3 (civil) speaks Hinglish into the mic. The assistant transcribes, links and replies aloud."})
    else:
        notes.append("No in-progress civil activity suitable for the Hinglish step.")

    # 4) clarification - ambiguous message (two plausible activities)
    s4 = None
    groups: dict[tuple, list[Activity]] = {}
    for a in db.execute(select(Activity).where(Activity.actual_start.is_not(None), Activity.actual_finish.is_(None))).scalars():
        groups.setdefault((a.area, a.discipline, a.phase), []).append(a)
    tries = []
    for (area, disc, phase), acts in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        if len(acts) < 2 or disc not in ("PIP", "ELE", "CIV"):
            continue
        word = {"welding": "welding", "erection": "spool erection", "fabrication": "spool fabrication",
                "cable_pull": "cable pulling", "install": "tray installation", "termination": "termination",
                "pour": "concrete pouring", "rebar": "shuttering", "excavation": "excavation",
                "backfill": "backfilling", "pcc": "PCC", "hydrotest": "hydrotest"}.get(phase, phase)
        tries += [(f"{area} me {word} ka kaam chal raha hai", disc), (f"{word} in progress at {area}", disc)]
    r = _first(db, tries[:24], {policy.CLARIFY})
    if r:
        t, res = r
        opts = [o for o in res["decision"]["options"] if o["value"] != "none"]
        s4 = {"text": t, "expected": policy.CLARIFY, "answer_value": opts[0]["value"],
              "spoken_answer": "pehla wala", "options_preview": opts}
        disc = next(d for tt, d in tries if tt == t)
        who = {"PIP": "piping", "ELE": "electrical", "CIV": "civil"}[disc]
        steps.append({"id": "clarify", "type": "voice", "who": who, **SUPERVISORS[who], "lang": "hi-IN", **s4,
                      "narration": "An ambiguous update: two activities fit. The assistant asks ONE clarifying question with tap-to-answer buttons; the supervisor answers by voice."})
    else:
        notes.append("Could not construct an ambiguous message that triggers a clarification in the current state.")

    # 5) out-of-order - successor reported while predecessor incomplete
    s5 = None
    acts = {a.activity_id: a for a in db.execute(select(Activity)).scalars()}
    for a in sorted(acts.values(), key=lambda x: x.planned_start):
        if a.actual_start or a.discipline != "PIP" or a.phase != "hydrotest":
            continue
        preds = [acts[p] for p in a.predecessors if p in acts]
        if preds and any(p.actual_start and not p.actual_finish for p in preds):
            t = f"Hydrotest completed for line {a.tag}, test pack cleared."
            if _first(db, [(t, "PIP")], {policy.CONFIRM_SEQUENCE}):
                s5 = {"text": t, "activity_id": a.activity_id, "expected": policy.CONFIRM_SEQUENCE, "answer_value": "confirm",
                      "spoken_answer": "haan, confirm hai"}
                break
    if s5:
        steps.append({"id": "sequence", "type": "chat", "who": "piping", **SUPERVISORS["piping"], **s5,
                      "narration": "Hydrotest reported while field welding on the same line is still in progress. The sequence checker warns and asks the supervisor to confirm; the confirmation is logged."})
    else:
        notes.append("No hydrotest with an in-progress predecessor found for the sequence-warning step.")

    # 6) new activity
    ai = 4
    t6 = f'Extra pipe support fabricated for new drain line 2"-D-9{ai}07 near V-{ai}01, not in drawing'
    if _first(db, [(t6, "PIP")], {policy.NEW_ACTIVITY}):
        steps.append({"id": "new", "type": "chat", "who": "piping", **SUPERVISORS["piping"], "text": t6,
                      "expected": policy.NEW_ACTIVITY,
                      "narration": "Work that is not in the plan: flagged as a NEW activity proposal under the most likely WBS parent - never force-matched, never dropped."})

    # 7) planner correction on a backlog item where the engine's top guess is wrong (uses synthetic truth)
    labels = benchmark.load_labels()
    corr = None
    q = select(Report).where(Report.status == "awaiting_planner", Report.external_id.is_not(None)).order_by(Report.confidence.desc())
    for r in db.execute(q).scalars():
        lab = labels.get(r.external_id or "")
        if not lab or not lab.get("activity_id"):
            continue
        top = r.analysis["candidates"][0]["activity_id"] if r.analysis["candidates"] else None
        if top != lab["activity_id"]:
            corr = {"report_id": r.id, "activity_id": lab["activity_id"], "from": top}
            break
    if corr:
        steps.append({"id": "correction", "type": "planner_reassign", **corr,
                      "narration": "Planner console: the planner reassigns a low-confidence item to the correct activity (keyboard: R). The correction is stored for learning."})
    steps.append({"id": "planner_batch", "type": "planner_batch", "n": 25,
                  "narration": "A scripted planner clears the rest of the review queue (uses the synthetic ground-truth labels) and approves the new-activity proposal."})
    steps.append({"id": "eod", "type": "end_of_day", "who": "electrical", **SUPERVISORS["electrical"],
                  "narration": "End of day: the assistant compares today's planned activities with reports received and chases the gaps."})
    steps.append({"id": "retrain", "type": "retrain",
                  "narration": "Retrain: the scorer is retrained with the corrections; accuracy on the held-out sets is re-measured."})
    steps.append({"id": "metrics", "type": "metrics",
                  "narration": "Evaluation page: all numbers computed live on the synthetic benchmark."})
    return {"steps": steps, "notes": notes}


def planner_batch(db: Session, n: int = 25, planner: str = "scripted planner (synthetic truth)") -> dict:
    labels = benchmark.load_labels()
    q = select(Report).where(Report.status == "awaiting_planner").order_by(Report.confidence.desc())
    done = {"approve": 0, "reassign": 0, "new_activity": 0, "reject": 0, "skipped": 0}
    for r in list(db.execute(q).scalars())[:n]:
        lab = labels.get(r.external_id or "")
        top = r.analysis["candidates"][0]["activity_id"] if r.analysis["candidates"] else None
        try:
            if lab is None:  # a live demo report: approve NEW proposals, approve confident reviews
                if r.decision == policy.NEW_ACTIVITY:
                    R.planner_action(db, r.id, "new_activity", planner=planner)
                    done["new_activity"] += 1
                elif top:
                    R.planner_action(db, r.id, "approve", planner=planner)
                    done["approve"] += 1
                continue
            if lab["is_new"]:
                R.planner_action(db, r.id, "new_activity", planner=planner)
                done["new_activity"] += 1
            elif top == lab["activity_id"]:
                R.planner_action(db, r.id, "approve", planner=planner)
                done["approve"] += 1
            else:
                R.planner_action(db, r.id, "reassign", activity_id=lab["activity_id"], planner=planner)
                done["reassign"] += 1
        except R.WorkflowError:
            done["skipped"] += 1
    return done
