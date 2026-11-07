# 12 — Hardware update analysis and the 5-finger plan

The hardware team changed the glove after the software plan was written (main PRs #2–#9, #26). This doc lists **every hardware
change and what it means for the software**, then the plan to update the whole project.

## 1. What changed in hardware

| # | Change | Before (software plan) | Now (`README.md §3`, `hardware/`) |
|---|---|---|---|
| H1 | **Actuated fingers** | 3 (thumb, index, middle); ring and pinky "later" | **5 servos, one per finger** |
| H2 | **Servo pins** | 25, 26, 27 | 25 thumb · 26 index · 27 middle · **13 ring · 4 pinky** |
| H3 | **Servo models** | MG90S preferred, all alike | Index TowerPro SG92R (~2.5 kg·cm), middle MG90S (~2.0), ring and pinky Smraza S51 (~1.7), **thumb unidentified (measure; its housing doesn't fit yet)** |
| H4 | **Power** | 5 V, 1.5 A limit | 5 V, **2.5 A** limit for 5 servos |
| H5 | **Actuator location** | Servos on the forearm | **Wrist module** (80.5 × 80 × 47 mm) under the wrist, which **immobilizes the wrist**, strapped with two velcro straps; threads exit the front ~10° toward the palm |
| H6 | **Spools** | Radius 10 mm assumed | Radius 10 mm → ~31 mm of thread per 180°; a full fist needs ~40–45 mm, so **the glove reaches only ~70% of a fist** unless the radius grows (radius "to confirm") |
| H7 | **Friction** | Not quantified | Servo pulls **~2–2.7×** what reaches the fingertip |
| H8 | **Posture** | Not specified (UI assumed a palm-up view) | **Palm down**, module at the table edge, fingers close in the air, forearm on a towel |
| H9 | **Camera placement** | "Above and to the side" | **In front, on the thumb side, diagonal, 30–40 cm from the fingers, higher than the hand** (Logitech on a small tripod) |
| H10 | **Glove** | Not specified | **Light, thin glove**; MediaPipe is trained on bare hands, so a dark glove may break detection. "Test it on day 1" |
| H11 | **Guides and anchors** | Tubes or straws | Printed guides (13 + 3 spare, already printed) and fingertip anchors (5 + 1); the module, lid and spools are still to be printed |
| H12 | **Left hand** | – | Mirror the module and lid in the slicer |

## 2. Impact on the software

| Hardware change | Software impact | Where |
|---|---|---|
| H1, H2 | **Everything uses arrays of 3** (`Triple`, `GLOVE_FINGERS`, Literal of 3 fingers): protocol, firmware (`FINGERS = 3`, pins), codec, simulator, engine (scoring, assist, attribution), evaluation sweeps, calibration wizard (3 servos), metrics, backend contracts, fixtures, seeding, charts (3 finger colors), meters, voice prompt ("thumb, index and middle") | 31 non-test source files + firmware + fixtures |
| H3 | Per-finger servos differ in strength → per-finger stall currents differ. Weaker ring/pinky servos stall earlier. The thumb's torque is unknown | Firmware limits, the simulator's patient/servo model, the engine's resistance thresholds, the bench guide |
| H4 | 5 stalled micro servos (~0.65–0.8 A each) can exceed 2.5 A. The overcurrent default (900 mA) and max (1400 mA) were sized for 3 servos | Firmware constants, the simulator current model, the engine's assist strategy (stagger fingers), the calibration UI's current warnings |
| H5 | The wrist is fixed, so thread length doesn't depend on wrist angle; the servo calibration stays stable within a session | Nothing to change; note it in calibration copy |
| H6 | The glove can't close a full fist: the target `full_fist = 1.0` is physically unreachable by assist. Calibration already defines 100% = the glove-closed relaxed hand, which absorbs this, but **pose targets must be ≤ the glove's max** and "assist settled" must not wait for the impossible | Pose table, engine settle rule, calibration copy |
| H7 | Higher idle current while pulling. The friction calibration (empty glove) matters more for Evaluation | Simulator current model, the evaluation default limit, the friction step stays mandatory for Evaluation |
| H8 | **The virtual hand and the copy assume palm-up.** The patient sees their hand palm-down; the UX rule "say it and show it" calls for showing the hand in the same orientation | `hand3d` camera/orientation, calibration and exercise instructions, the MediaPipe handedness logic |
| H9 | A diagonal, thumb-side view from above: the flexion angles from world landmarks should still work, but occlusion in the fist changes. Handedness from a non-selfie view is unreliable → rely on the configured affected hand | Vision (handedness selection, confidence gating), setup copy (camera placement guide with a diagram) |
| H10 | **Biggest vision risk:** detection on a gloved hand | A vision robustness test on day 1, confidence thresholds, a fallback plan (cut fingertips or bare-hand demo) |
| H11, H12 | No software impact (left hand is already supported via `affected_hand`) | – |

## 3. Design decisions for the update

1. **Variable-length finger arrays, not a fixed 5.** Wire arrays have length `N = info.fingers` (3 or 5), always in the order
   `[thumb, index, middle, ring, pinky]` truncated to N. The firmware builds with `FINGERS = 5` by default and `-DREHAB_FINGERS=3` for
   a 3-servo demo. The app reads `info.fingers` on connect and adapts. Old 3-finger data in the DB stays valid (missing fingers = null).
   - TS: `GloveFinger = FingerId` (all five); `FingerArray = number[]` with length = `gloveFingers.length`; a `useGloveFingers()`
     selector exposes the active list. Py: `GloveFinger = FingerId`. C++: `FINGERS` from a build flag, `MAX_FINGERS = 5` for buffers.
   - Serial line length: a `tel` with 5 values stays under 200 bytes (2-decimal values); verify with a test.
2. **Power-aware assist.** The engine assists the unreached fingers in a **stagger**: starting each finger 150 ms apart and capping the number
   moving at once (default 3), so that 5 simultaneous stalls can't happen. The firmware limits: `LIMIT_DEFAULT_MA = 1500`, `LIMIT_MAX_MA = 2200`
   (below the 2.5 A supply), with a per-build override.
3. **Per-finger servo profiles** (thumb, index, middle, ring, pinky): nominal stall current and speed in `config.h` and the sim, used for the
   simulator realism and the resistance thresholds (weaker servos → lower thresholds). Values are measured on the bench and recorded in `BENCH.md`.
4. **Reachable targets.** The pose table caps every glove-assisted target at `MAX_ASSIST_CLOSURE = 0.95` of the calibrated range;
   `full_fist` becomes 0.95; assist "settled" uses `min(target, servo max)`. The copy says "as far as the glove goes".
5. **Palm-down presentation.** The virtual hand renders palm-down from a front-diagonal view that matches the camera position (thumb side),
   mirrored for the left hand. The calibration and exercise instructions describe the palm-down posture. A "Camera placement" step in Setup with
   a small diagram (30–40 cm, thumb side, above the hand, diagonal).
6. **Vision with a glove.** Use the configured affected hand (ignore MediaPipe handedness when only one hand is visible); a day-1 robustness
   check in Setup ("Hand detected: 92% of the last 5 s") with guidance if it is low. Record real landmark fixtures in the real posture, with the glove.
7. **Ring and pinky are scored and assisted** in all tendon glides; the pinch stays thumb–index.
8. **The NeoPixel ring (24 px):** 5 segments of 4 px with a 1 px gap (thumb, index, middle, ring, pinky = 20 px + 4 gaps).

## 4. Work packages

Wave 0 is done by the coordinator. Waves 1–2 are parallel Codex workers through Orca (same process as `10-orchestration.md`).
**Precondition:** the in-flight visual-metrics PRs are merged first (they touch the same pages and charts).

| WP | Name | Owns | Depends | Wave |
|---|---|---|---|---|
| **F0** | Contract v2 (5 fingers, variable length) + reconcile `main` | `docs/plan/03-contracts.md`, `docs/plan/06-session.md §2`, `frontend/src/contracts/**`, `backend/app/contracts/**`, `firmware/lib/core/protocol.h`, `contracts/fixtures/**`, README merge with main's #26 | metrics PRs merged | 0 (coordinator) |
| **F1** | Firmware: 5 servos, build-flag N, pins 13/4, limits, per-servo profiles, 5-segment ring, native tests for N=3 and N=5, `BENCH.md` for 5 servos + measuring stall currents | `firmware/**` | F0 | 1 |
| **F2** | Glove link + simulator: variable-length codec, `info.fingers` handling, simFirmware N, per-finger servo profiles and power model, patient model for 5 fingers (ring/pinky presets), conformance for N=3 and N=5 | `frontend/src/glove/**` | F0 | 1 |
| **F3** | Engine: scoring/assist/attribution over N fingers, **staggered power-aware assist**, reachable-target cap, evaluation over N fingers (finger subset selectable; 10 sweeps take ~2 min), resistance thresholds per servo profile | `frontend/src/engine/**` | F0 | 1 |
| **F4** | Vision: palm-down diagonal posture, handedness from config, confidence/robustness stats, closure for 5 fingers in calibration (glove closes all 5), glove-detection check API for Setup | `frontend/src/vision/**` | F0 | 1 |
| **F5** | Backend: 5-finger contracts, aggregations, export columns, summary prompts mention all fingers, demo seeder with 5 fingers, tests incl. mixed 3/5-finger history | `backend/**` | F0 | 1 |
| **F6** | Voice: prompt, cues and safety phrases for 5 fingers ("ring", "little finger"), finger naming helper | `frontend/src/voice/**`, `backend/app/voice/**` | F0 | 1 |
| **F7** | Live UI: Setup (telemetry ×N, camera placement step, glove-detection check), Calibrate (N servos, power warning), Exercise meters ×N, attempt feedback hand, Evaluate ×N, `hand3d` palm-down view + 5-finger tint, the `--finger-ring/--finger-pinky` tokens | pages Home/Setup/Calibrate/Exercise/Evaluate, `components/common`, `components/metrics`, `hand3d/**`, `styles/tokens*` (finger tokens only) | F0 (+F2 for sim visuals) | 2 |
| **F8** | Data UI: history, replay, evaluation detail, doctor for N fingers (5 small multiples / hand map with 5 fingers, mixed 3/5 data) | pages History/SessionReplay/EvaluationDetail/Doctor, `components/charts` | F0, F5 | 2 |
| **F9** | Integration + docs: runtime adapts to `info.fingers`, e2e for N=5 and a 3-finger firmware, soak; update `docs/plan/*`, `docs/HARDWARE_CHECKLIST.md` (5 servos, 2.5 A, pins, posture, camera, glove test), `docs/DEMO.md`, README | `frontend/src/runtime/**`, `frontend/e2e/**`, docs | F1–F8 | 3 |

```
F0 ─┬─ F1 firmware ──────────────┐
    ├─ F2 glove+sim ──┬─ F7 live UI ──┐
    ├─ F3 engine ─────┤               ├─ F9 integration + docs
    ├─ F4 vision ─────┤               │
    ├─ F5 backend ────┼─ F8 data UI ──┤
    └─ F6 voice ──────┘───────────────┘
```

## 5. Acceptance criteria (whole update)
1. With 5-finger firmware (or the sim with N=5): calibrate 5 servos, practice the default plan with all 5 fingers scored and assisted, evaluate
   any subset, see 5 fingers in history, replay, the doctor view and export.
2. With a 3-finger firmware build, the same app still works (adapts to `info.fingers = 3`).
3. The simulator never exceeds 2.2 A during a 5-finger assist (stagger verified), and overcurrent still trips in < 100 ms + one tick.
4. The virtual hand is shown palm-down, matching the patient's view; the setup shows the camera placement guide and the glove-detection check.
5. Old 3-finger sessions in the DB still render (ring/pinky shown as "not measured").
6. `make test` and `make e2e` green; firmware native tests for N=3 and N=5.

## 6. Hardware-side actions (for the team, feeding the software)
- Bench (`firmware/BENCH.md`, updated in F1): measure each servo's idle, moving and stall current, and the thumb servo's torque/size. Put the numbers
  in `config.h` (servo profiles) and the overcurrent limit.
- Measure the real closure the glove reaches (how many mm of thread a fist needs) and decide the spool radius; the servo calibration absorbs it.
- On day 1, test MediaPipe detection on the real glove, in the real posture and camera position; record 30 s per pose with
  `make dev-camera` for the vision fixtures (F4).
