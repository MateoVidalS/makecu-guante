"""AI therapy wire models, mirroring frontend/src/contracts/therapist.ts.

These are observations and audit records, never motor commands. Runtime and firmware
remain responsible for immediate braking and enforcing the fixed safety limits.
"""

from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import ConfigDict, Field, JsonValue, field_validator

from app.contracts.types import ContractModel, ExercisePhase, FingerId, PoseId
from app.contracts.types import SessionDetail as BaseSessionDetail

CoachToolName = Literal[
    "get_live_state",
    "adjust_help",
    "set_attempt_time",
    "add_rest",
    "choose_next_pose",
    "record_feeling",
    "brake",
    "undo_last_adjustment",
]
Rating = Annotated[float, Field(ge=0, le=10, allow_inf_nan=False)]
Finite = Annotated[float, Field(allow_inf_nan=False)]


class TherapyLimits(ContractModel):
    assist_speed: tuple[Literal[0.1], Literal[0.3]] = (0.1, 0.3)
    assist_step: Literal[0.05] = 0.05
    attempt_s: tuple[Literal[4], Literal[9]] = (4, 9)
    rest_add_max_s: Literal[20] = 20
    rest_total_max_s: Literal[60] = 60
    pain_brake_at: Literal[4] = 4


class TherapyAdjustments(ContractModel):
    assist_speed: dict[FingerId, Annotated[float, Field(ge=0.1, le=0.3)]]
    attempt_s: Annotated[float, Field(ge=4, le=9)]
    extra_rest_s: Annotated[float, Field(ge=0, le=60)]
    next_pose: PoseId | None

    @field_validator("assist_speed")
    @classmethod
    def all_fingers(cls, value):
        if set(value) != {"thumb", "index", "middle", "ring", "pinky"}:
            raise ValueError("Assist speed must include all five fingers")
        return value


class LiveTherapyFinger(ContractModel):
    finger: FingerId
    now: Finite | None
    target: Finite | None
    best_alone: Finite | None
    glove_helping: bool
    lagging: bool


class LastAttempt(ContractModel):
    reached_alone: bool
    assisted: bool
    active_ratio: Finite


class LastFeeling(ContractModel):
    pain: Rating
    fatigue: Rating
    minutes_ago: Annotated[float, Field(ge=0, allow_inf_nan=False)]


class LiveTherapyState(ContractModel):
    phase: ExercisePhase
    pose: PoseId
    rep: int
    index: int
    total: int
    seconds_in_phase: Annotated[float, Field(ge=0, allow_inf_nan=False)]
    fingers: list[LiveTherapyFinger]
    last_attempt: LastAttempt | None
    adjustments: TherapyAdjustments
    last_feeling: LastFeeling | None


class TimedRecord(ContractModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    t: str

    @field_validator("t")
    @classmethod
    def utc_timestamp(cls, value):
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            raise ValueError("Timestamp must include a timezone")
        return (
            timestamp.astimezone(timezone.utc)
            .isoformat(timespec="microseconds")
            .replace("+00:00", "Z")
        )


class CoachDecision(TimedRecord):
    id: str = Field(min_length=1)
    session_id: int | None
    # Unknown/rejected tools must also survive the audit trail, with their original arguments.
    tool: CoachToolName | str
    requested: dict[str, JsonValue]
    applied: dict[str, JsonValue] | None
    result: Literal["applied", "clamped", "rejected", "undone"]
    reason: str
    source: Literal["coach", "local_rule", "patient_ui"]


class FeelingEntry(TimedRecord):
    session_id: int
    attempt_index: Annotated[int, Field(ge=0)] | None
    pain: Rating
    fatigue: Rating
    note: str
    source: Literal["voice", "ui"]


class CoachDecisionsIn(ContractModel):
    decisions: list[CoachDecision]


class FeelingsIn(ContractModel):
    feelings: list[FeelingEntry]


class SessionDetail(BaseSessionDetail):
    # Defaults keep legacy sessions and fixtures readable without a data migration.
    coach_decisions: list[CoachDecision] = Field(default_factory=list)
    feelings: list[FeelingEntry] = Field(default_factory=list)
