# 07 — Voice coach (Gemini Live) and summaries (Gemini)

Code: `frontend/src/voice/` + `backend/app/voice/` (WP8), `backend/app/llm/` (WP5). English. Warm, concise.

> ⚠️ The Gemini Live API (endpoint, ephemeral tokens, message shapes, model and voice names) changes often. **WP8 must read
> the current Google docs first** and adapt the wire details below; the design stays the same.

## 1. Layers

| Layer | When | How |
|---|---|---|
| **Safety net** (local, always on) | Safety events (overcurrent, STOP, watchdog, camera lost, disconnect) and resistance | An immediate earcon (WebAudio) + a fixed phrase through `speechSynthesis`, e.g. "Stopping. I felt resistance in your index." It **never waits for the network**. The same event is also sent to Gemini Live as context, and the coach is told not to repeat the safety sentence |
| **Gemini Live coach** | Session start, each PRESENT (instruction), short encouragement during ATTEMPT, debrief after each attempt, questions between attempts, end-of-session recap | A streaming voice session from the browser |
| **Fixed-phrase fallback** | No `GEMINI_API_KEY`, Live fails 3 times, or the user picks "Simple voice" | `speechSynthesis` with a phrase table (§6) |
| **Gemini text** (backend) | Session summary (patient-facing) and therapist summary | `POST /api/summaries` (WP5) |

## 2. Gemini Live connection
1. On session start the browser calls `POST /api/voice/token {session_id}`. The backend (`voice/gemini_live.py`) creates a **short-lived
   ephemeral token** with the Gemini API (`google-genai` auth tokens, limited to 1 use and ~30 min, locked to the Live model and config) and returns
   `VoiceToken` (token, model, voice, system instruction, tools). **The API key never reaches the browser.**
2. The browser opens the Live WebSocket with the token (`@google/genai` JS SDK `ai.live.connect` with the ephemeral token, or the raw
   WebSocket per the docs). Config: audio response modality, the voice from the token, input + output transcription on, automatic
   voice activity detection (barge-in allowed), the system instruction, the tools.
3. Mic: `getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}})` → an AudioWorklet downsamples to **16 kHz PCM16**
   → `sendRealtimeInput`. Output: 24 kHz PCM16 chunks → an AudioWorklet player with a small jitter buffer. Interrupt → flush the player.
4. Mic mute toggle; the coach can be "Paused" (no context pushes) without disconnecting.
5. Reconnect on drop (backoff 1/3/6 s, a new token each time) → after 3 failures → fallback. Sessions over the Live session time limit
   (check the docs) → reconnect transparently, re-sending a compact context summary.

## 3. System instruction (`backend/app/voice/prompt.py`)
```
You are Coach, a warm, concise voice coach for hand rehabilitation after a stroke. The patient wears a robotic glove
that assists all five fingers (thumb, index, middle, ring and little finger), and a camera measures how far each finger closes.
You receive short updates prefixed with [session] and [safety].

How it works: for each exercise the patient first tries alone; if they can't reach the position, the glove gently
completes it. Effort matters more than reaching the position.

Rules:
- When a pose is presented, say the instruction in one short sentence ("Let's make a hook. Give it a try.").
- During an attempt, at most one short encouragement ("Keep going", "A little more with your index").
- After an attempt: one sentence of honest, encouraging feedback using the numbers you were given, rounded
  ("Your index closed to about 55% on its own, better than last time").
- Every third attempt or so, ask one short question ("How did that feel?") and listen.
- [safety] messages are already announced by the app. Don't repeat them; acknowledge calmly and ask if they're OK.
- Never give medical advice or diagnoses. If asked, suggest talking to their therapist.
- Use the patient's name ({pseudonym}) occasionally. English only.
- Use tools when the patient asks to pause, continue, skip, repeat, stop, or asks how they're doing.
{goals_line}
```

## 4. Context pushes (`frontend/src/voice/cues.ts`, a pure function of engine events)

Sent as text turns (`sendClientContent` with `turnComplete` set as noted; a turn-complete push makes the model speak):

| Engine event | Text | Speak now? |
|---|---|---|
| session start | `[session] Starting: 5 poses × 3 reps. Last session: active closure index 40%, middle 52%, thumb 35%.` | yes (greeting) |
| `phase PRESENT` | `[session] Pose 2 of 5: hook, rep 1 of 3. Instruction: "Make a hook: bend the top two joints".` | yes |
| `phase ATTEMPT` | `[session] Attempt started.` | no |
| `progress` (≥ +0.1 since the last push, ≤ 1 per 3 s) | `[session] Index now at 45% (target 60%).` | only if 4 s passed since the coach last spoke |
| `reached{assisted:false}` | `[session] Reached the position on their own in 2.1 s.` | yes |
| `assist_started` | `[session] Not reached alone (index 40%/60%). The glove is helping now.` | yes |
| `attempt_done` | `[session] Result: active index 40%, middle 52%, thumb n/a; glove helped 20% on index. Previous rep: index 35%.` | yes (debrief) |
| `safety` / `resistance` | `[safety] Overcurrent: resistance in the index finger. The glove released.` | no (the safety net already spoke) |
| `session_done` | `[session] Session complete. Summary: … Compared with last session: …` | yes (recap) |

**Rate limit:** at most one spoken push per 2.5 s; newer non-critical pushes replace pending ones; never trigger speech while the patient
is talking (VAD state from the server) unless it's PRESENT.

## 5. Tools (function calling)
`pause_session`, `resume_session`, `skip_pose`, `repeat_instruction`, `stop_session` (the coach confirms first, unless it's clearly stop),
`get_progress` (returns the current session's per-finger active ratios + the previous session's). They're executed by the runtime
(`useRuntime().exercise.*`), and the result is returned as a tool response.

## 6. Fixed-phrase table (fallback + safety net)
Safety: overcurrent "Stopping. I felt resistance{ in your index}." · STOP "Stopped. Press release when you're ready." · watchdog
or disconnect "The glove disconnected. It has released." · camera lost "I can't see your hand. Pausing."
Fallback coaching: PRESENT → the pose instruction · reached "Great, hold it." · assist "Good effort. The glove will help now." · attempt end
"Nice work." · session end "Session done. Well done today."

## 7. Transcripts
Input and output transcriptions + safety phrases → `TranscriptLine`s, batched to `POST /api/sessions/{id}/transcript` every 10 s and at the end.

## 8. Summaries (backend, WP5, `app/llm/summaries.py`)
- **Session summary** (patient-facing, ≤ 80 words): the input is the `SessionSummary` + the previous session + the evaluation trend if any.
  It's shown on the session-done screen and read by the coach.
- **Therapist summary** (≤ 250 words, headings *Practice*, *Active range*, *Assistance*, *Resistance*, *Safety*, *Notes for therapist*): the input is
  a digest over N days (per-finger active-range trends, assist needed, evaluation resistance slow/fast, safety events, adherence).
- Framing: "estimate inspired by clinical practice", never "validated"; no diagnosis. Demo sessions are excluded unless the digest
  has only demo data (then say so).
- The `google-genai` Python SDK, a 30 s timeout, missing key → 503 `llm_unavailable`.

## 9. Tests
Cues: the table rows and the rate limiter (pure, vitest). Safety net: the phrase and earcon are triggered synchronously on the event (a fake
`speechSynthesis`). Live client: a `LiveTransport` interface with a fake transport; tool dispatch round trip; reconnect → fallback.
Backend: the token endpoint with mocked Google (respx or SDK monkeypatch), the prompt rendering snapshot, summaries with a mocked model, 503s.
