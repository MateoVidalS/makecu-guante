# MakeCU — Robotic glove for hand rehabilitation

> **Product name: memo.** Brand, logo and voice in [`docs/brand/BRAND.md`](docs/brand/BRAND.md). "Rehab Hub" remains the internal name of the repo and the plan.

**Track:** Healthcare
**Challenges we're entering:** MLH Gemini API, Trace (custom PCB), Zelos, Notability (optional)

---

## Status and how to run it

| Part | Status |
|---|---|
| **Software** (web app, backend, firmware) | Built and merged: WP0–WP12 in [`handoffs/STATUS.md`](handoffs/STATUS.md). Runs end to end with the **simulator**, no hardware needed |
| **Hardware** | Guides and anchors printed. The module, lid and spools (`hardware/definitivas/2_...`) still need printing, then sewing, wiring and testing |
| **Firmware on the board** | Builds and passes the native tests. Bench sessions on a real ESP32 are logged in [`hardware/BENCH-1.md`](hardware/BENCH-1.md) and [`hardware/BENCH-3.md`](hardware/BENCH-3.md); the acceptance steps in [`firmware/BENCH.md`](firmware/BENCH.md) are still pending |

> **Five fingers are implemented end to end:** protocol, firmware, simulator, camera, exercise/evaluation, voice and history. Wire order is `[thumb, index, middle, ring, pinky]`, on GPIO4/13/27/26/25. Boards reporting another finger count are rejected. Physical acceptance remains pending in [`firmware/BENCH.md`](firmware/BENCH.md).

**Requirements:** Node 20+, pnpm, Python 3.11+, [uv](https://docs.astral.sh/uv/), Chrome or Edge (Web Serial). PlatformIO only for the firmware.

```sh
make setup        # install backend and frontend
make demo-seed    # optional: 25 demo sessions (3 legacy), 5 opening evaluations, coach and voice records
make dev-sim      # API on :8000 + app on http://127.0.0.1:5173, simulated glove + real camera (webcam)
make dev-sim-all  # simulated glove and camera (no webcam)
```

| Command | Purpose |
|---|---|
| `make dev` | Same as `dev-sim`, but with the real glove over USB |
| `make dev-mock` | Frontend only, with the API mocked in the browser |
| `make dev-camera` | Alias of `dev-sim` (real webcam + simulated glove) |
| `make test` / `make e2e` | pytest, vitest, TypeScript, Ruff, ESLint (+ native firmware tests if `pio` is installed) / Playwright |
| `make demo` | Builds the frontend and serves it from the backend at http://127.0.0.1:8000 |
| `make fw-build` / `make fw-flash` | Build / flash the firmware (**only after the bench tests**) |

- **Gemini:** copy `backend/.env.example` to `backend/.env` and set `GEMINI_API_KEY` (Google AI Studio). It is the only API key. Models: voice `gemini-3.8-live` (`gemini-3.8-live-extended-thinking` talks but never calls the coach tools, so the backend replaces it; `uv run python -m tools.coach_check` verifies this live); summaries `gemini-4-argon` (requires billing), with automatic fallback to `gemini-3.8-flash`, `gemini-3.5-flash` and `gemini-3.5-flash-lite` on quota errors, overload or slowness (each model gets ~20 s; the AI Studio free tier allows only 20 requests per day per model, so use a key with billing for a demo). `cd backend && uv run python -m tools.summary_check` tests summaries live against the demo history. Without a key the app still works, with simple voice (fixed browser phrases) and no summaries.
- The app is **in English**. This README is the concept; the detailed technical plan is in [`docs/plan/`](docs/plan/README.md) and the contract (source of truth) in [`docs/plan/03-contracts.md`](docs/plan/03-contracts.md).
- More detail: [`docs/DEV.md`](docs/DEV.md) (development), [`docs/DEMO.md`](docs/DEMO.md) (6-minute demo script and how to recover from failures), [`docs/HARDWARE_CHECKLIST.md`](docs/HARDWARE_CHECKLIST.md) (before putting the glove on anyone).

---

## 1. Extension-assist concept

Rehab Hub practices active hand closing and helps the patient **open** against
flexor tone. The same five servos wind tendons routed over the **back of the
fingers** (dorsal routing). Winding straightens a finger; unwinding releases it.
The glove can only reduce closure. A webcam measures the patient's movement,
a virtual hand shows the target, and a voice coach guides practice.

After a stroke, a hand may close into a fist but struggle to open. The patient
first makes a fist alone, then tries to open. The glove supplies only the missing
opening. Evaluation estimates **resistance to opening (flexor tone)** at slow and
fast speeds, with thread friction (threads unhooked from the fingertip anchors) subtracted. These are estimates inspired
by clinical practice, not validated clinical measurements.

## 2. A practice session

1. Calibrate the five servo ranges and camera in the current upright posture.
2. Make a fist actively. The glove follows with slack and pays out as you close.
3. Try to open. The camera records the opening achieved without help.
4. Only fingers still short of the opening target receive slow assistance.
   Orange means opening help; reaching the target turns the hand green.
5. Repeat fist → open five times: **10 attempts**. History, replay and Doctor view
   retain each attempt, assistance, current and safety events. Earlier records
   remain labeled **Earlier closing-assist glove**, with separate trend paths.

A calibration from the earlier closing glove (direction absent or `close`) must
be replaced. Its endpoints are unsuitable for dorsal routing.

## 3. Hardware: bare hand and opening assist

**Decision of November 8:** there is no fabric glove. The guides are small
**BLACK** dots on the back of the proximal and middle phalanges; the anchors are
**YELLOW** dots on the back of each fingertip. They are attached directly to the
skin with skin-safe tape; the hardware team must confirm the attachment method,
positions and exact sizes. The threads run along the back of the hand and open it,
per [15-open-assist.md](docs/plan/15-open-assist.md). The app keeps the name
**glove** for the device.

The camera sees the bare palm, the best case for MediaPipe. The dots and tape must
not cover the joint creases on the palm side. Use good front lighting, sleeve rolled
up, no rings or watch. On day one, check detection in Setup and save a real landmark
recording with `frontend/src/vision/recorder.ts` covering `bare-hand-points`; log the
evidence in the **points** section of the bench checklist (adding it is up to the team).

**Safety:** test on a hand-shaped fixture first, before attaching any part to a
person. Check the skin before and after every session: redness, marks or pain; a
person after a stroke may not feel rubbing. If a guide or anchor is re-attached,
redo the servo calibration before practicing: maximum pull is set with the fingers
straight, and a moved anchor can over-extend a finger.

To evaluate, measure **Thread friction (unhooked)** with each thread unhooked from
its yellow anchor and the hand relaxed; alternatively, use a hand-shaped fixture
with the guides attached the same way. Re-hook before evaluating.
See [16-bare-hand.md](docs/plan/16-bare-hand.md) for the decision and its open items.
Earlier references to empty-glove friction in sections 1 and 4 are superseded by
this unhooked-thread procedure.

Existing CAD and wrist module: `hardware/`. The upright mounting, thread exits,
friction, usable travel and extension strength still require team validation.
The earlier palm-side routing is superseded by **dorsal tendons**. Do not copy
old diagrams or angle ranges into a person-mounted calibration.

- Wire order: thumb, index, middle, ring, pinky. Each has a servo/spool.
- `pull = 0`: slack tendon at calibrated `min`; a relaxed hand may remain curled.
- `pull = 1`: full calibrated opening at `max`, finger straight and neutral.
- Never swap `min` and `max` to reverse the anatomy: release, fault, STOP and
  watchdog always unwind to pull 0. Slack is the safe state.
- Calibrate **Slack** with a relaxed fist, tendon just taut; calibrate **Open**
  at straight, never bent back. Normal assist is capped at 95% of that range.
- Winding defaults to ≤0.20 range/s for assistance (≤0.30 only with consent).
  Unwinding in target and follow runs at 3.0/s; follow leaves 0.08 slack.
- Starts are staggered ≥150 ms with at most three winding motors. A sustained-load
  governor eases pull before the aggregate firmware current limit; all five held
  open can still consume substantial current.

**Hardware gate — pending, team only:** complete the electrical/firmware bench
checks and the ordered opening gates in [firmware/BENCH.md](firmware/BENCH.md),
recorded in [HARDWARE_CHECKLIST.md](docs/HARDWARE_CHECKLIST.md). Confirm winding
opens each finger on an empty fixture, calibrate, prove extension strength and a
2 s hold under the limit, measure the five-finger sustained hold, verify STOP
releases to slack in <0.5 s on a fixture, and test fast closing during follow.
Keep the glove off patients until every gate passes. If extension strength fails,
the team must revise the servo or spool/lever mechanism and repeat the gate.
Simulator acceptance does not establish physical force, comfort or safety.

### Spools and routing

Keep thread exits tangent and in the spool plane, with strain relief and smooth
guides. A 10 mm winding radius gives about 31 mm travel per half turn; measure
actual opening travel and force on the dorsal fixture. Greater radius increases
travel and reduces force. Micro-servo torque and the estimated 2–2.7× friction
loss do not prove the mechanism can open a spastic hand.

### Servos (the ones we have)

| Finger | Servo | Approx. torque (4.8 V) | Why |
|---|---|---|---|
| All 5 fingers | Smraza S51 (9 g micro servo, SG90 type) | ~1.6–1.8 kg·cm | The same servo everywhere: a single housing size and the same current profile |

- Pulse range ~500–2400 µs: calibrate each finger within ~10–170° so the internal end stop isn't forced.
- 5 stalled servos can draw ~650 mA each: use a 5 V supply of at least 2 A.

- Torques come from store and manufacturer datasheets; they vary between sources.
- **Universal housings:** 23.6 × 13.2 mm pocket (bodies measure 22.2–23 × 11.8–12.6) and slotted holes (±0.8 mm), because hole spacing varies between brands.
- **Micro servos on purpose:** a large servo (e.g. 20 kg·cm) could injure someone if the software fails or the finger jams. With a micro servo, the worst case is that the servo stalls.
- Shaft height varies 1–2 mm between models: the front exits leave room for that.

### Electronics

```
  5 V supply (2.5 A limit) ──> [INA219] ──> (+) 5 servos
                                  │ I2C              ▲ PWM
                                  ▼                  │
  STOP button ───────────────────> [ESP32-WROOM-32] ──┘
                                  │        └──> level shifter ──> NeoPixel Ring
                                  └── USB ──> laptop (camera, virtual hand, voice, dashboard)
```

**The ESP32-WROOM-32 drives all five servos** with hardware PWM (LEDC, 50 Hz, 500–2500 µs pulses) through `ESP32Servo`. Firmware allocates **two LEDC timers** so the fifth servo can attach while the other four remain attached (PR #39). Verify all five together on the empty bench fixture; see `firmware/BENCH.md` step 4.

| Function | ESP32 pin | Notes |
|---|---|---|
| Thumb servo | GPIO 4 | |
| Index servo | GPIO 13 | |
| Middle servo | GPIO 27 | |
| Ring servo | GPIO 26 | |
| Pinky servo | GPIO 25 | |
| NeoPixel (data) | GPIO 33 | Level shifter (3.3 → 5 V) + ~330 Ω resistor |
| INA219 SDA / SCL | GPIO 21 / 22 | I2C |
| STOP button | GPIO 32 | `INPUT_PULLUP`, the button goes to GND |

- **Pins avoided:** 0, 2, 5, 12 and 15 (they set how the board boots) and 14 (it pulses at boot and would make a servo jump).
- **Communication with the laptop over USB** (Web Serial from Chrome).
- The ESP32, the INA219 and the level shifter sit on the breadboard, **on the table** behind the module. The servo cables leave through the slot at the back of the module.

### Power

- **Facmogu bench supply at 5 V with a 2.5 A limit** (5 servos). The servos are **not** powered from the ESP32.
- **470–1000 µF capacitor** between 5 V and GND on the servo line: it absorbs the spike when several start at once, which could otherwise reset the ESP32.
- Firmware releases on total filtered current above the limit for 100 ms: **1500 mA default, 2200 mA maximum**, below the 2.5 A supply limit. Measure each actual servo and thread friction with fingertip anchors unhooked on the bench; provisional profiles are not measured force limits.
- The current limit is a **physical cutoff**: even if the software fails, the supply won't let more through.
- **Common GND** between the supply, the servos and the ESP32.
- Check the 5 V with the multimeter **before** connecting the servos.

### Safety

- Each servo's travel is **limited in software** to each finger's comfortable range, calibrated per person.
- **Overcurrent cutoff:** if the INA219 reads above a threshold, the servos release. If the hand resists, the glove stops instead of forcing.
- **STOP button:** releases all servos instantly.
- **Supply current limit** as the last barrier.
- Extension assist: winding opens; releasing leaves the tendons slack.

### Table setup

- **Laptop in front of the patient; camera = the laptop's front webcam.** Raise the affected hand next to the face, upright, with the **palm facing the screen**, like waving on a video call. Open and close the fingers toward the camera.
- **Elbow resting on the table**, on a towel or comfortable pad; forearm vertical. Keep the wrist, the whole hand and all five fingertips in frame, about **40–60 cm from the laptop**. Tilt the screen to frame the hand without lifting the elbow.
- **Diffuse light from the front or side, no window behind the patient.** Check in the camera view that the palm and fingers are lit, not backlit.
- **Bare palm with black and yellow dots:** check detection in Setup for five seconds while opening and closing under the room's lighting; record the percentage, occlusions and a real landmark recording. If it fails, adjust lighting/framing and ask the team to review before using it.
- **New calibration in this posture:** don't reuse captures taken palm-down with a diagonal camera. Do short sets, rest, and pause if holding the hand up gets tiring.

**Findings from the real bench — read [`hardware/BENCH-1.md`](hardware/BENCH-1.md) before connecting anything:** Matias's first session was without tendons or glove and does not replace the acceptance in [`firmware/BENCH.md`](firmware/BENCH.md).

- **INA219 connected before any physical practice.** Without the sensor the firmware rejects assistance (`target`/`follow`), though it allows `jog`; a servo moving and reading 0 mA without the sensor proves nothing about safety.
- **The actual Facmogu has no current limit.** The limited supply described above does not match this adapter: for the demo, use a fuse chosen by the team or a supply with a limit. For the glove, feed the rail at **5.0 V directly through the INA219**, bypassing the MB102, with its own **470–1000 µF** capacitor. On an empty fixture, test the cutoff per BENCH with `limit 800` (JSON: `{"t":"limit","ma":800}`); record current, event and release. It is an 800 mA firmware threshold for that test, not a physical supply limit nor a setting approved for a person.
- **MB102 (~0.8 A): bench tests with one servo at a time only**, never practice with the full glove. Set both jumpers to **5V**, measure the output and keep the Facmogu at **9 V or less** when feeding the MB102: its capacitor is rated 10 V.
- **Check rail polarity with a multimeter before connecting servos.** Don't assume the row order: a servo with red/brown swapped got hot within seconds during testing.
- **Manual bench with the repo firmware:** send `ping` every **~300 ms** during `jog` (JSON: `{"t":"ping"}`, newline-terminated). With no valid messages for more than 1 s, the watchdog releases and enters fault; don't disable it for testing.

**Open question for the hardware team — resolve before using the glove on a person:** the wrist module was designed to rest on the table with the palm down. With the hand upright it hangs from the forearm. Do the two straps hold it without slipping or squeezing, is its weight comfortable, and does the dorsal thread exit allow opening and slack release without rubbing or snagging? Also check how gravity changes the action of the elastics and the servo pull. Record the decision and the evidence in [`docs/HARDWARE_CHECKLIST.md`](docs/HARDWARE_CHECKLIST.md), on an empty fixture first; don't assume the previous mounting is already validated.

### Printed parts

| Part | Status | Size | Qty |
|---|---|---|---|
| Tendon guide | **Final, already printed** (`hardware/definitivas/1_...`) | 12 × 9 × 5.6 mm, concave base | 13 (+3) |
| Fingertip anchor | **Final** | 12 × 9 × 5.8 mm | 5 (+1) |
| Wrist module | First test | 80.5 × 80 × 41 mm | 1 |
| Lid (concave, with strap ears) | First test | 80.5 × 102 × 6 mm | 1 |
| Spool | Radius to be confirmed | Ø 22 × 8.2 mm | 5 |

- Everything comes from `hardware/cad/piezas.py` (FreeCAD, parametric): `freecadcmd hardware/cad/piezas.py` regenerates the STLs in `hardware/stl/`.
- For the left hand: mirror the module and lid in the slicer.
- **Before printing the module:** check that all 5 S51s fit in their housings.
- Print settings and sewing: [`hardware/PRINTING.md`](hardware/PRINTING.md).

---

## 4. Software

> What is built. The detail of each part (types, constants, endpoints, thresholds) is in [`docs/plan/`](docs/plan/README.md); the contract shared by all parts is [`docs/plan/03-contracts.md`](docs/plan/03-contracts.md).

### 4.1 What it does

A local web app (**Rehab Hub**) running on the laptop:
1. Shows the patient a **virtual hand** with the target pose (ghost) and their real hand (solid) overlaid.
2. Measures with the **webcam** how far each finger closes.
3. Commands the **glove** (ESP32 over USB) to supply missing opening only; closing is active practice.
4. Records every attempt, shows it in a **history** with charts and generates summaries with **Gemini**.
5. A **voice coach** (Gemini Live) guides the session. Safety alerts are local and immediate.

### 4.2 Architecture

```
 Chrome / Edge (React + Vite)
   webcam ─> Vision (MediaPipe) ───┐                ┌─> Virtual hand (three.js)
                                   ▼                │
                 Runtime ─tick─> Exercise / evaluation engine (pure TS)
                   │  ▲                │ commands
                   │  └─ telemetry ────┴──> Web Serial ──USB──> ESP32 (or simulated glove)
                   ├─> Voice: local safety net + Gemini Live coach
                   └─> REST API ──> FastAPI + SQLite (localhost:8000)
                                     sessions, attempts, traces, calibrations,
                                     evaluations, history, export, Gemini
```

- **All real-time logic runs in the browser.** The backend only stores data, aggregates the history and talks to Gemini (so the API key never reaches the browser).
- **Safety does not depend on the browser.** The firmware enforces limits, ramps, overcurrent cutoff, STOP and watchdog on its own; the browser is a second layer (it pauses if it loses the camera and anticipates resistance).
- **Simulator (`SimWorld`):** a simulated glove that behaves like the firmware, a patient model (severe, moderate, mild, with a "rigid index") and a simulated camera. It lets us develop, test and demo without hardware.

| Folder | Contents |
|---|---|
| `frontend/` | React 18 + TypeScript + Vite, three.js (`@react-three/fiber`), MediaPipe Tasks Vision, Recharts, `@google/genai`. Tests with Vitest and Playwright |
| `backend/` | FastAPI + SQLModel + SQLite (WAL). Also serves the built frontend. `tools/seed_demo.py` generates the sample data |
| `firmware/` | PlatformIO, Arduino-ESP32. Safety logic in plain C++ with native tests (Unity) |
| `contracts/fixtures/` | Sample serial and REST messages checked by all three parts |
| `docs/plan/` | Technical plan: product, architecture, contracts, firmware, vision, session, voice, frontend, tests, UX |
| `handoffs/` | Briefs (WP0–WP12) that coding agents used to build each part, and their status |
| `hardware/` | CAD, STLs, 3D viewer, printing notes and bench logs (section 3) |

### 4.3 Screens

| Route | Screen |
|---|---|
| `/` | Home |
| `/setup` | Choose glove (USB or simulated), camera and affected hand |
| `/calibrate` | Wizard: five servo ranges (jog) → open / closed / pinch camera range → review. Thread friction (unhooked) is in Evaluate preflight. |
| `/exercise` | Exercise session (focus mode, no navigation) |
| `/evaluate` | Resistance evaluation |
| `/history` | Trends for range, assistance and resistance; replay of each session (`/history/sessions/:id`) and evaluation |
| `/doctor` | Therapist view: trends, on-demand Gemini summary, JSON/CSV export, print. The only setting is the **adaptive plan** (section 4.10) |
| `/profile` | Optional patient profile |

The header has a **Demo tools** menu to switch to a simulated glove or camera mid-demo without reloading.

### 4.4 Serial protocol (laptop ↔ ESP32)

USB at **115200 baud**, one compact JSON line per message (max. 200 bytes). Finger arrays are always in the order **[thumb, index, middle, ring, pinky]**.

| Laptop → ESP32 | Example | What it does |
|---|---|---|
| `target` | `{"t":"target","f":[0.8,0.6,0.6,0.5,0.5],"v":0.5}` | Target tendon pull (0 = slack, 1 = calibrated straight finger) at speed `v` |
| `follow` | `{"t":"follow","f":[0.3,0.4,0.1,0.2,0.2]}` | Follow vision converted to pull, subtracting 0.08 slack; unwind at 3.0/s |
| `release` | `{"t":"release"}` | Release everything; also exits `fault` |
| `calib` | `{"t":"calib","i":1,"min":20,"max":150}` | Servo angles for slack `min` and neutral-open `max`; not persisted on the board |
| `jog` | `{"t":"jog","i":1,"deg":95}` | Move one servo to an angle, for calibration |
| `limit` / `ping` / `hello` | `{"t":"limit","ma":1500}` | Current threshold / keepalive / request `info` |

| ESP32 → laptop | Example |
|---|---|
| `tel` (50 Hz) | `{"t":"tel","ms":12345,"a":[0.42,0.40,0.35,0.30,0.30],"ma":312,"st":"run","md":"follow","tg":[0.42,0.45,0.40,0.35,0.35]}` |
| `evt` | `overcurrent`, `stop_button`, `stop_released`, `watchdog`, `boot`, `ina_missing`, `calib_ok` |
| `info` / `err` | Version, finger count, limit and calibration / rejected command and why |

`boot` events include optional `reset_reason` from `esp_reset_reason()`. Code **9** means brown-out: Setup and runtime status tell the helper to check the 470–1000 µF capacitor and the supply limit.

`a` is the **commanded** position (micro servos don't report the real one). States: `boot → idle → run`, `calib` during jog, and `fault` after a cutoff, until a `release`.

### 4.5 Firmware safety

Always enforced, whatever the laptop says (details in [`firmware/README.md`](firmware/README.md)):
- At boot, PWM is detached: no remembered calibration or movement. `target` and `follow` are rejected until every finger is calibrated.
- Stays within calibration: target winding ≤1 range/s, follow winding 1.5/s, unwinding 3.0/s.
- **Overcurrent cutoff:** above the (filtered) threshold for 100 ms → releases everything and stays in `fault`.
- **STOP:** latches on the first edge; to continue, release the button and send `release`.
- **Watchdog:** 1 s without valid messages → releases everything.
- Release unwinds to pull 0 (slack), then detaches PWM after 500 ms.

### 4.6 Vision

- MediaPipe Hand Landmarker (local model in `frontend/public/models/`), 640×480 at 30 Hz.
- Per-finger closure from flexion angles, normalized with the patient's calibration and smoothed with a One Euro filter.
- If the hand isn't visible, confidence drops or the camera freezes (100 ms without frames), the reading is invalidated and the session asks nothing new of the glove.
- It is an **estimate**, not a goniometer.

### 4.7 Session engine

Deterministic TypeScript engine (`frontend/src/engine/`), with no clock of its own, tested with the simulator.

```
 PRESENT → ATTEMPT (follow) → reached → HOLD → RELEASE → REST
                  │
                  ├─ missing opening → ASSIST → ASSIST_HOLD → RELEASE
                  ├─ closing attempt ends → RELEASE (no help)
                  └─ fault / STOP / camera loss → PAUSED + slack
```

- **Default plan:** active full fist → assisted open, five pairs (10 attempts). `TENDON_GLIDE_PLAN` retains the five observation glides, three reps each; pinch remains optional.
- Assistance begins after the attempt timeout or plateau. Unreached fingers start at least **150 ms apart**, with at most **three moving at once**. Glove-assisted targets are capped at **0.95 of the calibrated range**; 100% calibration means a straight, neutral finger; never hyperextension. Only fingers lacking opening are assisted.
- All five fingers are scored in fist/open practice; closing poses receive follow only; pinch uses thumb and index. Evaluation accepts any subset, with one slow and one fast sweep per selected finger. Old three-finger sessions remain readable with missing ring/little-finger measurements.
- The simulator exposes rigid-finger resistance. Detection also covers a stall already present in the initial assist baseline; a single stall need not exceed the aggregate firmware current limit. See `docs/DEV.md` for the browser and unit regressions.
- **Evaluation:** from a relaxed, curled hand, sweep opening pull slowly and quickly. Subtract recent thread friction (threads unhooked from the yellow fingertip anchors) measured in Evaluate preflight; fast − slow estimates velocity dependence of flexor tone.

**Per-attempt metrics:** maximum active closure per finger, time to pose, assistance needed, peak and mean current, safety events, and a 20 Hz trace to replay the attempt later.

### 4.8 Voice and Gemini

| Layer | What it does |
|---|---|
| **Local safety net** | Browser sounds and speech for safety alerts ("Stopping. I felt resistance in your index."). Works in every mode, offline |
| **Coach (Gemini Live)** | Gives the instruction, encourages, comments on each attempt and answers questions. Voice commands: pause, continue, skip, repeat, stop, "how am I doing" |
| **Simple voice** | Fixed phrases, no key needed. Turns on automatically if Gemini Live fails 3 times |
| **Summaries (Gemini text)** | For the patient at the end of the session and for the therapist on demand from `/doctor` |

Gemini only receives summarized metrics, never video. Everything is presented as coaching, not medical advice.

### 4.9 Data

SQLite in `backend/data/rehab.db`: profile, calibrations, sessions, attempts with traces, evaluations and voice transcripts. Exportable to JSON and CSV from the therapist view. Demo data from `make demo-seed` contains 25 sessions (212 attempts, including three legacy closing sessions) and five opening evaluations over six weeks, with voice-coach decisions, check-ins and transcripts in the last 18 days. All carry `is_demo`; directions remain separated in history.

### 4.10 Today's plan (adaptive progression)

Each practice can start from the latest sessions instead of the same standard plan. **It is off by default**: the therapist turns it on in `/doctor` → **Adaptive plan** (Standard or Gentle). When off, practice and the demo work exactly as before.

- **Per-finger target:** a finger that almost never opens fully on its own gets a target a little beyond what it opens alone (for example, pinky at 60%). That way it practices a reachable challenge.
- **Help fades gradually:** if most openings happen unaided, help is offered later (6 → 7 → 8 s to try alone). If the last session had pain or a lot of fatigue, the timing stays standard.
- **It only makes practice easier or gives more time:** it never changes the glove speed, maximum pull, current limits or firmware. A lower target also makes the glove pull less. The coach adjusts from there, within its own limits.
- On the practice screen (Home → Customize plan) the patient sees **Today's plan** and can use the standard plan that day; the quick-start buttons apply the plan without showing it. The applied plan is stored in the session record ("Today's plan applied").
- Details, rules and tests: [`docs/plan/17-progression.md`](docs/plan/17-progression.md). It is an estimate inspired by clinical practice, not a validated protocol.

### 4.11 To do

**Team plan, step by step and with owners:** [`docs/TEAM_PLAN.md`](docs/TEAM_PLAN.md).

- **Going from 3 to 5 fingers** (in progress): the contract (`docs/plan/03-contracts.md`, `contracts/fixtures/`, `firmware/lib/core/protocol.h`, `frontend/src/contracts/`, `backend/app/contracts/`) and everything that uses it: firmware, calibration, virtual hand, metrics, charts, simulator, tests and voice prompt.
- **Current threshold for 5 servos:** measure it on the bench.
- **Test the firmware on the board** with [`firmware/BENCH.md`](firmware/BENCH.md) and then [`docs/HARDWARE_CHECKLIST.md`](docs/HARDWARE_CHECKLIST.md), without the glove on.
- **Gemini with the real key:** confirm `/api/health` reports `gemini: true` and rehearse a voice connection and a summary.
- Out of scope: mirror mode, fading the lights and the assistance frequency (today's plan only delays help, section 4.10), remote access, multiple patients, other languages.

---

## 5. Modes

| Mode | What it does | What it measures |
|---|---|---|
| **Exercise** (main) | Therapy poses. The patient tries alone and the glove helps with what's missing | How far each finger gets alone, time to pose, how much help was needed |
| **Evaluation** | From a relaxed curled hand, opens each selected finger slowly then quickly | Resistance of each finger by speed |
| **Mirror** (not built) | A healthy hand in front of the camera controls the glove | Nothing: it's for practice and for the demo |

**Poses** (real hand-therapy exercises):
- **Tendon glides:** open hand, hook, full fist, tabletop, straight fist.
- **Thumb opposition:** touch the tip of each finger with the thumb (inspired by the Kapandji test).
- **Pinch:** thumb and index.

**Fading feedback** (first step built, section 4.10): with the adaptive plan on, help is offered later as the patient opens alone, and each finger practices a target tailored to it. Still missing: dimming the lights and offering help on fewer attempts (for example, from 100% to 50%). Constant feedback creates dependence.

---

## 6. Metrics

Per finger and per attempt:

- **Active opening:** how far the finger opens alone (0–100%), derived from open-pose closure. Closing ability is recorded separately by pose.
- **Time to pose.**
- **Assistance needed:** how much of the travel the glove completed.
- **Resistance:** servo current during evaluation mode, minus thread friction (calibration).

Stiffness after a stroke increases with movement speed. Comparing resistance at slow and fast speed is what the therapist assesses by hand (Ashworth scale).

> Communicate everything as an "estimate inspired by clinical practice", **not** as a validated measurement.

---

## 7. The Healthcare angle

| Population | Use of the glove |
|---|---|
| **Stroke with a paretic hand** (main case) | Assisted repetitions and measurement of range and stiffness |
| Tendon injury or post hand surgery | Tendon-glide exercises at home |
| Cervical spinal cord injury | Opening practice after team and clinical assessment |
| Multiple sclerosis, cerebral palsy | Tracking stiffness over time |

**Telerehabilitation:** the patient practices at home and the therapist views the dashboard remotely. Gemini generates a weekly summary for the therapist.

---

## 8. Demo and pitch

The detailed script (6 minutes, with what to say at each step and how to recover if the camera, glove or Gemini fails) is in [`docs/DEMO.md`](docs/DEMO.md). Anything that forces resistance or STOP is shown with the simulator, never with a person's hand.

1. Use both simulators with the moderate patient. Make a fist alone, then watch the glove help open. Show blue active movement, orange opening help and green reach.
2. In the simulator, enable Rigid index during an opening. Show the resistance stop and its saved event. For STOP/overcurrent, show pause and slack; never deliberately stall a person's hand.
3. Show opening trends, an Open hand replay, and the two labeled legacy closing sessions. Evaluation measures resistance to opening (flexor tone).
4. Open Doctor view, request a summary if available, and export the marked records. Rehearse [docs/DEMO.md](docs/DEMO.md).

### Devpost video (3 min)

| Criterion | What to show |
|---|---|
| Problem solving | Post-stroke patient, lack of therapy hours, telerehabilitation |
| Innovation | Helps only with what's missing + stiffness measurement from servo current |
| Technology | Computer vision, artificial tendons, servo control with overcurrent cutoff, Gemini |
| Design | Lightweight glove, servos in a wrist module, layered safety |
| Completion | Live demo |

---

## 9. Challenges

| Challenge | How it fits | What's needed |
|---|---|---|
| **MLH Gemini API** | Voice coach and summaries for the therapist | Use the Gemini API |
| **Trace** | Glove PCB: ESP32 + servo connectors + INA219 + STOP | Design in Trace, ERC/DRC, BOM, Gerbers, mechanical view. Code `MAKECU-X-TRACE-26` |
| **Zelos** | Watch current and angles live during development | Academic plan with a university email |
| **Notability** (optional) | Document the process | Tag, 2+ screenshots, 1–2 sentences. Code `MAKECU` |

Touchtronix no longer applies: we don't use the SensX25.

---

## 10. Hardware list

### CURC desk (orders from the MakeCU site)

| Order | Item | Qty |
|---|---|---|
| O-00039 | Facmogu Adjustable DC Power Supply | 1 |
| O-00039 | INA219 Current and Power Monitor | 1 |
| O-00039 | Tactile Push Buttons (Assorted) | 1 |
| O-00036 | ESP32 ESP-WROOM-32 Development Board | 2 (one spare) |
| O-00036 | WS2812B NeoPixel Ring (24 px) | 1 |
| O-00036 | 4-channel Logic Level Shifter | 1 |
| O-00036 | INMP441 I2S Microphone | 1 (optional: the laptop microphone is enough) |
| O-00036 | Alligator Clip Test Lead | 2 |
| O-00014 | Audio Amplifier + Dweii Mini Speaker | 1 + 1 (optional: the laptop speaker is enough) |
| O-00014 | Solderless Breadboard full + half | 1 + 1 |

Ask them to remove from O-00014: ESP32-CAM, Raspberry Pi AI Camera, USB 3.1 breakout and electret microphone.

### MLH desk (in person)

| Item | Qty |
|---|---|
| Resistor Kit | 1 |
| Wire Spool | 1 |
| DMM, Wire Strippers, Flush Cutters | 1 each |
| Grove 3 Axis Digital (optional, tremor) | 1 |

### Outside the inventory

- Micro-USB cables for the ESP32s.
- Thin fabric or cycling glove.
- Fishing line or waxed thread.
- Small plastic tubes or straws for the guides.
- Elastic band for the back of the hand.
- Velcro (2 straps for the module).
- Male-male and male-female jumper wires (5 servos to the breadboard).
- Strong sewing thread, needle and super glue (for guides, anchors and knots).
- 470–1000 µF electrolytic capacitor for the servos' 5 V line.

### 3D printing (Makerspace, Mudd 254)

Parts in `hardware/`: wrist module, lid, spools, guides and anchors (see section 3 and [`hardware/PRINTING.md`](hardware/PRINTING.md)). Do the **Makerspace training early**. Max 4 h per print, 1 printer per team.

---

## 11. Work plan

| Role | Task | Status |
|---|---|---|
| Software | App, backend, firmware, simulator, voice | **Done** (WP0–WP12). Still needs testing with real hardware |
| Mechanics | Print module, lid and spools; attach guides, anchors and elastics | Guides and anchors printed |
| Electronics | Wire ESP32, INA219, STOP and servos; bench tests in `firmware/BENCH.md` | In progress (see [`hardware/FIXES.md`](hardware/FIXES.md)) |
| Integration | One finger end to end: calibrate, `follow`, assistance, overcurrent cutoff | Software integrated; physical opening strength gate pending |
| Pitch | Rehearse `docs/DEMO.md`, Devpost video | Pending |

**Order:** first **one finger + one servo + the camera end to end**. Then the other four.

### Risks

- **Mechanics are the hardest part:** thread friction, anchors coming loose, the attachment shifting. Test with a single finger as early as possible.
- **Servos:** 5× Smraza S51. Each still needs measuring on the bench (rest, moving, stalled) and checking that it fits its housing.
- **Opening travel and force:** measure dorsal travel, extension strength and sustained current on a fixture before finalizing spools.
- **Camera with covered fingers:** test the webcam position early.
- **Firmware only lightly tested on a board:** finish the bench tests early, with the glove off.
- If the mechanics fail, the app with the simulator (or with the real camera and the simulated glove) is still a demo that works on its own.
