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
| BENCH steps 8–13 results and limitations | Pending |
| STOP / release / watchdog evidence | Pending |
| Upright wrist-module decision: strap fit / weight / thread exit / gravity | Pending — blocks hand mounting |
| Decision: fixture only or helper-hand calibration | Pending |

- [ ] Servo power off: check common ground; INA219 in the positive servo rail;
  signal pins and STOP wiring against README. Keep USB/ESP32 power separate from
  the servo supply. Verify 5.0 V on a DMM; supply limit **2.5 A**. Fit a correctly polarized **470–1000 µF**
  capacitor across the servo 5 V/GND rail near the connectors.
- [ ] Inspect tendons, anchors, guides, spools, strain relief and quick removal.
  No sharp edges, loose connections, crossed threads or trapped fingers.
- [ ] **Open hardware question — team decision required:** the wrist module was
  designed to rest on the table with the palm down. With the hand upright it hangs
  from the forearm. Do both straps prevent slipping without tightening excessively?
  Is the hanging weight comfortable, and does the vertical wrist preserve a clear
  thread exit angle without rubbing, snagging or unwanted tension? Check how
  gravity changes elastic return and servo pull. Verify on an empty fixture first;
  record the team's decision and evidence above before any hand mounting. The old
  table-supported mounting does not establish this.
- [ ] Verify the physical STOP is reachable with the free hand and by the helper;
  the power switch must also be reachable. A browser button is an extra layer.
- [ ] On the fixture, verify no boot twitch, bounded jogging, calibrated ranges,
  current cut-off, latched STOP, and watchdog/release behavior using BENCH.
- [ ] Verify all five servos can remain attached at once, including the fifth
  channel. Firmware allocates **two LEDC timers** (PR #39); see BENCH step 4.
  Check GPIO4/13 boot behavior and no reset during five-servo startup.
- [ ] Confirm the current sensor agrees with the DMM. Do not increase the limit
  to hide friction or repeated stops. Diagnose the mechanism on the bench.
- [ ] Capture the evidence and obtain the team's go/no-go decision above.

## 2. Mount only after the gate passes

- [ ] Power off/released and tendons slack. Check the helper can remove the glove
  quickly. Mount to a mannequin first; a helper's hand is allowed only after the
  recorded bench gate. Never start on a patient.
- [ ] Confirm comfortable alignment and intended finger/channel mapping
  **all five actuated fingers**: thumb GPIO25, index GPIO26, middle GPIO27,
  ring GPIO13, little finger GPIO4 (wire indices 0–4).
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
  capture comfortable open and closed positions for all five actuated fingers. Do not
  chase full closure or copy example degrees. Release before saving each range.
- [ ] **Posture**: sit facing the laptop, raise the affected hand upright beside
  the face, palm toward the screen, and open/close toward the camera. Keep the
  forearm vertical and the elbow supported on the table with comfortable padding;
  do not hold the arm unsupported. Confirm the upright module decision above.
- [ ] **Camera placement**: select the laptop's front webcam. Start with the hand
  about 40–60 cm from the laptop; adjust the screen to keep the wrist, whole hand
  and all five fingertips in frame without lifting the elbow.
- [ ] **Backlight check**: no window or bright light behind the person. Use
  diffuse light from in front or the side; check the preview for a clearly lit
  palm and fingers before capturing calibration.
- [ ] **Day-1 glove detection check**: with the actual light, thin light glove,
  thin light threads and upright posture, observe Setup’s detected fraction over
  five seconds while opening and closing. The camera now sees palm-side threads,
  guides and anchors; record the percentage, lighting and any joint occlusions.
  Low detection blocks the physical-camera demo; adjust light/framing or have the
  team assess exposed fingertips/bare-hand vision. Repeat for the configured
  affected hand; that setting remains authoritative, with selfie handedness as a
  cross-check. Repeat the check at the event if conditions change.
- [ ] **Camera range**. Confirm affected hand, lighting, full-hand visibility and
  fingertip clearance; capture open, relaxed glove-closed, and pinch references.
  Capture in the upright posture; old palm-down/diagonal camera calibration must
  be replaced. Repeat a capture if movement/tracking makes it unreliable.
- [ ] **Review** every servo range and camera capture, then save calibration.
  The wizard has three steps: Glove range → Camera range → Review.
  Empty-glove friction belongs to Evaluate preflight, off the hand. If it cannot
  be measured safely, leave evaluation unavailable and use practice only.
- [ ] Before evaluation, measure complete slow/fast friction for all five
  fingers with an empty glove. Refresh it when missing or older than 24 hours;
  reject aborted/incomplete curves, then put the glove back on and reconfirm the
  relaxed-hand checklist. A skipped baseline still permits practice.
- [ ] Review every range, camera capture and current limit (firmware default
  1500 mA, maximum 2200 mA; choose only a bench-approved limit). Save; verify **Saved**.
  Redo calibration after remounting, rerouting tendons or changing mechanics.

## 4. Dry run, then presentation

- [ ] Follow [DEMO.md](DEMO.md) preflight: seed, volume, camera, permissions,
  optional Gemini access, and both simulator fallbacks rehearsed.
- [ ] Start with one comfortable pose and one repetition. Check open/release,
  visual target, camera tracking, assistance labels and voice/captions.
- [ ] Keep the elbow supported throughout. Ask about fatigue from holding the
  hand up; use short sets and rests, and pause/release if the posture tires the
  person. Recheck framing after a rest before continuing.
- [ ] End session and verify release before removal. Do not cause faults on a
  hand to prove safety. Use SimWorld Rigid index for the key demo moment.
- [ ] Rehearse **Demo tools → Use simulated glove / camera** and **Use simple
  voice**. Each source change ends the run; start a new run after recovery.
- [ ] Check History/replay and flagged demo trends, Doctor view, summary fallback,
  JSON/CSV export, and print labels.
- [ ] For uncertain release: STOP, cut servo power, remove safely with the helper,
  return to fixture-only use. A simulator-ready message does not prove the old
  physical glove has released.

| Dry-run result | Value |
| --- | --- |
| Calibration ID / mounting reference | Pending |
| Five channel mapping / fifth PWM output | Pending |
| Upright module fit / elbow support / backlight check | Pending |
| Glove detection fraction / posture / camera evidence | Pending |
| Slow/fast empty-glove friction timestamp / completeness | Pending |
| Helper / observer | Pending |
| Practice / voice / tracking | Pending |
| Simulator handoff wall time (target <5 s) | Pending |
| Saved history / replay / export | Pending |
| Go/no-go and unresolved limitations | Pending |

Pack laptop/charger, tested data USB cable plus spare, separate regulated supply,
DMM, spare servo/board, STOP switch, glove, tendons/guides/anchors, tape/Velcro,
strain relief, and the recorded bench evidence. Keep the fully simulated demo
ready even when hardware passes.
