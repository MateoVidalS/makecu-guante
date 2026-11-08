# V6: "How memo uses Gemini" (scene `gemini`, 432 f = 6 bars, starts at 100.8 s)

Read `handoffs/video/README.md` first (design direction; **never call the device a glove**). You own `src/scenes/Gemini.tsx` and
`src/components/gemini/**`. Copy: `COPY.gemini` in `src/script.ts`; VO lines `ai-1`…`ai-4` (frames in `VO`). Keep the bottom 180 px
free while a VO line plays (captions). This scene matters for the MLH Gemini challenge: it must be **accurate** and **legible**.

## Facts (verified in the repo; do not invent others)
- Voice coach = **Gemini Live** (`gemini-3.8-live`, native audio, voice Puck) running **in the browser** via `@google/genai`.
  The backend mints a **single-use ephemeral token** (`client.auth_tokens.create`, uses 1, 30 min) so the API key never reaches the
  browser (`backend/app/voice/gemini_live.py`).
- **Function calling**: 20 tools declared in `backend/app/voice/tools.py` (`"Only bounded runtime actions; the model never receives
  motor controls."`). Tools include get_live_state, adjust_help, assist_finger_now, adjust_target, highlight_finger, record_feeling,
  note_for_therapist, add_rest, choose_next_pose, intensify, brake, pause/resume/skip/stop, undo_last_adjustment.
- Every tool call goes to the runtime's coach control API, which **clamps** the args to fixed safe limits
  (e.g. adjust_help: help starts 1 s sooner/later within 1–9 s; assist speed never above 0.20/s), applies at the next phase boundary,
  **logs** requested vs. clamped args with the reason, and shows it on screen with **Undo** (`docs/plan/13-ai-therapist.md`).
- **Stop and pain words** ("stop", "it hurts", "me duele"…) are matched **locally**, before Gemini answers
  (`frontend/src/voice/patientSafety.ts`). Pain ≥ 4/10 → release + pause.
- **Gemini text** writes the patient and therapist summaries (`gemini-4-argon` with fallback to 3.8/3.5 flash).
- **Doctor chat**: Gemini with **6 read-only tools** over the record (get_session, get_transcript, get_evaluation, compare, find,
  show_chart; `backend/app/chat/tools.py`).
- **This video**: the voice-over is **Gemini TTS** (`gemini-3.8-flash-tts`, voice Sulafat).

## Choreography (scene-relative frames; 1 beat = 18 f)
1. **0–132, VO ai-1** ("Under the hood, the coach is Gemini Live, with function calling."): title `COPY.gemini.title` (h1) top-left.
   A horizontal flow of 5 app-style cards (`COPY.gemini.flow`): Patient speaks → **Gemini Live** → Tool call → Runtime clamps →
   Session engine. Lines draw on the beat (`@remotion/paths` evolvePath). A small memo-blue audio waveform lives in the Gemini Live card.
2. **132–252, VO ai-2** ("Twenty tools. Every call is clamped, logged, and undoable."): the Tool call card expands into a code chip in
   the mono font: `COPY.gemini.exampleCall`, typed in over ~18 f. Then a "clamp" moment: the chip passes through the Runtime card
   and comes out with a tiny **"clamped · logged · Undo"** row (an Undo button styled like the app's secondary button).
   Behind, a grid of tool-name chips (`COPY.gemini.tools`, mono, c.surface2, 1 px border) fades in, with `COPY.gemini.toolCount` (h3).
3. **252–318, VO ai-3** ("None of them moves a motor."): the motor/servo side of the diagram (a small "5 micro servos" node at the far
   right, beyond the engine) gets a **lock** state: a thin ink line between the tool grid and the servos is visibly cut. Under it, the
   local rule `COPY.gemini.localRule` at body size with a small "on the laptop" tag. Keep red out of this frame (nothing is unsafe).
4. **318–432, VO ai-4** ("Gemini also writes the summaries, and voiced this video."): cut to four cards in a row (`COPY.gemini.uses`):
   Gemini Live · Gemini text · Doctor chat · Gemini TTS, each with a tiny icon (2 px round stroke). Each arrives on a beat; the last
   card ("The voice-over in this video") gets the memo-blue 3 px outline. Hold to the bar.

Look: paper background, ink text, white cards with hairlines, one memo-blue accent per frame. No Google logo, no Gemini sparkle
logo (trademark); the word "Gemini" in our type is fine. Motion: `ease`, no bounce.

## Acceptance
- [ ] `scene-gemini` renders alone and in `Main`; `pnpm check` green; no hex outside tokens.
- [ ] Stills in `evidence/V6/` for each of the 4 beats; every fact on screen traceable to the list above.
- [ ] PR `V6: How memo uses Gemini` into `MateoVidalS/video`; do not merge.
