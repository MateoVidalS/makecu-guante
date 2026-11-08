"""Compact, read-only clinical context. No traces, transcripts or database identities."""

from collections import Counter
from datetime import date, datetime, timedelta, timezone

from sqlmodel import select

from app.db import models as m
from app.db import repo
from app.llm import context


def cohort(db):
    """Use real sessions AND evaluations if either contains real data, otherwise demo."""
    sessions = list(db.exec(select(m.Session).order_by(m.Session.started_at, m.Session.id)))
    evaluations = list(
        db.exec(select(m.Evaluation).order_by(m.Evaluation.started_at, m.Evaluation.id))
    )
    only_demo = bool(sessions or evaluations) and all(r.is_demo for r in [*sessions, *evaluations])
    return (
        [r for r in sessions if r.is_demo == only_demo],
        [r for r in evaluations if r.is_demo == only_demo],
        only_demo,
    )


def dated(timestamp):
    return {"date": context._date(timestamp), "iso_date": timestamp[:10]}


def session_block(db, detail, previous=None, first=None):
    block = context.session(db, detail, previous, None, first)
    # This is a patient-level trend, included once below rather than in every session.
    block.pop("resistance_to_opening", None)
    block.update(dated(detail.started_at))
    block["assist_direction"] = detail.assist_direction
    block["attempts_per_pose"] = dict(Counter(a.pose.replace("_", " ") for a in detail.attempts))
    block["notes_for_therapist"] = [
        {"text": a["note"], "result": a["result"], "reason": a["reason"]}
        for a in block["coach_actions"]
        if "note" in a
    ]
    return block


def evaluation_blocks(db, evaluations):
    by_id = {r.id: r for r in evaluations}
    blocks = {
        r.id: {
            **dated(r.started_at),
            "assist_direction": repo._direction(db, r.calibration_id),
            "per_finger_mA": {},
        }
        for r in evaluations
    }
    for point in repo.history_resistance(db):
        if point.evaluation_id not in by_id:
            continue
        blocks[point.evaluation_id]["per_finger_mA"][point.finger] = {
            "slow": None if point.slow is None else round(point.slow),
            "fast": None if point.fast is None else round(point.fast),
            "fast_minus_slow": None if point.dependence is None else round(point.dependence),
        }
    return list(blocks.values())


def _adherence(details):
    weeks = {}
    for detail in details:
        day = date.fromisoformat(detail.started_at[:10])
        monday = (day - timedelta(days=day.weekday())).isoformat()
        week = weeks.setdefault(monday, {"days": set(), "sessions": 0, "attempts": 0, "minutes": 0})
        week["days"].add(day)
        week["sessions"] += 1
        week["attempts"] += len(detail.attempts)
        week["minutes"] += context._minutes(detail.started_at, detail.ended_at) or 0
    return [
        {
            "week_start": monday,
            "days_practiced": len(w["days"]),
            "sessions": w["sessions"],
            "attempts": w["attempts"],
            "minutes": round(w["minutes"], 1),
        }
        for monday, w in weeks.items()
    ]


def build_patient_record(db) -> dict:
    sessions, evaluations, only_demo = cohort(db)
    profile = repo.get_profile(db)
    details = [repo.get_session(db, r.id) for r in sessions]
    opening = [
        d for d in details if d.assist_direction == "open" and context.opening_alone(d.attempts)
    ]
    first = opening[0] if opening else None
    previous = {}
    blocks = []
    for detail in details:
        direction = detail.assist_direction
        blocks.append(session_block(db, detail, previous.get(direction), first))
        if direction != "open" or context.opening_alone(detail.attempts):
            previous[direction] = detail
    used = {r.calibration_id for r in [*sessions, *evaluations]}
    calibrations = [c for c in repo.list_calibrations(db) if c.id in used]
    evals = evaluation_blocks(db, evaluations)
    trends = {}
    for direction in ("open", "close"):
        trend = context.resistance_change([e for e in evals if e["assist_direction"] == direction])
        if trend and direction == "close":
            trend["in_words"] = trend["in_words"].replace("to opening", "to legacy closing")
        trends[direction] = trend
    summary = db.exec(
        select(m.Summary)
        .where(m.Summary.kind == "therapist")
        .order_by(m.Summary.created_at.desc(), m.Summary.id.desc())
        .limit(1)
    ).first()
    today = datetime.now(timezone.utc).date()
    practiced = {
        d.started_at[:10]
        for d in details
        if today - timedelta(days=6) <= date.fromisoformat(d.started_at[:10]) <= today
    }
    return {
        "only_demo": only_demo,
        "readable": {
            "profile": {
                "affected_hand": profile.affected_hand,
                "condition": profile.condition,
                "goals": profile.goals,
                "therapist": profile.therapist_name,
            },
            "calibrations": [
                {
                    **dated(c.created_at),
                    "assist_direction": c.assist_direction or "close",
                    "fingers": [s.finger for s in c.servo],
                }
                for c in reversed(calibrations)
            ],
            "sessions": blocks,
            "evaluations": evals,
            "resistance_trends_by_assist_direction": trends,
            "weekly_adherence": _adherence(details),
            "overview": {
                "sessions": len(details),
                "attempts": sum(len(d.attempts) for d in details),
                "evaluations": len(evaluations),
                "days_practiced_last_7": len(practiced),
                "last_session": dated(details[-1].started_at) if details else None,
            },
            "latest_stored_therapist_summary": {
                **dated(summary.created_at),
                "text": summary.text,
                "cohort": "not recorded; verify against the supplied measurements",
            }
            if summary
            else None,
        },
    }
