"""Read-only Gemini tools. Dates are resolved inside the selected database cohort."""

import calendar
import re
from datetime import date
from statistics import mean
from typing import Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.chat.record import cohort, dated, evaluation_blocks, session_block
from app.contracts.chat import ChartSection
from app.db import models as m
from app.db import repo
from app.llm import context


class Arguments(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class DateArgs(Arguments):
    date: str = Field(min_length=1, max_length=20)


class CompareArgs(Arguments):
    finger: Literal["thumb", "index", "middle", "ring", "pinky"]
    metric: Literal["opening_alone", "glove_completed", "resistance_slow", "resistance_fast"]
    from_date: str = Field(min_length=1, max_length=20)
    to_date: str = Field(min_length=1, max_length=20)


class FindArgs(Arguments):
    query: str = Field(min_length=1, max_length=200)


class ChartArgs(Arguments):
    section: ChartSection


ARGUMENTS = {
    "get_session": DateArgs,
    "get_transcript": DateArgs,
    "get_evaluation": DateArgs,
    "compare": CompareArgs,
    "find": FindArgs,
    "show_chart": ChartArgs,
}
DESCRIPTIONS = {
    "get_session": "Read every session and attempt on a date (YYYY-MM-DD or Nov 3).",
    "get_transcript": "Read up to 4000 characters of the recorded transcript on a date.",
    "get_evaluation": "Read sweeps, friction calibration and incomplete sweeps on a date.",
    "compare": "Compare one finger's recorded values on two dates, within one glove direction.",
    "find": "Search check-in notes, coach reasons, therapist notes and transcripts (max 10).",
    "show_chart": "Show a Doctor view chart by scrolling to its section. Browser-only action.",
}


def _parameters(model) -> dict:
    """Gemini's schema subset: no additionalProperties, titles, $defs or length keywords.
    Arguments are validated again with the pydantic model before any lookup.
    """
    schema = model.model_json_schema()
    properties = {}
    for key, field in schema["properties"].items():
        if "$ref" in field:
            field = schema["$defs"][field["$ref"].rsplit("/", 1)[-1]]
        prop = {"type": "STRING"}
        if "enum" in field:
            prop["enum"] = list(field["enum"])
        properties[key] = prop
    return {"type": "OBJECT", "properties": properties, "required": schema.get("required", [])}


# SDK generate_content and Live both accept this list of Tool dictionaries.
TOOLS = [
    {
        "function_declarations": [
            {
                "name": name,
                "description": DESCRIPTIONS[name],
                "parameters": _parameters(model),
            }
            for name, model in ARGUMENTS.items()
        ]
    }
]


class UnknownTool(ValueError):
    pass


class BrowserOnlyTool(ValueError):
    pass


def _parse_date(value):
    """Return ISO date or (month, day); no guessed year for a human date."""
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return date.fromisoformat(value).isoformat()
    match = re.fullmatch(r"([A-Za-z]{3})\s+(\d{1,2})", value.strip())
    if not match:
        raise ValueError("Use YYYY-MM-DD or Nov 3")
    months = {m.lower(): i for i, m in enumerate(calendar.month_abbr) if m}
    month = months.get(match[1].lower())
    day = int(match[2])
    if month is None:
        raise ValueError("Invalid month")
    date(2000, month, day)  # Leap day is valid; resolve the actual year from stored dates.
    return month, day


def _on_date(rows, value):
    parsed = _parse_date(value)
    if isinstance(parsed, str):
        return [r for r in rows if r.started_at[:10] == parsed]
    return [r for r in rows if (int(r.started_at[5:7]), int(r.started_at[8:10])) == parsed]


def _number(value):
    return None if value is None else round(value, 1)


def _safety(attempt):
    return [
        {
            **readable,
            "seconds_into_attempt": _number(event.t_rel),
            "current_mA": _number(event.ma),
        }
        for readable, event in zip(context.safety([attempt]), attempt.safety_events, strict=True)
    ]


def _decisions(detail):
    decisions = []
    for d in detail.coach_decisions:
        readable = context.coach_actions([d], detail.started_at)
        decisions.extend(
            readable
            or [
                {
                    "action": context.ACTIONS.get(d.tool, "read the practice state"),
                    "result": d.result,
                    "reason": d.reason,
                    "date": context._date(d.t),
                }
            ]
        )
    return decisions


def _session(db, rows):
    sessions = []
    for row in rows:
        detail = repo.get_session(db, row.id)
        block = session_block(db, detail)
        block["coach_actions"] = _decisions(detail)
        block["attempts"] = [
            {
                "try": a.index + 1,
                "pose": a.pose.replace("_", " "),
                "repetition": a.rep,
                "assisted": a.assisted,
                "interrupted": a.interrupted,
                "reached_alone": a.reached_active,
                "reached_final": a.reached_final,
                "seconds_to_position": _number(a.time_to_position_s),
                "per_finger": {
                    f.finger: {
                        "scored": f.scored,
                        "target_closure_percent": context._pct(f.target),
                        "opening_on_own_percent"
                        if a.pose == "open"
                        else "closure_on_own_percent": (
                            None
                            if f.active_max is None
                            else context._pct(
                                1 - f.active_max if a.pose == "open" else f.active_max
                            )
                        ),
                        "glove_completed_percent": context._pct(f.assist_needed),
                        "final_closure_percent": context._pct(f.final),
                    }
                    for f in a.fingers
                },
                "safety": _safety(a),
            }
            for a in detail.attempts
        ]
        sessions.append(block)
    return {"readable": {"sessions": sessions}}


def _transcript(db, rows):
    lines = [
        f"{d.started_at[:10]} {line.t[11:19]} {line.role}: {line.text}"
        for r in rows
        for d in [repo.get_session(db, r.id)]
        for line in d.transcript
    ]
    transcript = "\n".join(lines)
    if not transcript:
        return {"not_found": "Transcript not recorded for that date"}
    return {"readable": {"transcript": transcript[:4000], "truncated": len(transcript) > 4000}}


def _evaluation(db, rows):
    evaluations = []
    for r in rows:
        e = repo.get_evaluation(db, r.id)
        calibration = repo._calibration(db.get(m.Calibration, e.calibration_id))
        block = evaluation_blocks(db, [r])[0]
        block["friction_used"] = e.friction_used
        block["friction_calibration"] = {
            **dated(calibration.created_at),
            "per_finger": {
                finger: [
                    {
                        "speed_percent_per_second": context._pct(curve.v),
                        "points": [
                            {"position_percent": context._pct(p.pos), "current_mA": _number(p.ma)}
                            for p in curve.points
                        ],
                    }
                    for curve in curves
                ]
                for finger, curves in calibration.friction.items()
            },
        }
        block["sweeps"] = [
            {
                "finger": s.finger,
                "speed": s.speed,
                "speed_percent_per_second": context._pct(s.v),
                "stopped_at_position_percent": context._pct(s.aborted_at),
                "points": [
                    {
                        "position_percent": context._pct(p.pos),
                        "current_mA": _number(p.ma),
                        "excess_mA": _number(p.excess_ma),
                    }
                    for p in s.points
                ],
            }
            for s in e.sweeps
        ]
        incomplete = []
        for finger in e.settings.fingers:
            result = next((f for f in e.fingers if f.finger == finger), None)
            for speed in ("slow", "fast"):
                sweeps = [s for s in e.sweeps if s.finger == finger and s.speed == speed]
                if not sweeps or any(s.aborted_at is not None or not s.points for s in sweeps):
                    incomplete.append({"finger": finger, "speed": speed})
                elif result is None or getattr(result, f"resistance_{speed}_ma") is None:
                    incomplete.append({"finger": finger, "speed": speed})
        block["incomplete_sweeps"] = incomplete
        block["aborted_fingers"] = [f.finger for f in e.fingers if f.aborted]
        evaluations.append(block)
    return {"readable": {"evaluations": evaluations}}


def _compare(db, sessions, evaluations, args):
    opening = args.metric in ("opening_alone", "glove_completed")
    rows = sessions if opening else evaluations
    before = _on_date(rows, args.from_date)
    after = _on_date(rows, args.to_date)
    if not before or not after:
        return {"not_found": "Measurements not recorded for both dates"}
    for matched in (before, after):
        if len({r.started_at[:10] for r in matched}) > 1:
            return {"error": "Date is ambiguous across years; use YYYY-MM-DD"}
    directions = {repo._direction(db, r.calibration_id) for r in [*before, *after]}
    if len(directions) != 1 or (opening and directions != {"open"}):
        return {"error": "Cannot compare opening and legacy closing-glove measurements"}

    def values(selected):
        if opening:
            measure = (
                context.opening_alone if args.metric == "opening_alone" else context.glove_completed
            )
            return [
                value
                for r in selected
                if (value := measure(repo.get_session(db, r.id).attempts).get(args.finger))
                is not None
            ]
        speed = "slow" if args.metric == "resistance_slow" else "fast"
        return [
            value
            for block in evaluation_blocks(db, selected)
            if (value := block["per_finger_mA"].get(args.finger, {}).get(speed)) is not None
        ]

    left, right = values(before), values(after)
    if not left or not right:
        return {"not_found": "That finger's measurements are not recorded on both dates"}
    start, end = round(mean(left), 1), round(mean(right), 1)
    if not opening and start == 0:
        return {"not_found": "Percentage change is undefined from zero resistance"}
    change = round(end - start if opening else (end - start) / start * 100, 1)
    return {
        "readable": {
            "finger": args.finger,
            "metric": args.metric,
            "assist_direction": directions.pop(),
            "from": dated(before[0].started_at),
            "to": dated(after[0].started_at),
            "from_value": start,
            "to_value": end,
            "unit": "percent opening" if opening else "mA",
            "change": change,
            "change_unit": "percentage points" if opening else "percent",
            "trend": "about the same"
            if abs(change) < 3
            else "increased"
            if change > 0
            else "decreased",
        }
    }


def _find(db, sessions, query):
    query = query.strip().casefold()
    if not query:
        return {"error": "Search query must not be blank"}
    hits = []
    for r in sessions:
        d = repo.get_session(db, r.id)
        candidates = [("check-in note", f.note) for f in d.feelings]
        candidates += [("coach reason", c.reason) for c in d.coach_decisions]
        candidates += [
            ("therapist note", text)
            for c in d.coach_decisions
            if c.tool == "note_for_therapist"
            for text in [{**c.requested, **(c.applied or {})}.get("text")]
            if isinstance(text, str)
        ]
        candidates += [("transcript", line.text) for line in d.transcript]
        for source, text in candidates:
            if query not in text.casefold():
                continue
            # Keep the match visible even in a long note.
            at = text.casefold().find(query)
            begin = max(0, at - 100)
            hits.append(
                {**dated(d.started_at), "source": source, "snippet": text[begin : begin + 400]}
            )
            if len(hits) == 10:
                return {"readable": {"matches": hits}}
    return (
        {"readable": {"matches": hits}}
        if hits
        else {"not_found": "No matching notes or transcript"}
    )


def execute(db, name, args) -> dict:
    if name not in ARGUMENTS:
        raise UnknownTool("Unknown chat tool")
    if name == "show_chart":
        raise BrowserOnlyTool("Chart navigation is browser-only")
    try:
        parsed = ARGUMENTS[name].model_validate(args)
        sessions, evaluations, only_demo = cohort(db)
        if name == "compare":
            result = _compare(db, sessions, evaluations, parsed)
        elif name == "find":
            result = _find(db, sessions, parsed.query)
        else:
            rows = _on_date(evaluations if name == "get_evaluation" else sessions, parsed.date)
            if not rows:
                return {"not_found": "No records for that date in the selected cohort"}
            result = {
                "get_session": _session,
                "get_transcript": _transcript,
                "get_evaluation": _evaluation,
            }[name](db, rows)
        return {"only_demo": only_demo, **result}
    except (ValidationError, ValueError, TypeError):
        return {"error": "Invalid tool arguments; use declared fields and valid dates"}


def label(name, args):
    """Only validated dates/section enums reach status events; never echo provider text."""
    if name == "show_chart":
        return ChartArgs.model_validate(args).section
    if name in ("get_session", "get_transcript", "get_evaluation"):
        try:
            parsed = _parse_date(DateArgs.model_validate(args).date)
            human = (
                context._date(parsed)
                if isinstance(parsed, str)
                else f"{calendar.month_abbr[parsed[0]]} {parsed[1]}"
            )
            noun = name.removeprefix("get_")
            return f"Looking up the {human} {noun}"
        except (ValueError, TypeError):
            return "Looking up patient records"
    return "Comparing recorded measurements" if name == "compare" else "Searching patient notes"


CHART_SECTIONS = get_args(ChartSection)
