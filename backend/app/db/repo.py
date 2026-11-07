"""Transactional persistence and SQL aggregates; public values use the frozen contracts."""

import csv
import gzip
import io
import json
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import case, func, or_
from sqlmodel import Session as DbSession
from sqlmodel import select

from app.contracts import types as c
from app.db import models as m

FINGERS = ("thumb", "index", "middle")


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _json(value) -> str:
    return json.dumps(value, separators=(",", ":"), allow_nan=False)


def _values(row, *, exclude=frozenset()):
    # Access attributes so SQLAlchemy refreshes instances expired by commit.
    return {name: getattr(row, name) for name in type(row).model_fields if name not in exclude}


def _required(db, model, id):
    row = db.get(model, id)
    if row is None:
        raise HTTPException(404, {"code": "not_found", "message": "Record not found"})
    return row


def _invalid(message):
    raise HTTPException(422, {"code": "validation_error", "message": message})


def get_profile(db: DbSession) -> c.Profile:
    row = db.get(m.Profile, 1) or m.Profile()
    return c.Profile.model_validate(_values(row, exclude={"id"}))


def put_profile(db: DbSession, profile: c.Profile) -> c.Profile:
    row = db.get(m.Profile, 1) or m.Profile()
    row.sqlmodel_update(profile.model_dump())
    db.add(row)
    db.commit()
    return get_profile(db)


def _calibration(row) -> c.Calibration:
    return c.Calibration(
        id=row.id,
        created_at=row.created_at,
        servo=json.loads(row.servo_json),
        camera=json.loads(row.camera_json),
        friction=json.loads(row.friction_json),
        current_limit_ma=row.current_limit_ma,
    )


def list_calibrations(db: DbSession) -> list[c.Calibration]:
    return [
        _calibration(r)
        for r in db.exec(
            select(m.Calibration).order_by(m.Calibration.created_at.desc(), m.Calibration.id.desc())
        )
    ]


def latest_calibration(db: DbSession) -> c.Calibration | None:
    row = db.exec(
        select(m.Calibration)
        .order_by(m.Calibration.created_at.desc(), m.Calibration.id.desc())
        .limit(1)
    ).first()
    return _calibration(row) if row else None


def create_calibration(db: DbSession, body: c.CalibrationIn) -> c.Calibration:
    data = body.model_dump()
    row = m.Calibration(
        created_at=now(),
        servo_json=_json(data["servo"]),
        camera_json=_json(data["camera"]),
        friction_json=_json(data["friction"]),
        current_limit_ma=body.current_limit_ma,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _calibration(row)


def _session(row, n_attempts=0) -> c.Session:
    return c.Session(
        **_values(row, exclude={"plan_json", "settings_json", "summary_json"}),
        plan=json.loads(row.plan_json),
        settings=json.loads(row.settings_json),
        summary=json.loads(row.summary_json) if row.summary_json else None,
        n_attempts=n_attempts,
    )


def _session_count(db, id):
    return db.exec(select(func.count(m.Attempt.id)).where(m.Attempt.session_id == id)).one()


def create_session(db: DbSession, body: c.SessionIn, *, started_at: str | None = None) -> c.Session:
    _required(db, m.Calibration, body.calibration_id)
    data = body.model_dump()
    row = m.Session(
        **body.model_dump(exclude={"plan", "settings"}),
        started_at=started_at or now(),
        plan_json=_json(data["plan"]),
        settings_json=_json(data["settings"]),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _session(row)


def list_sessions(
    db: DbSession, mode: str | None = None, limit: int = 50, offset: int = 0
) -> list[c.Session]:
    query = select(m.Session, func.count(m.Attempt.id)).outerjoin(m.Attempt).group_by(m.Session.id)
    if mode:
        query = query.where(m.Session.mode == mode)
    return [
        _session(row, n)
        for row, n in db.exec(
            query.order_by(m.Session.started_at.desc(), m.Session.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ]


def _attempt(row, fingers) -> c.Attempt:
    data = _values(row, exclude={"idx", "safety_json"})
    return c.Attempt(
        **data,
        index=row.idx,
        safety_events=json.loads(row.safety_json),
        fingers=[_values(f, exclude={"id", "attempt_id"}) for f in fingers],
    )


def get_session(db: DbSession, id: int) -> c.SessionDetail:
    row = _required(db, m.Session, id)
    attempts = db.exec(
        select(m.Attempt).where(m.Attempt.session_id == id).order_by(m.Attempt.idx, m.Attempt.id)
    ).all()
    fingers = db.exec(
        select(m.AttemptFinger)
        .join(m.Attempt)
        .where(m.Attempt.session_id == id)
        .order_by(m.AttemptFinger.id)
    ).all()
    by_attempt = {}
    for f in fingers:
        by_attempt.setdefault(f.attempt_id, []).append(f)
    transcript = db.exec(
        select(m.TranscriptLine)
        .where(m.TranscriptLine.session_id == id)
        .order_by(m.TranscriptLine.t, m.TranscriptLine.id)
    ).all()
    return c.SessionDetail(
        **_session(row, len(attempts)).model_dump(),
        attempts=[_attempt(a, by_attempt.get(a.id, [])) for a in attempts],
        transcript=[_values(r, exclude={"id", "session_id"}) for r in transcript],
    )


def delete_session(db: DbSession, id: int) -> None:
    db.delete(_required(db, m.Session, id))
    db.commit()


def session_summary_with_previous(
    db: DbSession, session_id: int, summary: c.SessionSummary
) -> c.SessionSummary:
    current = _required(db, m.Session, session_id)
    # A previous session must precede this one; prefer real data, even if a demo is newer.
    query = (
        select(m.Session)
        .where(
            m.Session.summary_json.is_not(None),
            m.Session.id != session_id,
            or_(
                m.Session.started_at < current.started_at,
                (m.Session.started_at == current.started_at) & (m.Session.id < session_id),
            ),
        )
        .order_by(m.Session.is_demo, m.Session.started_at.desc(), m.Session.id.desc())
        .limit(1)
    )
    row = db.exec(query).first()
    previous = None
    if row:
        old = c.SessionSummary.model_validate_json(row.summary_json)
        previous = c.PreviousSummary(
            active_ratio_mean=old.active_ratio_mean,
            per_finger=[
                c.PreviousFinger(finger=f.finger, active_max_mean=f.active_max_mean)
                for f in old.per_finger
            ],
        )
    return summary.model_copy(update={"previous": previous})


def end_session(
    db: DbSession, id: int, summary: c.SessionSummary, *, ended_at: str | None = None
) -> c.Session:
    row = _required(db, m.Session, id)
    row.summary_json = session_summary_with_previous(db, id, summary).model_dump_json()
    row.ended_at = row.ended_at or ended_at or now()
    db.add(row)
    db.commit()
    return _session(row, _session_count(db, id))


def create_attempt(db: DbSession, id: int, body: c.AttemptResult) -> c.Attempt:
    _required(db, m.Session, id)
    data = body.model_dump(exclude={"trace", "fingers", "index", "safety_events"})
    row = m.Attempt(
        **data,
        session_id=id,
        idx=body.index,
        safety_json=_json([s.model_dump() for s in body.safety_events]),
    )
    db.add(row)
    db.flush()
    fingers = [m.AttemptFinger(attempt_id=row.id, **f.model_dump()) for f in body.fingers]
    db.add_all(fingers)
    db.add(
        m.AttemptTrace(attempt_id=row.id, blob=gzip.compress(body.trace.model_dump_json().encode()))
    )
    db.commit()
    return _attempt(row, fingers)


def get_trace(db: DbSession, id: int) -> c.AttemptTrace:
    return c.AttemptTrace.model_validate_json(
        gzip.decompress(_required(db, m.AttemptTrace, id).blob)
    )


def add_transcript(db: DbSession, id: int, lines: list[c.TranscriptLine]) -> None:
    _required(db, m.Session, id)
    db.add_all([m.TranscriptLine(session_id=id, **line.model_dump()) for line in lines])
    db.commit()


def _evaluation(db, row) -> c.Evaluation:
    fingers = db.exec(
        select(m.EvaluationFinger)
        .where(m.EvaluationFinger.evaluation_id == row.id)
        .order_by(m.EvaluationFinger.id)
    ).all()
    return c.Evaluation(
        **_values(row, exclude={"settings_json", "sweeps_blob"}),
        settings=json.loads(row.settings_json),
        sweeps=json.loads(gzip.decompress(row.sweeps_blob)),
        fingers=[_values(f, exclude={"id", "evaluation_id"}) for f in fingers],
    )


def create_evaluation(db: DbSession, body: c.EvaluationIn) -> c.Evaluation:
    _required(db, m.Calibration, body.calibration_id)
    data = body.model_dump()
    row = m.Evaluation(
        **body.model_dump(exclude={"settings", "sweeps", "fingers"}),
        settings_json=_json(data["settings"]),
        sweeps_blob=gzip.compress(_json(data["sweeps"]).encode()),
    )
    db.add(row)
    db.flush()
    db.add_all([m.EvaluationFinger(evaluation_id=row.id, **f.model_dump()) for f in body.fingers])
    db.commit()
    return _evaluation(db, row)


def list_evaluations(db: DbSession) -> list[c.Evaluation]:
    return [
        _evaluation(db, row)
        for row in db.exec(
            select(m.Evaluation).order_by(m.Evaluation.started_at.desc(), m.Evaluation.id.desc())
        )
    ]


def get_evaluation(db: DbSession, id: int) -> c.Evaluation:
    return _evaluation(db, _required(db, m.Evaluation, id))


def history_rom(
    db: DbSession, finger: c.GloveFinger | None = None, pose: c.PoseId | None = None
) -> list[c.RomPoint]:
    query = (
        select(
            m.Session.id,
            m.Session.started_at,
            m.AttemptFinger.finger,
            func.avg(m.AttemptFinger.active_max),
            m.Session.is_demo,
        )
        .join(m.Attempt, m.Attempt.session_id == m.Session.id)
        .join(m.AttemptFinger)
        .where(
            m.AttemptFinger.scored,
            m.AttemptFinger.finger.in_(FINGERS),
            m.AttemptFinger.active_max.is_not(None),
        )
    )
    if finger:
        query = query.where(m.AttemptFinger.finger == finger)
    if pose:
        query = query.where(m.Attempt.pose == pose)
    query = query.group_by(m.Session.id, m.AttemptFinger.finger).order_by(
        m.Session.started_at, m.Session.id, m.AttemptFinger.finger
    )
    return [
        c.RomPoint(
            session_id=id, started_at=t, finger=f, pose=pose, active_max_mean=mean, is_demo=demo
        )
        for id, t, f, mean, demo in db.exec(query)
    ]


def history_assist(db: DbSession) -> list[c.AssistPoint]:
    query = (
        select(
            m.Session.id,
            m.Session.started_at,
            m.AttemptFinger.finger,
            func.avg(m.AttemptFinger.assist_needed),
            func.avg(case((m.AttemptFinger.assist_needed > 0, 1.0), else_=0.0)),
            m.Session.is_demo,
        )
        .join(m.Attempt, m.Attempt.session_id == m.Session.id)
        .join(m.AttemptFinger)
        .where(
            m.AttemptFinger.scored,
            m.AttemptFinger.finger.in_(FINGERS),
            m.AttemptFinger.assist_needed.is_not(None),
        )
        .group_by(m.Session.id, m.AttemptFinger.finger)
        .order_by(m.Session.started_at, m.Session.id, m.AttemptFinger.finger)
    )
    # Assistance is per finger: another finger's assistance must not inflate this rate.
    return [
        c.AssistPoint(
            session_id=id,
            started_at=t,
            finger=f,
            assist_needed_mean=mean,
            assisted_rate=rate,
            is_demo=demo,
        )
        for id, t, f, mean, rate, demo in db.exec(query)
    ]


def history_resistance(db: DbSession) -> list[c.ResistancePoint]:
    # Select only scalar trend fields: never read or inflate sweep blobs here.
    query = (
        select(
            m.Evaluation.id,
            m.Evaluation.started_at,
            m.Evaluation.is_demo,
            m.EvaluationFinger.finger,
            m.EvaluationFinger.resistance_slow_ma,
            m.EvaluationFinger.resistance_fast_ma,
            m.EvaluationFinger.velocity_dependence_ma,
        )
        .join(m.EvaluationFinger)
        .order_by(m.Evaluation.started_at, m.Evaluation.id, m.EvaluationFinger.id)
    )
    return [
        c.ResistancePoint(
            evaluation_id=id,
            started_at=t,
            is_demo=demo,
            finger=f,
            slow=slow,
            fast=fast,
            dependence=dep,
        )
        for id, t, demo, f, slow, fast, dep in db.exec(query)
    ]


def history_overview(db: DbSession) -> c.HistoryOverview:
    rom = history_rom(db)
    assist = {(p.session_id, p.finger): p.assist_needed_mean for p in history_assist(db)}
    per_finger = []
    for finger in FINGERS:
        points = [p for p in rom if p.finger == finger]
        per_finger.append(
            c.OverviewFinger(
                finger=finger,
                active_max_first=points[0].active_max_mean if points else None,
                active_max_last=points[-1].active_max_mean if points else None,
                assist_needed_last=assist.get((points[-1].session_id, finger)) if points else None,
            )
        )
    cutoff = (datetime.now(timezone.utc) - timedelta(days=6)).date().isoformat()
    today = datetime.now(timezone.utc).date().isoformat()
    days = db.exec(
        select(func.count(func.distinct(func.substr(m.Session.started_at, 1, 10)))).where(
            func.substr(m.Session.started_at, 1, 10) >= cutoff,
            func.substr(m.Session.started_at, 1, 10) <= today,
        )
    ).one()
    return c.HistoryOverview(
        sessions=db.exec(select(func.count(m.Session.id))).one(),
        attempts=db.exec(select(func.count(m.Attempt.id))).one(),
        evaluations=db.exec(select(func.count(m.Evaluation.id))).one(),
        days_practiced_last_7=days,
        last_session_at=db.exec(select(func.max(m.Session.started_at))).one(),
        per_finger=per_finger,
    )


def therapist_digest(db: DbSession, days: int) -> dict:
    if days < 1:
        _invalid("Days must be positive")
    end = now()
    start = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat().replace("+00:00", "Z")
    sessions = db.exec(
        select(m.Session)
        .where(m.Session.started_at >= start, m.Session.started_at <= end)
        .order_by(m.Session.started_at, m.Session.id)
    ).all()
    evals = db.exec(
        select(m.Evaluation.id, m.Evaluation.is_demo).where(
            m.Evaluation.started_at >= start, m.Evaluation.started_at <= end
        )
    ).all()
    only_demo = bool(sessions or evals) and not (
        any(not s.is_demo for s in sessions) or any(not demo for _, demo in evals)
    )
    sessions = [s for s in sessions if only_demo or not s.is_demo]
    ids = {s.id for s in sessions}
    evaluation_ids = {id for id, demo in evals if only_demo or not demo}
    attempts = db.exec(select(m.Attempt).where(m.Attempt.session_id.in_(ids))).all() if ids else []
    rom = [p.model_dump() for p in history_rom(db) if p.session_id in ids]
    assist = [p.model_dump() for p in history_assist(db) if p.session_id in ids]
    resistance = [
        p.model_dump() for p in history_resistance(db) if p.evaluation_id in evaluation_ids
    ]
    return {
        "days": days,
        "from": start,
        "to": end,
        "only_demo": only_demo,
        "adherence": {
            "sessions": len(ids),
            "attempts": len(attempts),
            "days_practiced": len({s.started_at[:10] for s in sessions}),
            "evaluations": len(evaluation_ids),
        },
        "active_range": rom,
        "assistance": assist,
        "resistance": resistance,
        "safety_events": [
            {"session_id": a.session_id, "attempt_id": a.id, **event}
            for a in attempts
            for event in json.loads(a.safety_json)
        ],
    }


def create_summary(db: DbSession, body: c.SessionSummaryIn | c.TherapistSummaryIn) -> c.Summary:
    from app.llm.summaries import generate_summary

    if isinstance(body, c.SessionSummaryIn):
        session = get_session(db, body.session_id)
        context = {
            "summary": session.summary.model_dump() if session.summary else None,
            "is_demo": session.is_demo,
            "evaluation_trend": [
                p.model_dump() for p in history_resistance(db) if p.is_demo == session.is_demo
            ],
        }
        if session.summary is None:
            _invalid("End the session before generating a summary")
    else:
        context = therapist_digest(db, body.days)
    generated = generate_summary(body.kind, context)
    row = m.Summary(
        kind=body.kind,
        created_at=now(),
        session_id=body.session_id if isinstance(body, c.SessionSummaryIn) else None,
        days=body.days if isinstance(body, c.TherapistSummaryIn) else None,
        model=generated.model,
        text=generated.text,
    )
    db.add(row)
    db.commit()
    return c.Summary.model_validate(_values(row))


def list_summaries(db: DbSession, kind: str | None = None, limit: int = 20) -> list[c.Summary]:
    query = select(m.Summary)
    if kind:
        query = query.where(m.Summary.kind == kind)
    return [
        c.Summary.model_validate(_values(r))
        for r in db.exec(
            query.order_by(m.Summary.created_at.desc(), m.Summary.id.desc()).limit(limit)
        )
    ]


def export_data(db: DbSession, format: str = "json") -> str:
    sessions = [
        get_session(db, row.id)
        for row in db.exec(select(m.Session).order_by(m.Session.started_at, m.Session.id))
    ]
    if format == "json":
        nested = []
        for session in sessions:
            data = session.model_dump()
            data["attempts"] = [
                {**a.model_dump(), "trace": get_trace(db, a.id).model_dump()}
                for a in session.attempts
            ]
            nested.append(data)
        return _json(
            {
                "profile": get_profile(db).model_dump(),
                "calibrations": [x.model_dump() for x in list_calibrations(db)],
                "sessions": nested,
                "evaluations": [x.model_dump() for x in list_evaluations(db)],
                "summaries": [
                    c.Summary.model_validate(_values(x)).model_dump()
                    for x in db.exec(select(m.Summary).order_by(m.Summary.id))
                ],
            }
        )
    if format != "csv":
        _invalid("Unsupported export format")
    output = io.StringIO(newline="")
    session_cols = [
        "session_id",
        "mode",
        "session_started_at",
        "session_ended_at",
        "calibration_id",
        "is_demo",
        "plan",
        "settings",
        "summary",
        "n_attempts",
    ]
    attempt_cols = ["attempt_id", *c.AttemptBase.model_fields.keys()]
    attempt_cols.remove("fingers")
    writer = csv.DictWriter(
        output,
        fieldnames=[*session_cols, *attempt_cols, *c.FingerAttemptMetrics.model_fields.keys()],
    )
    writer.writeheader()
    for session in sessions:
        sd = session.model_dump(exclude={"attempts", "transcript"})
        sd["session_id"] = sd.pop("id")
        sd["session_started_at"] = sd.pop("started_at")
        sd["session_ended_at"] = sd.pop("ended_at")
        for key in ("plan", "settings", "summary"):
            sd[key] = _json(sd[key])
        for attempt in session.attempts:
            ad = attempt.model_dump(exclude={"fingers", "session_id"})
            ad["attempt_id"] = ad.pop("id")
            ad["safety_events"] = _json(ad["safety_events"])
            for finger in attempt.fingers:
                writer.writerow({**sd, **ad, **finger.model_dump()})
    return output.getvalue()


def create_demo_session(
    db: DbSession, body: c.SessionIn, *, started_at: str | None = None
) -> c.Session:
    """Seeders can set historical UTC timestamps, then add attempts and end the session."""
    return create_session(db, body.model_copy(update={"is_demo": True}), started_at=started_at)


def create_demo_evaluation(db: DbSession, body: c.EvaluationIn) -> c.Evaluation:
    return create_evaluation(db, body.model_copy(update={"is_demo": True}))


def create_demo_calibration(db: DbSession, body: c.CalibrationIn) -> c.Calibration:
    return create_calibration(db, body)
