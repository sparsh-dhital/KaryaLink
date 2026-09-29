"""Render ground-truth events into messy, realistic field reports.

Noise sources: abbreviations, typos, Hinglish, missing dates / tags / areas, partial
quantities ("3 of 12"), finer-than-plan granularity (joint / spool numbers), ambiguous
wording, voice-transcript style, and ~10% reports describing work that is NOT in the plan.
The phrase lists here are intentionally broader than the extractor lexicon so the
benchmark is not a closed-world lookup.
"""
from __future__ import annotations

import random
import re
from datetime import date, timedelta

from .actuals import TruthEvent
from .schedule import Activity, AREAS

PHASE_EN = {
    "excavation": ["excavation", "excav", "digging", "earthwork excavation", "exc"],
    "pcc": ["PCC", "lean concrete", "blinding concrete", "PCC casting"],
    "rebar": ["rebar & shuttering", "reinforcement and formwork", "bar bending & shuttering",
              "rebar tying", "shuttering and rebar"],
    "pour": ["concrete pour", "concreting", "casting", "conc pour", "RCC pour", "concrete pouring"],
    "backfill": ["backfilling", "back filling", "backfill", "back-filling"],
    "fabrication": ["spool fab", "spool fabrication", "fabrication", "shop fab of spools", "fab"],
    "erection": ["erection", "spool erection", "erectn", "erection of spools"],
    "welding": ["welding", "field joint welding", "joints welding", "wldg", "field welding"],
    "hydrotest": ["hydrotest", "hydro test", "pressure test", "hydrotesting", "HT"],
    "install": ["installation", "fixing", "install", "instln", "mounting"],
    "cable_pull": ["cable pulling", "cable laying", "cable pull", "cabling"],
    "termination": ["termination", "glanding & termination", "cable termination", "terminations"],
    "hookup": ["impulse tubing", "hook-up", "tubing hookup", "hookup"],
    "loop_check": ["loop check", "loop test", "loop checking"],
    "setting": ["setting on foundation", "setting", "placement on fdn", "positioning"],
    "alignment": ["alignment", "laser alignment", "final alignment"],
    "grouting": ["grouting", "grout", "base grouting"],
    "barricading": ["barricading & signage", "hard barricading", "safety barricading"],
    "audit": ["HSE audit", "safety audit", "pre-comm HSE audit"],
}
PHASE_HI = {
    "excavation": ["khudai", "khodai", "excavation", "khudai ka kaam"],
    "pcc": ["PCC dhalai", "PCC", "PCC ka kaam"],
    "rebar": ["sariya bandhai", "shuttering", "sariya aur shuttering", "sariya ka kaam"],
    "pour": ["dhalai", "casting", "concrete dhalai", "dhalaai"],
    "backfill": ["mitti bharai", "bharai", "backfilling", "mitti bharna"],
    "fabrication": ["spool fabrication", "spool banana", "fabrication", "spool bana"],
    "erection": ["spool erection", "spool chadhana", "erection", "spool lagana"],
    "welding": ["joint welding", "welding", "joint ki welding", "weld"],
    "hydrotest": ["hydrotest", "pressure test", "hydro test"],
    "install": ["fitting", "installation", "lagana", "install"],
    "cable_pull": ["cable kheenchna", "cable khinchai", "cable pulling", "cable bichhana"],
    "termination": ["termination", "glanding", "termination ka kaam"],
    "hookup": ["tubing", "hook up", "tubing ka kaam"],
    "loop_check": ["loop check", "loop checking"],
    "setting": ["foundation pe rakhna", "setting", "placement"],
    "alignment": ["alignment", "alignment ka kaam"],
    "grouting": ["grouting", "grout bharna"],
    "barricading": ["barricading", "gheraabandi", "barricade lagana"],
    "audit": ["safety audit", "HSE audit"],
}
STATUS_EN = {
    "start": ["started", "commenced", "begun", "start", "started today", "kicked off"],
    "progress": ["in progress", "ongoing", "progressing", "WIP", "continuing"],
    "complete": ["completed", "done", "finished", "complete", "completed fully", "over"],
}
STATUS_HI = {
    "start": ["shuru kiya", "shuru ho gaya", "chalu kiya", "start kiya", "aarambh"],
    "progress": ["chal raha hai", "jaari hai", "chalu hai", "ho raha hai"],
    "complete": ["ho gaya", "pura ho gaya", "khatam", "complete ho gaya", "poora hua", "ho gya"],
}
UNIT_WORDS = {
    "m3": ["cum", "m3", "cu.m", "cubic m"], "MT": ["MT", "ton", "tonnes"], "m": ["m", "mtr", "rmt", "meter"],
    "spools": ["spools", "spool", "nos spools"], "joints": ["joints", "jts", "joint"],
    "nos": ["nos", "no."], "test pack": ["test pack"], "loop": ["loop"], "audit": ["audit"],
}
ABBREV = {
    "completed": ["compl", "cmpltd", "completd"], "foundation": ["fdn", "fndn"], "concrete": ["conc", "concr"],
    "welding": ["wldg", "weldng"], "installation": ["instln", "instl"], "erection": ["erctn", "erecn"],
    "progress": ["prog", "progres"], "excavation": ["excvn", "excav"], "started": ["strtd", "startd"],
    "today": ["tdy", "2day"], "yesterday": ["ystrdy", "yday"], "pulling": ["pullng"],
}
NUM_WORDS_EN = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
                "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
                "eighteen", "nineteen", "twenty"]
NUM_WORDS_HI = ["shunya", "ek", "do", "teen", "char", "paanch", "chhe", "saat", "aath", "nau", "das",
                "gyarah", "barah"]
FILLERS_EN = ["Update:", "FYI", "Sir,", "Pls note", "Status -", "Daily update:", "Hi team,"]
FILLERS_HI = ["Sir,", "Namaste sir,", "Update hai:", "Bhai,", "Sir ji"]
REPORTERS = {
    "CIV": ["Rakesh Gogoi", "Manoj Kalita"], "PIP": ["Anil Borah", "Deepak Yadav"],
    "ELE": ["Priya Das", "Sanjay Phukan"], "INS": ["Imran Hussain", "Neha Barua"],
    "MEC": ["Suresh Nair", "Vikram Singh"], "HSE": ["Kavita Saikia", "Rohit Dutta"],
}
EQUIP_WORDS = {"V": "vessel", "P": "pump", "K": "compressor", "E": "cooler", "T": "tank"}


def _num_word(n: float, hindi: bool) -> str:
    n = int(n)
    words = NUM_WORDS_HI if hindi else NUM_WORDS_EN
    return words[n] if 0 <= n < len(words) else str(n)


def _typo(word: str, rng: random.Random) -> str:
    if len(word) < 5 or not word.isalpha():
        return word
    i = rng.randint(1, len(word) - 2)
    op = rng.choice(["swap", "drop", "dup"])
    if op == "swap":
        return word[:i] + word[i + 1] + word[i] + word[i + 2:]
    if op == "drop":
        return word[:i] + word[i + 1:]
    return word[:i] + word[i] + word[i:]


def render_tag(a: Activity, rng: random.Random, degrade: float) -> str:
    """Render the activity's tag, degraded with probability `degrade`. May return ''."""
    t = a.tag
    if rng.random() >= degrade:
        prefix = {"foundation": "foundation ", "tray": "", "line": "line ", "instrument": "",
                  "equipment": "", "hydrant": "", "shower": "", "area": ""}[a.tag_type]
        return prefix + t
    tt = a.tag_type
    if tt == "line":
        size, svc, num = re.match(r'(\d+")-([A-Z])-(\d+)', t).groups()
        return rng.choice([f"{svc}-{num}", f"line {num}", f"{size} {svc}{num}", f"{num} line",
                           f"{size.replace(chr(34), 'in')}-{svc}-{num}", f"ln {svc}{num}", ""])
    if tt == "foundation":
        num = t.split("-")[1]
        return rng.choice([f"F{num}", f"fdn {num}", f"F {num}", f"fdn F{num}", f"foundation no {num}", ""])
    if tt == "tray":
        _, l, num = t.split("-")
        return rng.choice([f"CT{l}{num}", f"CT-{l}-{int(num)}", f"tray {l}-{num}", f"{l}{int(num)} tray",
                           f"tray {l}{int(num)}", ""])
    if tt == "instrument":
        typ, num = t.split("-")
        return rng.choice([f"{typ}{num}", f"{typ} {num}", f"transmitter on {num}", f"{typ.lower()}-{num}", ""])
    if tt == "equipment":
        letter, num = t.split("-")
        word = EQUIP_WORDS.get(letter, "equipment")
        return rng.choice([f"{letter}{num}", f"{word} {num}", f"{letter}-{num}".lower(), f"{word}", ""])
    if tt in ("hydrant", "shower"):
        num = t.split("-")[1]
        word = "hydrant" if tt == "hydrant" else "safety shower"
        return rng.choice([f"{word} {num}", f"{word} no. {num}", word])
    return ""


def render_area(area: str, rng: random.Random, p_missing: float) -> str:
    if rng.random() < p_missing:
        return ""
    num = area.split("-")[1]
    return rng.choice([area, area.replace("-", ""), f"unit {num}", f"area {num}", f"U {num}"])


def render_date(event_date: date, report_date: date, rng: random.Random, hindi: bool, p_missing: float) -> str:
    if rng.random() < p_missing:
        return ""
    lag = (report_date - event_date).days
    if lag == 0 and rng.random() < 0.6:
        return "aaj" if hindi else rng.choice(["today", "tdy", "today"])
    if lag == 1 and rng.random() < 0.6:
        return "kal" if hindi else rng.choice(["yesterday", "yday"])
    fmt = rng.choice(["%d/%m", "%d-%m-%Y", "%d %b", "%d.%m.%y", "%d-%b-%Y", "%b %d"])
    return event_date.strftime(fmt)


def _qty_phrase(a: Activity, ev: TruthEvent, prev_done: float, rng: random.Random, hindi: bool,
                voice: bool) -> tuple[str, str]:
    """Return (phrase, qty_mode)."""
    if a.credit_method == "milestone" or ev.event == "complete" and rng.random() < 0.7:
        return "", "none"
    if ev.event == "start" and ev.qty_done == 0:
        return "", "none"
    unit = rng.choice(UNIT_WORDS.get(a.unit, [a.unit]))
    done, total = ev.qty_done, ev.qty_total
    inc = done - prev_done
    fmt = lambda x: _num_word(x, hindi) if voice and x <= 12 else f"{x:g}"
    r = rng.random()
    if a.unit in ("spools", "joints") and inc > 0 and inc <= 4 and r < 0.25:
        # finer granularity than the plan: individual spool / joint numbers
        prefix = "S" if a.unit == "spools" else "J"
        ids = [f"{prefix}-{int(prev_done) + i + 1}" for i in range(int(inc))]
        return ", ".join(ids), "incremental"
    if r < 0.55:
        if hindi:
            return rng.choice([f"{fmt(total)} me se {fmt(done)} {unit}", f"{fmt(done)}/{fmt(total)} {unit}"]), "cumulative"
        return rng.choice([f"{fmt(done)} of {fmt(total)} {unit}", f"{fmt(done)}/{fmt(total)} {unit}",
                           f"{fmt(done)} out of {fmt(total)} {unit}"]), "cumulative"
    if r < 0.8 and inc > 0:
        if hindi:
            return rng.choice([f"aur {fmt(inc)} {unit}", f"{fmt(inc)} {unit} aaj"]), "incremental"
        return rng.choice([f"{fmt(inc)} more {unit}", f"{fmt(inc)} {unit} added", f"+{fmt(inc)} {unit}"]), "incremental"
    pct = round(ev.pct / 5) * 5
    if 0 < pct < 100:
        return (f"{pct}%" if not voice else f"{pct} percent"), "percent"
    return "", "none"


def render_report(a: Activity, ev: TruthEvent, prev_done: float, report_date: date, rng: random.Random,
                  hard: bool = False) -> dict:
    style = rng.choices(["formal", "terse", "chat", "hinglish", "voice", "sheet"],
                        weights=[18, 24, 14, 26, 12, 6] if not hard else [0, 30, 5, 40, 25, 0])[0]
    hindi = style == "hinglish" or (style == "voice" and rng.random() < 0.5)
    voice = style == "voice"
    degrade = 0.95 if hard else {"formal": 0.1, "sheet": 0.1}.get(style, 0.45)
    tag = render_tag(a, rng, degrade)
    if hard and rng.random() < 0.5:
        tag = ""  # heavy noise: no tag at all in half the hard reports
    area = render_area(a.area, rng, 0.9 if hard else (0.3 if tag else 0.1))
    dt = render_date(date.fromisoformat(ev.date), report_date, rng, hindi, 0.7 if hard else 0.25)
    phase = rng.choice((PHASE_HI if hindi else PHASE_EN)[a.phase])
    status = rng.choice((STATUS_HI if hindi else STATUS_EN)[ev.event])
    if hard and rng.random() < 0.2:
        status = rng.choice(["update", "kaam", "status", "work"])  # vague: no explicit status word
    qty, qty_mode = _qty_phrase(a, ev, prev_done, rng, hindi, voice)
    obj = ""
    if a.tag_type == "equipment" and rng.random() < 0.5:
        m = re.search(r"of (.+?) [A-Z]-\d", a.name)
        obj = m.group(1) if m else ""

    if style == "formal":
        parts = [f"{phase.capitalize()} {status} for {tag}".strip()]
        if obj:
            parts.append(f"({obj})")
        if area:
            parts.append(f"in {area}")
        if qty:
            parts.append(f"- {qty}")
        if dt:
            parts.append(f"on {dt}")
        text = " ".join(parts) + "."
    elif style == "terse":
        bits = [tag, phase, qty, status, dt, area]
        if rng.random() < 0.3:
            head = bits[:3]
            rng.shuffle(head)
            bits = head + bits[3:]
        text = " ".join(b for b in bits if b)
    elif style == "chat":
        filler = rng.choice(FILLERS_EN) if rng.random() < 0.5 else ""
        text = f"{filler} {tag} {phase} {status} {qty} {dt} {area}".strip()
        if rng.random() < 0.3:
            text += rng.choice([" thx", " pls update", " 👍", ""])
    elif style == "hinglish":
        filler = rng.choice(FILLERS_HI) if rng.random() < 0.4 else ""
        order = rng.random()
        if order < 0.5:
            text = f"{filler} {dt} {area} {tag} ka {phase} {qty} {status}"
        else:
            text = f"{filler} {tag} {phase} {status} {dt} {qty} {area}"
    elif style == "voice":
        text = f"{tag} {phase} {qty} {status} {dt} {area}".lower()
    else:  # sheet row flattened
        text = f"{a.discipline} | {area or '-'} | {tag or '-'} | {phase} | {qty or '-'} | {status} | {dt or '-'}"

    text = re.sub(r"\s+", " ", text).strip()
    # word-level noise
    words = text.split(" ")
    p_abbrev, p_typo = (0.6, 0.25) if hard else (0.2, 0.05)
    out = []
    for w in words:
        lw = w.lower().strip(".,")
        if lw in ABBREV and rng.random() < p_abbrev:
            w = rng.choice(ABBREV[lw])
        elif rng.random() < p_typo:
            w = _typo(w, rng)
        out.append(w)
    text = " ".join(out)
    if style in ("terse", "voice") or (hard and rng.random() < 0.5):
        text = text.lower() if rng.random() < 0.7 else text
    if voice:
        text = re.sub(r"[.,|]", "", text)
    reporter = rng.choice(REPORTERS[a.discipline])
    known_disc = rng.random() < (0.1 if hard else 0.8)
    return {
        "text": text,
        "style": style,
        "reporter": reporter,
        "reporter_discipline": a.discipline if known_disc else None,
        "channel": {"voice": "voice", "sheet": "spreadsheet", "formal": "email"}.get(style, "chat"),
        "report_date": report_date.isoformat(),
        "qty_mode": qty_mode,
    }


# ----------------------------------------------------------------------------------------
# New (unplanned) work reports: must be flagged, never force-matched.
NEW_WORK_EN = [
    ("PIP", 'Extra pipe support fabricated for new drain line {size}-D-9{a}{k}, not in plan'),
    ("PIP", 'Temporary bypass line {size}-T-8{a}{k} erected for flushing'),
    ("PIP", 'Rework: cut and re-weld of joint on temp line {size}-T-8{a}{k}'),
    ("CIV", 'Additional drain pit excavation near {equip} in {area}'),
    ("CIV", 'Culvert repair work at approach road {area} started'),
    ("CIV", 'Extra sump pit PCC done near fdn F-{a}9'),
    ("ELE", 'Temporary construction power DB installed at {area}'),
    ("ELE", 'Temp cable CT-{L}-9{k} laid for welding machines'),
    ("INS", 'Additional pressure gauge PG-9{a}{k} installed on temporary line'),
    ("MEC", 'Spare pump skid P-9{a}0 received and placed at laydown'),
    ("HSE", 'Emergency assembly point signboards installed in {area}'),
    ("HSE", 'Additional fire extinguisher stands installed at {area} pipe rack'),
]
NEW_WORK_HI = [
    ("PIP", 'naya drain line {size}-D-9{a}{k} ka fabrication shuru, drawing me nahi tha'),
    ("CIV", '{area} me extra sump pit ki khudai chalu hai'),
    ("CIV", 'approach road {area} pe culvert repair ho gaya'),
    ("ELE", 'welding machine ke liye temporary cable CT-{L}-9{k} bichha diya'),
    ("HSE", '{area} me assembly point ka board laga diya'),
    ("MEC", 'spare pump P-9{a}0 laydown me rakh diya'),
]


def render_new_work(rng: random.Random, report_date: date, wbs_parent_for, hard: bool = False) -> tuple[dict, dict]:
    ai = rng.randint(1, len(AREAS))
    area = AREAS[ai - 1][0]
    hindi = rng.random() < (0.5 if hard else 0.3)
    disc, tmpl = rng.choice(NEW_WORK_HI if hindi else NEW_WORK_EN)
    text = tmpl.format(size=rng.choice(['2"', '3"', '4"']), a=ai, k=rng.randint(1, 9), area=area,
                       equip=f"V-{ai}01", L="ABCDEF"[ai - 1])
    if rng.random() < 0.3:
        text = text.lower()
    report = {
        "text": text, "style": "hinglish" if hindi else "chat",
        "reporter": rng.choice(REPORTERS[disc]),
        "reporter_discipline": disc if rng.random() < 0.8 else None,
        "channel": "chat", "report_date": report_date.isoformat(), "qty_mode": "none",
    }
    label = {"activity_id": None, "is_new": True, "event": "start", "discipline": disc, "area": area,
             "parent_wbs": wbs_parent_for(area, disc), "event_date": report_date.isoformat(),
             "qty_done": None, "qty_total": None}
    return report, label
