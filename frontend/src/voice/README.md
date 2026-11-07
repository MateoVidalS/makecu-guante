# Voice coach

`VoiceProvider` belongs inside `RuntimeProvider`. It owns one exercise-event
subscription. Pages call `start(sessionId)` after starting the runtime, and
`stop()` when leaving the session. `useVoice` returns stable action functions,
so an unmount effect can depend on `stop` safely. Never forward engine events
from a page, and never attach voice tools directly to glove methods.

The default mode is Live coach. Missing credentials immediately select Simple
voice. Other connection failures retry after 1, 3, and 6 seconds, obtaining a
fresh token each time. Three failed reconnects select Simple voice visibly.
Successful reconnects reset the failure count. Token requests and Live setup
have 15-second deadlines. Periodic server GoAway messages reconnect with current
pose, movement, previous-session and recent-event context. Context compression
is enabled; reconnect starts a fresh model session rather than resuming a handle.

Finger names are centralized in `fingerNames.ts` (and `finger_names.py` for the
server prompt): thumb, index, middle, ring, little finger. Context pushes keep
only unmet targets and fingers needing assistance; opening targets use lower
closure as better. Attempt comparisons require the same pose and target, and
missing measurements are never filled with zero. Start/reconnect and session
recaps use compact summaries rather than raw five-finger JSON.

Mic mute affects patient audio only. Simple voice uses fixed phrases and browser
SpeechRecognition for local stop/pain transcription checks. Other voice commands
require Live coach. Off disables coaching and transcription. Recognition needs
microphone permission and browser support; the browser may use its own network
service, so offline speech recognition is not guaranteed. Its language follows
the browser (English or Spanish). The deterministic EN/ES word rule itself is
local in both modes; physical STOP and firmware safety remain independent.
Local safety earcons, speech and captions remain armed in every mode, even before
`start`. User interaction unlocks WebAudio; platform speech synthesis and a local
English voice must be available. Safety speech survives the following PAUSED
event and takes precedence over Live playback, captions and encouragement.

Transcriptions are accumulated into utterances, then saved every ten seconds and
at session end/stop. Failed batches remain in memory and retry while the provider
is mounted, including after stop. The panel reports pending saves. Closing the
page can lose unsaved lines; there is no durable offline transcript outbox.

## Verification

Run `make test` and `make build`. Voice tests cover the Google SDK adapter,
configuration serialization, tool dispatch, safety event timing, cue scheduling,
16 kHz capture from 44.1/48 kHz, 24 kHz playback/flush, transcript retries, and
connection/fallback behavior. Backend tests exercise profile/previous-session
context and transcript persistence against the merged WP5 storage APIs.
The F6 prompt snapshot and naming tests live inside the owned backend voice
directory. Run them explicitly with
`cd backend && uv run pytest -q app/voice/test_prompt.py`.

For the browser check, run `make dev-sim`, then from `frontend`:

```sh
HEADED=1 CHROME=1 node src/voice/browser-check.mjs http://127.0.0.1:5173
```

Use the port Vite prints if another workspace is already using 5173. This check
requires no Gemini key: it mounts an isolated QA provider, observes the real 503
fallback and panel, captures a synthetic microphone, loads both AudioWorklets,
then takes the browser offline and injects a safety event followed by PAUSED.
Chrome must be installed for `CHROME=1`; omit it to use Playwright Chromium.
The QA harness is imported only by this script and is excluded from the app's
production import graph. Screenshots/timing output go to `/tmp/wp8-*`.

[evidence/browser-check.json](evidence/browser-check.json) records the headed
Chrome run; [evidence/browser-check.png](evidence/browser-check.png) shows its
coach panel. WebAudio scheduling and speech synthesis `start` events measure
browser/platform onset; this is not an acoustic loopback measurement. Fake-timer
tests also verify synchronous safety dispatch for every source.

A real keyed Gemini conversation remains to be run by the team. No API key was
configured in the worker environment. With a key, verify a greeting, each PRESENT
instruction, debriefs, “pause” and “how am I doing”, then inspect the stored
session transcript. The exercise page is owned by WP7 and must call the exposed
start/stop actions; its scaffold does not start voice itself.

## AI therapy assistant (A2)

All eight therapy tools dispatch exclusively through `Runtime.therapy` using the
frozen `TherapyApi`. Runtime decisions return `ok`, `reason` and the full decision
(including requested/applied values) so the coach can describe clamping or
rejection accurately. No voice tool changes calibration, current limits or motors.
Until A1 supplies therapy, new tools return unavailable; the local brake uses the
existing runtime pause/release path. Tests provide a local TherapyApi stub; no
runtime or contract files were changed.

Connected Live sessions send `[live]` snapshots once per second in ATTEMPT,
ASSIST and HOLD with per-finger percentages, target, best-alone, lagging/helping,
adjustments and recent feelings. Null measurements stay unknown. These updates
never complete a turn or request speech. Every third non-interrupted attempt
index requests a pain/fatigue check-in in its debrief. Simple voice asks the same
question. An unlabeled pain answer is recognized for 30 seconds after the prompt;
explicit pain ratings are recognized throughout practice. Live coach records both
ratings with `record_feeling`; Simple voice handles safety words and ratings but
does not infer/store a complete feeling entry from an incomplete answer.

Stop/enough/it hurts and para/basta/me duele, plus explicit pain ratings >= 4,
call the runtime brake synchronously on interim patient text. Word boundaries
avoid matches inside other words; a recognized stop word always wins, even in a
negated phrase. Live deltas accumulate; browser interim hypotheses replace.
Patient transcription is delivered before audio/tools from the same server
message. Local braking clears pending cues/playback, announces safety, records a
system transcript line, and blocks stale resume/adjustment tools. A completed,
affirmative request to continue or a runtime phase change after UI resume clears
that voice guard; the runtime still performs its safety checks.

Google docs checked for this update:
[Live tools](https://ai.google.dev/gemini-api/docs/live-api/tools),
[capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities), and
[ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens).
The existing v1beta constrained-token connection, matching tool response IDs,
16 kHz PCM input and transcriptions remain compatible. Therapy schemas stay
synchronous; this update adds no SDK dependency or connection configuration.

Run voice unit tests with `cd frontend && pnpm test --run src/voice` and the
owned backend prompt/schema tests with
`cd backend && uv run pytest -q app/voice/test_prompt.py app/voice/test_tools.py`.
A keyed live conversation and hardware validation remain team checks; no API key
or physical glove was used by A2.

The A2 headed Chrome check is saved in
[evidence/a2-browser-check.json](evidence/a2-browser-check.json) and
[evidence/a2-browser-check.png](evidence/a2-browser-check.png). On this run the
safety earcon was scheduled in 1.2 ms, platform speech started in 25.6 ms, and an
injected Spanish patient transcription (`me duele`) reached the fallback runtime
brake in 1.8 ms with the browser offline. This validates the recognized-text path;
it does not claim offline speech-to-text support. The Simple voice microphone
switch remains available so the patient can mute recognition.

Every executed Live tool request and result is also saved as a system transcript
line, including read/legacy tools and voice-level rejections; mutation responses
carry the runtime decision's requested/applied values and reason.
