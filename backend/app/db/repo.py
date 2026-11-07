"""Storage boundary. WP5 replaces these stubs with transactional implementations."""

from sqlmodel import Session as DbSession

from app.contracts.types import (
    AssistPoint,
    Attempt,
    AttemptResult,
    AttemptTrace,
    Calibration,
    CalibrationIn,
    Evaluation,
    EvaluationIn,
    GloveFinger,
    HistoryOverview,
    PoseId,
    Profile,
    ResistancePoint,
    RomPoint,
    Session,
    SessionDetail,
    SessionIn,
    SessionSummary,
    SessionSummaryIn,
    Summary,
    TherapistSummaryIn,
    TranscriptLine,
)


def get_profile(db: DbSession) -> Profile:
    raise NotImplementedError("WP5")


def put_profile(db: DbSession, profile: Profile) -> Profile:
    raise NotImplementedError("WP5")


def list_calibrations(db: DbSession) -> list[Calibration]:
    raise NotImplementedError("WP5")


def latest_calibration(db: DbSession) -> Calibration | None:
    raise NotImplementedError("WP5")


def create_calibration(db: DbSession, body: CalibrationIn) -> Calibration:
    raise NotImplementedError("WP5")


def create_session(db: DbSession, body: SessionIn) -> Session:
    raise NotImplementedError("WP5")


def list_sessions(
    db: DbSession, mode: str | None = None, limit: int = 50, offset: int = 0
) -> list[Session]:
    raise NotImplementedError("WP5")


def get_session(db: DbSession, id: int) -> SessionDetail:
    raise NotImplementedError("WP5")


def delete_session(db: DbSession, id: int) -> None:
    raise NotImplementedError("WP5")


def end_session(db: DbSession, id: int, summary: SessionSummary) -> Session:
    raise NotImplementedError("WP5")


def create_attempt(db: DbSession, id: int, body: AttemptResult) -> Attempt:
    raise NotImplementedError("WP5")


def get_trace(db: DbSession, id: int) -> AttemptTrace:
    raise NotImplementedError("WP5")


def add_transcript(db: DbSession, id: int, lines: list[TranscriptLine]) -> None:
    raise NotImplementedError("WP5")


def create_evaluation(db: DbSession, body: EvaluationIn) -> Evaluation:
    raise NotImplementedError("WP5")


def list_evaluations(db: DbSession) -> list[Evaluation]:
    raise NotImplementedError("WP5")


def get_evaluation(db: DbSession, id: int) -> Evaluation:
    raise NotImplementedError("WP5")


def history_overview(db: DbSession) -> HistoryOverview:
    raise NotImplementedError("WP5")


def history_rom(
    db: DbSession, finger: GloveFinger | None = None, pose: PoseId | None = None
) -> list[RomPoint]:
    raise NotImplementedError("WP5")


def history_assist(db: DbSession) -> list[AssistPoint]:
    raise NotImplementedError("WP5")


def history_resistance(db: DbSession) -> list[ResistancePoint]:
    raise NotImplementedError("WP5")


def create_summary(db: DbSession, body: SessionSummaryIn | TherapistSummaryIn) -> Summary:
    raise NotImplementedError("WP5")


def list_summaries(db: DbSession, kind: str | None = None, limit: int = 20) -> list[Summary]:
    raise NotImplementedError("WP5")


def export_data(db: DbSession, format: str = "json") -> str:
    raise NotImplementedError("WP5")


def session_summary_with_previous(
    db: DbSession, session_id: int, summary: SessionSummary
) -> SessionSummary:
    raise NotImplementedError("WP5")


def therapist_digest(db: DbSession, days: int) -> dict:
    raise NotImplementedError("WP5")


def create_demo_session(db: DbSession, body: SessionIn) -> Session:
    raise NotImplementedError("WP5")


def create_demo_evaluation(db: DbSession, body: EvaluationIn) -> Evaluation:
    raise NotImplementedError("WP5")
