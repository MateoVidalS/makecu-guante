"""Therapy declarations stay bounded and serialize in the token's locked config."""

from google.genai import types

from app.voice.prompt import render_prompt
from app.voice.tools import TOOLS


def test_complete_runtime_tool_surface():
    declarations = TOOLS[0]["functionDeclarations"]
    assert {tool["name"] for tool in declarations} == {
        "pause_session",
        "resume_session",
        "skip_pose",
        "repeat_instruction",
        "stop_session",
        "get_progress",
        "get_live_state",
        "adjust_help",
        "set_attempt_time",
        "add_rest",
        "choose_next_pose",
        "record_feeling",
        "brake",
        "undo_last_adjustment",
        "assist_finger_now",
        "adjust_target",
        "highlight_finger",
        "note_for_therapist",
        "repeat_pose",
    }
    config = types.LiveConnectConfig.model_validate({"tools": TOOLS})
    assert len(config.tools[0].function_declarations) == 19
    tools = {tool["name"]: tool for tool in declarations}
    assert tools["brake"]["parameters"]["required"] == ["reason"]
    help_args = tools["adjust_help"]["parameters"]["properties"]
    assert help_args["finger"]["enum"] == ["thumb", "index", "middle", "ring", "pinky", "all"]
    assert help_args["direction"]["enum"] == ["more", "less", "gentler"]
    assert tools["adjust_target"]["parameters"]["properties"]["direction"]["enum"] == [
        "lower",
        "raise",
    ]
    for name in ("assist_finger_now", "adjust_target", "highlight_finger"):
        assert tools[name]["parameters"]["properties"]["finger"]["enum"] == [
            "thumb",
            "index",
            "middle",
            "ring",
            "pinky",
        ]
    assert "pinch" not in tools["choose_next_pose"]["parameters"]["properties"]["pose"]["enum"]
    assert tools["record_feeling"]["parameters"]["properties"]["pain"]["maximum"] == 10
    assert tools["set_attempt_time"]["parameters"]["properties"]["seconds"]["maximum"] == 9
    assert tools["add_rest"]["parameters"]["properties"]["seconds"]["maximum"] == 20


def test_prompt_therapy_policy():
    prompt = render_prompt(None, None)
    for rule in [
        "[live]",
        "[check-in]",
        "record_feeling",
        "Pain >= 4/10",
        "local brake",
        "once per finger per attempt",
        "never claim success or retry blindly",
        "Never delay help to push harder",
        "Fatigue >= 6",
        "saved for review",
    ]:
        assert rule in prompt
    for rule in [
        "more = help starts 1 second sooner",
        "less = 1 second later",
        "0.10–0.20/s",
        "never exceeds the 0.20/s default",
        "Resistance automatically lowers",
        "assist_finger_now",
        "stagger/power rules",
        "adjust_target",
        "0.5–1.0",
        "highlight_finger",
        "note_for_therapist",
        "repeat_pose",
        "at most 3 extra",
        "glove state/current",
        "last_safety",
    ]:
        assert rule in prompt
    assert "0.30" not in prompt
