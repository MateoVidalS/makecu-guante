# WP8 — Voice: Gemini Live coach, local safety net, fallback

**Goal:** a warm, concise, hands-free voice coach on Gemini Live, with safety announcements that **never wait for the network**.

**Read:** `AGENTS.md`, **`docs/plan/07-voice-and-ai.md` (all)**, `docs/plan/03-contracts.md §3–4` (EngineEvent, runtime, VoiceToken),
`docs/plan/11-ux-design.md §5.4, §6` (coach panel and voice/visual coordination).
**First step:** read Google's **current** Gemini Live API docs (ephemeral tokens, the JS SDK live connect, audio formats, VAD, transcription, tools, session limits)
and note any differences from the plan in the PR.

**You own:** `frontend/src/voice/**`, `backend/app/voice/**`, `backend/app/api/voice.py`, and their tests.

## Deliverables
- [ ] Backend: `voice/gemini_live.py` (ephemeral token creation, locked to the model and config), `voice/prompt.py`, `voice/tools.py`, `api/voice.py` (`POST /api/voice/token`,
      503 without a key). Reads the profile and last session via the WP5 repo functions (wrap them until WP5 merges).
- [ ] Frontend: a `LiveTransport` interface + `GeminiLiveTransport` + `FakeTransport`; AudioWorklets (mic 16 kHz PCM16 capture, 24 kHz player with
      flush on interrupt); `cues.ts` (§4 table + rate limiter); `safetyNet.ts` (earcons + `speechSynthesis`, synchronous on events); `fallbackCoach.ts`;
      `tools.ts` → runtime calls; transcript batching; `VoiceProvider`/`useVoice` (`status`, `mode: "live" | "simple" | "off"`, `muted`, `lastCoachLine`,
      `lastPatientLine`, `start(sessionId)`, `stop()`, `setMode`, `setMuted`) replacing the WP0 stub; `CoachPanel` per `11-ux-design.md §5.4`.
- [ ] Hook-up: `VoiceProvider` subscribes to `runtime.exercise.onEvent` itself, so pages only call `start`/`stop`.

## Acceptance criteria
- [ ] With a key and `make dev-sim`: greeting, the pose instruction on each PRESENT, a debrief after attempts, "pause" / "how am I doing" work; the transcript is saved.
      Describe a run (or attach a recording) in the PR.
- [ ] Safety event → earcon starts in < 50 ms and the phrase starts in < 300 ms (measured with fake timers + a real browser manual check).
- [ ] Without a key, or after 3 failed reconnects → Simple voice, automatically and visibly.
- [ ] The API key never reaches the browser (tested). `make test` is green.
