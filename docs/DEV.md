# Rehab Hub development

Rehab Hub runs the five-finger exercise and evaluation engines in the browser,
with either Web Serial + MediaPipe or a shared deterministic SimWorld. FastAPI
stores calibration, attempts, 20 Hz traces, evaluations and summaries in SQLite.
All glove vectors use `[thumb, index, middle, ring, pinky]`; boards reporting any
other finger count are rejected. Old three-finger history remains readable,
with unmeasured ring/little-finger values shown as missing.

## First run

Install Node 20+, pnpm, Python 3.11+ and uv. Use Chrome or Edge for Web Serial.

```sh
make setup
make dev-sim
```

Open <http://127.0.0.1:5173>, visit Calibrate, choose **Calibrate simulator**, then
**Continue to practice**. Known simulator ranges apply only to simulated sources.
Never copy them to hardware. The default plan has fifteen attempts across five
poses; all five fingers are scored. Pinch scores thumb and index. The shell keeps Home/History/Setup navigation;
Exercise and Evaluate are available from Home. **Demo tools** in the header
is the single simulator menu, including patient preset, rigid-finger selection,
STOP, hand hiding and source restart. The camera preview starts hidden. If the USB chooser has no glove, Setup’s
**Simulate glove** replaces only the glove; the selected real camera stays
active. The live **Glove motors** strip shows all five motor states from
telemetry and labels simulated motors.

| Command | Behavior |
| --- | --- |
| `make dev` | FastAPI :8000 + Vite :5173, physical glove/camera selected |
| `make dev-sim` | Same API, simulated glove and patient/camera |
| `make dev-camera` | Simulated glove + real webcam, for glove-detection checks |
| `make dev-mock` | Frontend only, browser MSW fixtures; writes last until reload |
| `make demo-seed` | Explicit, idempotent demo history in the configured SQLite DB |
| `make build` | Typecheck + production frontend into `backend/static/` |
| `VITE_SIM=1 make demo` | Build and serve a simulator demo on :8000 |
| `make test` | Backend/frontend tests, typecheck, lint, optional firmware native tests |
| `make e2e` | Chromium browser integration against an isolated SQLite DB |
| `make fw-build` | Compile ESP32 firmware without flashing |

`make demo-seed DEMO_SEED_ARGS=--reset` replaces flagged demo history and preserves
real records. `make dev-mock` does not use the SQLite demo seed. The API exposes
OpenAPI at `/docs`; storage endpoints are implemented. No seed runs implicitly in
normal development or production. See [DEMO.md](DEMO.md) for a rehearsable flow.

## Laptop webcam and upright-hand checks

Use `make dev-camera` for the day-1 glove detection check with simulated motors
and the real laptop front webcam. Keep physical servo power off for this camera
check; fitting the actual glove to a hand still requires the recorded hardware
gate in [HARDWARE_CHECKLIST.md](HARDWARE_CHECKLIST.md).

Sit facing the laptop, raise the affected hand beside the face with the palm
toward the screen, and open/close toward the camera. Support the elbow on the
table with comfortable padding and keep the forearm vertical. Start about
40–60 cm from the laptop; adjust the screen so the wrist, whole hand and all five
fingertips stay in frame without lifting the elbow. Use diffuse front/side light,
with no window or bright light behind the person. Check the preview for a clearly
lit palm. Use short sets and rests if holding the hand up causes fatigue.

On day 1, check Setup's five-second detection fraction while opening and closing
with the real thin light glove and thin light threads. The front view exposes
palm-side threads, guides and anchors. Record the percentage, occlusions,
configured affected hand, posture and lighting in the hardware checklist; repeat
when event conditions change. Low detection needs light/framing adjustment and
team review before a physical-camera demo.

The committed camera contract defines `CameraView` as `'front_upright'` or
`'front_diagonal'`, with `CURRENT_CAMERA_VIEW = 'front_upright'` and an optional
`view` option in `VisionSource.start`. Missing `CameraCalibration.camera_view` means
legacy `front_diagonal`. Capture fresh open/closed/pinch references for the upright
view instead of reusing old palm-down/diagonal calibration. The configured
affected hand remains authoritative; selfie handedness is a cross-check.

**Hardware question for the team:** the wrist module previously rested on the
table; upright, it hangs from the forearm. Strap fit, hanging weight, thread exit
angle and the effect of gravity on elastic return/servo pull require a recorded
decision after empty-fixture checks, before mounting on a person. See the
hardware checklist; software tests cannot resolve this mechanical question.

## Configuration

Use `backend/.env.example` and `frontend/.env.example` as references; ignored `.env`
files are optional. Keep backend keys out of `VITE_*` variables.

| Variable | Purpose |
| --- | --- |
| `REHAB_DB_PATH` | SQLite file; Make defaults to `backend/data/rehab.db` |
| `REHAB_PORT` / `REHAB_FRONTEND_PORT` | Backend / Vite port (defaults 8000 / 5173); the dev launcher configures the proxy |
| `VITE_SIM=1` | Start with simulated sources |
| `VITE_DEMO=1` | Keep header recovery controls available with physical sources |
| `VITE_VISION=camera` | Override vision only, useful for real gloved-hand detection |
| `VITE_SIM_SPEED` | Simulation clock multiplier; normal use 1, browser tests 3 |
| `VITE_MOCK_API=1` | Enable browser MSW; unset for real backend integration |
| `GEMINI_API_KEY` | Backend-only Gemini access; absent key leaves simple voice available |

Voice/text model settings and fallback order are in `backend/.env.example`.
Check an actual request with the event account; a configured key does not prove
access. Safety speech is local and stays armed with coach Voice mode Off.

## Runtime and safety

`RehabRuntime` connects providers, engines, UI, voice and the persistence queue.
`ScriptedRuntime` is an injected test fixture. Source changes to simulation end and
save the current run, release the old glove, and require a new run. Physical
source/calibration changes are locked during a running or paused session.

Assist starts unreached fingers at least 150 ms apart with at most three motors
moving at once. Targets are capped at 95% of the calibrated range. The firmware
independently enforces speed/range limits, STOP, watchdog and total-current cut-off
(default 1500 mA, maximum 2200 mA, sustained for 100 ms). Per-servo current profiles
are provisional bench estimates; aggregate current is not a force measurement.

The resistance detector requires elevated current, a command/vision gap, and
stalled vision. A baseline sampled after a stall starts must not normalize that
stall away. The extra detection path uses stall-level aggregate current and a
larger gap. Resistance freezes the achieved command, then releases after the hold;
firmware faults release immediately and require explicit recovery.

Camera ranges are validated before saving or starting motion. Simulator validation
uses the known model flex range; physical-camera validation uses visible observed
raw flex. An undersized range that implies more than 105% is flagged rather than
accepted as extra patient movement. The tolerance accommodates endpoint noise;
it is not a physical safety limit. Remounting/rerouting still requires calibration.

Boot events retain optional `reset_reason`. Code 9 shows the exact capacitor/
supply guidance in Setup and runtime status; normal/unknown boots do not claim a
brown-out. A new shared line fixture lives at
`contracts/fixtures/serial_boot_brownout.txt`; older event lines remain valid.
The status notice uses its own banner below the header to keep its full message
readable without widening the status row.

Empty-glove friction runs without camera visibility, off the hand. Any safety
event aborts that whole measurement; stop, disconnect, source replacement and
runtime disposal settle its promise with no curves and an aborted stage. Patient
evaluation retains its distinct per-finger overcurrent behavior. A disconnected
transport cannot deliver release: the independent firmware watchdog is essential.

Failed REST writes stay in an ordered durable retry queue. Keep the tab open while
Saving/Offline is shown. Writes are at least once; the frozen contract has no
idempotency key, so a lost response can cause a duplicate. Reload never restarts
motion. Demo provenance follows any simulated source.

## Verification

```sh
make test
make e2e
# Known load-sensitive recovery test: rerun alone once if the full run fails it.
cd frontend
pnpm e2e e2e/recovery.spec.ts
```

Playwright starts a seeded real backend and a 3× simulator on :5178/:8008 by default,
with temporary SQLite storage, fake media and no Gemini key. Free those ports or
set both port variables. `REHAB_E2E_MOCK=1 make e2e` selects MSW instead; use the
normal mode for persistence acceptance. Browser tests exercise the full plan,
safety speech, recovery, replay, evaluation and doctor export. The dedicated
five-finger safety spec runs all five rigid fingers through real browser runtime,
controllers, engine and simulator with an isolated REST write sink; its camera
calibration read is fixed to the clean simulator range.

A 20-minute wall-clock soak uses separate ports and a disposable database:

```sh
REHAB_FRONTEND_PORT=5278 REHAB_PORT=8108 \
  REHAB_DB_PATH=/tmp/rehab-f9-soak.db GEMINI_API_KEY='' make dev-sim
# Another terminal:
cd frontend
node e2e/f9-soak.mjs
```

The development-only entry repeats two full default sessions then a five-finger
evaluation at 3× speed throughout the run. The driver samples retained JS heap
after GC every 30 seconds and writes `docs/qa/f9-soak.json`. Acceptance requires
at least two complete sessions/30 attempts, one evaluation, no safety/browser
errors, saved writes, and peak heap growth <=50 MiB. It does not mount the React
pages or prove physical timing. `REHAB_SOAK_URL` changes the server;
`REHAB_SOAK_MS` shortens runner diagnostics only, not acceptance.

PlatformIO native tests run when `pio` is available. Firmware flashing and every
physical run belong to the hardware team. Complete the recorded gate in
[HARDWARE_CHECKLIST.md](HARDWARE_CHECKLIST.md) and [BENCH.md](../firmware/BENCH.md),
including the fifth PWM channel and both LEDC timers. Software checks alone do
not authorize mounting the glove on a person.
