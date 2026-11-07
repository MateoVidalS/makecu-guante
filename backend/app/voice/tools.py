"""Only runtime actions; the model never receives direct glove controls."""

TOOLS = [
    {
        "functionDeclarations": [
            {"name": name, "description": description, "parameters": {"type": "OBJECT"}}
            for name, description in [
                ("pause_session", "Pause practice immediately when requested."),
                ("resume_session", "Continue practice through the runtime safety checks."),
                ("skip_pose", "Skip the current pose when requested."),
                ("repeat_instruction", "Get and repeat the current pose instruction."),
                ("stop_session", "End practice. Confirm ambiguity first; clear stop is immediate."),
                ("get_progress", "Get current finger percentages and the previous session."),
            ]
        ]
    }
]
