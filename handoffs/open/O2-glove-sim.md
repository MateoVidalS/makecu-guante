# O2 — Glove link + simulator for the opening glove (owns `frontend/src/glove/**`)

Read `handoffs/open/COMMON.md` first, then `docs/plan/15-open-assist.md` §1, §2 and §4.2. The sim's firmware conformance is a safety review item.

## Build
1. **`sim/simFirmware.ts`** mirrors O1 exactly: in run (follow and target), a servo whose goal is below its pull unwinds at `V_RELEASE`
   (3.0/s); winding uses `V_FOLLOW` (follow) or `min(v, V_MAX)` (target). `FOLLOW_SLACK = 0.08`. Release, fault, watchdog, STOP unchanged
   (pull → 0). Update `sim/conformance.test.ts` with the same cases as the firmware native tests (see `handoffs/open/O1-firmware.md` §4).
2. **Patient model (`sim/patient.ts`) inverted.** Per finger:
   - `rest` closure (where the hand sits when the glove is slack; flexed after a stroke),
   - active range `[active_min, active_max]` (most open / most closed the patient reaches alone),
   - `tone_ma_per_unit` (sustained current per unit of stretch past `rest` toward open),
   - a velocity-dependent term (stretch reflex: extra current proportional to opening speed above a threshold),
   - optional `rigid_floor` (the finger cannot be opened past this closure).
   The patient's own closure follows its intent within the active range (fist attempts → toward `active_max`, open attempts → toward
   `active_min`, otherwise → `rest`). **Real closure** = `max(rigid_floor ?? 0, min(patient_closure, closureFromPull(pull)))` + noise.
   The glove can only make a finger more open, never more closed.
3. **Current (`patient.ts` `servoCurrents`, `power.ts`):** per servo = idle + moving term + **sustained tone load** when the glove holds a
   finger more open than the patient would be on their own (`max(0, patient_closure − real_closure) × tone`) + velocity term + stall when
   the commanded pull exceeds what the finger can reach (rigid floor) or the servo profile's torque; unwinding unloads. Total through
   `supplyPower` as today.
4. **Presets** (used by `SimulatorControls` in O4 and by tests): `demo` (no tone, rest 0.2, opens fully alone), `mild` (rest 0.6, opens
   alone to 0.3, low tone), `moderate` (rest 0.75, opens alone to 0.55, moderate tone), `spastic` (rest 0.85, opens alone to 0.75, high
   tone, strong velocity term), `rigid_index` (moderate + index `rigid_floor` 0.6). Export them with stable ids and labels; keep the
   existing exports working or update every caller inside `glove/**` (callers outside your paths: list them in the PR for O4/O7).
5. `simVision.ts` reports the real closure.
6. `webSerialGlove.ts` / `codec.ts`: no protocol change; update comments to pull. The release-jumps-the-queue rule stays.

## Tests
- Conformance with the firmware rules above.
- Physics: pull can only lower closure; slack returns the finger to `rest` (or the patient's intent); rigid floor holds; tone current
  rises while held open and falls to idle when slack; a fast fist with the glove following never produces a stall (the thread pays out).
- Power: 5 fingers held fully open (pull 0.95) on `spastic` exceeds 2.2 A **without** a governor (so O3's governor has something to
  prevent; document the number), and stays under 1.5 A on `demo`.

## Acceptance
`make test` green; diff only under `frontend/src/glove/**`; the PR documents the model equations and preset numbers.
