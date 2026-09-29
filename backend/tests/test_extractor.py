from datetime import date

import pytest

from sitesync.engine.extractor import evidence_spans, extract

RD = date(2026, 9, 29)


def v(ext, k):
    return (ext.get(k) or {}).get("value")


def test_english_formal_with_partial_quantity():
    e = extract('Erection of spools completed for 3 of 12 spools on line 24"-P-1021 in U-100 today.', RD)
    assert v(e, "phase") == "erection"
    assert [t["value"] for t in e["tags"]] == ['24"-P-1021']
    assert e["quantity"]["value"] == 3 and e["quantity"]["total"] == 12 and e["quantity"]["mode"] == "cumulative"
    assert v(e, "status") == "progress"  # 3 of 12 is not complete, despite the word "completed"
    assert v(e, "date") == "2026-09-29"
    assert v(e, "area") == "U-100"
    assert v(e, "discipline") == "PIP"


def test_hinglish_with_hindi_quantity_and_relative_date():
    e = extract("kal F-12 ka dhalai ho gaya, 42 me se 42 cum", RD)
    assert v(e, "phase") == "pour"
    assert [t["value"] for t in e["tags"]] == ["F-12"]
    assert v(e, "status") == "complete"
    assert v(e, "date") == "2026-09-28"
    assert v(e, "discipline") == "CIV"


def test_devanagari_and_status_start():
    e = extract("आज CT-B-07 में केबल पुलिंग शुरू", RD)
    assert [t["value"] for t in e["tags"]] == ["CT-B-07"]
    assert v(e, "status") == "start"
    assert v(e, "date") == "2026-09-29"


def test_typos_are_corrected_and_evidence_points_to_original():
    text = "spool erction compleated line P-1021"
    e = extract(text, RD)
    assert v(e, "phase") == "erection"
    assert v(e, "status") == "complete"
    assert e["phase"]["evidence"] == "erction"  # evidence is the ORIGINAL typo'd token
    assert any(c["from"] == "compleated" for c in e["corrections"])


def test_voice_number_words_and_granular_ids():
    e = extract("line 1021 three of twelve spools erected", RD)
    assert e["quantity"]["value"] == 3 and e["quantity"]["total"] == 12
    g = extract("joints J-5, J-6 welded on 2023 line", RD)
    assert g["quantity"]["value"] == 2 and g["quantity"]["unit"] == "joints"
    assert [t["value"] for t in g["tags"]] == ["2023"]


@pytest.mark.parametrize("text,expected", [
    ("pour done 14/09", "2026-09-14"),
    ("pour done 14-Sep-2026", "2026-09-14"),
    ("pour done Sep 14", "2026-09-14"),
    ("pour done 14.09.26", "2026-09-14"),
    ("pour done 2026-09-14", "2026-09-14"),
])
def test_explicit_dates(text, expected):
    assert v(extract(text, RD), "date") == expected


def test_slash_quantity_is_not_a_date():
    e = extract("3/12 spools erected", RD)
    assert e["quantity"]["value"] == 3 and e["quantity"]["total"] == 12
    assert e["date"]["source"] == "assumed"


def test_missing_date_is_flagged_as_assumed():
    e = extract("PT-1021 installed", RD)
    assert e["date"]["source"] == "assumed" and e["date"]["value"] == RD.isoformat()


def test_tag_families():
    e = extract("V-101 setting, P-102A alignment, PT-1021 loop check, HYD-11 install", RD)
    kinds = {t["value"]: t["type"] for t in e["tags"]}
    assert kinds["V-101"] == "equipment" and kinds["P-102A"] == "equipment"
    assert kinds["PT-1021"] == "instrument" and kinds["HYD-11"] == "hydrant"


def test_new_work_cue():
    assert extract("Extra pipe support fabricated, not in plan", RD)["new_work_cue"] is not None


def test_every_evidence_span_matches_source_text():
    texts = ['Erection 3 of 12 spools line 24"-P-1021 U-100 today', "kal F-12 ka dhalai ho gaya 42 cum",
             "sir, cablling 356/864 rmt yday CT-D-05", "fdn no 43 shutttering and rebar complete"]
    for t in texts:
        e = extract(t, RD)
        for s in evidence_spans(e):
            assert 0 <= s["start"] < s["end"] <= len(t)
        for k in ("phase", "status", "quantity", "area"):
            f = e.get(k)
            if f and f.get("start") is not None:
                assert t[f["start"]:f["end"]] == f["evidence"]
