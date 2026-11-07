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
    }
    config = types.LiveConnectConfig.model_validate({"tools": TOOLS})
    assert len(config.tools[0].function_declarations) == 14
    tools = {tool["name"]: tool for tool in declarations}
    assert tools["brake"]["parameters"]["required"] == ["reason"]
    help_args = tools["adjust_help"]["parameters"]["properties"]
    assert help_args["finger"]["enum"] == ["thumb", "index", "middle", "ring", "pinky", "all"]
    assert help_args["direction"]["enum"] == ["more", "less"]
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
        "Never lower help to push harder",
        "Fatigue >= 6",
        "saved for review",
    ]:
        assert rule in prompt
