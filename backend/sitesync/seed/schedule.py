"""Generate a realistic L1-L6 schedule for a fictional gas gathering station.

Project: "GGS-7 Gas Gathering Station" (fictional). 6 process units x 6 disciplines.
L1 project > L2 unit > L3 discipline > L4 work package > L5 work item (tag) > L6 step.
Leaf activities are L6 steps, except HSE items which are scheduled directly at L5.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field, asdict
from datetime import date, timedelta

from ..config import PROJECT_START, RANDOM_SEED

AREAS = [
    ("U-100", "Inlet Separation"),
    ("U-200", "Gas Compression"),
    ("U-300", "Produced Water Treatment"),
    ("U-400", "Utilities & Power"),
    ("U-500", "Flare System"),
    ("U-600", "Tank Farm"),
]
DISCIPLINES = {
    "CIV": "Civil",
    "PIP": "Piping",
    "ELE": "Electrical",
    "INS": "Instrumentation",
    "MEC": "Mechanical",
    "HSE": "HSE",
}
AREA_SERVICES = {1: "PG", 2: "GP", 3: "WP", 4: "UW", 5: "FG", 6: "PW"}
AREA_EQUIP = {
    1: [("V", "Inlet separator"), ("P", "Condensate pump")],
    2: [("K", "Gas compressor"), ("E", "Gas cooler")],
    3: [("V", "Skim vessel"), ("P", "Produced water pump")],
    4: [("E", "Air cooler"), ("P", "Utility water pump")],
    5: [("V", "Flare KO drum"), ("P", "KO drum pump")],
    6: [("T", "Crude storage tank"), ("P", "Transfer pump")],
}
INSTR_TYPES = ["PT", "FT", "LT", "TT", "PG"]
LINE_SIZES = ['2"', '3"', '4"', '6"', '8"', '10"', '12"', '16"', '18"', '20"', '24"']

# Step templates: (step code, phase, name template, unit, qty range, weight, duration range, credit)
CIV_STEPS = [
    ("EXC", "excavation", "Excavation for foundation {tag}", "m3", (40, 180), 0.10, (3, 5), "quantity"),
    ("PCC", "pcc", "PCC for foundation {tag}", "m3", (3, 12), 0.05, (1, 2), "quantity"),
    ("RBR", "rebar", "Rebar & formwork for foundation {tag}", "MT", (2, 9), 0.25, (4, 7), "quantity"),
    ("POUR", "pour", "Concrete pouring foundation {tag}", "m3", (20, 90), 0.50, (1, 3), "quantity"),
    ("BKF", "backfill", "Backfilling around foundation {tag}", "m3", (30, 140), 0.10, (2, 4), "quantity"),
]
PIP_STEPS = [
    ("FAB", "fabrication", "Spool fabrication line {tag}", "spools", (6, 24), 0.30, (10, 18), "quantity"),
    ("ERC", "erection", "Spool erection line {tag}", "spools", None, 0.30, (8, 14), "quantity"),
    ("WLD", "welding", "Field welding line {tag}", "joints", (10, 60), 0.30, (8, 15), "quantity"),
    ("HYD", "hydrotest", "Hydrotest line {tag}", "test pack", (1, 1), 0.10, (2, 4), "milestone"),
]
ELE_STEPS = [
    ("TRY", "install", "Cable tray installation {tag}", "m", (60, 240), 0.30, (6, 10), "quantity"),
    ("CBL", "cable_pull", "Cable pulling through tray {tag}", "m", (300, 1500), 0.50, (8, 14), "quantity"),
    ("TRM", "termination", "Cable termination & glanding {tag}", "nos", (8, 40), 0.20, (4, 8), "quantity"),
]
INS_STEPS = [
    ("INST", "install", "Instrument installation {tag}", "nos", (1, 1), 0.40, (2, 4), "milestone"),
    ("HKP", "hookup", "Impulse tubing hook-up {tag}", "m", (8, 30), 0.40, (3, 6), "quantity"),
    ("LCK", "loop_check", "Loop check {tag}", "loop", (1, 1), 0.20, (1, 2), "milestone"),
]
# Planned durations and intra-area offsets are scaled by SCALE (realistic L6 step lengths).
SCALE = 2.0


def _d(days: float) -> timedelta:
    return timedelta(days=round(days * SCALE))


MEC_STEPS = [
    ("SET", "setting", "Setting of {name} {tag} on foundation", "nos", (1, 1), 0.50, (2, 3), "milestone"),
    ("ALN", "alignment", "Alignment of {name} {tag}", "nos", (1, 1), 0.30, (3, 5), "milestone"),
    ("GRT", "grouting", "Grouting of {name} {tag}", "m3", (1, 4), 0.20, (2, 3), "quantity"),
]


@dataclass
class Activity:
    activity_id: str
    name: str
    discipline: str
    area: str
    area_name: str
    wbs_code: str
    parent_wbs: str
    level: int
    tag: str
    tag_type: str
    phase: str
    planned_start: str
    planned_finish: str
    duration: int
    quantity: float
    unit: str
    weight: float
    credit_method: str
    predecessors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class WbsNode:
    code: str
    name: str
    level: int
    parent: str | None


class _Builder:
    def __init__(self, rng: random.Random):
        self.rng = rng
        self.activities: list[Activity] = []
        self.wbs: dict[str, WbsNode] = {}
        self._seq: dict[str, int] = {}

    def node(self, code: str, name: str, level: int, parent: str | None) -> str:
        if code not in self.wbs:
            self.wbs[code] = WbsNode(code, name, level, parent)
        return code

    def next_id(self, area: str, disc: str) -> str:
        key = f"{area.replace('-', '')}-{disc}"
        self._seq[key] = self._seq.get(key, 1000) + 10
        return f"{key}-{self._seq[key]}"

    def add(self, *, area, area_name, disc, parent, level, tag, tag_type, phase, name,
            start: date, dur: int, qty, unit, weight, credit, preds) -> Activity:
        aid = self.next_id(area, disc)
        a = Activity(
            activity_id=aid, name=name, discipline=disc, area=area, area_name=area_name,
            wbs_code=f"{parent}.{aid.split('-')[-1]}" if level == 6 else parent,
            parent_wbs=parent, level=level, tag=tag, tag_type=tag_type, phase=phase,
            planned_start=start.isoformat(),
            planned_finish=(start + timedelta(days=dur - 1)).isoformat(),
            duration=dur, quantity=float(qty), unit=unit, weight=weight,
            credit_method=credit, predecessors=list(preds),
        )
        self.activities.append(a)
        return a

    def chain(self, steps, *, area, area_name, disc, l5, tag, tag_type, start: date,
              extra_pred: dict[str, list[Activity]] | None = None, fmt=None, qty_override=None):
        """Create FS-linked L6 steps under an L5 item. Returns list of activities."""
        rng = self.rng
        out: list[Activity] = []
        cur = start
        prev: Activity | None = None
        fmt = fmt or {}
        for code, phase, tmpl, unit, qrange, weight, drange, credit in steps:
            dur = max(1, round(rng.randint(*drange) * SCALE))
            if qty_override and code in qty_override:
                qty = qty_override[code]
            elif qrange is None:
                qty = out[-1].quantity if out else 10
            else:
                qty = rng.randint(*qrange)
            preds = [prev.activity_id] if prev else []
            for p in (extra_pred or {}).get(code, []):
                preds.append(p.activity_id)
                pf = date.fromisoformat(p.planned_finish) + timedelta(days=1)
                cur = max(cur, pf)
            if prev:
                cur = max(cur, date.fromisoformat(prev.planned_finish) + timedelta(days=1))
            a = self.add(area=area, area_name=area_name, disc=disc, parent=l5, level=6, tag=tag,
                         tag_type=tag_type, phase=phase, name=tmpl.format(tag=tag, **fmt),
                         start=cur, dur=dur, qty=qty, unit=unit, weight=weight, credit=credit,
                         preds=preds)
            out.append(a)
            prev = a
        return out


def generate_schedule(seed: int = RANDOM_SEED):
    rng = random.Random(seed)
    b = _Builder(rng)
    root = b.node("GGS7", "GGS-7 Gas Gathering Station (fictional)", 1, None)

    for ai, (area, area_name) in enumerate(AREAS, start=1):
        a_code = b.node(f"GGS7.{area.replace('-', '')}", f"{area} {area_name}", 2, root)
        a_start = PROJECT_START + timedelta(days=(ai - 1) * 16 + rng.randint(0, 4))
        L3 = {d: b.node(f"{a_code}.{d}", f"{area} {n}", 3, a_code) for d, n in DISCIPLINES.items()}

        # ---- Civil: 4 foundations ----
        fnd_pkg = b.node(f"{L3['CIV']}.FND", f"{area} Foundations", 4, L3["CIV"])
        foundations = []
        for k in range(1, 5):
            tag = f"F-{ai}{k}"
            l5 = b.node(f"{fnd_pkg}.F{ai}{k}", f"Foundation {tag}", 5, fnd_pkg)
            steps = b.chain(CIV_STEPS, area=area, area_name=area_name, disc="CIV", l5=l5, tag=tag,
                            tag_type="foundation", start=a_start + _d((k - 1) * 3))
            foundations.append(steps)
        pour = [s[3] for s in foundations]
        bkf = [s[4] for s in foundations]

        # ---- Mechanical: 2 equipment items on foundations 1 & 2 ----
        mec_pkg = b.node(f"{L3['MEC']}.EQP", f"{area} Static & rotating equipment", 4, L3["MEC"])
        equipment = []
        for k, (letter, ename) in enumerate(AREA_EQUIP[ai], start=1):
            tag = f"{letter}-{ai}0{k}" + ("A" if letter == "P" else "")
            l5 = b.node(f"{mec_pkg}.{tag.replace('-', '')}", f"{ename} {tag}", 5, mec_pkg)
            steps = b.chain(MEC_STEPS, area=area, area_name=area_name, disc="MEC", l5=l5, tag=tag,
                            tag_type="equipment", start=a_start + _d(30),
                            extra_pred={"SET": [bkf[k - 1]]}, fmt={"name": ename.lower()})
            equipment.append(steps)

        # ---- Piping: 5 lines; erection after pour of rack foundations 3/4 ----
        pip_pkg = b.node(f"{L3['PIP']}.LNS", f"{area} Process & utility piping", 4, L3["PIP"])
        lines = []
        services = AREA_SERVICES[ai]
        for k in range(1, 6):
            num = ai * 1000 + 20 + k
            tag = f"{rng.choice(LINE_SIZES)}-{rng.choice(services)}-{num}"
            l5 = b.node(f"{pip_pkg}.L{num}", f"Line {tag}", 5, pip_pkg)
            steps = b.chain(PIP_STEPS, area=area, area_name=area_name, disc="PIP", l5=l5, tag=tag,
                            tag_type="line", start=a_start + _d(10 + (k - 1) * 3),
                            extra_pred={"ERC": [pour[2 + (k % 2)]]})
            lines.append(steps)

        # ---- Electrical: 3 cable trays ----
        ele_pkg = b.node(f"{L3['ELE']}.TRY", f"{area} Cable trays & cabling", 4, L3["ELE"])
        letter = "ABCDEF"[ai - 1]
        first = rng.randint(1, 5)
        trays = []
        for k in range(3):
            tag = f"CT-{letter}-{first + k:02d}"
            l5 = b.node(f"{ele_pkg}.CT{letter}{first + k:02d}", f"Cable tray {tag}", 5, ele_pkg)
            steps = b.chain(ELE_STEPS, area=area, area_name=area_name, disc="ELE", l5=l5, tag=tag,
                            tag_type="tray", start=a_start + _d(35 + k * 7),
                            extra_pred={"TRY": [pour[2 + (k % 2)]]})
            trays.append(steps)

        # ---- Instrumentation: one transmitter per line, installed after line erection ----
        ins_pkg = b.node(f"{L3['INS']}.FLD", f"{area} Field instruments", 4, L3["INS"])
        for k, line in enumerate(lines, start=1):
            num = ai * 1000 + 20 + k
            tag = f"{INSTR_TYPES[(k - 1) % len(INSTR_TYPES)]}-{num}"
            l5 = b.node(f"{ins_pkg}.{tag.replace('-', '')}", f"Instrument {tag}", 5, ins_pkg)
            b.chain(INS_STEPS, area=area, area_name=area_name, disc="INS", l5=l5, tag=tag,
                    tag_type="instrument", start=a_start + _d(50),
                    extra_pred={"INST": [line[1]], "LCK": [trays[(k - 1) % 3][2]]})

        # ---- HSE: L5-level activities ----
        hse_pkg = b.node(f"{L3['HSE']}.FAC", f"{area} HSE facilities & audits", 4, L3["HSE"])
        hyd_tag, ss_tag = f"HYD-{ai}1", f"SS-{ai}1"
        hse_items = [
            ("barricading", "Barricading & safety signage {area}", area, "area", "m",
             rng.randint(150, 400), 0, (4, 7), "quantity", []),
            ("install", "Fire water hydrant {tag} installation", hyd_tag, "hydrant", "nos",
             1, 55, (3, 5), "milestone", []),
            ("install", "Safety shower & eye wash {tag} installation", ss_tag, "shower", "nos",
             1, 60, (2, 4), "milestone", []),
        ]
        last_act = None
        for phase, tmpl, tag, ttype, unit, qty, off, drange, credit, preds in hse_items:
            code = f"{hse_pkg}.{tag.replace('-', '')}"
            b.node(code, tmpl.format(area=area, tag=tag), 5, hse_pkg)
            last_act = b.add(area=area, area_name=area_name, disc="HSE", parent=code, level=5, tag=tag,
                             tag_type=ttype, phase=phase, name=tmpl.format(area=area, tag=tag),
                             start=a_start + _d(off), dur=max(1, round(rng.randint(*drange) * SCALE)), qty=qty,
                             unit=unit, weight=1.0, credit=credit, preds=preds)
        audit_code = f"{hse_pkg}.AUD"
        b.node(audit_code, f"Pre-commissioning HSE audit {area}", 5, hse_pkg)
        b.add(area=area, area_name=area_name, disc="HSE", parent=audit_code, level=5, tag=area,
              tag_type="area", phase="audit", name=f"Pre-commissioning HSE audit {area}",
              start=a_start + _d(95), dur=1, qty=1, unit="audit", weight=1.0,
              credit="milestone", preds=[equipment[0][2].activity_id, lines[0][3].activity_id])

    return b.activities, list(b.wbs.values())


def successors_map(activities: list[Activity]) -> dict[str, list[str]]:
    succ: dict[str, list[str]] = {a.activity_id: [] for a in activities}
    for a in activities:
        for p in a.predecessors:
            succ.setdefault(p, []).append(a.activity_id)
    return succ


def wbs_nodes_as_dicts(nodes: list[WbsNode]) -> list[dict]:
    return [asdict(n) for n in nodes]
