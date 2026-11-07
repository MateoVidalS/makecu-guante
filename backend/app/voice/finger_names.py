"""Spoken finger names, separate from protocol and storage IDs."""

from app.contracts.types import FingerId

FINGER_NAMES: dict[FingerId, str] = {
    "thumb": "thumb",
    "index": "index",
    "middle": "middle",
    "ring": "ring",
    "pinky": "little finger",
}


def finger_name(finger: FingerId) -> str:
    return FINGER_NAMES[finger]


def finger_names() -> str:
    names = list(FINGER_NAMES.values())
    return f"{', '.join(names[:-1])} and {names[-1]}"
