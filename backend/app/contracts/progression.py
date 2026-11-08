"""Adaptive progression ("today's plan") contract; see docs/plan/17-progression.md.

The plan itself is computed in the browser from recent sessions. The backend only stores the
therapist's switch: whether practice adapts to the patient's progress, and how gently.
"""

from typing import Literal

from app.contracts.types import ContractModel

ProgressionChallenge = Literal["gentle", "standard"]


class ProgressionSettingsIn(ContractModel):
    enabled: bool
    challenge: ProgressionChallenge


class ProgressionSettings(ProgressionSettingsIn):
    # None until a therapist saves the setting for the first time.
    updated_at: str | None
