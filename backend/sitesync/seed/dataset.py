"""Build the full synthetic dataset and write it to data/.

Outputs
  data/schedule.csv, data/schedule.json      schedule (activities + WBS nodes)
  data/truth_events.json                     ground-truth actual events (history)
  data/reports/{train,test,hard,backlog}.jsonl   field reports (NO labels inside)
  data/labels.json                           ground truth for every report id
  data/samples/*                             demo inputs (spreadsheet, daily report, MSPDI)
"""
from __future__ import annotations

import csv
import json
import random
from dataclasses import asdict
from datetime import date, timedelta
from pathlib import Path

from ..config import DATA_DATE, DATA_DIR, RANDOM_SEED, SAMPLES_DIR, ensure_dirs
from .actuals import simulate_actuals
from .reports import render_new_work, render_report
from .schedule import generate_schedule, wbs_nodes_as_dicts

SPLIT_SIZES = {"hard": (36, 4), "test": (135, 15), "backlog": (54, 6)}  # (planned-work, new-work)
SCHEDULE_COLUMNS = ["activity_id", "name", "wbs_code", "parent_wbs", "level", "discipline", "area",
                    "area_name", "tag", "tag_type", "phase", "planned_start", "planned_finish", "duration",
                    "quantity", "unit", "weight", "credit_method", "predecessors"]


def build_dataset(seed: int = RANDOM_SEED, data_dir: Path = DATA_DIR) -> dict:
    ensure_dirs()
    rng = random.Random(seed)
    activities, wbs = generate_schedule(seed)
    by_id = {a.activity_id: a for a in activities}
    events, actual = simulate_actuals(activities, random.Random(seed + 1), DATA_DATE)

    l4_for: dict[tuple[str, str], str] = {}
    for a in activities:
        pkg = a.parent_wbs.rsplit(".", 1)[0] if a.level == 6 else a.parent_wbs.rsplit(".", 1)[0]
        l4_for.setdefault((a.area, a.discipline), pkg)
    parent_for = lambda area, disc: l4_for[(area, disc)]

    # previous cumulative qty per event (for incremental phrasing)
    prev_done: dict[str, float] = {}
    last_by_act: dict[str, float] = {}
    for e in events:
        prev_done[e.event_id] = last_by_act.get(e.activity_id, 0.0)
        last_by_act[e.activity_id] = e.qty_done

    reportable = [e for e in events if rng.random() < 0.88]
    rng.shuffle(reportable)

    splits: dict[str, list[tuple[dict, dict]]] = {k: [] for k in ("train", "test", "hard", "backlog")}
    cursor = 0

    def make(ev, hard: bool):
        a = by_id[ev.activity_id]
        ed = date.fromisoformat(ev.date)
        lag = rng.choices([0, 1, 2, 3, 4], weights=[60, 30, 10, 0, 0] if not hard else [25, 25, 20, 15, 15])[0]
        rd = min(DATA_DATE, ed + timedelta(days=lag))
        rep = render_report(a, ev, prev_done[ev.event_id], rd, rng, hard=hard)
        lab = {"activity_id": a.activity_id, "is_new": False, "event": ev.event, "qty_done": ev.qty_done,
               "qty_total": ev.qty_total, "pct": ev.pct, "event_date": ev.date, "discipline": a.discipline,
               "area": a.area, "parent_wbs": a.parent_wbs, "qty_mode": rep["qty_mode"],
               "out_of_order": ev.out_of_order, "truth_event_id": ev.event_id}
        return rep, lab

    def new_work(hard: bool, max_age: int = 150):
        rd = DATA_DATE - timedelta(days=rng.randint(1, max_age))
        rep, lab = render_new_work(rng, rd, parent_for, hard=hard)
        lab["qty_mode"] = "none"
        return rep, lab

    # Backlog = the most recent reports (last 12 days), not yet reconciled: they seed the
    # planner review queue and are excluded from the seeded actuals history.
    recent_cut = (DATA_DATE - timedelta(days=12)).isoformat()
    n_plan, n_new = SPLIT_SIZES["backlog"]
    backlog_evs = [e for e in reportable if e.date >= recent_cut][:n_plan]
    taken = {e.event_id for e in backlog_evs}
    reportable = [e for e in reportable if e.event_id not in taken]
    items = [make(e, rng.random() < 0.5) for e in backlog_evs]
    items += [new_work(rng.random() < 0.5, max_age=12) for _ in range(n_new)]
    items.sort(key=lambda it: it[0]["report_date"])
    splits["backlog"] = items

    for split in ("hard", "test"):
        n_plan, n_new = SPLIT_SIZES[split]
        items = [make(e, split == "hard") for e in reportable[cursor:cursor + n_plan]]
        cursor += n_plan
        items += [new_work(split == "hard") for _ in range(n_new)]
        rng.shuffle(items)
        splits[split] = items
    train = [make(e, False) for e in reportable[cursor:]]
    n_new_train = round(len(train) / 9)  # ~10% of the train split is new work
    train += [new_work(False) for _ in range(n_new_train)]
    rng.shuffle(train)
    splits["train"] = train

    labels: dict[str, dict] = {}
    rep_dir = data_dir / "reports"
    rep_dir.mkdir(parents=True, exist_ok=True)
    counts = {}
    prefix = {"train": "TR", "test": "TS", "hard": "HD", "backlog": "BL"}
    for split, items in splits.items():
        with open(rep_dir / f"{split}.jsonl", "w", encoding="utf-8") as f:
            for i, (rep, lab) in enumerate(items, start=1):
                rid = f"{prefix[split]}-{i:04d}"
                rep = {"report_id": rid, **{k: v for k, v in rep.items() if k != "qty_mode"}}
                f.write(json.dumps(rep, ensure_ascii=False) + "\n")
                labels[rid] = {**lab, "split": split}
        counts[split] = len(items)

    (data_dir / "labels.json").write_text(json.dumps(labels, indent=1, ensure_ascii=False), encoding="utf-8")
    sched = {"project": "GGS-7 Gas Gathering Station (fictional)", "data_date": DATA_DATE.isoformat(),
             "activities": [a.to_dict() for a in activities], "wbs": wbs_nodes_as_dicts(wbs)}
    (data_dir / "schedule.json").write_text(json.dumps(sched, indent=1, ensure_ascii=False), encoding="utf-8")
    write_schedule_csv(activities, data_dir / "schedule.csv")
    (data_dir / "truth_events.json").write_text(
        json.dumps([asdict(e) for e in events], indent=0), encoding="utf-8")

    write_samples(activities, events, actual)
    return {"activities": len(activities), "wbs_nodes": len(wbs), "events": len(events), "reports": counts,
            "new_work": sum(1 for l in labels.values() if l["is_new"])}


def write_schedule_csv(activities, path: Path) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(SCHEDULE_COLUMNS)
        for a in activities:
            d = a.to_dict()
            d["predecessors"] = ";".join(a.predecessors)
            w.writerow([d[c] for c in SCHEDULE_COLUMNS])


def write_samples(activities, events, actual) -> None:
    """Demo inputs describing progress on the data date for in-progress activities."""
    from openpyxl import Workbook

    last = {}
    for e in events:
        last[e.activity_id] = e
    in_prog = [a for a in activities if a.activity_id in actual and actual[a.activity_id]["finish"] is None
               and not actual[a.activity_id]["stalled"]]
    today = DATA_DATE

    # 1) Piping discipline spreadsheet
    pip = [a for a in in_prog if a.discipline == "PIP" and a.credit_method == "quantity"][:8]
    rows = []
    for a in pip:
        done = last[a.activity_id].qty_done if a.activity_id in last else 0
        inc = max(1, round(a.quantity * 0.08))
        cum = min(a.quantity - 1, done + inc)
        rows.append([today.strftime("%d-%m-%Y"), a.area, a.tag, a.phase.capitalize(), int(cum - done), int(cum),
                     int(a.quantity), a.unit, "Work continuing" if cum < a.quantity else "Completed"])
    header = ["Date", "Unit", "Line No", "Activity", "Qty Today", "Cum Qty", "Total Qty", "UOM", "Remarks"]
    with open(SAMPLES_DIR / "piping_daily_progress.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    wb = Workbook()
    ws = wb.active
    ws.title = "Piping progress"
    ws.append(header)
    for r in rows:
        ws.append(r)
    wb.save(SAMPLES_DIR / "piping_daily_progress.xlsx")

    # 2) Mixed-discipline daily report text (electrical + instrumentation + civil)
    lines = [f"DAILY PROGRESS REPORT - {today.strftime('%d-%b-%Y')} - Site supervisor (E&I / Civil)", ""]
    for a in [x for x in in_prog if x.discipline in ("ELE", "INS", "CIV")][:7]:
        done = last[a.activity_id].qty_done if a.activity_id in last else 0
        if a.credit_method == "quantity":
            cum = min(a.quantity - 1, done + max(1, round(a.quantity * 0.1)))
            lines.append(f"- {a.tag} {a.phase.replace('_', ' ')}: {cum:g} of {a.quantity:g} {a.unit} done today")
        else:
            lines.append(f"- {a.tag} {a.phase.replace('_', ' ')} completed today")
    lines += ["", "Manpower: 46 | Weather: clear | No LTI"]
    (SAMPLES_DIR / "daily_report_EI_civil.txt").write_text("\n".join(lines), encoding="utf-8")
