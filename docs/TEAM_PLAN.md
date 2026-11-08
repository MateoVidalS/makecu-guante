# Team plan: what is left to build the glove

The software (app, backend, simulator, voice) and the five-finger firmware are on `main` and tested on the host.
**Nothing has run on real hardware yet.** This is what the team still has to do, in order, and who owns it.
Each step points to the document that has the details; this page is the map.

Owners: **Hardware** = the people with the board, servos and glove. **Software** = the agent working on the app.
**Firmware** = the firmware agent (`firmware/**` only). Never flash the board or move servos on a person outside these steps.

## 0. Today's blockers (do first)

| # | Task | Owner | Done when |
|---|---|---|---|
| 0.1 | Identify the black thumb servo: body size, torque, pulse range. Its housing in the module is 1.5 mm larger | Hardware | Model and measurements written in `firmware/BENCH.md` → "Measure each actual servo" |
| 0.2 | Check the 1.5 mm gap between the front spools with the real servos | Hardware | Gap confirmed, or `hardware/cad/piezas.py` adjusted |
| 0.3 | Print the wrist module, lid and 5 spools (`hardware/definitivas/2_...`). Mirror module and lid for a left hand | Hardware | Parts printed and test-fitted |

## 1. Electrical bench, glove off (gate for everything else)

Follow `firmware/BENCH.md` step by step and fill in its Results table. Summary of what matters most:

| # | Task | Owner | Done when |
|---|---|---|---|
| 1.1 | Wire on the breadboard: 5 V supply **limited to 2.5 A** → INA219 → servo rail, **470–1000 µF capacitor** across the rail, common GND, STOP on GPIO32, ring via the level shifter. Servo signals: thumb 25, index 26, middle 27, ring 13, pinky 4 | Hardware | 5.0 V measured with the DMM before any servo is plugged in |
| 1.2 | Flash with `make fw-flash`, open the serial monitor at 115200 | Hardware | `evt boot` + `info` with `"fingers":5`, no servo twitch at boot |
| 1.3 | Jog each finger 0–4 alone, then attach **all five at once** and confirm the fifth moves (two PWM timers, PR #39) | Hardware | All five channels move; mapping finger ↔ servo correct |
| 1.4 | Measure each servo's idle, moving and **stall** current, and the hand-shaped fixture opening all five together | Hardware | Numbers in BENCH; Firmware agent updates `SERVO_PROFILES` in `firmware/include/config.h` |
| 1.5 | Start all five servos together and check the ESP32 **does not reset** (brown-out). If it does, add capacitance or stagger | Hardware | No reset over 10 tries (`evt boot` with `reset_reason` 9 = brown-out) |
| 1.6 | Prove every safety stop on a fixture: overcurrent (100 ms), STOP button, watchdog (pull USB, release ≤ 1005 ms), INA219 missing | Hardware | BENCH rows 5–8 passed with evidence |
| 1.7 | **Decide the current limit.** Today the board cuts only on total current > 1500 mA; a single rigid finger (~650–800 mA, estimated) does not reach it. With the measured numbers, lower the default if the five-finger fist allows it | Hardware + Firmware | New default in `config.h` (or 1500 kept on purpose), written in BENCH |

## 2. Mechanics on a hand-shaped fixture

| # | Task | Owner | Done when |
|---|---|---|---|
| 2.1 | Attach small BLACK guides to the backs of proximal and middle phalanges and YELLOW anchors to the backs of fingertips with skin-safe tape, directly on skin after fixture gates pass; hardware must confirm the attachment method and exact positions/sizes; mount the module with the two straps | Hardware | Threads run over the back of each finger and open the hand; no palm-side joint crease is covered |
| 2.2 | Measure the thread a full fist needs (estimate 40–45 mm; a 10 mm spool gives ~31 mm per 180°, ~70% of a fist). If short, raise the spool radius in `hardware/cad/piezas.py` and reprint | Hardware | Real closure measured; spool radius decided |
| 2.3 | Check elastics on the back open every finger when the servo releases | Hardware | All five reopen without help |

## 3. Camera and vision on the bare hand with points (day 1)

| # | Task | Owner | Done when |
|---|---|---|---|
| 3.1 | Use the laptop front webcam, upright bare palm toward the screen, elbow supported, about 40–60 cm away; good front light, sleeve up, no rings/watch | Hardware | Setup page shows the hand detected most of the time |
| 3.2 | Check bare-hand-with-points detection in Setup in that posture; keep points/tape off palm-side joint creases, adjust light/framing if needed | Hardware | Detection is stable in every pose |
| 3.3 | Record real landmark clips per pose with `frontend/src/vision/recorder.ts`, covering `bare-hand-points` (see DEV for current metadata limitation); add/complete the bench’s new **points** section | Hardware → Software | Clips handed to the software agent |

## 4. Software follow-ups (software agent)

| # | Task | Owner |
|---|---|---|
| 4.1 | Show a brown-out reset in Setup: the board sends `reset_reason` in `evt boot` (9 = brown-out, now in the contract) and the app drops it today | Software |
| 4.2 | ~~Contract fixes (fw version, `calib_ok` = 5 fingers, `reset_reason`)~~ Done in `1666a82` | Coordinator |
| 4.3 | Rigid-finger case: make sure a rigid finger always ends in a resistance stop or an overcurrent fault during assist, for every finger (brief F9) | Software |
| 4.4 | Flag calibrations that would show more than 100% (brief F9) | Software |
| 4.5 | The e2e test "simulated STOP, disconnect and camera loss" fails when the machine is under heavy load; make it robust | Software |

## 5. Full system, then the demo

| # | Task | Owner | Done when |
|---|---|---|---|
| 5.1 | Run `docs/HARDWARE_CHECKLIST.md`: bench gate recorded, mount on a mannequin first, then a helper's hand | Hardware | Go/no-go written down |
| 5.2 | Fresh calibration wizard (5 servo ranges, camera range, review); Evaluate preflight: **Thread friction (unhooked)**, each thread unhooked from its YELLOW anchor, hand relaxed (or hand-shaped fixture with guides attached the same way); re-hook before evaluation | Hardware | Calibration saved |
| 5.3 | **Milestone: one finger end to end** — follow, assist, current cut-off — then the other four | Hardware + Software | One finger closes with its servo, then all five |
| 5.4 | Gemini with the real key: `/api/health` says `gemini: true`; rehearse voice and a summary | Software | Voice coach and summary work live |
| 5.5 | Rehearse `docs/DEMO.md`, including the recovery menu, and record the Devpost video | Everyone | Six-minute demo runs twice without help |

## Rules that do not change

- The board enforces safety on its own (range, speed, current, STOP, watchdog); the browser is an extra layer, never the only one.
- Never repeat a fault against resistance, never stall a person's finger on purpose, never raise the current limit to hide friction.
- Hardware tests happen on a hand-shaped fixture before anything is attached to a person.
- Re-attaching guides or anchors requires fresh glove (servo) calibration before practice: full pull is set at straight fingers; a moved anchor can over-straighten a finger.
- Check skin before and after every session for redness, marks or pain; post-stroke patients may not feel rubbing.
- The app retains the device name "glove"; the webcam sees a bare palm, MediaPipe’s best case. See [16-bare-hand.md](plan/16-bare-hand.md).
