"""Doctor chat wire models, mirroring frontend/src/contracts/chat.ts (docs/plan/03-contracts.md §4.1).

The doctor chat is read-only: its tools only read the patient's stored records. It never
controls the glove and never writes data.
"""

from typing import Annotated, Literal

from pydantic import Field, JsonValue

from app.contracts.types import ContractModel

ChatRole = Literal["user", "model"]
ChatToolName = Literal[
    "get_session", "get_transcript", "get_evaluation", "compare", "find", "show_chart"
]
# Browser-only tool: scrolls the Doctor view to a section. The server never executes it.
ChartSection = Literal[
    "summary", "glance", "range", "assistance", "therapy", "sessions", "evaluations"
]


class ChatMessage(ContractModel):
    role: ChatRole
    text: Annotated[str, Field(min_length=1, max_length=4000)]


class ChatIn(ContractModel):
    # The server keeps no chat history: the browser sends the conversation (oldest first,
    # last message from the user).
    messages: Annotated[list[ChatMessage], Field(min_length=1, max_length=40)]


class ChatDelta(ContractModel):
    type: Literal["delta"]
    text: str


class ChatToolEvent(ContractModel):
    type: Literal["tool"]
    name: ChatToolName
    label: str  # human status, e.g. "Looking up the Nov 3 session"


class ChatDone(ContractModel):
    type: Literal["done"]
    model: str


class ChatErrorEvent(ContractModel):
    type: Literal["error"]
    code: Literal["chat_unavailable", "invalid_request"]
    message: str


# POST /api/chat streams these as Server-Sent Events: one `data: <json>\n\n` per event,
# ending with exactly one `done` or `error`.
ChatStreamEvent = Annotated[
    ChatDelta | ChatToolEvent | ChatDone | ChatErrorEvent, Field(discriminator="type")
]


class ChatToolIn(ContractModel):
    args: dict[str, JsonValue] = {}


class ChatToolResult(ContractModel):
    name: ChatToolName
    result: dict[str, JsonValue]


class ChatVoiceToken(ContractModel):
    token: str
    expires_at: str
    model: str
    voice: str
    # When set, the browser sends this as the first (silent) client turn after connecting:
    # the patient record, if it is too large for the token's locked system instruction.
    context: str | None
