"""Only bounded runtime actions; the model never receives motor controls."""


def declaration(name, description, properties=None, required=None):
    parameters = {"type": "OBJECT"}
    if properties:
        parameters["properties"] = properties
        parameters["required"] = required or list(properties)
    return {"name": name, "description": description, "parameters": parameters}


REASON = {"type": "STRING", "description": "Explain the change in plain words."}
FINGER = {"type": "STRING", "enum": ["thumb", "index", "middle", "ring", "pinky"]}
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
                    "Get live fingers, targets, help, feelings, highlights, glove state/current "
                    "and the last safety event.",
                ),
                ("undo_last_adjustment", "Undo the last non-brake adjustment at a safe boundary."),
            ]
        ]
        + [
            declaration(
                "adjust_help",
                "More means help starts 1 second sooner; less means 1 second later, within "
                "1–9 seconds per finger. Gentler lowers speed by 0.05/s within 0.10–0.20/s. "
                "Never faster than the 0.20/s default. More applies next ATTEMPT; "
                "less/gentler are immediate. Once per finger per attempt.",
                {
                    "finger": {
                        "type": "STRING",
                        "enum": ["thumb", "index", "middle", "ring", "pinky", "all"],
                    },
                    "direction": {"type": "STRING", "enum": ["more", "less", "gentler"]},
                    "reason": REASON,
                },
            ),
            declaration(
                "assist_finger_now",
                "Request opening help on one finger. In ATTEMPT it starts now; at any other "
                "time it is set for the next opening attempt (see applies in the result). "
                "Uses gentle speed and shaped target through the runtime's stagger/power "
                "safety rules. For several fingers, call once per finger the patient named. "
                "Call it before telling the patient the glove helps.",
                {"finger": FINGER, "reason": REASON},
            ),
            declaration(
                "adjust_target",
                "Lower or raise target_scale by 0.1 within 0.5–1.0: how far to open. "
                "Lower means less opening; raise means more opening. Closing poses remain "
                "independent effort. Starts next ATTEMPT; never above the calibrated range.",
                {
                    "finger": FINGER,
                    "direction": {"type": "STRING", "enum": ["lower", "raise"]},
                    "reason": REASON,
                },
            ),
            declaration(
                "highlight_finger",
                "Highlight one finger on the virtual hand for about 4 seconds while naming it.",
                {"finger": FINGER},
            ),
            declaration(
                "note_for_therapist",
                "Save a patient-reported observation for therapist review, without diagnosing.",
                {"text": {"type": "STRING"}},
            ),
            declaration(
                "repeat_pose",
                "Add one repetition of the current pose after this attempt; at most 3 extra "
                "repetitions per session.",
                {"reason": REASON},
            ),
            declaration(
                "intensify",
                "Only after the patient explicitly asked or accepted an offer in the last 20s. "
                "Further: open further up to 100% calibrated range; hold_longer: at most 2s extra; "
                "faster: "
                "up to 0.30/s, next ATTEMPT. Blocked by pain >= 2 or resistance on that finger "
                "in the last 60s; automatically reverted on pain/resistance. Never initiate "
                "intensity yourself or invent consent. Quote the patient's actual words.",
                {
                    "finger": FINGER,
                    "kind": {"type": "STRING", "enum": ["further", "hold_longer", "faster"]},
                    "consent": {"type": "STRING", "enum": ["patient_asked", "accepted_offer"]},
                    "patient_quote": {"type": "STRING"},
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
                "Choose the next pose from the existing plan, excluding pinch; "
                "length is unchanged.",
                {
                    "pose": {
                        "type": "STRING",
                        "enum": [
                            "open",
                            "hook",
                            "full_fist",
                            "tabletop",
                            "straight_fist",
                            "thumbs_up",
                            "point",
                            "peace",
                            "pinky_up",
                        ],
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
