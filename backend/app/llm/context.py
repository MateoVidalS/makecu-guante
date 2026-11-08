"""Readable, unit-labeled facts for the summary prompts.

The raw records speak engine units (0–1 closure, tendon pull, tool names). Models misread them:
they quote fractions, average fists into opening, or name internal tools. This module turns the
same records into the numbers a person would write: opening percentages per finger, point
changes, glove help limited to the attempts it can help, resistance in mA, and plain actions.
"""

from statistics import mean

from sqlmodel import Session as DbSession
from sqlmodel import select

from app.contracts import types as c
from app.db import models as m

FINGERS = ("thumb", "index", "middle", "ring", "pinky")
NAMES = {
    "thumb": "thumb",
    "index": "index finger",
    "middle": "middle finger",
    "ring": "ring finger",
    "pinky": "little finger",
}
# Plain wording for coach tools, mirroring the replay timeline labels.
ACTIONS = {
    "adjust_help": "changed how the glove helps",
    "set_attempt_time": "changed the time to try alone",
    "add_rest": "added rest",
    "choose_next_pose": "changed the next exercise",
    "adjust_target": "changed the opening target",
    "repeat_pose": "added a repetition",
    "intensify": "asked for more intensity",
    "brake": "released the glove and paused practice",
    "undo_last_adjustment": "undid the last change",
    "assist_finger_now": "helped a finger right away",
    "highlight_finger": "pointed out a finger to focus on",
    "note_for_therapist": "left a note for the therapist",
    "pause_session": "paused practice",
    "resume_session": "resumed practice",
    "skip_pose": "skipped an exercise",
    "stop_session": "ended practice",
    "record_feeling": "recorded how the patient felt",
}
QUIET_TOOLS = {"get_live_state", "get_progress", "repeat_instruction", "record_feeling"}
SOURCES = {"coach": "voice coach", "local_rule": "automatic safety rule", "patient_ui": "patient"}


def _pct(value: float | None) -> int | None:
    return None if value is None else round(value * 100)


def _finger_values(attempts, pose: str, field: str) -> dict[str, float]:
    values: dict[str, list[float]] = {f: [] for f in FINGERS}
    for attempt in attempts:
        if attempt.pose != pose:
            continue
        for row in attempt.fingers:
            value = getattr(row, field)
            if row.scored and row.finger in values and value is not None:
                values[row.finger].append(value)
    return {f: mean(v) for f, v in values.items() if v}


def opening_alone(attempts) -> dict[str, int]:
    """Opening on your own on open tries: 100% = finger straight (1 − closure)."""
    return {
        f: round((1 - v) * 100) for f, v in _finger_values(attempts, "open", "active_max").items()
    }


def glove_completed(attempts) -> dict[str, int]:
    """Opening the glove completed on open tries (fists are never assisted)."""
    return {f: _pct(v) for f, v in _finger_values(attempts, "open", "assist_needed").items()}


def _changes(now: dict[str, int], before: dict[str, int] | None) -> dict[str, int] | None:
    if not before:
        return None
    return {f: now[f] - before[f] for f in FINGERS if f in now and f in before}


MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


def _date(value: str | None) -> str | None:
    """Human date ("Nov 7"), as the app shows it."""
    if not value:
        return None
    year, month, day = value[:10].split("-")
    return f"{MONTHS[int(month) - 1]} {int(day)}"


def _best_gain(change: dict[str, int] | None) -> str | None:
    """The most improved finger, only when it improved by 3 points or more."""
    if not change:
        return None
    finger = max(change, key=change.get)
    return NAMES[finger] if change[finger] >= 3 else None


def _minutes(start: str, end: str | None) -> float | None:
    if not end:
        return None
    from datetime import datetime

    parse = lambda v: datetime.fromisoformat(v.replace("Z", "+00:00"))  # noqa: E731
    return round((parse(end) - parse(start)).total_seconds() / 60, 1)


def coach_actions(decisions, started_at: str | None = None) -> list[dict]:
    rows = []
    for d in decisions:
        if d.tool in QUIET_TOOLS:
            continue
        args = {**(d.requested or {}), **(d.applied or {})}
        finger = args.get("finger")
        row = {
            "date": _date(d.t),
            "minute": _minutes(started_at, d.t) if started_at else None,
            "action": ACTIONS.get(d.tool, "made an adjustment"),
            "finger": NAMES.get(finger) if isinstance(finger, str) else None,
            "result": {
                "applied": "applied",
                "clamped": "applied within safe limits",
                "rejected": "not applied",
                "undone": "reverted",
            }[d.result],
            "by": SOURCES.get(d.source, d.source),
            "reason": d.reason,
            "requested_by_patient": d.source == "patient_ui"
            or isinstance((d.requested or {}).get("patient_quote"), str),
        }
        quote = (d.requested or {}).get("patient_quote")
        if isinstance(quote, str):
            row["patient_quote"] = quote
        if d.tool == "note_for_therapist" and isinstance(args.get("text"), str):
            row["note"] = args["text"]
        if d.tool == "adjust_target" and isinstance(args.get("target_scale"), int | float):
            row["target"] = f"{round(args['target_scale'] * 100)}% of the usual opening"
        rows.append({k: v for k, v in row.items() if v is not None})
    return rows


def _score(value: float) -> int | float:
    """0–10 ratings are whole numbers when they can be ("1", not "1.0")."""
    return int(value) if float(value).is_integer() else value


def feelings(rows) -> list[dict]:
    return [
        {
            "date": _date(f.t),
            "after_try": None if f.attempt_index is None else f.attempt_index + 1,
            "pain_0_10": _score(f.pain),
            "fatigue_0_10": _score(f.fatigue),
            "note": f.note or None,
            "via": "patient button" if f.source == "ui" else "voice check-in",
        }
        for f in rows
    ]


def safety(attempts) -> list[dict]:
    rows = []
    for a in attempts:
        for e in a.safety_events:
            source = e.get("source") if isinstance(e, dict) else e.source
            finger = e.get("finger") if isinstance(e, dict) else e.finger
            what = {
                "resistance": "resistance stop: the finger stopped following, so the glove held",
                "coach_brake": "brake: glove released and practice paused",
                "load_shed": "load limit: the glove eased its pull to stay under the current limit",
                "overcurrent": "current cut-off",
                "stop_button": "STOP button",
                "watchdog": "connection watchdog",
                "camera_lost": "camera lost the hand",
            }.get(source, source)
            rows.append(
                {
                    "try": a.index + 1,
                    "what": what,
                    "finger": NAMES.get(finger) if finger else None,
                }
            )
    return [{k: v for k, v in r.items() if v is not None} for r in rows]


def _resistance(db: DbSession, evaluation_ids: list[int]) -> list[dict]:
    rows = []
    for evaluation_id in evaluation_ids:
        evaluation = db.get(m.Evaluation, evaluation_id)
        fingers = db.exec(
            select(m.EvaluationFinger).where(m.EvaluationFinger.evaluation_id == evaluation_id)
        ).all()
        rows.append(
            {
                "date": _date(evaluation.started_at),
                "per_finger_mA": {
                    f.finger: {
                        "slow": None
                        if f.resistance_slow_ma is None
                        else round(f.resistance_slow_ma),
                        "fast": None
                        if f.resistance_fast_ma is None
                        else round(f.resistance_fast_ma),
                        "fast_minus_slow": None
                        if f.velocity_dependence_ma is None
                        else round(f.velocity_dependence_ma),
                    }
                    for f in fingers
                    if f.finger in FINGERS
                },
            }
        )
    return rows


def resistance_change(evaluations: list[dict]) -> dict | None:
    """Mean change of slow resistance across fingers, first to latest evaluation, in percent."""
    if len(evaluations) < 2:
        return None
    first, last = evaluations[0]["per_finger_mA"], evaluations[-1]["per_finger_mA"]
    changes = {
        f: round((last[f]["slow"] - first[f]["slow"]) / first[f]["slow"] * 100)
        for f in FINGERS
        if f in first and f in last and first[f]["slow"] and last[f]["slow"] is not None
    }
    if not changes:
        return None
    average = round(mean(changes.values()))
    trend = "eased" if average <= -5 else "rose" if average >= 5 else "about the same"
    return {
        "from": evaluations[0]["date"],
        "to": evaluations[-1]["date"],
        "evaluations": len(evaluations),
        "slow_resistance_change_percent": changes,
        "average_change_percent": average,
        "trend": trend,
        "in_words": f"resistance to opening {trend}"
        + (
            f" by about {abs(average)}% since {evaluations[0]['date']}"
            if trend != "about the same"
            else ""
        ),
    }


def _open_evaluations(db: DbSession, is_demo: bool, ids: set[int] | None = None) -> list[int]:
    query = (
        select(m.Evaluation.id)
        .join(m.Calibration, m.Calibration.id == m.Evaluation.calibration_id)
        .where(m.Calibration.assist_direction == "open", m.Evaluation.is_demo == is_demo)
        .order_by(m.Evaluation.started_at, m.Evaluation.id)
    )
    found = list(db.exec(query))
    return [i for i in found if ids is None or i in ids]


def session(db: DbSession, detail, previous, profile: c.Profile | None, first=None) -> dict:
    """Readable facts for one session; `previous` is the prior same-direction session detail."""
    attempts = detail.attempts
    opens = [a for a in attempts if a.pose == "open"]
    fists = [a for a in attempts if a.pose == "full_fist"]
    readable: dict = {
        "date": _date(detail.started_at),
        "minutes": _minutes(detail.started_at, detail.ended_at),
        "glove": "opening-assist glove"
        if detail.assist_direction == "open"
        else "earlier closing-assist glove (legacy)",
        "tries": len(attempts),
        "stopped_early": any(a.interrupted for a in attempts),
        "safety": safety(attempts),
        "feelings": feelings(detail.feelings or []),
        "coach_actions": coach_actions(detail.coach_decisions or [], detail.started_at),
    }
    if detail.assist_direction == "open":
        now = opening_alone(attempts)
        before = opening_alone(previous.attempts) if previous else None
        change = _changes(now, before)
        help_ = glove_completed(attempts)
        readable.update(
            {
                "open_tries": len(opens),
                "fist_tries": len(fists),
                "fists_closed_on_your_own": sum(a.reached_active for a in fists),
                "open_tries_fully_opened_with_glove": sum(a.reached_final for a in opens),
                "opening_on_your_own_percent": now,
                "glove_completed_percent": help_,
                "previous_session": {
                    "date": _date(previous.started_at),
                    "opening_on_your_own_percent": before,
                }
                if previous and before
                else None,
                "change_points_vs_previous": change,
                "most_improved_finger_vs_previous": _best_gain(change),
                "since_first_opening_session": _since(first, now)
                if first and first.id != detail.id
                else None,
                "finger_needing_most_help": NAMES[max(help_, key=help_.get)] if help_ else None,
            }
        )
        evaluations = _resistance(db, _open_evaluations(db, detail.is_demo))
        readable["resistance_to_opening"] = resistance_change(evaluations)
    else:
        closure = _finger_values(attempts, "full_fist", "active_max")
        readable["fist_closure_on_your_own_percent"] = {f: _pct(v) for f, v in closure.items()}
    if profile and profile.goals.strip():
        readable["patient_goals"] = profile.goals.strip()
    return readable


def _since(first, now: dict[str, int]) -> dict:
    before = opening_alone(first.attempts)
    change = _changes(now, before)
    return {
        "date": _date(first.started_at),
        "opening_on_your_own_percent": before,
        "change_points": change,
        "most_improved_finger": _best_gain(change),
    }


def digest(db: DbSession, raw: dict, details: list, baseline) -> dict:
    """Readable facts for the therapist window. `details` are the window's session details."""
    opening = [
        d
        for d in details
        if d.assist_direction == "open" and any(a.pose == "open" for a in d.attempts)
    ]
    legacy = [d for d in details if d.assist_direction != "open"]
    per_session = [
        {
            "date": _date(d.started_at),
            "tries": len(d.attempts),
            "opening_on_your_own_percent": opening_alone(d.attempts),
            "glove_completed_percent": glove_completed(d.attempts),
            "stopped_early": any(a.interrupted for a in d.attempts),
        }
        for d in opening
    ]
    first, last = (per_session[0], per_session[-1]) if per_session else (None, None)
    window_ids = {p["evaluation_id"] for p in raw["resistance"]}
    is_demo = raw["only_demo"]
    evaluations = _resistance(db, _open_evaluations(db, is_demo, window_ids))
    all_evaluations = _resistance(db, _open_evaluations(db, is_demo))
    pains = [_score(f.pain) for d in details for f in d.feelings or []]
    fatigues = [_score(f.fatigue) for d in details for f in d.feelings or []]
    readable = {
        "window": {"from": _date(raw["from"]), "to": _date(raw["to"]), "days": raw["days"]},
        "demo_data": is_demo,
        "adherence": {
            **raw["adherence"],
            "minutes_practiced": round(
                sum(_minutes(d.started_at, d.ended_at) or 0 for d in details)
            ),
            "sessions_stopped_early": sum(any(a.interrupted for a in d.attempts) for d in details),
        },
        "legacy_closing_glove_sessions_in_window": len(legacy),
        "opening_sessions": per_session,
        "opening_change_in_window_points": _changes(
            last["opening_on_your_own_percent"], first["opening_on_your_own_percent"]
        )
        if first and last and first is not last
        else None,
        "glove_help_change_in_window_points": _changes(
            last["glove_completed_percent"], first["glove_completed_percent"]
        )
        if first and last and first is not last
        else None,
        "since_first_opening_session": _since(baseline, last["opening_on_your_own_percent"])
        if baseline and last
        else None,
        "resistance_evaluations_in_window": evaluations,
        "resistance_since_first_evaluation": resistance_change(all_evaluations),
        "safety": [
            {"date": _date(d.started_at), **row} for d in details for row in safety(d.attempts)
        ],
        "feelings": {
            "check_ins": len(pains),
            "pain_range_0_10": [min(pains), max(pains)] if pains else None,
            "fatigue_range_0_10": [min(fatigues), max(fatigues)] if fatigues else None,
            "entries": [r for d in details for r in feelings(d.feelings or [])],
        },
        "coach_actions": [r for d in details for r in coach_actions(d.coach_decisions or [])],
    }
    return readable
