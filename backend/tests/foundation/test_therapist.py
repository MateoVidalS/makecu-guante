import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.contracts.therapist import (
    THERAPY_LIMITS,
    CoachDecision,
    FeelingEntry,
    LiveTherapyState,
    SessionDetail,
    TherapyLimits,
)


def test_fixed_limits_match_typescript_contract_and_cannot_be_overridden():
    assert THERAPY_LIMITS.model_dump(mode="json") == {
        "assist_speed": [0.1, 0.3],
        "assist_step": 0.05,
        "attempt_s": [4, 9],
        "rest_add_max_s": 20,
        "rest_total_max_s": 60,
        "pain_brake_at": 4,
    }
    for key, value in (
        ("assist_speed", [0.1, 0.31]),
        ("assist_step", 0.1),
        ("attempt_s", [4, 10]),
        ("rest_add_max_s", 21),
        ("rest_total_max_s", 61),
        ("pain_brake_at", 5),
    ):
        with pytest.raises(ValidationError):
            TherapyLimits.model_validate({**THERAPY_LIMITS.model_dump(), key: value})
    with pytest.raises(ValidationError):
        THERAPY_LIMITS.pain_brake_at = 5


def test_live_state_and_legacy_session_detail_mirror_the_wire_shape():
    data = {
        "phase": "ASSIST",
        "pose": "full_fist",
        "rep": 1,
        "index": 0,
        "total": 15,
        "seconds_in_phase": 0.5,
        "fingers": [
            {
                "finger": finger,
                "now": None if finger == "thumb" else 0.4,
                "target": 1,
                "best_alone": 0.4,
                "glove_helping": True,
                "lagging": finger == "index",
            }
            for finger in ("thumb", "index", "middle", "ring", "pinky")
        ],
        "last_attempt": {"reached_alone": False, "assisted": True, "active_ratio": 0.5},
        "adjustments": {
            "assist_speed": {f: 0.3 for f in ("thumb", "index", "middle", "ring", "pinky")},
            "attempt_s": 6,
            "extra_rest_s": 0,
            "next_pose": None,
        },
        "last_feeling": {"pain": 0, "fatigue": 6, "minutes_ago": 1.5},
    }
    state = LiveTherapyState.model_validate(data)
    assert json.loads(state.model_dump_json()) == data
    assert LiveTherapyState.model_validate_json(state.model_dump_json()) == state
    del data["adjustments"]["assist_speed"]["pinky"]
    with pytest.raises(ValidationError):
        LiveTherapyState.model_validate(data)
    fixture = Path(__file__).resolve().parents[3] / "contracts/fixtures/session_detail.json"
    legacy = SessionDetail.model_validate_json(fixture.read_text())
    assert legacy.coach_decisions == legacy.feelings == []


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf")])
def test_nonfinite_values_are_not_persistable_json(value):
    base = {"t": "2026-11-07T12:00:00Z", "session_id": 1}
    with pytest.raises(ValidationError):
        FeelingEntry(**base, attempt_index=None, pain=value, fatigue=0, note="", source="ui")
    with pytest.raises(ValidationError):
        CoachDecision(
            **base,
            id="bad-json",
            tool="unknown",
            requested={"nested": [{"value": value}]},
            applied=None,
            result="rejected",
            reason="Invalid request",
            source="coach",
        )
