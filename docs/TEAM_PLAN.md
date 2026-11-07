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
| 1.4 | Measure each servo's idle, moving and **stall** current, and the empty glove closing all five together | Hardware | Numbers in BENCH; Firmware agent updates `SERVO_PROFILES` in `firmware/include/config.h` |
| 1.5 | Start all five servos together and check the ESP32 **does not reset** (brown-out). If it does, add capacitance or stagger | Hardware | No reset over 10 tries (`evt boot` with `reset_reason` 9 = brown-out) |
| 1.6 | Prove every safety stop on a fixture: overcurrent (100 ms), STOP button, watchdog (pull USB, release ≤ 1005 ms), INA219 missing | Hardware | BENCH rows 5–8 passed with evidence |
| 1.7 | **Decide the current limit.** Today the board cuts only on total current > 1500 mA; a single rigid finger (~650–800 mA, estimated) does not reach it. With the measured numbers, lower the default if the five-finger fist allows it | Hardware + Firmware | New default in `config.h` (or 1500 kept on purpose), written in BENCH |

## 2. Mechanics on a mannequin or empty glove

| # | Task | Owner | Done when |
|---|---|---|---|
| 2.1 | Sew the guides and fingertip anchors on a **light, thin glove**; mount the module with the two straps | Hardware | Threads run straight from each spool to its fingertip |
| 2.2 | Measure the thread a full fist needs (estimate 40–45 mm; a 10 mm spool gives ~31 mm per 180°, ~70% of a fist). If short, raise the spool radius in `hardware/cad/piezas.py` and reprint | Hardware | Real closure measured; spool radius decided |
| 2.3 | Check elastics on the back open every finger when the servo releases | Hardware | All five reopen without help |

## 3. Camera and vision on the real glove (day 1)

| # | Task | Owner | Done when |
|---|---|---|---|
| 3.1 | Place the webcam in front, on the thumb side, diagonal, 30–40 cm from the fingers and above the hand; palm down at the table edge | Hardware | Setup page shows the hand detected most of the time |
| 3.2 | Test MediaPipe detection **with the glove on** in that posture. If it fails, try a lighter glove or cut fingertips | Hardware | Detection is stable in every pose |
| 3.3 | Record real landmark clips per pose for the vision fixtures | Hardware → Software | Clips handed to the software agent |

## 4. Software follow-ups (software agent)

| # | Task | Owner |
|---|---|---|
| 4.1 | Show a brown-out reset in Setup: the board sends `reset_reason` in `evt boot` and the app drops it today | Software |
| 4.2 | Contract fixes: the `info` example says `"fw":"0.2.0"` but firmware and fixture say `0.1.0`; `calib_ok` text still says "3 fingers"; document `reset_reason` | Software / coordinator |
| 4.3 | Rigid-finger case: make sure a rigid finger always ends in a resistance stop or an overcurrent fault during assist, for every finger (brief F9) | Software |
| 4.4 | Flag calibrations that would show more than 100% (brief F9) | Software |
| 4.5 | The e2e test "simulated STOP, disconnect and camera loss" fails when the machine is under heavy load; make it robust | Software |

## 5. Full system, then the demo

| # | Task | Owner | Done when |
|---|---|---|---|
| 5.1 | Run `docs/HARDWARE_CHECKLIST.md`: bench gate recorded, mount on a mannequin first, then a helper's hand | Hardware | Go/no-go written down |
| 5.2 | Fresh calibration wizard on the real glove (5 servo ranges, camera range, empty-glove friction) | Hardware | Calibration saved |
| 5.3 | **Milestone: one finger end to end** — follow, assist, current cut-off — then the other four | Hardware + Software | One finger closes with its servo, then all five |
| 5.4 | Gemini with the real key: `/api/health` says `gemini: true`; rehearse voice and a summary | Software | Voice coach and summary work live |
| 5.5 | Rehearse `docs/DEMO.md`, including the recovery menu, and record the Devpost video | Everyone | Six-minute demo runs twice without help |

## Rules that do not change

- The board enforces safety on its own (range, speed, current, STOP, watchdog); the browser is an extra layer, never the only one.
- Never repeat a fault against resistance, never stall a person's finger on purpose, never raise the current limit to hide friction.
- Hardware tests happen on a fixture or empty glove before anyone wears it.
