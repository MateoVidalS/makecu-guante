import json

import pytest
from google.genai import types
from sqlmodel import select

from app.chat import tools
from app.contracts import types as c
from app.db import models as m
from app.db import repo


def test_declarations_are_sdk_compatible_and_read_only():
    generated = types.GenerateContentConfig(tools=tools.TOOLS)
    live = types.LiveConnectConfig(tools=tools.TOOLS)
    names = {d.name for d in generated.tools[0].function_declarations}
    assert names == set(tools.ARGUMENTS)
    assert len(live.tools[0].function_declarations) == 6
    assert set(tools.CHART_SECTIONS) == {
        "summary",
        "glance",
        "range",
        "assistance",
        "therapy",
        "sessions",
        "evaluations",
    }


@pytest.mark.parametrize("day", ["2026-11-05", "Nov 5", "nov 05"])
def test_session_readable_attempts_and_dates(db, day):
    result = tools.execute(db, "get_session", {"date": day})
    assert result["only_demo"] is True
    session = result["readable"]["sessions"][0]
    assert session["iso_date"] == "2026-11-05"
    assert session["feelings"] and session["coach_actions"]
    attempts = session["attempts"]
    assert len(attempts) == 10
    opening = next(a for a in attempts if a["pose"] == "open")
    assert opening["assisted"] and not opening["interrupted"]
    finger = opening["per_finger"]["index"]
    assert finger["target_closure_percent"] == 0
    assert 0 < finger["opening_on_own_percent"] < 100
    assert finger["glove_completed_percent"] > 0
    assert '"id":' not in json.dumps(result)


def test_every_session_on_same_day_and_no_model_invented_id(db):
    latest = repo.list_sessions(db)[0]
    repo.create_session(
        db,
        c.SessionIn(
            mode="exercise",
            calibration_id=latest.calibration_id,
            plan=latest.plan,
            settings=latest.settings,
            is_demo=True,
        ),
        started_at="2026-11-05T16:00:00Z",
    )
    result = tools.execute(db, "get_session", {"date": "Nov 5"})
    assert len(result["readable"]["sessions"]) == 2
    assert "error" in tools.execute(db, "get_session", {"date": "Nov 5", "session_id": 12345})


def test_safety_and_decision_reasons_are_readable(db):
    for session in repo.list_sessions(db):
        detail = repo.get_session(db, session.id)
        if not any(a.safety_events for a in detail.attempts):
            continue
        result = tools.execute(db, "get_session", {"date": detail.started_at[:10]})
        day = result["readable"]["sessions"][0]
        events = [e for a in day["attempts"] for e in a["safety"]]
        assert events and all("seconds_into_attempt" in e and "what" in e for e in events)
        assert all("reason" in d for d in day["coach_actions"])


def test_transcript_trim_and_missing(db):
    result = tools.execute(db, "get_transcript", {"date": "Nov 5"})
    transcript = result["readable"]["transcript"]
    assert "patient:" in transcript and len(transcript) <= 4000
    latest = repo.list_sessions(db)[0]
    repo.add_transcript(
        db,
        latest.id,
        [c.TranscriptLine(t=latest.started_at, role="patient", text="Long note " * 600)],
    )
    result = tools.execute(db, "get_transcript", {"date": "Nov 5"})
    assert len(result["readable"]["transcript"]) == 4000
    assert result["readable"]["truncated"] is True
    assert "not_found" in tools.execute(db, "get_transcript", {"date": "Sep 26"})


def test_evaluation_sweeps_friction_and_incomplete(db):
    row = db.exec(select(m.Evaluation).order_by(m.Evaluation.started_at)).first()
    result = tools.execute(db, "get_evaluation", {"date": row.started_at[:10]})
    evaluation = result["readable"]["evaluations"][0]
    assert len(evaluation["sweeps"]) == 10
    assert evaluation["friction_used"] is True
    assert evaluation["friction_calibration"]["per_finger"]["index"]
    assert evaluation["incomplete_sweeps"] == []
    assert evaluation["sweeps"][0]["points"][0]["position_percent"] == 0
    import gzip

    sweeps = json.loads(gzip.decompress(row.sweeps_blob))
    sweeps[0]["aborted_at"] = 0.45
    row.sweeps_blob = gzip.compress(json.dumps(sweeps[:-1]).encode())
    db.add(row)
    db.commit()
    result = tools.execute(db, "get_evaluation", {"date": row.started_at[:10]})
    assert len(result["readable"]["evaluations"][0]["incomplete_sweeps"]) == 2


@pytest.mark.parametrize("metric", ["opening_alone", "glove_completed"])
def test_compare_opening_uses_precomputed_percentages(db, metric):
    opening = [s for s in reversed(repo.list_sessions(db)) if s.assist_direction == "open"]
    args = {
        "finger": "index",
        "metric": metric,
        "from_date": opening[0].started_at[:10],
        "to_date": "Nov 5",
    }
    result = tools.execute(db, "compare", args)["readable"]
    key = "opening_on_your_own_percent" if metric == "opening_alone" else "glove_completed_percent"
    first = tools.execute(db, "get_session", {"date": args["from_date"]})["readable"]["sessions"][0]
    last = tools.execute(db, "get_session", {"date": "Nov 5"})["readable"]["sessions"][0]
    assert result["from_value"] == first[key]["index"]
    assert result["to_value"] == last[key]["index"]
    assert result["change"] == last[key]["index"] - first[key]["index"]
    assert result["change_unit"] == "percentage points"
    args["from_date"] = "Nov 5"
    same = tools.execute(db, "compare", args)["readable"]
    assert same["change"] == 0 and same["trend"] == "about the same"


@pytest.mark.parametrize("metric", ["resistance_slow", "resistance_fast"])
def test_compare_resistance_is_percent_change(db, metric):
    evaluations = list(reversed(repo.list_evaluations(db)))
    args = {
        "finger": "ring",
        "metric": metric,
        "from_date": evaluations[0].started_at[:10],
        "to_date": evaluations[-1].started_at[:10],
    }
    result = tools.execute(db, "compare", args)["readable"]
    assert result["unit"] == "mA" and result["change_unit"] == "percent"
    assert result["change"] == round(
        (result["to_value"] - result["from_value"]) / result["from_value"] * 100, 1
    )
    assert result["change"] < 0


def test_compare_never_mixes_directions_and_handles_missing_fingers(db):
    args = {"finger": "index", "metric": "opening_alone", "from_date": "Sep 26", "to_date": "Nov 5"}
    assert "error" in tools.execute(db, "compare", args)
    args["from_date"] = "Nov 5"
    from sqlalchemy import delete

    db.exec(delete(m.AttemptFinger).where(m.AttemptFinger.finger == "index"))
    db.commit()
    assert "not_found" in tools.execute(db, "compare", args)


def test_find_case_insensitive_dated_snippets_and_limit(db):
    result = tools.execute(db, "find", {"query": "FINGER"})
    matches = result["readable"]["matches"]
    assert len(matches) == 10
    assert all("finger" in m["snippet"].lower() and m["date"] and m["iso_date"] for m in matches)
    assert all(len(m["snippet"]) <= 400 for m in matches)
    assert "not_found" in tools.execute(db, "find", {"query": "unfindable-98765"})


@pytest.mark.parametrize(
    "name,args",
    [
        ("get_session", {"date": "Nov 32"}),
        ("get_evaluation", {"date": "2026-02-30"}),
        ("get_transcript", {"date": 123}),
        ("get_session", {}),
        ("find", {"query": " "}),
        ("compare", {"finger": "elbow"}),
        ("find", None),
    ],
)
def test_bad_arguments_are_data_not_exceptions(db, name, args):
    assert "error" in tools.execute(db, name, args)


@pytest.mark.parametrize("name", ["get_session", "get_transcript", "get_evaluation"])
def test_missing_dates(db, name):
    assert "not_found" in tools.execute(db, name, {"date": "2020-01-01"})


def test_tool_cohort_matches_record(db):
    row = db.exec(select(m.Evaluation)).first()
    row.is_demo = False
    db.add(row)
    db.commit()
    for name in ("get_session", "get_transcript"):
        assert "not_found" in tools.execute(db, name, {"date": "Nov 5"})
    assert "not_found" in tools.execute(db, "find", {"query": "finger"})
    result = tools.execute(db, "get_evaluation", {"date": row.started_at[:10]})
    assert result["only_demo"] is False


def test_browser_only_and_unknown_raise(db):
    with pytest.raises(tools.BrowserOnlyTool):
        tools.execute(db, "show_chart", {"section": "range"})
    with pytest.raises(tools.UnknownTool):
        tools.execute(db, "delete_session", {"id": 1})


def test_declarations_use_only_the_gemini_schema_subset():
    """Gemini rejects JSON-schema keywords such as additionalProperties with a 400."""
    allowed = {"type", "properties", "required", "enum", "description"}

    def walk(node):
        assert set(node) <= allowed, set(node) - allowed
        for child in node.get("properties", {}).values():
            walk(child)

    for declaration in tools.TOOLS[0]["function_declarations"]:
        walk(declaration["parameters"])
