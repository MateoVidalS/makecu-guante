"""Opt-in, deterministic synthetic historical demo data for both glove directions.

Run from backend: uv run python -m tools.seed_demo [--reset] [--db PATH].
Only --reset removes data, and only rows explicitly marked is_demo.
"""

import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete
from sqlmodel import Session, select

from app.config import settings
from app.contracts import therapist as therapy
from app.contracts import types as c
from app.db import models as m
from app.db import repo
from app.db.session import make_engine, upgrade_schema


def generate(end: datetime) -> dict:
    script = Path(__file__).with_name("generate_demo.mjs")
    result = subprocess.run(
        ["node", str(script), end.isoformat()],
        check=True,
        capture_output=True,
        text=True,
        timeout=60,
    )
    return json.loads(result.stdout)


def _validate_fingers(calibration, sessions, evaluations) -> None:
    """New demos must contain measured five-finger data, never padded legacy records."""

    def require(fingers):
        fingers = list(fingers)
        if len(fingers) != len(repo.FINGERS) or set(fingers) != set(repo.FINGERS):
            raise ValueError("Demo data must include all five fingers exactly once")

    require(s.finger for s in calibration.servo)
    require(calibration.camera.open_flex)
    require(calibration.camera.closed_flex)
    for _, attempts, summary in sessions:
        require(f.finger for f in summary.per_finger)
        for attempt in attempts:
            require(f.finger for f in attempt.fingers)
            require(attempt.trace.closure)
            require(attempt.trace.servo)
    for evaluation in evaluations:
        require(evaluation.settings.fingers)
        require(f.finger for f in evaluation.fingers)
        for speed in ("slow", "fast"):
            require(s.finger for s in evaluation.sweeps if s.speed == speed)


def _created_at(calibration: dict) -> str:
    """Historical calibration time from the story, normalized to the stored Z format."""
    value = datetime.fromisoformat(calibration["created_at"].replace("Z", "+00:00"))
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _profile_is_replaceable(db, demo: c.Profile) -> bool:
    """Fill the profile only when nobody has entered one, or it is the previous demo patient."""
    current = repo.get_profile(db)
    return not current.pseudonym.strip() or current.pseudonym == demo.pseudonym


def seed_demo(engine, *, reset: bool = False, end: datetime | None = None) -> tuple[int, int]:
    upgrade_schema(engine)
    with Session(engine) as db:
        if not reset and db.exec(select(m.Session).where(m.Session.is_demo)).first():
            return (0, 0)
    end = end or datetime.now(timezone.utc).replace(hour=10, minute=0, second=0, microsecond=0)
    payload = generate(end)
    # Validate everything before opening a write transaction or removing old demos.
    calibration = c.CalibrationIn.model_validate(
        {k: v for k, v in payload["calibration"].items() if k not in {"id", "created_at"}}
    )
    legacy_calibration = c.CalibrationIn.model_validate(
        {k: v for k, v in payload["legacy_calibration"].items() if k not in {"id", "created_at"}}
    )
    sessions = [
        (
            value,
            [c.AttemptResult.model_validate(a) for a in value["attempts"]],
            c.SessionSummary.model_validate(value["summary"]),
        )
        for value in payload["sessions"]
    ]
    profile = c.Profile.model_validate(payload["profile"])
    decisions = [
        [therapy.CoachDecision.model_validate(d) for d in value.get("decisions", [])]
        for value in payload["sessions"]
    ]
    # Session ids are assigned on insert; validate with a placeholder now.
    feelings = [
        [
            therapy.FeelingEntry.model_validate({**f, "session_id": 1})
            for f in value.get("feelings", [])
        ]
        for value in payload["sessions"]
    ]
    transcripts = [
        [c.TranscriptLine.model_validate(line) for line in value.get("transcript", [])]
        for value in payload["sessions"]
    ]
    evaluations = [
        c.EvaluationIn.model_validate({**value, "calibration_id": 1, "is_demo": True})
        for value in payload["evaluations"]
    ]
    _validate_fingers(calibration, sessions, evaluations)
    _validate_fingers(legacy_calibration, [], [])
    if calibration.assist_direction != "open" or legacy_calibration.assist_direction not in (
        None,
        "close",
    ):
        raise ValueError("Demo calibrations must distinguish opening and legacy closing")
    if any(value.get("assist_direction") not in ("open", "close") for value, _, _ in sessions):
        raise ValueError("Demo sessions must declare their assist direction")
    with engine.begin() as connection:
        # SQLite legacy transaction mode otherwise lets the first SAVEPOINT commit itself.
        connection.exec_driver_sql("BEGIN IMMEDIATE")
        # Repository commits release savepoints; the enclosing transaction stays atomic.
        with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
            if not reset and db.exec(select(m.Session).where(m.Session.is_demo)).first():
                return (0, 0)
            if reset:
                db.exec(delete(m.Session).where(m.Session.is_demo))
                db.exec(delete(m.Evaluation).where(m.Evaluation.is_demo))
                db.commit()
            # Reuse only an identical historical calibration; never overwrite hardware ranges.
            calibration_ids = {}
            for direction, body, created_at in [
                ("open", calibration, _created_at(payload["calibration"])),
                ("close", legacy_calibration, _created_at(payload["legacy_calibration"])),
            ]:
                candidates = db.exec(
                    select(m.Calibration).where(m.Calibration.created_at == created_at)
                ).all()
                row = next(
                    (
                        r
                        for r in candidates
                        if repo._calibration(r).model_dump(exclude={"id", "created_at"})
                        == body.model_dump()
                    ),
                    None,
                )
                if row is None:
                    saved = repo.create_calibration(db, body)
                    row = db.get(m.Calibration, saved.id)
                    row.created_at = created_at
                    db.add(row)
                    db.commit()
                calibration_ids[direction] = row.id
            if _profile_is_replaceable(db, profile):
                repo.put_profile(db, profile)
            for (value, attempts, summary), coach, felt, lines in zip(
                sessions, decisions, feelings, transcripts, strict=True
            ):
                saved = repo.create_session(
                    db,
                    c.SessionIn(
                        mode="exercise",
                        plan=value["plan"],
                        settings=value["settings"],
                        calibration_id=calibration_ids[value["assist_direction"]],
                        is_demo=True,
                    ),
                    started_at=value["started_at"],
                )
                for attempt in attempts:
                    repo.create_attempt(db, saved.id, attempt)
                repo.end_session(db, saved.id, summary, ended_at=value["ended_at"])
                if coach:
                    repo.add_coach_decisions(db, saved.id, coach)
                if felt:
                    repo.add_feelings(
                        db, saved.id, [f.model_copy(update={"session_id": saved.id}) for f in felt]
                    )
                if lines:
                    repo.add_transcript(db, saved.id, lines)
            for evaluation in evaluations:
                repo.create_evaluation(
                    db, evaluation.model_copy(update={"calibration_id": calibration_ids["open"]})
                )
    return len(sessions), len(evaluations)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="Replace only is_demo history")
    parser.add_argument("--db", default=settings.rehab_db_path, help="SQLite database path")
    args = parser.parse_args()
    engine = make_engine(args.db)
    try:
        sessions, evaluations = seed_demo(engine, reset=args.reset)
        print(f"Demo seed: {sessions} sessions, {evaluations} evaluations written to {args.db}.")
        if not sessions:
            print("Demo history already exists. Use --reset to replace it.")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
