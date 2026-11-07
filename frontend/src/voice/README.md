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

Mic mute affects patient audio only. Simple voice uses local fixed phrases and
session buttons; speech commands require Live coach. Off disables coaching.
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
