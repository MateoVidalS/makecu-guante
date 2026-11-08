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

AI therapy controls are always available on `RehabRuntime.therapy` and the UI-only
`ScriptedRuntime.therapy`. The owned runtime module exports a `Runtime` type with
required `therapy`; removing the optional marker in the shared runtime contract
remains a coordinator change. The coordinator-owned therapist contract is used unchanged.

The exercise engine owns the bounded policy. More/less help changes each finger's
wait before help starts, within 1–9 seconds; more waits for the next ATTEMPT and
less can defer current help immediately. Gentler lowers assist speed by 0.05/s,
within 0.10–0.20/s, immediately. A lower initial baseline stays lower during ordinary
practice. `assist_finger_now` is accepted only during ATTEMPT with enabled assistance,
visible finite vision and safe telemetry/current, and uses the same 150 ms stagger
and three-motor cap. Other fingers retain their measured position while queued.
A finger's movement after help starts is excluded from its best-alone measurement.

Target shaping scales a pose target by 0.5–1.0 at the next ATTEMPT, including its
rendered joint angles. Attempt duration also waits for ATTEMPT, rest for REST, and
next-pose selection for PRESENT. `repeat_pose` inserts at most three extra repetitions
after the current attempt; only this tool changes plan length. Highlights expire
four seconds after the request. Clinical notes are `note_for_therapist` audit records,
so the existing replay and summary storage can retain their exact text.

Only `intensify` may exceed the gentle defaults. It requires a quoted, matching
patient request or affirmative response from the latest patient turn, reported by
`notePatientSpeech` within 20 seconds. A2 should report every patient line; omit the
optional timestamp or supply the runtime's monotonic clock in milliseconds, never
UTC milliseconds. Future/stale timestamps, unrelated quotes and explicit negative
responses cannot grant consent. Pending intensity expires if consent becomes stale
before the next ATTEMPT. A new patient turn supersedes the previous one.

With consent, `further` permits that finger's target up to 1.0 of its calibrated range,
`faster` permits at most 0.30/s independently of baseline gentleness, and `hold_longer`
adds at most two seconds to the hold. The current limit and calibration are never
writable through therapy tools. Pain at least 2 or resistance on the finger within
60 seconds blocks intensity. New pain, resistance, a safety stop or consent withdrawal
reverts intensity; speed/target reductions are immediate, and no Undo can resurrect
an automatically revoked permission. Recent pain/resistance blocks survive session
restart. A resistance event also lowers the affected finger's gentle speed ceiling.

Undo acts at the affected boundary and never resumes a paused session. An immediate
help request can be canceled at the next boundary, without retrospectively erasing
its assisted metrics. Consumed rest/repetitions cannot be undone or refunded into
fresh budgets. A brake releases synchronously before audit observers or storage.
Pain at least 4 applies that release/pause policy even with malformed remaining
feeling fields. Braking evaluation or friction never restores a higher current limit.
`coach_brake` is recorded in attempt safety events and decisions; adding it to the
shared engine event source union remains a coordinator change.

Live state includes five-finger targets/best-alone/help/lag, glove state/current/source,
last safety event, highlighted finger, intensity flags and latest feeling. Decisions
and feelings enter the durable queue before session end, receive the eventual real
session ID, and post to A3's endpoints. A pending local feeling uses session_id 0 until
creation succeeds; that placeholder is never posted. Distinct feeling reports have
strictly increasing timestamps to preserve A3's retry identity. Unavailable endpoints
leave the queue Offline and retry normally. Broken audit/UI observers cannot stop
release or engine safety actions; records remain in the session's local audit log.
