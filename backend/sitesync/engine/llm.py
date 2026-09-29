"""OPTIONAL LLM-assisted extraction. Only active when ANTHROPIC_API_KEY is set.

The LLM returns strict JSON (structured outputs). Every field must quote an evidence
span; any field whose evidence is not literally present in the source text is REJECTED.
LLM fields only fill gaps left by the rule extractor - they never override rule fields.
Any error (no network, no SDK, refusal) silently falls back to the offline path.
"""
from __future__ import annotations

import json
import logging

from .. import config
from .lexicon import PHASE_LABEL, PHASE_DISCIPLINE

log = logging.getLogger("sitesync.llm")

_FIELD = {"type": "object", "properties": {"value": {"type": ["string", "null"]},
                                           "evidence": {"type": ["string", "null"]}},
          "required": ["value", "evidence"], "additionalProperties": False}
SCHEMA = {
    "type": "object",
    "properties": {k: _FIELD for k in ("phase", "status", "tag", "area")},
    "required": ["phase", "status", "tag", "area"],
    "additionalProperties": False,
}
PROMPT = """You extract construction progress facts from one site-supervisor message (English, Hindi or Hinglish).
Return JSON with fields phase, status, tag, area. For each: "value" and "evidence".
- phase: one of {phases} or null
- status: one of start, progress, complete, or null
- tag: an equipment / line / foundation / tray / instrument tag exactly as written, or null
- area: a unit/area code like U-100, or null
"evidence" MUST be an exact substring copied from the message that supports the value; use null if unsure.

Message: <<<{text}>>>"""


def available() -> bool:
    if not config.ANTHROPIC_API_KEY:
        return False
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False
    return True


def _call(text: str) -> dict | None:
    import anthropic

    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY, timeout=20.0, max_retries=1)
    resp = client.beta.messages.create(
        model=config.LLM_MODEL,
        max_tokens=1024,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": PROMPT.format(phases=", ".join(PHASE_LABEL), text=text)}],
    )
    if resp.stop_reason == "refusal":
        return None
    txt = next((b.text for b in resp.content if b.type == "text"), None)
    return json.loads(txt) if txt else None


def enrich(ext: dict) -> dict:
    """Fill missing fields in a rule extraction from the LLM; reject unsupported evidence."""
    if not available():
        return ext
    text = ext["text"]
    try:
        out = _call(text)
    except Exception as e:  # network / auth / SDK errors -> offline path
        log.warning("LLM extraction skipped: %s", e)
        ext["llm_status"] = f"skipped: {type(e).__name__}"
        return ext
    if not out:
        ext["llm_status"] = "no output"
        return ext
    accepted, rejected = [], []
    low = text.lower()
    for key, f in out.items():
        val, evd = f.get("value"), f.get("evidence")
        if not val:
            continue
        if not evd or evd.lower() not in low:
            rejected.append({"field": key, "value": val, "evidence": evd, "reason": "evidence not in source"})
            continue
        s = low.index(evd.lower())
        span = {"start": s, "end": s + len(evd), "evidence": text[s:s + len(evd)], "source": "llm"}
        if key == "phase" and ext.get("phase") is None and val in PHASE_LABEL:
            ext["phase"] = {"value": val, "label": PHASE_LABEL[val], **span}
            ext["phases_all"] = sorted(set(ext.get("phases_all") or []) | {val})
            if ext.get("discipline") is None and PHASE_DISCIPLINE.get(val):
                ext["discipline"] = {"value": PHASE_DISCIPLINE[val], "votes": {}, **span}
            accepted.append(key)
        elif key == "status" and ext.get("status") is None and val in ("start", "progress", "complete"):
            ext["status"] = {"value": val, **span}
            accepted.append(key)
        elif key == "area" and ext.get("area") is None:
            ext["area"] = {"value": val.upper().replace("U", "U-").replace("--", "-"), **span}
            accepted.append(key)
        elif key == "tag" and not ext.get("tags"):
            from .extractor import Normalized, extract_tags

            parsed, _ = extract_tags(Normalized(val))
            parsed += extract_tags(Normalized(val), bare_numbers=True)[0]
            if parsed:
                ext["tags"] = [{**t, **span} for t in parsed[:1]]
                accepted.append(key)
            else:
                rejected.append({"field": key, "value": val, "evidence": evd, "reason": "not a recognised tag"})
    ext["llm_status"] = "ok"
    ext["llm_accepted"] = accepted
    ext["llm_rejected"] = rejected
    ext["extractor"] = "rules+llm" if accepted else "rules"
    return ext
