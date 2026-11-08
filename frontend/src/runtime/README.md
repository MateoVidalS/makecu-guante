# Runtime integration

`RehabRuntime` is the production runtime. `RuntimeProvider` takes the shared
GloveProvider and VisionProvider controllers and mounts/disposes subscriptions.
`ScriptedRuntime` remains an explicitly injected page/voice test fixture only.

- Vision frames, glove telemetry, glove events and connection changes tick the
  exercise/evaluation engines. A 100 ms heartbeat also detects a stalled camera.
  Engine time uses the SimWorld clock with simulated sources, including 3× runs;
  real sources use `performance.now()`. UTC timestamps map from that clock.
- Commands go through GloveClient, which owns follow coalescing, release priority,
  stale-motion cancellation and keepalives. Runtime adds no movement queue.
- Phase events set simulated patient intent. The same events feed the voice
  controller and UI, including the always-armed local safety net in Voice Off. All glove arrays use
  thumb/index/middle/ring/pinky order.
- A reconnect or firmware boot sends release, five saved servo ranges, and the
  appropriate current limit. Calibration and switches to physical sources are locked during an
  exercise, paused session, evaluation, or friction sweep. Switching to a simulator
  first ends and saves the run and releases the glove; no movement resumes.
- First-use friction calibration can run without a patient calibration or visible
  hand: the empty glove is off the hand. Firmware calibration/current/STOP/watchdog
  protection remains in effect. Patient evaluation still requires vision.

## Saving

The ordered retry queue stores session creation, attempts (including 20 Hz
traces), the end marker, and evaluations. Creates resolve their dependent writes
through local session keys. Each write is saved to localStorage before sending;
failed writes remain queued and retry every two seconds. The browser never waits
for storage to start, pause, resume, stop or finish a session. Query caches are
invalidated after successful writes, and the patient recap waits for saving.

The header shows Saving… / Saved / Offline. A storage failure keeps writes in
memory; keep the tab open in that case. Restarting the page retries saved writes
but never resumes movement. Calibration has a separate cache for offline use;
new calibration must be saved successfully before it is used for sessions.

The frozen REST contract has no idempotency keys. Retries are **at least once**:
if a response is lost after the server commits, a retry can duplicate a session,
attempt or evaluation. Do not present this queue as exactly-once storage. A
contract extension for idempotency is requested in the WP10 PR.

## Simulator and diagnostics

The calibration page offers known model ranges only when both sources are
simulated. It never substitutes those values for a real glove or camera. The header’s Demo tools menu includes simulator-only rigid-finger selection
and toggles for the resistance demo.
`VITE_SIM_SPEED` defaults to 1; Playwright sets it to 3.

Setup displays rolling p95 vision-to-command and command-to-telemetry-echo values
(last 256 samples each). CameraVision also exposes camera-to-frame and inference
p95. Simulator vision ages use simulated time; command echoes use wall time.
An echo matches firmware mode and goal and includes client queuing; it is not a
measurement of physical servo position. Physical camera/display and USB latency
still need the team's bench/manual checks.

## Verification

From the repository root:

```sh
make test
make e2e
```

`runtime.test.ts` uses a deterministic moderate SimWorld and mocked API, including
all 15 default attempts, assist flags, safety/recovery, offline retry, reconnect,
physical-source locks, simulator recovery and first-use friction. `backend.test.ts` starts a real FastAPI server
on a free port with temporary SQLite storage and verifies traces, history,
evaluation and export. It requires the normal `make setup` uv environment.

Playwright runs `make dev-sim` on isolated ports (5178/8008 by default), a temporary
database, a 3× simulator, no Gemini key, and fake browser media. Its main flow
calibrates the simulator, performs the full plan, provokes rigid-index overcurrent,
checks the local spoken safety phrase, resumes, checks the saved summary and
history, renders replay, runs evaluation, opens Doctor view and downloads export.
Only the Gemini session summary response is mocked. A separate browser test
checks that an unavailable backend never blocks completion and that saving recovers.

For a 20-minute browser runtime soak, use a separate terminal:

```sh
REHAB_FRONTEND_PORT=5278 REHAB_PORT=8108 \
  REHAB_DB_PATH=/tmp/rehab-soak.db GEMINI_API_KEY='' make dev-sim
cd frontend
node e2e/soak.mjs
```

The development-only `/e2e/soak.html` entry exercises the real runtime/controllers
and API at 3× speed: two full default sessions and one evaluation, followed by
continued vision/telemetry traffic until 20 minutes of wall time. It does not mount
React pages. The driver samples retained JavaScript heap after explicit GC every
30 seconds, records browser errors and saving state, and writes
`frontend/e2e/soak-result.json`. The acceptance threshold is 50 MiB growth. Set
`REHAB_SOAK_URL` for another server; `REHAB_SOAK_MS` is only for runner diagnostics,
not the acceptance run.

The header’s **Demo tools** menu is available during focus mode. Glove/camera
fallback ends the run before replacing a source, preserving demo provenance. It
can also reconnect an unplugged simulator or restart simulated vision. Simple
voice switches immediately without ending practice. See `docs/DEMO.md`.

F9 verification, rigid-finger baseline regression, calibration-range validation,
friction abort behavior and the repeated 20-minute soak runner are documented in
[`docs/DEV.md`](../../../docs/DEV.md). The F9 runner writes its own evidence to
`docs/qa/f9-soak.json`; the older WP10 soak evidence is retained unchanged.

Boot `reset_reason: 9` is preserved by the serial codec and displayed in Setup
and runtime status with capacitor/supply guidance. The optional field is additive;
legacy boot messages remain valid, and a later normal boot clears the warning.
