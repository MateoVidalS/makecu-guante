from sqlalchemy import CheckConstraint
from sqlmodel import Field, SQLModel


class Profile(SQLModel, table=True):
    __tablename__ = "profile"
    __table_args__ = (CheckConstraint("id = 1"),)
    id: int = Field(default=1, primary_key=True)
    pseudonym: str = ""
    affected_hand: str = "right"
    condition: str = ""
    goals: str = ""
    therapist_name: str = ""
    therapist_email: str = ""


class Calibration(SQLModel, table=True):
    __tablename__ = "calibration"
    id: int | None = Field(default=None, primary_key=True)
    created_at: str
    servo_json: str
    camera_json: str
    friction_json: str
    current_limit_ma: float


class Session(SQLModel, table=True):
    __tablename__ = "session"
    id: int | None = Field(default=None, primary_key=True)
    mode: str
    started_at: str = Field(index=True)
    ended_at: str | None = None
    calibration_id: int = Field(foreign_key="calibration.id", index=True)
    plan_json: str
    settings_json: str
    is_demo: bool = False
    summary_json: str | None = None


class Attempt(SQLModel, table=True):
    __tablename__ = "attempt"
    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="session.id", ondelete="CASCADE", index=True)
    idx: int
    pose: str
    rep: int
    started_at: str = Field(index=True)
    ended_at: str
    reached_active: bool
    reached_final: bool
    assisted: bool
    time_to_position_s: float | None = None
    active_ratio: float
    pinch_min: float | None = None
    current_peak_ma: float | None = None
    current_mean_ma: float | None = None
    interrupted: bool
    safety_json: str


class AttemptFinger(SQLModel, table=True):
    __tablename__ = "attempt_finger"
    id: int | None = Field(default=None, primary_key=True)
    attempt_id: int = Field(foreign_key="attempt.id", ondelete="CASCADE", index=True)
    finger: str
    scored: bool
    target: float | None = None
    active_max: float | None = None
    assist_needed: float | None = None
    final: float | None = None


class AttemptTrace(SQLModel, table=True):
    __tablename__ = "attempt_trace"
    attempt_id: int = Field(primary_key=True, foreign_key="attempt.id", ondelete="CASCADE")
    blob: bytes


class Evaluation(SQLModel, table=True):
    __tablename__ = "evaluation"
    id: int | None = Field(default=None, primary_key=True)
    started_at: str = Field(index=True)
    ended_at: str
    calibration_id: int = Field(foreign_key="calibration.id", index=True)
    settings_json: str
    sweeps_blob: bytes
    is_demo: bool = False
    friction_used: bool


class EvaluationFinger(SQLModel, table=True):
    __tablename__ = "evaluation_finger"
    id: int | None = Field(default=None, primary_key=True)
    evaluation_id: int = Field(foreign_key="evaluation.id", ondelete="CASCADE", index=True)
    finger: str
    resistance_slow_ma: float | None = None
    resistance_fast_ma: float | None = None
    velocity_dependence_ma: float | None = None
    peak_excess_ma: float | None = None
    aborted: bool


class TranscriptLine(SQLModel, table=True):
    __tablename__ = "transcript_line"
    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="session.id", ondelete="CASCADE", index=True)
    t: str
    role: str
    text: str


class Summary(SQLModel, table=True):
    __tablename__ = "summary"
    id: int | None = Field(default=None, primary_key=True)
    kind: str
    created_at: str
    session_id: int | None = Field(
        default=None, foreign_key="session.id", ondelete="CASCADE", index=True
    )
    days: int | None = None
    model: str
    text: str
