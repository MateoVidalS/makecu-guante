# Event-day hardware checklist

**Team-operated procedure. No hardware checks have been run by the coding worker.**
Start with disconnected tendons and a hand-shaped fixture. Never run deliberate
stall, unplug, STOP-fault or resistance tests on a person's hand. The simulator
supplies the pitch's resistance demonstration.

## 1. Record the bench gate before mounting

[firmware/BENCH.md](../firmware/BENCH.md) is the authoritative procedure and evidence
sheet. Its steps **1–7 must pass on the real board and be recorded before anyone
connects a person's hand**. The ordered **Opening glove gate** at the end of BENCH must also pass; its permitted fixture/volunteer stages are authoritative. Complete the remaining bench checks too; any failed
check blocks use with a person. Do not treat passing host tests as board evidence.

Read [Matias' first bench session, 7 Nov 2026](../hardware/BANCO.md) before
wiring. It records unloaded jogs and STOP observations, with no INA219 connected;
it does **not** pass the BENCH gate. The actual Facmogu adapter has **no current
limit**, and the MB102 breadboard regulator is insufficient for glove practice.
Use the checks below instead of assuming the laboratory supply described elsewhere
is the supply on the bench.

| Record | Event value / evidence link |
| --- | --- |
| Operator / date / second checker | Pending |
| Board and wiring revision / firmware commit | Pending |
| Servo model / spool radius / tendon routing | Pending |
| Supply / DMM / INA219 shunt | Pending |
| Fuse or current-limited supply / measured 5 V rail / polarity | Pending |
| INA219 wired and checked / 800 mA cut-off evidence | Pending — blocks practice |
| BENCH steps 1–7 results and raw captures | Pending — blocks hand mounting |
| BENCH steps 8–13 results and limitations | Pending |
| STOP / release / watchdog evidence | Pending |
| Upright wrist-module decision: strap fit / weight / thread exit / gravity | Pending — blocks hand mounting |
| Dorsal winding opens all five fingers / routing evidence | Pending — opening gate 1 |
| Slack/open endpoints / neutral straight limit, no hyperextension | Pending — opening gate 2 |
| Extension strength / single-finger 2 s hold / measured current | Pending — opening gate 3 |
| Five-finger sustained hold / total current below approved limit | Pending — opening gate 4 |
| STOP while held open → slack <0.5 s (fixture) | Pending — opening gate 5 |
| Fast fist during follow / no overcurrent | Pending — opening gate 6 |
| Remaining opening fault/recovery checks | Pending — opening gate 7 |
| Decision: fixture only or helper-hand calibration | Pending |

- [ ] Servo power off: check common ground, signal pins and STOP wiring. Keep
  USB/ESP32 power separate from servo power. **Measure breadboard rail polarity
  with a multimeter before connecting servos**; do not infer +/− from row position.
  BANCO records reversed red/brown servo leads causing heat within seconds.
- [ ] **INA219 required before any physical practice:** wire it in the positive
  servo rail and verify sensor/current readings against the DMM. Without it the
  firmware refuses assistance (`target`/`follow`); `jog` still works and a zero
  `ma` reading without a sensor does not establish safe current.
- [ ] **Demo power protection:** the actual Facmogu adapter has no adjustable
  current limit; its 5 A rating is not a safety cut-off. Use a team-selected fuse
  or a current-limited supply for the demo. With a limited supply, retain the
  bench procedure's **2.5 A** limit. Verify the servo rail is **5.0 V** with a DMM.
  For glove practice, power the rail directly from the 5 V supply through the
  INA219, bypassing the MB102; fit a correctly polarized **470–1000 µF** capacitor
  near the servo connectors. Record the protection and wiring decision above.
- [ ] **MB102 is for single-servo bench tests only (~0.8 A maximum)**, never
  five-servo glove practice. If using it on the empty bench, set both rail jumpers
  to **5V**, measure the output, and keep the Facmogu input **at or below 9 V**:
  the recorded MB102 capacitor is rated 10 V. Its onboard capacitor does not
  replace the glove's dedicated servo-rail capacitor.
- [ ] Inspect tendons, anchors, guides, spools, strain relief and quick removal.
  No sharp edges, loose connections, crossed threads or trapped fingers.
  Confirm **dorsal routing**: winding must straighten every finger on an empty
  fixture. If it closes a finger, stop and reroute before calibration.
- [ ] Complete BENCH opening gates in order. Extension strength must open one
  moderately resisted fixture finger and hold 2 s under the limit; record current.
  If it fails, revise servo/spool/lever hardware and repeat the gate. Record the
  five-finger hold current, fixture STOP-to-slack <0.5 s and fast follow payout.
  Keep all independent firmware safety limits active.
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
- [ ] **Manual bench keepalive:** while jogging with the repository firmware,
  send `ping` about every **300 ms** (`{"t":"ping"}` plus newline). A manual
  serial console needs a keepalive sender; a single jog command is insufficient.
  Without valid messages the watchdog releases/faults after more than 1 s. Never
  disable or lengthen it to make manual testing easier.
- [ ] Verify all five servos can remain attached at once, including the fifth
  channel. Firmware allocates **two LEDC timers** (PR #39); see BENCH step 4.
  Check GPIO4/13 boot behavior and no reset during five-servo startup.
- [ ] Confirm the current sensor agrees with the DMM. Do not increase the limit
  to hide friction or repeated stops. Diagnose the mechanism on the bench.
- [ ] With the INA219 working and the fuse/limited supply in place, test the
  low-current cut-off on an **empty fixture**, following BENCH step 7: `limit 800`
  means send `{"t":"limit","ma":800}` plus newline. Record the measured current,
  overcurrent event and release. This is an 800 mA firmware threshold, not a
  supply current limit or an approved patient setting. Never test the cut on a
  person's hand; the bench team still must approve the practice limit.
- [ ] Capture the evidence and obtain the team's go/no-go decision above.

## 2. Mount only after the gate passes

- [ ] Test all hardware on a **hand-shaped fixture before anything is attached to
  a person**. Small BLACK guides go on the backs of proximal and middle phalanges;
  YELLOW anchors go on the backs of fingertips. Attach directly to skin with
  skin-safe tape; the hardware team must confirm the attachment method and exact
  positions/sizes. The device remains named "glove" in the app.
- [ ] Check skin before and after every session for redness, marks or pain.
  Post-stroke patients may not feel rubbing. Stop and review any skin concern.
- [ ] Re-attaching any guide or anchor requires fresh glove (servo) calibration
  before practice. Full pull is set at straight fingers; a moved anchor can
  over-straighten a finger.

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
  capture **Slack** with a relaxed fist and the dorsal tendon just taut, then
  **Open** at a straight, neutral finger, never bent back. Require ≥20° separation
  within 5–175°. Pull 0 at `min` must release to slack; pull 1 at `max` opens.
  Never swap endpoints to invert routing, and never copy example degrees.
  Release before saving each range. Legacy closing calibrations must be redone.
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
- [ ] **Day-1 bare-hand-with-points detection check**: with the actual BLACK dorsal
  proximal/middle-phalange guide points, YELLOW dorsal fingertip anchors,
  dorsal threads and upright posture, observe Setup’s detected fraction over
  five seconds while opening and closing. The camera sees the palm; check whether dorsal routing leaves
  guides or anchors visible; record the percentage, lighting and any joint occlusions.
  Keep points/tape off palm-side joint creases; sleeve up, no rings/watch, good
  front light. Save a real landmark recording with `frontend/src/vision/recorder.ts`
  covering `bare-hand-points`; record results in the bench’s new **points** section
  (team to add/complete). See DEV for the current recorder metadata limitation.
  Low detection blocks the physical-camera demo; adjust light/framing or have the
  team assess point placement and bare-hand tracking. Repeat for the configured
  affected hand; that setting remains authoritative, with selfie handedness as a
  cross-check. Repeat the check at the event if conditions change.
- [ ] **Camera range**. Confirm affected hand, lighting, full-hand visibility and
  fingertip clearance. **Closed** is always the patient's own fist. For **Open**,
  relax while the physical glove opens all five fingers in stages; with a simulated
  glove, capture the patient's own open hand. Capture pinch separately.
  Capture in the upright posture; old palm-down/diagonal camera calibration must
  be replaced. Repeat a capture if movement/tracking makes it unreliable.
- [ ] **Review** every servo range and camera capture, then save calibration.
  The wizard has three steps: Glove range → Camera range → Review.
  **Thread friction (unhooked)** belongs to Evaluate preflight. If it cannot
  be measured safely, leave evaluation unavailable and use practice only.
- [ ] Before evaluation, measure complete slow/fast friction for all five
  fingers with each thread unhooked from its YELLOW fingertip anchor and the hand
  relaxed (or a hand-shaped fixture with guides attached the same way). Refresh
  when missing or older than 24 hours; reject aborted/incomplete curves, then
  re-hook every thread before evaluation and reconfirm the
  relaxed-hand checklist. A skipped baseline still permits practice.
- [ ] Review every range, camera capture and current limit (firmware default
  1500 mA, maximum 2200 mA; choose only a bench-approved limit). Save; verify **Saved**.
  Redo calibration after remounting, rerouting tendons or changing mechanics.

## 4. Dry run, then presentation

- [ ] Follow [DEMO.md](DEMO.md) preflight: seed, volume, camera, permissions,
  optional Gemini access, and both simulator fallbacks rehearsed.
- [ ] Start with an active fist and an assisted opening. Check slack release,
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
| Bare-hand-with-points detection fraction / posture / camera evidence | Pending |
| Slow/fast Thread friction (unhooked) timestamp / completeness | Pending |
| Helper / observer | Pending |
| Practice / voice / tracking | Pending |
| Simulator handoff wall time (target <5 s) | Pending |
| Saved history / replay / export | Pending |
| Go/no-go and unresolved limitations | Pending |

Pack laptop/charger, tested data USB cable plus spare, separate regulated supply
with a team-approved fuse or current limit, wired INA219, DMM, spare servo/board,
STOP switch, tendons/BLACK guides/YELLOW anchors, skin-safe tape/Velcro,
strain relief, and the recorded bench evidence. Keep the fully simulated demo
ready even when hardware passes.
