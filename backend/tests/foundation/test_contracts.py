import json
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from app.contracts import types as c

FIXTURES = Path(__file__).resolve().parents[3] / "contracts" / "fixtures"
MODELS = {
    "profile": c.Profile,
    "calibration": c.Calibration,
    "sessions": list[c.Session],
    "session_detail": c.SessionDetail,
    "attempt_trace": c.AttemptTrace,
    "evaluations": list[c.Evaluation],
    "history_overview": c.HistoryOverview,
    "history_rom": list[c.RomPoint],
    "history_assist": list[c.AssistPoint],
    "history_resistance": list[c.ResistancePoint],
    "summaries": list[c.Summary],
}


@pytest.mark.parametrize("name,model", MODELS.items())
def test_fixture_matches_rest_contract(name, model):
    TypeAdapter(model).validate_json((FIXTURES / f"{name}.json").read_text())


def test_fixture_trends_and_trace():
    sessions = sorted(
        json.loads((FIXTURES / "sessions.json").read_text()), key=lambda s: s["started_at"]
    )
    assert len(sessions) == 8
    assert sum(s["is_demo"] for s in sessions) == 2
    assert all(
        a["summary"]["active_ratio_mean"] < b["summary"]["active_ratio_mean"]
        for a, b in zip(sessions, sessions[1:])
    )
    evaluations = sorted(
        json.loads((FIXTURES / "evaluations.json").read_text()), key=lambda e: e["started_at"]
    )
    assert len(evaluations) == 3
    assert (
        evaluations[0]["fingers"][1]["velocity_dependence_ma"]
        > evaluations[-1]["fingers"][1]["velocity_dependence_ma"]
    )
    trace = c.AttemptTrace.model_validate_json((FIXTURES / "attempt_trace.json").read_text())
    assert {"ATTEMPT", "ASSIST", "ASSIST_HOLD", "RELEASE"} <= set(trace.phase)
    assert max(trace.ma) == 570
    assert all(abs(b - a - 0.05) < 1e-8 for a, b in zip(trace.t, trace.t[1:]))
    detail = c.SessionDetail.model_validate_json((FIXTURES / "session_detail.json").read_text())
    assert detail.attempts[0].safety_events[0].source == "resistance"


def test_trace_rejects_misaligned_samples():
    payload = json.loads((FIXTURES / "attempt_trace.json").read_text())
    payload["ma"].pop()
    with pytest.raises(ValidationError):
        c.AttemptTrace.model_validate(payload)


def test_serial_annotations_cover_all_lines():
    lines = (FIXTURES / "serial_lines.txt").read_text().splitlines()
    annotations = json.loads((FIXTURES / "serial_lines.expected.json").read_text())
    assert len(lines) == len(annotations)
    assert sum(not a["valid"] for a in annotations) == 11
    for line, entry in zip(lines, annotations):
        if entry["valid"]:
            assert len(line.encode()) <= 200
            assert json.loads(line)["t"] == entry["type"]
    assert {
        e["type"] for e in annotations if e["valid"] and e["direction"] == "host_to_device"
    } == {"target", "follow", "release", "calib", "limit", "ping", "jog", "hello"}
