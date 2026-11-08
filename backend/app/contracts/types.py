from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

FingerId = Literal["thumb", "index", "middle", "ring", "pinky"]
GloveFinger = FingerId
Handedness = Literal["left", "right"]
AssistDirection = Literal["close", "open"]
CURRENT_ASSIST_DIRECTION: AssistDirection = "open"
PoseId = Literal["open", "hook", "full_fist", "tabletop", "straight_fist", "pinch"]
ExercisePhase = Literal[
    "PRESENT", "ATTEMPT", "HOLD", "ASSIST", "ASSIST_HOLD", "RELEASE", "PAUSED", "REST", "DONE"
]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Profile(ContractModel):
    pseudonym: str
    affected_hand: Handedness
    condition: str
    goals: str
    therapist_name: str
    therapist_email: str


class ServoCalibration(ContractModel):
    finger: GloveFinger
    min_deg: float  # Slack with a relaxed fist.
    max_deg: float  # Fingers straight, never hyperextended.


class CameraCalibration(ContractModel):
    affected_hand: Handedness
    # Absent in older calibrations (treated as front_diagonal by the app).
    camera_view: Literal["front_upright", "front_diagonal"] | None = None
    # Absent or null = 1, the unsigned math before P1.
    flex_model: int | None = None
    open_flex: dict[FingerId, float]  # Glove-opened relaxed hand.
    closed_flex: dict[FingerId, float]  # The patient's own fist.
    pinch_closed: float
    pinch_open: float


class FrictionPoint(ContractModel):
    pos: float
    ma: float


class FrictionCurve(ContractModel):
    v: float
    points: list[FrictionPoint]


class CalibrationIn(ContractModel):
    assist_direction: AssistDirection | None = None  # None = legacy closing assist.
    servo: list[ServoCalibration]
    camera: CameraCalibration
    friction: dict[GloveFinger, list[FrictionCurve]]
    current_limit_ma: float


class Calibration(CalibrationIn):
    id: int
    created_at: str


class ExercisePlanItem(ContractModel):
    pose: PoseId
    reps: int


class ExerciseSettings(ContractModel):
    present_s: float
    attempt_s: float
    hold_s: float
    assist_max_s: float
    rest_s: float
    tolerance: float
    reach_dwell_s: float
    assist_speed: float
    plateau_s: float
    assist_enabled: bool


class FingerAttemptMetrics(ContractModel):
    finger: FingerId
    scored: bool
    target: float | None
    active_max: float | None
    assist_needed: float | None
    final: float | None


class SafetyEvent(ContractModel):
    source: str
    t_rel: float
    finger: GloveFinger | None
    ma: float | None


class AttemptTrace(ContractModel):
    hz: Literal[20]
    t: list[float]
    closure: dict[GloveFinger, list[float | None]]
    servo: dict[GloveFinger, list[float]]
    ma: list[float]
    phase: list[ExercisePhase]

    @model_validator(mode="after")
    def aligned_samples(self):
        arrays = [self.ma, self.phase, *self.closure.values(), *self.servo.values()]
        if any(len(a) != len(self.t) for a in arrays):
            raise ValueError("Trace arrays must have equal lengths")
        if any(b <= a for a, b in zip(self.t, self.t[1:])):
            raise ValueError("Trace time must increase")
        return self


class AttemptBase(ContractModel):
    pose: PoseId
    rep: int
    index: int
    started_at: str
    ended_at: str
    reached_active: bool
    reached_final: bool
    assisted: bool
    time_to_position_s: float | None
    active_ratio: float
    fingers: list[FingerAttemptMetrics]
    pinch_min: float | None
    current_peak_ma: float | None
    current_mean_ma: float | None
    safety_events: list[SafetyEvent]
    interrupted: bool


class AttemptResult(AttemptBase):
    trace: AttemptTrace


class Attempt(AttemptBase):
    id: int
    session_id: int


class PoseSummary(ContractModel):
    pose: PoseId
    active_ratio_mean: float
    assisted: int
    reps: int


class FingerSummary(ContractModel):
    finger: GloveFinger
    active_max_mean: float | None
    assist_needed_mean: float | None


class PreviousFinger(ContractModel):
    finger: GloveFinger
    active_max_mean: float | None


class PreviousSummary(ContractModel):
    active_ratio_mean: float
    per_finger: list[PreviousFinger]


class SessionSummary(ContractModel):
    attempts: int
    reached_active: int
    assisted: int
    interrupted: int
    active_ratio_mean: float
    per_pose: list[PoseSummary]
    per_finger: list[FingerSummary]
    previous: PreviousSummary | None


class SessionIn(ContractModel):
    mode: Literal["exercise"]
    plan: list[ExercisePlanItem]
    settings: ExerciseSettings
    calibration_id: int
    is_demo: bool = False


class Session(SessionIn):
    assist_direction: AssistDirection | None = None  # Derived from calibration.
    id: int
    started_at: str
    ended_at: str | None
    summary: SessionSummary | None
    n_attempts: int


class TranscriptLine(ContractModel):
    t: str
    role: Literal["coach", "patient", "system"]
    text: str


class SessionDetail(Session):
    attempts: list[Attempt]
    transcript: list[TranscriptLine]


class EvalSettings(ContractModel):
    slow_v: float
    fast_v: float
    limit_ma: float
    fingers: list[GloveFinger]


class EvalPoint(FrictionPoint):
    excess_ma: float


class EvalSweep(ContractModel):
    finger: GloveFinger
    speed: Literal["slow", "fast"]
    v: float
    points: list[EvalPoint]
    aborted_at: float | None


class EvalFingerResult(ContractModel):
    finger: GloveFinger
    resistance_slow_ma: float | None
    resistance_fast_ma: float | None
    velocity_dependence_ma: float | None
    peak_excess_ma: float | None
    aborted: bool


class EvaluationResult(ContractModel):
    started_at: str
    ended_at: str
    settings: EvalSettings
    sweeps: list[EvalSweep]
    fingers: list[EvalFingerResult]
    friction_used: bool


class EvaluationIn(EvaluationResult):
    calibration_id: int
    is_demo: bool = False


class Evaluation(EvaluationIn):
    assist_direction: AssistDirection | None = None  # Derived from calibration.
    id: int


class Summary(ContractModel):
    id: int
    kind: Literal["session", "therapist"]
    created_at: str
    session_id: int | None
    days: int | None
    model: str
    text: str


class SessionSummaryIn(ContractModel):
    kind: Literal["session"]
    session_id: int


class TherapistSummaryIn(ContractModel):
    kind: Literal["therapist"]
    days: int


class VoiceToken(ContractModel):
    token: str
    expires_at: str
    model: str
    voice: str
    system_instruction: str
    tools: list[dict]


class VoiceTokenIn(ContractModel):
    session_id: int | None


class OverviewFinger(ContractModel):
    finger: GloveFinger
    active_max_first: float | None
    active_max_last: float | None
    assist_needed_last: float | None


class HistoryOverview(ContractModel):
    sessions: int
    attempts: int
    evaluations: int
    days_practiced_last_7: int
    last_session_at: str | None
    per_finger: list[OverviewFinger]


class RomPoint(ContractModel):
    assist_direction: AssistDirection | None = None  # Derived from calibration.
    session_id: int
    started_at: str
    finger: GloveFinger
    pose: PoseId | None
    active_max_mean: float
    is_demo: bool


class AssistPoint(ContractModel):
    assist_direction: AssistDirection | None = None  # Derived from calibration.
    session_id: int
    started_at: str
    finger: GloveFinger
    assist_needed_mean: float
    assisted_rate: float
    is_demo: bool


class ResistancePoint(ContractModel):
    assist_direction: AssistDirection | None = None  # Derived from calibration.
    evaluation_id: int
    started_at: str
    finger: GloveFinger
    slow: float | None
    fast: float | None
    dependence: float | None
    is_demo: bool


class Health(ContractModel):
    ok: bool
    version: str
    gemini: bool


class ErrorDetail(ContractModel):
    code: str
    message: str


class ApiError(ContractModel):
    error: ErrorDetail


class SessionEndIn(ContractModel):
    summary: SessionSummary


class TranscriptIn(ContractModel):
    lines: list[TranscriptLine] = Field(default_factory=list)
