"""Context-aware Site Assistant: intents, follow-ups, undo/correct, queries, voice-transcript robustness."""
from datetime import date

import pytest

from sitesync.engine.extractor import extract

RD = date(2026, 9, 29)


def v(ext, k):
    return (ext.get(k) or {}).get("value")


# ---------------------------------------------------------------- speech-transcript normalisation
@pytest.mark.parametrize("text,tag,phase,status", [
    ("आज एफ 12 का ढलाई हो गया 42 क्यूबिक मीटर", "F-12", "pour", "complete"),
    ("सी टी बी 07 में केबल पुलिंग शुरू", "CT-B-07", "cable_pull", "start"),
    ("पी टी 1021 लूप चेक हो गया", "PT-1021", "loop_check", "complete"),
    ("line P dash 1021 three of twelve spools erected", "P-1021", "erection", "progress"),
    ("sir ji F-12 ka dhalai ho gaya", "F-12", "pour", "complete"),
])
def test_voice_transcripts(text, tag, phase, status):
    e = extract(text, RD)
    assert [t["value"] for t in e["tags"]] == [tag]
    assert v(e, "phase") == phase and v(e, "status") == status
    for t in e["tags"]:  # evidence still points into the original (Devanagari) text
        assert text[t["start"]:t["end"]] == t["evidence"]


def test_hindi_number_words_and_cumulative():
    e = extract("बारह में से तीन स्पूल इरेक्शन हो गए लाइन जी 2021", RD)
    assert e["quantity"]["value"] == 3 and e["quantity"]["total"] == 12


def test_followup_quantity_is_incremental_progress():
    e = extract("aur 2 ho gaye", RD)
    assert e["quantity"]["mode"] == "incremental" and v(e, "status") == "progress"


# ---------------------------------------------------------------- conversation helpers
def say(client, sid, text, **kw):
    body = {"session_id": sid, "text": text, "lang": kw.pop("lang", "en-IN"), "reporter": "Test Supervisor", **kw}
    r = client.post("/api/assistant/message", json=body)
    assert r.status_code == 200, r.text
    return r.json()["messages"]


def in_progress(client, disc="PIP"):
    for a in client.get(f"/api/activities?discipline={disc}&limit=500").json():
        if a["actual_start"] and not a["actual_finish"] and a["credit_method"] == "quantity" and a["qty_done"] < a["quantity"] - 3:
            return a
    raise AssertionError("no in-progress activity")


def test_help_thanks_language_switch(client):
    m = say(client, "t-help", "what can you do?")
    assert m[-1]["payload"]["kind"] == "help" and len(m[-1]["payload"]["items"]) >= 8
    m = say(client, "t-help", "hindi mein bolo")
    assert m[-1]["payload"]["set_lang"] == "hi-IN"
    m = say(client, "t-help", "thank you")
    assert "welcome" in m[-1]["text"].lower()


def test_status_query_is_answered_not_logged_as_report(client):
    a = in_progress(client)
    before = client.get("/api/reports?limit=1").json()["total"]
    m = say(client, "t-status", f"what is the status of line {a['tag']}?")
    assert m[-1]["payload"]["kind"] == "status"
    assert any(i["activity_id"] == a["activity_id"] for i in m[-1]["payload"]["items"])
    assert client.get("/api/reports?limit=1").json()["total"] == before  # a question is not a progress report


def test_plan_delays_and_memory_queries(client):
    m = say(client, "t-q", "what is planned today?", discipline="PIP")
    assert m[-1]["payload"]["kind"] in ("list",) or "Nothing" in m[-1]["text"]
    m = say(client, "t-q", "kya delay hai?", lang="hi-IN")
    assert m[-1]["payload"].get("kind") == "list"
    m = say(client, "t-q", "what is the typical duration for piping erection?")
    assert m[-1]["payload"]["kind"] == "memory" and "median" in m[-1]["text"]


def test_update_then_followup_then_undo(client):
    a = in_progress(client)
    sid = "t-flow"
    done = int(a["qty_done"]) + 1
    m = say(client, sid, f"line {a['tag']} {a['phase']} {done} of {int(a['quantity'])} {a['unit']} done today", discipline=a["discipline"])
    first = m[-1]
    assert first["report_id"]
    rep = client.get(f"/api/reports/{first['report_id']}").json()
    if rep["status"] != "applied":
        pytest.skip("engine chose review for this synthetic state")
    pct1 = client.get(f"/api/activities/{a['activity_id']}").json()["pct"]
    # follow-up without a tag uses the last activity (and says so)
    m = say(client, sid, "aur 1 ho gaya")
    assert "assuming" in m[-1]["text"].lower() or m[-1]["payload"].get("decision")
    pct2 = client.get(f"/api/activities/{a['activity_id']}").json()["pct"]
    assert pct2 >= pct1
    # undo restores the previous value, append-only
    m = say(client, sid, "undo")
    assert m[-1]["payload"].get("status") == "reverted"
    assert client.get(f"/api/activities/{a['activity_id']}").json()["pct"] == pytest.approx(pct1, abs=0.2)
    kinds = [e["kind"] for e in client.get("/api/audit?kind=ACTUAL_REVERTED").json()["items"]]
    assert "ACTUAL_REVERTED" in kinds
    assert client.get("/api/audit/verify").json()["ok"]


def test_why_explains_last_link(client):
    a = in_progress(client)
    say(client, "t-why", f"{a['tag']} {a['phase']} in progress", discipline=a["discipline"])
    m = say(client, "t-why", "why?")
    assert m[-1]["payload"]["kind"] == "why" and m[-1]["payload"]["reasons"]


def test_multiple_updates_in_one_message(client):
    acts = [x for x in client.get("/api/activities?discipline=CIV&limit=500").json() if x["actual_start"] and not x["actual_finish"]]
    if len(acts) < 2:
        pytest.skip("need two in-progress civil activities")
    a, b = acts[0], acts[1]
    m = say(client, "t-multi", f"{a['tag']} {a['phase']} in progress and {b['tag']} {b['phase']} in progress", discipline="CIV")
    assert "2 separate updates" in m[0]["text"]
    assert len([x for x in m if x["report_id"]]) == 2


def test_supervisor_correction_relinks_last_update(client):
    lines = [x for x in client.get("/api/activities?discipline=PIP&limit=500").json()
             if x["phase"] == "welding" and x["actual_start"] and not x["actual_finish"]]
    if len(lines) < 2:
        pytest.skip("need two lines in welding")
    a, b = lines[0], lines[1]
    sid = "t-fix"
    m = say(client, sid, f"line {a['tag']} field welding in progress", discipline="PIP")
    rid = m[-1]["report_id"]
    m = say(client, sid, f"no, it was line {b['tag']}")
    assert m[-1]["payload"].get("activity_id") == b["activity_id"]
    rep = client.get(f"/api/reports/{rid}").json()
    assert rep["activity_id"] == b["activity_id"]


def test_photo_only_attaches_to_next_update(client):
    png = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
           b"\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7V\xbd\xfa\x00\x00\x00\x00IEND\xaeB`\x82")
    p = client.post("/api/photos", files={"file": ("x.png", png, "image/png")}).json()
    sid = "t-photo"
    m = say(client, sid, "", photo_id=p["id"])
    assert "photo" in m[-1]["text"].lower()
    a = in_progress(client, "ELE")
    m = say(client, sid, f"{a['tag']} {a['phase']} in progress", discipline="ELE")
    assert client.get(f"/api/reports/{m[-1]['report_id']}").json()["photo_id"] == p["id"]


def test_upload_through_assistant_is_persisted(client):
    txt = b"- F-11 excavation 10 of 100 m3 done today\nWeather: clear\n"
    r = client.post("/api/assistant/upload", files={"file": ("day.txt", txt, "text/plain")},
                    data={"session_id": "t-up", "reporter": "Test"})
    assert r.status_code == 200
    hist = client.get("/api/assistant/history/t-up").json()
    assert hist[0]["role"] == "user" and "day.txt" in hist[0]["text"]
    assert hist[-1]["payload"]["kind"] == "list"
    assert client.delete("/api/assistant/history/t-up").json()["ok"]
    assert client.get("/api/assistant/history/t-up").json() == []


def test_chaser_ignores_update_for_another_tag(client):
    sid = "t-eod"
    m = client.post("/api/assistant/end-of-day", json={"session_id": sid}).json()["messages"]
    if not m[-1]["payload"].get("options"):
        pytest.skip("no gaps today")
    cur = m[-1]["payload"]["chaser_activity"]
    other = next(a for a in client.get("/api/activities?discipline=CIV&limit=500").json() if a["activity_id"] != cur and a["tag"].startswith("F-"))
    out = say(client, sid, f"{other['tag']} excavation done")
    assert all(x["payload"].get("chaser_activity") != cur or x["payload"].get("question") for x in out)
    assert any(x["report_id"] for x in out)  # handled as a normal report, not as the chaser answer
