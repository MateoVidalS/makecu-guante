# WP2 — Glove link: Web Serial client, codec, SimWorld

**Goal:** the browser side of the glove: a robust Web Serial client and a **firmware-faithful simulator** (glove + patient + camera), so all software can be
built, tested and demoed without hardware.

**Read:** `AGENTS.md`, **`docs/plan/03-contracts.md §2–3`**, **`docs/plan/05-vision-and-glove-link.md` Part A**, `docs/plan/04-firmware.md §3–4`
(the semantics your sim must match), `docs/plan/06-session.md §2–3` (what the sim patient reacts to).

**You own:** `frontend/src/glove/**` (including `sim/`) and its tests.

## Deliverables
- [ ] `codec.ts` + tests against `contracts/fixtures/serial_lines.txt` / `.expected.json`.
- [ ] `webSerialGlove.ts` (`GloveClient`): connect/reconnect, line reader, keepalive, follow throttling, release priority, disconnect handling,
      `beforeunload` release, the unsupported-browser error. Testable through an injected fake `SerialPort`.
- [ ] `sim/simFirmware.ts` (a TS port of the firmware state machine with the contract constants), `sim/patient.ts` (presets mild/moderate/severe,
      stiffness model, rigid flag, intent from the engine phase via `world.setIntent(pose, phase)`), `sim/simWorld.ts` (the clock: real-time or
      `timeScale`, a seeded RNG), `sim/simGlove.ts` (`GloveClient`), `sim/simVision.ts` (`VisionSource`, joints via `jointsFromClosure`; until WP6 merges,
      use a local linear fallback), dev controls (`world.controls.pressStop()`, `.unplug()`, `.setRigid(finger, bool)`, `.handOutOfFrame(ms)`, `.setPreset()`).
- [ ] `sim/conformance.test.ts`: the firmware behavior table (`04-firmware.md §4`) run against `simFirmware`, plus overcurrent with the rigid index during a
      target ramp, and watchdog after `unplug`.
- [ ] `GloveProvider` / `useGlove()` (replacing the WP0 stub; same exports): active client, `setKind`, connection, telemetry selector subscription, events log (last 100).

## Acceptance criteria
- [ ] The codec handles every fixture line correctly; malformed lines are counted and never throw.
- [ ] The conformance suite passes, and every row is named after the spec rule it checks.
- [ ] SimGlove: `target([1,1,1],0.3)` with the "moderate" preset completes in ~3.3 s, and the current stays under 900 mA; with rigid index, it faults with
      `overcurrent` between pos 0.25–0.4.
- [ ] Telemetry at 50 Hz ± 5%, and no timer drift over a 10-minute simulated run.
- [ ] Web Serial is manually verified if hardware is available. Otherwise, use the fake-port tests + a note in the PR.
