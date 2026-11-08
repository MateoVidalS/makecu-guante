# O4 — Runtime, Setup and Calibrate for the opening glove (owns `frontend/src/runtime/**`, `frontend/src/pages/Setup/**`, `frontend/src/pages/Calibrate/**`)

Read `handoffs/open/COMMON.md` first, then `docs/plan/15-open-assist.md` §1, §2, §4.4 and `docs/plan/11-ux-design.md` (tokens, copy, accessibility).

## Build
1. **Calibration validity** (`runtime/calibrationValidation.ts` and the shared calibration-status selector): a calibration whose
   `assist_direction !== CURRENT_ASSIST_DIRECTION` (absent = `'close'`) is **calibration needed**, with a specific reason ("The glove now
   helps the hand open. Calibrate it again."), alongside the existing `camera_view` rule. `calibration.save()` always writes
   `assist_direction: 'open'`. The simulator shortcut calibration also writes `'open'`.
2. **Servo step** (`pages/Calibrate`): per finger, two jog targets renamed and re-explained:
   - **Slack:** "Make a relaxed full fist. Jog until the thread is just taut." → `min_deg`.
   - **Open:** "Jog until the finger is straight. Never bend it back." → `max_deg`.
   Keep the ≥ 20° rule, the mannequin/helper-hand warning, and the existing jog → release → calib ordering. Add a visible
   hyperextension warning on the Open control.
3. **Camera step:** **Closed** = always the patient's own fist, held still (remove the glove-closes path). **Open** = "Relax. The glove
   opens all five fingers in stages." using the existing staged helper (`closure.ts`) inverted: it raises pull in stages through
   `client.target` at ≤ 0.3/s, capped at `MAX_ASSIST_PULL`, stops on resistance/overcurrent like today, and captures the open raw flex.
   With a simulated glove and the real camera, Open is the patient's own open hand. Pinch unchanged.
4. **Setup copy:** the glove helps the hand open; the hand rests curled when the glove is slack, and that is normal.
5. **Runtime:** wire the sim presets from O2 (`demo`, `mild`, `moderate`, `spastic`, `rigid_index`) into `SimulatorControls`
   (default `moderate`); if O2 is not merged yet, code against its documented ids and keep a fallback. Pass the active current limit to
   the exercise engine if O3 exposes the option. Nothing else in the runtime should convert closure/pull by hand.

## Tests
Validation (absent / `'close'` / `'open'`), save writes `'open'`, the staged open capture (stages rise, cap, abort on fault), the servo step
labels and order, the simulator shortcut, Setup copy; existing browser specs updated. `make test` and `make e2e` green.

## Acceptance
Diff only in the owned paths; e2e green; screenshots of the new Calibrate steps in the PR.
