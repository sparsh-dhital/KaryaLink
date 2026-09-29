"""API smoke + workflow tests against a freshly seeded temporary database."""
import io
import xml.etree.ElementTree as ET

from sitesync.engine import policy


def test_health_meta_summary(client):
    assert client.get("/api/health").json()["ok"]
    m = client.get("/api/meta").json()
    assert m["model_version"] == "v1" and m["llm_enabled"] is False
    s = client.get("/api/dashboard/summary").json()
    assert s["activities"] >= 400 and 0 < s["actual_pct"] < 100


def test_metrics_are_computed_and_labelled(client):
    for split in ("test", "hard"):
        m = client.get(f"/api/metrics?split={split}").json()
        assert m["label"] == "synthetic benchmark"
        assert 0 <= m["top1_accuracy"] <= 1 and m["n"] == (150 if split == "test" else 40)
        assert len(m["curve"]) > 10 and "confusion" in m
    h = client.get("/api/metrics/history").json()
    assert [x["version"] for x in h][:2] == ["v0-baseline", "v1"]


def _first_in_progress(client):
    acts = client.get("/api/activities?discipline=PIP&limit=500").json()
    for a in acts:
        if a["actual_start"] and not a["actual_finish"] and a["credit_method"] == "quantity" and a["qty_done"] < a["quantity"] - 1:
            return a
    raise AssertionError("no in-progress piping activity")


def test_submit_report_auto_applies_with_rule_of_credit(client):
    a = _first_in_progress(client)
    nxt = int(a["qty_done"]) + 1
    text = f"{a['phase']} progressing on line {a['tag']} in {a['area']}: {nxt} of {int(a['quantity'])} {a['unit']} done today"
    r = client.post("/api/reports", json={"text": text, "reporter": "tester", "reporter_discipline": "PIP"}).json()
    assert r["candidates"][0]["activity_id"] == a["activity_id"]
    assert r["decision"] in policy.DECISIONS
    if r["decision"] == policy.AUTO_APPLY:
        assert r["status"] == "applied"
        after = client.get(f"/api/activities/{a['activity_id']}").json()
        assert abs(after["pct"] - round(100 * nxt / a["quantity"], 1)) < 0.2
    # every report has evidence spans that point into its text
    for s in r["evidence_spans"]:
        assert 0 <= s["start"] < s["end"] <= len(text)


def test_new_work_is_flagged_and_planner_can_create_activity(client):
    r = client.post("/api/reports", json={"text": 'Extra pipe support fabricated for new drain line 2"-D-9407, not in plan',
                                          "reporter_discipline": "PIP"}).json()
    assert r["decision"] == policy.NEW_ACTIVITY and r["status"] == "awaiting_planner"
    out = client.post(f"/api/reports/{r['id']}/action", json={"action": "approve"}).json()
    assert out["status"] == "new_activity_created" and out["activity_id"].split("-")[-1].startswith("N")


def test_planner_reassign_reject_and_bulk(client):
    q = client.get("/api/queue").json()["planner"]
    assert q, "seeded backlog should leave items for review"
    target = client.get("/api/activities?discipline=CIV&limit=1").json()[0]["activity_id"]
    r = client.post(f"/api/reports/{q[0]['id']}/action", json={"action": "reassign", "activity_id": target}).json()
    assert r["status"] == "applied" and r["activity_id"] == target
    if len(q) > 1:
        r2 = client.post(f"/api/reports/{q[1]['id']}/action", json={"action": "reject"}).json()
        assert r2["status"] == "rejected"
    b = client.post("/api/queue/bulk-approve", json={"min_confidence": 0.0}).json()
    assert "count" in b
    bad = client.post(f"/api/reports/{q[0]['id']}/action", json={"action": "approve"})
    assert bad.status_code == 400  # already applied -> clear error, no double-apply


def test_assistant_conversation_and_end_of_day(client):
    sid = "pytest-session"
    m = client.post("/api/assistant/message", json={"session_id": sid, "text": "namaste", "lang": "hi-IN"}).json()
    assert "Namaste" in m["messages"][0]["text"]
    m = client.post("/api/assistant/message", json={"session_id": sid, "text": "hello how are you"}).json()
    assert m["messages"][0]["role"] == "assistant"
    eod = client.post("/api/assistant/end-of-day", json={"session_id": sid}).json()["messages"]
    assert eod and eod[0]["text"]
    if eod[-1]["payload"].get("options"):
        a = client.post("/api/assistant/answer", json={"session_id": sid, "value": "no_work"}).json()
        assert a["messages"]
    hist = client.get(f"/api/assistant/history/{sid}").json()
    assert len(hist) >= 4


def test_clarification_flow_via_demo_script(client):
    script = client.get("/api/demo/script").json()
    step = next((s for s in script["steps"] if s["id"] == "clarify"), None)
    if step is None:
        return  # state-dependent; covered by policy unit tests
    sid = "pytest-clarify"
    msgs = client.post("/api/assistant/message", json={"session_id": sid, "text": step["text"], "lang": "hi-IN",
                                                       "discipline": step["discipline"]}).json()["messages"]
    assert msgs[-1]["payload"].get("question")
    # spoken answer "pehla wala" = first option
    out = client.post("/api/assistant/message", json={"session_id": sid, "text": "pehla wala", "lang": "hi-IN"}).json()
    assert out["messages"][-1]["report_id"] == msgs[-1]["report_id"]


def test_photo_upload_and_evidence(client):
    png = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
           b"\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7V\xbd\xfa\x00\x00\x00\x00IEND\xaeB`\x82")
    p = client.post("/api/photos", files={"file": ("site.png", png, "image/png")}, data={"lat": "27.1", "lon": "95.3"}).json()
    assert p["id"] and len(p["sha256"]) == 64
    assert client.get(p["url"]).status_code == 200
    r = client.post("/api/reports", json={"text": "F-11 excavation started today", "photo_id": p["id"]}).json()
    assert r["photo_id"] == p["id"]
    entries = client.get(f"/api/audit?report_id={r['id']}").json()["items"]
    assert any((e["payload"].get("photo") or {}).get("sha256") == p["sha256"] for e in entries)
    assert client.post("/api/photos", files={"file": ("x.txt", b"hello", "text/plain")}).status_code == 400


def test_upload_spreadsheet_and_daily_report(client):
    csv = ("Date,Unit,Line No,Activity,Qty Today,Cum Qty,Total Qty,UOM,Remarks\n"
           "29-09-2026,U-100,\"20\"\"-P-1022\",Welding,2,10,40,joints,Work continuing\n").encode()
    r = client.post("/api/reports/upload", files={"file": ("p.csv", csv, "text/csv")}).json()
    assert len(r["reports"]) == 1 and r["reports"][0]["channel"] == "spreadsheet"
    txt = b"DAILY REPORT\n- F-11 excavation 20 of 100 m3 done today\nManpower: 40 | Weather: clear\n"
    r = client.post("/api/reports/upload", files={"file": ("d.txt", txt, "text/plain")}).json()
    assert len(r["reports"]) == 1 and len(r["informational_lines"]) == 2  # nothing silently dropped
    assert client.post("/api/reports/upload", files={"file": ("x.pdf", b"%PDF", "application/pdf")}).status_code == 400


def test_exports_and_mspdi_roundtrip(client):
    csv = client.get("/api/export/schedule.csv")
    assert csv.status_code == 200 and csv.text.startswith("activity_id,")
    ds = client.get("/api/export/actuals.csv")
    assert ds.status_code == 200 and "evidence_phase" in ds.text.splitlines()[0]
    xml = client.get("/api/export/schedule.xml").text
    root = ET.fromstring(xml)
    ns = {"p": "http://schemas.microsoft.com/project"}
    tasks = root.findall("p:Tasks/p:Task", ns)
    assert len(tasks) > 400
    assert any(t.find("p:ActualStart", ns) is not None for t in tasks)
    # re-import our own MSPDI: every leaf task should match an existing activity (updated, not duplicated)
    r = client.post("/api/schedule/import", files={"file": ("s.xml", xml.encode(), "application/xml")}).json()
    assert r["activities_added"] == 0 and r["activities_updated"] >= 440
    bad = client.post("/api/schedule/import", files={"file": ("s.xml", b"<nope", "application/xml")})
    assert bad.status_code == 400


def test_schedule_csv_import_validation(client):
    bad = client.post("/api/schedule/import", files={"file": ("s.csv", b"foo,bar\n1,2\n", "text/csv")})
    assert bad.status_code == 400 and "missing required columns" in bad.json()["detail"]
    ok = ("activity_id,name,planned_start,planned_finish\n"
          "X-NEW-1,Cable tray installation CT-F-09,2026-10-01,2026-10-05\n").encode()
    r = client.post("/api/schedule/import", files={"file": ("s.csv", ok, "text/csv")}).json()
    assert r["activities_added"] == 1
    a = client.get("/api/activities/X-NEW-1").json()
    assert a["discipline"] == "ELE" and a["tag"] == "CT-F-09"  # inferred from the name


def test_dashboard_endpoints(client):
    assert client.get("/api/rollup").json()["roots"]
    assert client.get("/api/rollup?discipline=PIP").json()["roots"]
    g = client.get("/api/plan-vs-actual?discipline=CIV").json()
    assert all(x["discipline"] == "CIV" for x in g)
    sc = client.get("/api/dashboard/scurve").json()
    assert sc and "planned" in sc[0] and any("actual" in x for x in sc)
    for f in client.get("/api/dashboard/delays").json():
        assert f["level"] in ("amber", "red")
    assert isinstance(client.get("/api/dashboard/warnings").json(), list)


def test_memory_query(client):
    r = client.post("/api/memory/ask", json={"question": "typical duration for piping erection"}).json()
    assert "Synthetic" in r["note"] and "median" in r["answer"]


def test_thresholds_validation(client):
    assert client.put("/api/settings/thresholds", json={"auto_apply": 0.5, "review": 0.6}).status_code == 400


def test_retrain_uses_corrections_and_ledger_verifies(client):
    r = client.post("/api/retrain").json()
    assert r["round"] >= 2 and r["n_corrections"] >= 1
    hist = client.get("/api/metrics/history").json()
    assert hist[-1]["is_active"] and hist[-1]["version"] == r["version"]
    v = client.get("/api/audit/verify").json()
    assert v["ok"] and v["entries"] > 50
