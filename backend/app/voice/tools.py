"""Only bounded runtime actions; the model never receives motor controls."""


def declaration(name, description, properties=None, required=None):
    parameters = {"type": "OBJECT"}
    if properties:
        parameters["properties"] = properties
        parameters["required"] = required or list(properties)
    return {"name": name, "description": description, "parameters": parameters}


REASON = {"type": "STRING", "description": "Explain the change in plain words."}
TOOLS = [
    {
        "functionDeclarations": [
            declaration(name, description)
            for name, description in [
                ("pause_session", "Pause practice immediately when requested."),
                (
                    "resume_session",
                    "Continue only on patient request through runtime safety checks.",
                ),
                ("skip_pose", "Skip the current pose when requested."),
                ("repeat_instruction", "Get and repeat the current pose instruction."),
                ("stop_session", "End practice. Confirm ambiguity first."),
                ("get_progress", "Get current finger percentages and the previous session."),
                (
                    "get_live_state",
                    "Get live fingers, targets, help, feelings and safe adjustments.",
                ),
                ("undo_last_adjustment", "Undo the last non-brake adjustment at a safe boundary."),
            ]
        ]
        + [
            declaration(
                "adjust_help",
                "Change help speed by 0.05/s within 0.10–0.30/s, once per finger per attempt. "
                "More applies next ASSIST; less is immediate. Never changes force or current limits.",
                {
                    "finger": {
                        "type": "STRING",
                        "enum": ["thumb", "index", "middle", "ring", "pinky", "all"],
                    },
                    "direction": {"type": "STRING", "enum": ["more", "less"]},
                    "reason": REASON,
                },
            ),
            declaration(
                "set_attempt_time",
                "Set time to try alone, clamped to 4–9 seconds, starting next ATTEMPT.",
                {"seconds": {"type": "NUMBER", "minimum": 4, "maximum": 9}, "reason": REASON},
            ),
            declaration(
                "add_rest",
                "Add up to 20 seconds next REST; at most 60 extra seconds per session.",
                {"seconds": {"type": "NUMBER", "minimum": 0, "maximum": 20}, "reason": REASON},
            ),
            declaration(
                "choose_next_pose",
                "Choose the next pose from the existing plan, excluding pinch; length is unchanged.",
                {
                    "pose": {
                        "type": "STRING",
                        "enum": ["open", "hook", "full_fist", "tabletop", "straight_fist"],
                    },
                    "reason": REASON,
                },
            ),
            declaration(
                "record_feeling",
                "Record patient-reported pain and fatigue, 0–10. Pain >= 4 releases and pauses "
                "immediately. Ask for missing ratings; never invent them.",
                {
                    "pain": {"type": "NUMBER", "minimum": 0, "maximum": 10},
                    "fatigue": {"type": "NUMBER", "minimum": 0, "maximum": 10},
                    "note": {"type": "STRING"},
                },
            ),
            declaration(
                "brake",
                "Immediately release and pause. Always allowed; never adds resistance.",
                {"reason": REASON},
            ),
        ]
    }
]
