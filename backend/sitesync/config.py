"""Central configuration. Everything is overridable via environment variables."""
from __future__ import annotations

import os
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("SITESYNC_DATA_DIR", ROOT / "data"))
MODEL_DIR = DATA_DIR / "models"
PHOTO_DIR = DATA_DIR / "photos"
SAMPLES_DIR = DATA_DIR / "samples"
DB_PATH = Path(os.environ.get("SITESYNC_DB", DATA_DIR / "sitesync.db"))

# Fixed random seed -> the synthetic dataset is fully reproducible.
RANDOM_SEED = 2026

# "Project clock": the data date that relative expressions ("today", "aaj",
# "yesterday", "kal") resolve against. Fixed so the demo is reproducible;
# override with SITESYNC_DATA_DATE=YYYY-MM-DD.
DATA_DATE = date.fromisoformat(os.environ.get("SITESYNC_DATA_DATE", "2026-09-29"))
PROJECT_START = date(2026, 5, 18)

# Decision-policy thresholds (calibrated probabilities). Editable at runtime via API.
DEFAULT_THRESHOLDS = {
    "auto_apply": 0.80,   # top candidate >= this (and margin ok, no warnings) -> auto-apply
    "review": 0.30,       # between review and auto_apply -> clarify / planner review
    "margin": 0.10,       # min gap between top-1 and top-2 for auto-apply
    "clarify_gap": 0.25,  # top-2 within this gap of top-1 -> ask a clarifying question
}

# Delay flags: activity due within N days (or overdue) and no update for M days.
DELAY_DUE_WINDOW_DAYS = 7
DELAY_AMBER_DAYS = 5
DELAY_RED_DAYS = 10

# Optional LLM (only used when ANTHROPIC_API_KEY is set).
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
LLM_MODEL = os.environ.get("SITESYNC_LLM_MODEL", "claude-sonnet-5-5")


def ensure_dirs() -> None:
    for d in (DATA_DIR, MODEL_DIR, PHOTO_DIR, SAMPLES_DIR):
        d.mkdir(parents=True, exist_ok=True)
