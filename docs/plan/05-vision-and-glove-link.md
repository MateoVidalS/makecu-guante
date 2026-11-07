# 05 — Glove link (Web Serial + simulator) and Vision (MediaPipe)

Types: `03-contracts.md §2–3`.

## Part A — Glove link (WP2, `frontend/src/glove/`)

### A1. `codec.ts`
`encode(cmd) → string` (compact JSON + `\n`; numbers rounded to 3 decimals) and `decode(line) → GloveTelemetry | GloveEvent | GloveInfo | GloveError | null`
(it stamps `t = performance.now()` and returns null on bad lines, counting them). Pure, unit-tested against `contracts/fixtures/serial_lines.txt`.

### A2. `webSerialGlove.ts` — `WebSerialGlove implements GloveClient`
- `connect()`: `navigator.serial.requestPort({ filters: [CP210x 0x10C4, CH340 0x1A86, FTDI 0x0403] })` (falls back to no
  filter), `open({ baudRate: 115200 })`, a reader loop with `TextDecoderStream` + a line splitter, a writer through `TextEncoderStream`.
  Then it sends `hello`, waits ≤ 2 s for `info` (else rejects with `no_info`) and returns it. A port granted earlier is reused through
  `navigator.serial.getPorts()` with no prompt ("Reconnect" button).
- **Keepalive:** a 100 ms timer sends `ping` if nothing was written in the last 300 ms.
- **Send throttling:** `follow` at most 30 Hz (keep the latest only); `target`, `release`, `calib`, `jog` and `limit` are never dropped.
  `release` jumps the queue.
- **Disconnect:** handles `navigator.serial` `disconnect` events and reader errors → `connection = "disconnected"`. It only emits
  the connection change (no synthetic glove event); the engine turns it into the safety event `glove_disconnected`, and the
  firmware's own watchdog releases the servos.
- `beforeunload` → best-effort `release`.
- Not in Chrome or Edge (no `navigator.serial`) → `connection = "error"` with the message "Use Chrome or Edge for the glove".

### A3. `sim/` — simulated world (glove + patient + camera)
A single `SimWorld` drives both `SimGlove` (a `GloveClient`) and `SimVision` (a `VisionSource`), so assist-as-needed can be
developed and demoed end to end without hardware.

**Patient model** (per glove finger, configurable presets):
- `active_max`: the furthest the patient can close alone (e.g. thumb 0.5, index 0.4, middle 0.6).
- `active_speed`: 0.6 /s; `reaction_s`: 0.4; tremor noise 0.01.
- `stiffness`: `{k0, kv}`, extra current per finger when the glove pulls beyond `active_max`:
  `extra_ma = k0·(pos − active_max)⁺ + kv·|v|·(pos − active_max)⁺` (velocity-dependent, so evaluation shows spasticity).
- `rigid` flag (the demo moment): extra_ma rises steeply, so overcurrent trips around pos 0.3.
- Intent: when the engine is in PRESENT/ATTEMPT for a pose, the sim patient moves toward `min(target, active_max)` after the reaction time, with
  some attempt-to-attempt variance; on REST/RELEASE it opens.

**SimGlove:** runs a **TypeScript port of the firmware state machine** (states, ramps, follow slack, limits, watchdog, fault latch,
`no_calib`) at 200 Hz, with the same constants. Current = `30 mA idle + 120 mA × moving servos + Σ extra_ma + noise`. The real
finger position = `max(patient position, servo position)` (the tendon can only pull closed). It emits `tel` at 50 Hz and events
exactly like the firmware. Dev controls: press STOP, unplug USB, set the patient preset, toggle rigid index.

**SimVision:** emits `VisionFrame` at 30 Hz from the real finger positions: closures + 0.02 noise + 60 ms latency; ring/pinky follow the middle finger;
pinch ratio derived from thumb/index closure; joints synthesized from the closure; confidence 0.95, with an optional dropout
schedule ("hand leaves frame" button).

The sim is the reference for the firmware semantics, so **WP2 also writes a conformance test suite** (`sim/conformance.test.ts`)
from `03-contracts.md §2` + `04-firmware.md §4`, which the firmware native tests mirror.

### A4. `GloveProvider` / `useGlove()`
A React context exposing the active client (serial or sim), connection state, the latest telemetry (subscribe with a selector),
events, and `setKind("serial" | "sim")`.

---

## Part B — Vision (WP3, `frontend/src/vision/`)

### B1. Camera + landmarker
- `@mediapipe/tasks-vision` `HandLandmarker`, `runningMode: "VIDEO"`, `numHands: 2` (pick the hand whose handedness matches the
  affected hand; with one hand visible, use it if its score is ≥ 0.6), GPU delegate with a CPU fallback. Model `hand_landmarker.task`,
  **served locally** from `frontend/public/models/` (no CDN dependency at the venue).
- Camera: `getUserMedia({ video: { width: 640, height: 480, frameRate: 30 } })`, device picker. Inference on
  `requestVideoFrameCallback`, skipping a frame if the previous inference is still running.
- MediaPipe handedness assumes a mirrored selfie image. The camera is mounted above and to the side, so provide a
  "Mirror handedness" toggle in Calibrate, stored in the camera calibration.

### B2. Flexion → closure (`flex.ts`, pure, unit-tested)
Use **world landmarks** (3D, meters). Flexion at a joint = the angle between consecutive bone vectors (0° = straight):
- Index/middle/ring/pinky with landmarks `(base, mcp, pip, dip, tip)` = index 5–8, middle 9–12, ring 13–16, pinky 17–20:
  `mcp = angle(wrist→mcp, mcp→pip)`, `pip = angle(mcp→pip, pip→dip)`, `dip = angle(pip→dip, dip→tip)`.
- Thumb (1–4): `mcp = angle(1→2, 2→3)`, `ip = angle(2→3, 3→4)` (stored in `pip`; `dip = 0`).
- `rawFlexSum = mcp + pip + dip`.
- `closure = clamp((raw − open_flex) / (closed_flex − open_flex), 0, 1.1)`.
- Pinch ratio = `|tip4 − tip8| / |lm0 − lm9|` (image-normalized landmarks; same ratio either way).
- Smoothing: a **One Euro filter** per finger on `rawFlexSum` (minCutoff 1.0 Hz, beta 0.02, dCutoff 1.0) and on pinch.
- Confidence = the handedness score × a presence factor (0 if not detected; it decays to 0 over 200 ms of no detection).

### B3. Calibration math (`calibration.ts`)
`captureStats(frames, seconds) → median rawFlexSum per finger + median pinch`, rejecting windows where any finger's
std > 8°. The wizard (`08-frontend.md`) uses it for open, closed and pinch.

### B4. Overlay (`CameraOverlay.tsx`)
The video preview with the 21 landmarks and bones drawn on a canvas, a per-finger closure readout, and a confidence badge. Used on the
Calibrate and Exercise pages (small picture-in-picture).

### B5. Performance targets
Inference ≤ 25 ms per frame on a laptop GPU (log the p50/p95). End-to-end camera → `VisionFrame` ≤ 80 ms, so the virtual hand stays
under the README's 150 ms visible lag.

### B6. Tests
`flex.ts` against recorded landmark fixtures (`contracts/fixtures/landmarks_*.json`: open, fist, hook, tabletop, pinch;
WP3 records these with a webcam during development and commits them), the One Euro filter's step response, normalization clamps, and
handedness selection.
