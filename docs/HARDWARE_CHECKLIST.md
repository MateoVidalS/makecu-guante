# Event-day hardware checklist

**Team-operated procedure. No hardware checks have been run by the coding worker.**
Start with disconnected tendons and an empty glove/fixture. Never run deliberate
stall, unplug, STOP-fault or resistance tests on a person's hand. The simulator
supplies the pitch's resistance demonstration.

## 1. Record the bench gate before mounting

[firmware/BENCH.md](../firmware/BENCH.md) is the authoritative procedure and evidence
sheet. Its steps **1–7 must pass on the real board and be recorded before anyone
connects a person's hand**. Complete the remaining bench checks too; any failed
check blocks use with a person. Do not treat passing host tests as board evidence.

| Record | Event value / evidence link |
| --- | --- |
| Operator / date / second checker | Pending |
| Board and wiring revision / firmware commit | Pending |
| Servo model / spool radius / tendon routing | Pending |
| Supply / DMM / INA219 shunt | Pending |
| BENCH steps 1–7 results and raw captures | Pending — blocks hand mounting |
| BENCH steps 8–11 results and limitations | Pending |
| STOP / release / watchdog evidence | Pending |
| Decision: fixture only or helper-hand calibration | Pending |

- [ ] Servo power off: check common ground; INA219 in the positive servo rail;
  signal pins and STOP wiring against README. Keep USB/ESP32 power separate from
  the servo supply. Verify 5.0 V on a DMM; supply limit 1.5 A.
- [ ] Inspect tendons, anchors, guides, spools, strain relief and quick removal.
  No sharp edges, loose connections, crossed threads or trapped fingers.
- [ ] Verify the physical STOP is reachable with the free hand and by the helper;
  the power switch must also be reachable. A browser button is an extra layer.
- [ ] On the fixture, verify no boot twitch, bounded jogging, calibrated ranges,
  current cut-off, latched STOP, and watchdog/release behavior using BENCH.
- [ ] Confirm the current sensor agrees with the DMM. Do not increase the limit
  to hide friction or repeated stops. Diagnose the mechanism on the bench.
- [ ] Capture the evidence and obtain the team's go/no-go decision above.

## 2. Mount only after the gate passes

- [ ] Power off/released and tendons slack. Check the helper can remove the glove
  quickly. Mount to a mannequin first; a helper's hand is allowed only after the
  recorded bench gate. Never start on a patient.
- [ ] Confirm comfortable alignment and intended finger/channel mapping
  (thumb, index, middle). Ring and pinky are observed, not actuated.
- [ ] Stop immediately for pain, tightness, numbness, unexpected travel, heat,
  sound, sensor mismatch, or failure to unwind. Power off and return to the bench.
- [ ] Keep the helper next to STOP throughout any person-mounted movement.

## 3. Run a fresh calibration wizard

Open Chrome/Edge → Setup. Pick the serial glove and camera explicitly. Keep
simulated/seeded ranges out of the real calibration; the seed demonstrates history,
not the mechanical limits of this mounting.

- [ ] Connect the correct USB port; check the firmware identity and sensor status.
  Board reset forgets calibration; reconnect must restore the approved ranges.
- [ ] Calibrate → **Glove range**. Keep the hand relaxed, use small jog increments,
  capture comfortable open and closed positions for each actuated finger. Do not
  chase full closure or copy example degrees. Release before saving each range.
- [ ] **Camera range**. Confirm affected hand, lighting, full-hand visibility and
  fingertip clearance; capture open, relaxed glove-closed, and pinch references.
  Repeat a capture if movement/tracking makes it unreliable.
- [ ] **Glove friction** measures an **empty glove only**. Remove the glove from
  the hand before running it; skip this step if that cannot be done safely. Never
  run empty-glove sweeps with a person's hand inside. Record “not measured” when
  skipped; resistance is less specific without a baseline.
- [ ] Review every range, camera capture and current limit. Save; verify **Saved**.
  Redo calibration after remounting, rerouting tendons or changing mechanics.

## 4. Dry run, then presentation

- [ ] Follow [DEMO.md](DEMO.md) preflight: seed, volume, camera, permissions,
  optional Gemini access, and both simulator fallbacks rehearsed.
- [ ] Start with one comfortable pose and one repetition. Check open/release,
  visual target, camera tracking, assistance labels and voice/captions.
- [ ] End session and verify release before removal. Do not cause faults on a
  hand to prove safety. Use SimWorld Rigid index for the key demo moment.
- [ ] Rehearse **Demo recovery → Use simulated glove / camera** and **Use simple
  voice**. Each source change ends the run; start a new run after recovery.
- [ ] Check History/replay and flagged demo trends, Doctor view, summary fallback,
  JSON/CSV export, and print labels.
- [ ] For uncertain release: STOP, cut servo power, remove safely with the helper,
  return to fixture-only use. A simulator-ready message does not prove the old
  physical glove has released.

| Dry-run result | Value |
| --- | --- |
| Calibration ID / mounting reference | Pending |
| Helper / observer | Pending |
| Practice / voice / tracking | Pending |
| Simulator handoff wall time (target <5 s) | Pending |
| Saved history / replay / export | Pending |
| Go/no-go and unresolved limitations | Pending |

Pack laptop/charger, tested data USB cable plus spare, separate regulated supply,
DMM, spare servo/board, STOP switch, glove, tendons/guides/anchors, tape/Velcro,
strain relief, and the recorded bench evidence. Keep the fully simulated demo
ready even when hardware passes.
