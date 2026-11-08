"""Gemini text boundary. Provider exceptions and credentials never enter API errors."""

import json
import re
import time
from datetime import datetime, timezone

from fastapi import HTTPException
from google import genai
from google.genai import types

from app.config import settings
from app.contracts.types import Summary
from app.llm.gemini import (
    COMMON,
    TOTAL_BUDGET_S,
    _cool,
    _cooling,
    _models,
    _plain,
    _retry_after,
    _transient,
)

SESSION_PROMPT = (
    COMMON
    + """
Write a warm, concise patient-facing session summary in at most 80 words (aim for 60-70;
never more than 80). Use second person, simple words and at most three numbers.
Acknowledge effort, compare with the previous session only when supplied, and mention
the evaluation trend if available, using its in_words phrasing. Do not show mA. If today is
about the same as last time, say so kindly and point to the longer-term change since the first
opening session instead. Mention at most two fingers by name.
Briefly acknowledge reported comfort or fatigue and relevant changes to help, time or rest.
If supplied, connect progress to one of the patient's goals in a few words.
If a resistance stop or a brake happened, say calmly in one short sentence that the glove
eased off or paused to keep you safe. Use the word "estimate" at most once, naturally.
Write one or two short paragraphs.
"""
)
THERAPIST_PROMPT = (
    COMMON
    + """
Write a therapist summary in at most 250 words (aim for about 200; never more than 250) with
these headings:
Practice, Active range, Assistance, Resistance, Safety, Notes for therapist.
Put each heading alone on its own line followed by a colon (for example "Practice:"), then
one short paragraph. Cover adherence, per-finger active-range trends, assistance, slow/fast
resistance and velocity dependence, and safety events. Clearly state when data is insufficient
for a comparison. Give opening as percentages and resistance in mA. In Active range, give
the change within the window and since the first opening session, naming the fingers that
gained most and least. Write one to three sentences per heading. Never list all five fingers'
values in one sentence: give numbers only for the one or two fingers that matter most and
describe the rest in words. Do not open with a disclaimer sentence beyond saying it is demo
data when so.
Include pain/fatigue trends and patient notes, the reasons for coach adjustments, brakes,
rejected calls and undo actions in Safety or Notes for therapist, when supplied.
"""
)

WORD_LIMITS = {"session": 80, "therapist": 250}
SHORTEN = """Shorten the summary below to about {target} words (never more than {limit}).
Keep the same headings, the
same facts and numbers that matter most, and the demo-data statement if present. Drop the
least important details. Plain text only. Reply with the shortened summary only."""

_SENTENCE = re.compile(r"(?<=[.!?])\s+")


def _fit(text: str, limit: int) -> str:
    """Last resort for a model that ignores the word limit: drop whole trailing sentences.

    Each heading keeps at least its first sentence, so the therapist report keeps its shape.
    """
    if len(text.split()) <= limit:
        return text
    sections = []  # (heading or None, [sentences])
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = block.strip().split("\n", 1)
        if len(lines) == 2 and lines[0].rstrip().endswith(":") and len(lines[0].split()) <= 4:
            heading, body = lines[0].strip(), lines[1]
        else:
            heading, body = None, block
        sections.append((heading, _SENTENCE.split(body.strip())))

    def words():
        return sum(len((h or "").split()) + len(" ".join(b).split()) for h, b in sections)

    while words() > limit:
        longest = max(sections, key=lambda s: len(" ".join(s[1]).split()) if len(s[1]) > 1 else 0)
        if len(longest[1]) <= 1:
            break
        longest[1].pop()
    return "\n\n".join((f"{h}\n" if h else "") + " ".join(b) for h, b in sections if b or h).strip()


def generate_summary(kind: str, context: dict) -> Summary:
    if not settings.gemini_api_key:
        _unavailable()
    prompt = SESSION_PROMPT if kind == "session" else THERAPIST_PROMPT
    contents = json.dumps(context, allow_nan=False)
    text, used = "", None
    deadline = time.monotonic() + TOTAL_BUDGET_S
    attempt_s = max(5.0, settings.gemini_text_attempt_timeout_s)
    try:
        # SDK timeouts are milliseconds. SDK retries are off; we fall back across models instead,
        # because a busy model (503), an exhausted quota (429) or a slow thinking model (504)
        # usually recovers on another one.
        with genai.Client(
            api_key=settings.gemini_api_key,
            http_options=types.HttpOptions(
                timeout=int(TOTAL_BUDGET_S * 1000), retry_options=types.HttpRetryOptions(attempts=1)
            ),
        ) as client:

            def ask(model: str, budget: float, body: str = contents, system: str = prompt) -> str:
                response = client.models.generate_content(
                    model=model,
                    contents=body,
                    config=types.GenerateContentConfig(
                        system_instruction=system,
                        temperature=0.2,
                        # Summaries are short; low thinking keeps them well inside the deadline.
                        thinking_config=types.ThinkingConfig(thinking_level="low"),
                        http_options=types.HttpOptions(timeout=int(budget * 1000)),
                    ),
                )
                return _plain(response.text or "")

            models = _models()
            soonest: tuple[float, str] | None = None  # a model that only hit a per-minute limit
            for position, model in enumerate(models):
                remaining = deadline - time.monotonic()
                if remaining < 3:
                    break
                last = position == len(models) - 1
                try:
                    text = ask(model, remaining if last else min(attempt_s, remaining))
                except Exception as error:  # noqa: BLE001 - redacted below, never surfaced
                    _cool(model, error)
                    if not _transient(error):
                        raise
                    wait = _retry_after(error)
                    if wait is not None and wait < 60 and (soonest is None or wait < soonest[0]):
                        soonest = (wait, model)
                    continue
                if text:
                    used = model
                    _cooling.pop(model, None)
                    break
            # Every model failed, but one asked us to wait a few seconds: wait once and retry it.
            if not used and soonest and soonest[0] + 5 < deadline - time.monotonic():
                time.sleep(soonest[0] + 0.5)
                text = ask(soonest[1], deadline - time.monotonic())
                used = soonest[1] if text else None
                if used:
                    _cooling.pop(used, None)
            # Smaller fallback models can overrun the word limit: ask once for a tighter version.
            limit = WORD_LIMITS.get(kind)
            if used and limit and len(text.split()) > limit and deadline - time.monotonic() > 5:
                try:
                    shorter = ask(
                        used,
                        deadline - time.monotonic(),
                        body=text,
                        system=prompt + "\n" + SHORTEN.format(limit=limit, target=limit * 4 // 5),
                    )
                except Exception:  # noqa: BLE001 - keep the longer, valid summary
                    shorter = ""
                if shorter and len(shorter.split()) < len(text.split()):
                    text = shorter
            if used and limit:
                text = _fit(text, limit)
        if not text or used is None or settings.gemini_api_key in text:
            _unavailable()
        # Demo data must always say so, even when a model forgets.
        demo = context.get("is_demo") or context.get("only_demo")
        if demo and "demo" not in text.lower():
            text = f"This is demo data. {text}"
    except Exception:
        # Never return or log provider exception text: it can contain credentials/request URLs.
        _unavailable()
    return Summary(
        id=0,
        kind=kind,
        created_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        session_id=None,
        days=None,
        model=used,
        text=text,
    )


def _unavailable():
    raise HTTPException(503, {"code": "llm_unavailable", "message": "Summary unavailable"})
