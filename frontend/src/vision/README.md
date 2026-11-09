# Vision integration

`CameraVision` implements the frozen `VisionSource` contract. It loads the local
MediaPipe task and WASM files documented in `public/models/README.md`, requests
640×480 at 30 Hz, and uses video frame callbacks (animation frames on older
browsers). Inference is synchronous in MediaPipe VIDEO mode; duplicate frames,
callbacks while fallback is pending, and callbacks arriving above 30 Hz are skipped.
The capture size, `numHands: 2` and the 0.6 detection, presence and tracking
confidences were measured against alternatives and kept; see "Detection settings"
in `perf/README.md` before changing them.

```ts
const source = new CameraVision();
const devices = await CameraVision.devices(); // Labels appear after permission.
source.setMirrorHandedness(false); // Labels match the unmirrored MediaPipe Tasks input.
source.setCalibration(cameraCalibration);
const unsubscribe = source.onFrame((frame) => consume(frame));
await source.start({
  affectedHand: 'right',
  view: 'front_upright',
  deviceId: devices[0]?.deviceId,
});
console.log(source.stats());
// On page/runtime disposal:
unsubscribe();
source.stop();
```

`stats()` reports the delegate, rolling 300-frame inference and camera-to-frame
p50/p95 in milliseconds, processed/skipped counts, and the last error. Every 300
processed frames it logs the same object. Camera-to-frame uses the browser's
capture timestamp when available and presentation timestamp otherwise; it cannot
measure physical sensor latency when the browser omits capture timestamps.

A stopped, unplugged, stalled, missing, or low-confidence camera immediately
invalidates its published observation. A 50 ms watchdog invalidates camera stalls
after 100 ms without inference results. Internal presence fades to zero over
200 ms, but published missing frames always have confidence 0 and null closure,
as required by `VisionFrame`. Filters reset on a configured hand change or a
200 ms gap. Hand identity (`selectHand` in `confidence.ts`) works the same in both
camera views:

- A hand's top handedness score must be at least 0.6.
- With two hands, labels select the configured hand.
- With one hand, it is published as the configured affected hand, unless MediaPipe
  labels it as the other hand with a score of at least 0.95 (`OTHER_HAND_MIN_SCORE`).
  That hand is dropped. A missing frame is safer than a bystander's hand or the
  patient's free hand driving "reached" and assist decisions: missing frames are
  handled (confidence fades, and the engine's dwell survives gaps up to 200 ms).
  An unknown label, or a less confident opposite label, keeps the configured hand.
  The label never flips the configured hand or the geometry. Evidence and limits:
  [Hand identity](#hand-identity).
- In `front_upright`, `source.diagnostics().handednessMismatch` is `true` when the
  lone hand's label disagrees with the configured hand. That covers a published hand
  with an unsure opposite label and a dropped hand, so the Setup check can say why
  the hand is missing. Unknown labels and the legacy view report `null`.
- The label inversion preference is for cameras that deliver mirrored frames. It
  applies to the drop and to two-hand selection. With the wrong setting, the
  patient's lone hand is dropped and Setup reports a label mismatch. It is
  independent of CSS preview mirroring.

[MediaPipe Tasks labels refer to the subject's hands](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker?tab=Web).
Inference receives the unmirrored video element, without rotation; mirror the
preview with `CameraOverlay mirrored` to match a laptop selfie view. Neither an unsure
label flip nor a short run of dropped other-hand frames resets joint smoothing.
Loading a saved affected-hand calibration also updates an already running camera's
configured hand.

Smoothing: `JointFilter` (`jointFilter.ts`) runs a One Euro filter on every joint
angle (degrees; `minCutoff 0.3 Hz`, `beta 0.02`, `dCutoff 0.5 Hz`). `rawFlexSum`
and `closure` are derived from those filtered joints, so the rendered hand and the
engine read one timeline. Each finger shares the average joint angle as its
adaptive speed signal, so adjacent signed joints retain equal filter gains and their landmark noise can
cancel in the flex sum. Pinch has a separate One Euro filter in ratio units
(`minCutoff 0.1 Hz`, `beta 5` per ratio/s, `dCutoff 0.5 Hz`): the larger beta
tracks a closing pinch promptly, while the low resting cutoff and smoother
derivative keep fingertip jitter from restarting the reach dwell. The 3D hand adds
frame-rate-independent damping and a 1° dead-band (`hand3d/smoothing.ts`). `hand3d/jitter.test.ts` measures the result.
`OneEuroFilter` also offers an opt-in second-order speed estimate (`speedOrder: 2`), which
noise opens less; it is not enabled because it raises near-line false acknowledgments
(`perf/README.md`, temporal tuning study).

## Device profiles

MediaPipe's hand landmarker is trained on bare skin, so what the patient wears
changes what it can find. `deviceProfiles.ts` has one entry per device (adding a
device = adding one entry): an id, a label and one-line description for Setup,
the preprocessing step applied to a copy of each frame before inference
(`PreprocessStep`: `(src, dst, width, height, scratch, region?) => fraction
changed`), a coverage helper (share of a detected hand's skeleton points that
look like the device) and the Automatic rules below. The preview video and
recordings of the image are unchanged.

| Profile        | Step before MediaPipe            | Automatic                                     |
| -------------- | -------------------------------- | --------------------------------------------- |
| Bare hand      | none (the raw video)             | the starting point; searched                  |
| Violet glove   | `recolorGlove` violet            | searched; switched to at coverage ≥ 0.6       |
| Sky blue glove | `recolorGlove` sky blue          | searched; switched to at coverage ≥ 0.6       |
| Magenta glove  | `recolorGlove` magenta           | searched; switched to at coverage ≥ 0.6       |
| Black glove    | `recolorGlove` black             | searched only (a dim bare hand looks dark)    |
| Strap device   | `inpaintDevice` straps, hand box | searched; switched to at strap coverage ≥ 0.2 |
| Dot points     | `inpaintDevice` points, hand box | never (choose it): dots are too small to see  |

The setting (`CameraVision.setDeviceSetting`, persisted in localStorage under
`rehab-hub.camera.device-profile`, chosen in Setup as **On the hand**) is
`auto` or a profile id. The old `rehab-hub.camera.glove-color` values (`auto`,
`none`, `violet`, `sky-blue`, `magenta`, `black`) are read when no new setting
exists, so nobody loses their choice; the old key is never written.

- `auto` (default): uses the raw video while the hand is tracked. After the hand
  has been missing for 250 ms it tries bare → violet → sky blue → magenta → black
  → strap device, one per frame, and keeps the first that finds the hand. While
  tracking, it moves to the most specific profile the hand actually wears (gloves:
  ≥ 60% of skeleton points; violet before sky blue before magenta, then the strap
  device; never black or dot points), reading the raw video's pixels every 15th
  frame for this, so tracking a bare hand costs nothing extra. A lavender glove
  found as sky blue, or tracked on the raw image, moves to violet. If the hand
  found while preprocessing does not wear that device (gloves: under 30% of
  skeleton points for 5 frames; strap device: under 10%), it returns to the raw
  video.
- A profile id: always that profile.

Strap coverage only counts on a hand that is mostly skin (≥ 40% of skeleton
points pass `isSkinPixel`): the strap colour rule includes every black-glove
pixel, and a glove must never be taken for straps. Measured on IMAGE detections
of the real recordings: device hand skin 0.62–1.0, strap coverage 0.26 median
(≥ 0.2 in 71 of 108); 192 bare hands (bystanders, the free hand) strap coverage
≤ 0.19 (≤ 0.12 on raw detections); 114 violet-glove hands skin ≤ 0.10; rendered
black, grey, sky blue and magenta gloves skin 0. The device steps get `region`,
the hand's box on the previous frame widened by 0.3 of its larger side
(`handRegion`), and the whole frame while the hand is lost. Gloves always
repaint the whole frame (their shading uses the glove's mean brightness).

`stats().device` reports the setting and the active profile;
`trackedDeviceProfile()` is the profile in use the last time the hand was seen.

**Calibration and device.** A device shifts where MediaPipe puts the joints, so
a camera calibration only fits the device it was captured with. The frozen
`CameraCalibration` has no device field. Each capture (fist, open hand, pinch)
records the profile its seen frames were tracked with
(`CameraVision.trackedDeviceProfile()` on every frame of the hold): a capture
whose frames span two profiles (Automatic switched mid-hold) is refused ("The
camera changed how it reads your hand. Try again."), and a capture whose profile
differs from the draft's other captures clears them ("Now tracking <device>, not
<device>. Start again with your fist."). Saving refuses mixed captures and stores
the captures' profile, not the one tracked at save time, in localStorage
(`rehab-hub.camera.calibration-device`) keyed to the calibration's values
(`calibrationDevice.ts`); a saved calibration's record is carried back into the
draft when it is reopened. Setup and the camera step
of Calibrate then show "Calibrated with <device>. Calibrate again for <device>."
when the device on the hand (the fixed setting, or what Automatic tracks while it
sees the hand) differs. Calibrations saved before this, or with the simulator,
have no device and show nothing.

Measured through this code (VIDEO-mode app emulation: production selector,
profile steps, `FrameProcessor` and MediaPipe at the app's 0.6 thresholds;
device-hand frames on the three strap-device recordings described under Device
inpainting; violet: rounds 3 and 4, each still held for 3 frames):

| Setting           | r5 / 239 | r6 / 240 | r7 / 240 | violet r3 / 180 | violet r4 / 180 |
| ----------------- | -------- | -------- | -------- | --------------- | --------------- |
| Automatic, before | 39       | 0        | 23       | 170             | 155             |
| Automatic         | 69       | 24       | 49       | 170             | 154             |
| Strap device      | 119      | 39       | 147      |                 |                 |
| Dot points        | 21       | 9        | 35       |                 |                 |
| Violet glove      |          |          |          | 179             | 174             |

The violet r4 difference is one frame of a search spent on the strap device.
With the strap device, choose it in Setup: Automatic only finds it while
searching, and lets go of it when another hand is tracked. With a 0.15 strap
threshold Automatic found 69 frames on r7, but 2 of the 192 bare hands passed.

## Hand identity

Before this rule, a lone hand was always published as the affected hand. A
bystander's hand, or the patient's free hand, then drove "reached" and assist
decisions. The evidence below comes from offline replays of real MediaPipe
results through `FrameProcessor`, with the app's 640×480 landmarker settings:

- **Device recordings r5–r7:** the team's device on a right hand, with bystanders
  present. About 240 frames each, sampled at 5 Hz, upright view.
- **Violet-glove rounds r3/r4:** 60 frames each, legacy palm-down view.
- **Hand classes:** "true" is the device or glove hand; "other" is a bystander's
  hand or the free hand, classified by eye.

Published frames, shown as true / other, before → after:

| Recording | VIDEO            | IMAGE           |
| --------- | ---------------- | --------------- |
| r5        | 38 / 6 → 38 / 0  | 5 / 3 → 5 / 1   |
| r6        | 7 / 87 → 7 / 33  | 1 / 47 → 1 / 10 |
| r7        | 17 / 68 → 17 / 2 | 5 / 23 → 5 / 1  |
| r3 violet | 60 / 0 → 60 / 0  | 55 / 0 → 55 / 0 |
| r4 violet | 59 / 0 → 59 / 0  | 54 / 0 → 53 / 0 |

- **Patient's hand:** the one true frame dropped is an isolated IMAGE frame, so
  no run of dropped frames is longer than one.
- **Left-handed check:** the same frames, mirrored, with the left hand
  configured. No true frame was dropped. Other-hand frames fell from 141 to 37
  (VIDEO) and from 46 to 19 (IMAGE).
- **Threshold:** a 0.9 threshold would remove 8 more of the 421 other-hand
  frames, all isolated frames. But on the rendered bench hand, 0.9 hides the
  right hand in a single-finger pose for up to 7 frames (233 ms at 30 Hz), longer
  than the engine's 200 ms gap tolerance. At 0.95, the bench loses 4 isolated
  frames out of 3,247.

Known limits:

- **Same-side bystander hand.** Most of r6's remaining frames show a bystander's
  right hand pressing the device's fingertips while the device hand itself is
  not detected. Its label is correct, so the check cannot catch it. Two other
  cues did not help:
  - Continuity in position and size with the last published hand: none of these
    frames had a device hand published in the 2 s before.
  - A size gate: bystander palms measure 0.21–0.60 of the patient's largest
    palm, but the patient's own hand measures down to 0.43 when held sideways.
    The calibration also stores no hand size.
- **Hands cut off by the frame edge.** 17 of r6's 33 remaining frames are a hand
  resting at the bottom-left corner, with landmarks outside the image. A "whole
  hand in frame" rule would catch them, but it changes detection quality rather
  than identity, so it is not applied here.
- **Label inversion.** The setting now matters for a lone hand. On a camera that
  mirrors its frames, if the setting is off, the patient's hand is dropped (r3
  violet VIDEO: 58 → 10 published). In `front_upright`, Setup then shows the
  label-mismatch guidance. Only the development preview page exposes the setting.
- **Frame rate.** The real recordings are 5 Hz samples. How stable the labels
  are on real hands at 30 Hz has not been measured.

## Glove colours

MediaPipe's palm detector is trained on bare skin, so solid violet, sky blue,
magenta and black gloves are often not detected at all. `gloveColor.ts` repaints
pixels of the glove colour in a skin tone (keeping their shading) on a copy of the
frame before inference; the glove profiles call it.

Colour rules and shading are tuned per colour (`TUNING` in `gloveColor.ts`):

- **Violet** (lavender/periwinkle nitrile) was tuned on four rounds of real
  laptop-webcam frames (two places, navy and black T-shirts, open/fist/side and
  palm-down exercise poses, the hand in front of the other bare forearm). Confident
  pixels: hue 224–268°, saturation 0.15–0.60, value ≥ 0.28; the saturation cap and
  hue floor keep navy clothing out. Shadowed folds (hue 220–268°, saturation up to
  0.85, value ≥ 0.15) are also repainted when within 8 px of a confident pixel, so
  an isolated navy patch is not. Repaint: a pale skin tone at 1.0× the glove's mean brightness with a mild contrast
  power of 1.5. Finger accuracy was tuned on the rendered-hand bench (known joint
  angles, upright view, hand coloured like the glove): a flat repaint hid the thumb
  against the palm (calibrated thumb range 32° vs 59° bare; the gloved left hand
  could not be calibrated at all). Contrast 1.5 restores it (55°, thumb error 0.13 =
  bare; left hand 91% detected, long fingers as accurate as bare) and finds more
  hands on the real frames. Contrast 2 or edge sharpening broke calibration, and
  darker tones lost the hand against bare skin behind it. Frames
  detected independently (rounds 1–4): 28/30, 25/30, 56/60, 55/60 (raw: 6, 0, 2, 1).
  In the app, rounds 3 and 4 were tracked 98–99% of the time (raw: 68% and 4%).
  Misses were edge-on hands, hands partly out of frame or in front of the face.
- **Black** averages the channels, smooths over a 5 px radius (at 640 px width) and
  squares the brightness ratio, to recover faint folds from camera noise. Known
  gap: a dark-grey glove with strong real shading can be over-contrasted (one
  synthetic case regressed); an adaptive contrast power was prototyped but not applied.
- **Sky blue** and **magenta** use plain brightness shading.

Repainting reads the video into a canvas (about 3 ms per 640×480 frame, 5–6 ms for
black and violet, included in `stats().inference`). If the browser cannot read pixels, the raw
video is used. Known
limits: a background of the glove's colour (a blue towel with a sky blue glove, a
black table with a black glove) becomes skin-coloured too, so use a contrasting
background; a uniformly coloured fist that fills most of the frame may still be
missed; and a black glove the camera clips to pure black has no folds to recover.

## Device inpainting

The device on a bare hand hides the fingers from MediaPipe. `deviceInpaint.ts`
paints it over on a copy of the frame before inference, in the same calling style
as `recolorGlove` (pure, no DOM, reusable scratch). The Strap device and Dot
points profiles call it (see Device profiles).

```ts
const scratch = createDeviceScratch();
// Fraction of pixels changed; 0 means dst is an exact copy (keep the raw video).
const share = inpaintDevice(
  src,
  dst,
  width,
  height,
  'straps',
  scratch,
  handBox,
);
// Share of the detected skeleton's points that look like the device.
const coverage = deviceCoverage(rawPixels, width, height, landmarks, 'straps');
```

Variants:

- `straps`: the user's device, black velcro straps on every finger segment and
  the wrist, yellow/orange thread guides and orange cables. A device pixel with
  solid skin on both sides within 26 px (at 640 px width; `STRAP_TUNING.span`)
  along a row, column or diagonal is filled with a blend of that skin; wider
  dark areas (gaps between spread fingers over a black sweater) are kept. Frames
  480 px wide or more are processed at half resolution. It also fills small dark
  spots that skin surrounds elsewhere (glasses, hair edges), so run it only for a
  hand wearing the device. Device-colour coverage of the skeleton was 0.24–0.29
  (median) on the device hand and about 0 on a bare hand: ~0.1 separates them.
- `points`: the team's small black dorsal guides and yellow fingertip anchors.
  Small, compact dark or yellow blobs on skin (up to 24 px, at least 75% skin
  around a dark one) are painted from their surroundings. It changes nothing on
  a frame without such blobs. The points are too small for `deviceCoverage` to
  recognise them.

Pass `region` (the tracked hand's box widened by a third of its larger side)
while a hand is tracked; use the whole frame while searching. Costs on a 640×480
real frame (headless Chromium, M-series Mac): `straps` 4–7 ms whole frame,
~1.7 ms in a hand box; `points` 3–6 ms whole frame (1–1.5 ms on the bench's plain
scene), ~1.7 ms in a hand box; plus the pixel readback.

Measured with the real MediaPipe Hand Landmarker (thresholds 0.6), counting only
the device hand (per-recording position rules, bystanders excluded), on three
real recordings of the user's strap device (12 poses × ~20 frames each; not in the
repository). Frames found, before → after:

| Recording                     | IMAGE mode, `straps` | VIDEO mode (app emulation), `straps` | VIDEO, `points` |
| ----------------------------- | -------------------- | ------------------------------------ | --------------- |
| r5 (hand often horizontal)    | 5 → 38 / 239         | 38 → 119                             | 38 → 21         |
| r6 (upright)                  | 1 → 24 / 240         | 7 → 40                               | 7 → 9           |
| r7 (upright, beside the face) | 5 → 25 / 240         | 17 → 157                             | 17 → 35         |

On r7 the fill makes calibration possible (open and fist found 100%; ranges
95–185° per long finger, thumb 100°), with a per-pose closure error of 0.18–0.26
for half, hook, tabletop, point and peace, 0.05 for the second open hand, and
pinch long fingers at 0. Still missed: thumbs up and pinky up, and the second fist
(found 30%, read as open). r6 never finds the fist, so it cannot be calibrated;
r5 calibrates with degenerate ranges. Run continuously, the `points` variant is
not safe with the strap device (r5 loses thumbs up and some peace frames), so
use it only for the dot device. On the rendered bench hand with points, `points`
restores calibration for both hands (see `perf/README.md`); with bare hands,
gloves or the real violet-glove frames it changed no detection when given the
tracked hand's region (whole frame: one of 120 raw violet frames lost).

## Status and known issues (accuracy round 1)

Round 1 of the hand and finger accuracy work (device profiles, strap/dot inpainting, hand identity, calibration
hold-still rule, temporal and detection guard tests) was integrated and reviewed for patient safety and methodology.
Included safety fixes from the reviews: the glove-opening phase is strict again on missed frames; calibration records the
device profile at capture time and never mixes profiles; Automatic never switches into the Strap device or Dot points
profiles (a dim bare hand passes the strap colour rule, and the strap fill then under-reads a near-fist), so choose
**Strap device** explicitly in Setup when wearing it. Joint math is unchanged, so existing calibrations stay valid.

Open, not fixed:

- **Mirrored cameras.** The hand-identity rule drops a lone hand confidently labelled as the other hand. It honours the
  mirror-handedness setting, which is only exposed on the developer preview page: with a camera that mirrors its frames,
  set it there, or the patient's own hand can be dropped.
- **Hand identity threshold.** The 0.95 label threshold comes from the rendered proxy (its open right hand is labelled
  Left up to 0.950). Under the Strap device profile about 5 device-hand frames per run are dropped; all are mirrored
  skeletons, which is the right outcome. A geometric chirality check is a round-2 item. A same-side bystander's hand
  pressing the device can still be published.
- **Strap device detection.** Fists, thumbs up and pinky up are still rarely or never found with the device; only one
  real upright recording calibrates end to end.
- **Calibration.** Limited-range thumb movements of 0.1-0.2 can pass the hold-still rule (an it.fails known gap).
- **Excluded candidates.** The lens-axis long-finger flexion and the unsigned thumb IP improved the rendered proxy but
  regressed real upright recordings; both are reverted, with evidence in the integration report.
- **Ground truth.** Real data is limited: no real bare-hand, 30 fps, left-hand or deliberately tilted recordings yet.
- Unrelated: 10 Doctor chat tests fail on main as well.

## Provider and overlay

`VisionProvider` uses camera by default and simulator with `VITE_SIM=1`. It obtains
the shared simulator from the enclosing `GloveProvider`, so the simulated glove
and camera observe the same patient. Controller `source` preserves the exact
shared `SimWorld.vision` identity; its start calls use an internal `SimVision` adapter. For standalone use, inject `simSource`
explicitly (the low-level controller uses the exported `createSimWorld()` factory
and disposes its owned world). Runtime integration can pass the shared source:

```tsx
<VisionProvider simSource={sharedWorld.vision} initialKind="sim">
  <CameraOverlay compact />
</VisionProvider>
```

`useVision()` exposes `source`, `latest`, `error`, `start(options)`, `stop()`,
`setKind(kind, options?)`, `setCalibration(calibration)`, and `subscribe(callback)`.
Subscriptions survive source switches and receive an invalid observation on stop.
`useVisionFrame(selector)` is the reactive frame hook; use `source.latest()` or
`subscribe` for animation getters that should not trigger React renders.

`CameraOverlay` can also receive an explicit `source` outside a provider. Props:
`compact` (240 px PiP), `mirrored` (preview only), and `state(finger)` returning
`idle | active | assist | reached`. It attaches the source's actual video element,
draws the 21 points and bones, and displays gaps until calibration is available.
Mount one overlay per source, since a video element has one DOM parent.

The frozen `CameraCalibration` has no mirror field. The optional label inversion setting is kept
separately in localStorage (`rehab-hub.camera.mirror-handedness`) until a contract
revision adds one. Changing it invalidates the frame and resets the filters.

## Camera view and flexion

`CameraVision.start({ view })` and controller `start` / `setKind` accept
`front_upright` (default) or legacy `front_diagonal`. View settings survive source
switches. The exported vision-side `SimVision` wraps the existing shared
`SimWorld.vision` (available as `delegate`), retains `cameraView()`, forwards the
view to its delegate, and clears queued frames before restarting. Synthetic
joints/closure have no camera projection, so their math and calibration are
identical in either view. The glove simulator implementation stays untouched.
Upright long-finger MCP is the angle of the proximal bone out of the
plane formed by knuckles 5, 9, 13 and 17, using that arch's area normal. Wrist
position and in-plane splay do not count as MCP flexion. The arch normal is
oriented toward the palmar side using the configured affected hand: reflecting world landmarks for the left hand reverses the raw
cross product. The area normal is palmar for an anatomical right hand and must
be reversed for a left hand (distal × palmar points toward the right thumb).
Measuring upright long-finger flexion toward the lens instead (the camera axis
as palmar direction) was tried in accuracy round 1 and not adopted. It improved the
rendered-hand bench, but on the real strap-device recordings it read flexed poses
lower (r7 mean per-pose closure error .21 → .23), lost r7's tabletop, which is done
with the hand turned sideways (.45 → .00 against .33), and accepted fewer real
calibration holds (37 → 31 of 74, r7 fist 3 → 0): the lens axis reads any hand
rotation as MCP flexion. A wrist-anchored palm normal (wrist, knuckles 5 and 17)
separates those turned hands (62–121° from the lens) from frontal ones (22–42°).
MCP keeps its sign rather than taking an absolute value. Its in-plane
component also keeps a forward/backward sign: a bone slightly past perpendicular
can read above 90°, so noise at the closed calibration endpoint is not rectified
downward. In-plane splay still does not count as flexion.
PIP/DIP use a signed `atan2` rotation about each finger's flexion axis, derived
from its wrist-to-knuckle direction and that palmar normal. The thumb's sign
reference is `cross(1→2, 2→17)`: rotation across the palm toward the pinky is
positive, independently of the configured hand. Opposition is not restricted to
the palm-normal plane. Its full 3D bend magnitude is measured with `atan2` and
oriented against that across-palm reference; a pure palmar bend is on the sign
boundary and is positive by convention. The IP keeps its sign: on the real
strap-device recordings (r5–r7, upright) an open thumb's IP reads a steady −17° to
−22° while flexed poses read positive, so an unsigned IP (tried in accuracy round 1)
made the open thumb read like a half-closed one (r7 thumb range 100° → 56°). Thumb landmarks 1–4 are first smoothed
in metres (`minCutoff 3 Hz`, `beta 10` per m/s, `dCutoff 1 Hz`) to reduce
non-planar near-straight magnitude bias and jitter. This prefilter shares the
existing hand/view/gap reset rules; the joint filters still run afterward. Small negative joint angles represent hyperextension and pass through
the joint filters; only normalized closure is clamped to [0, 1.1]. Every flexion
calculation uses world landmarks; image landmarks serve the overlay, pinch ratio and exposure region. Degenerate palms produce a
missing frame rather than fabricated flexion. The legacy view retains the old
wrist-to-MCP bone reference, using signed flexion in the same finger plane.
`jointAngles(points, view, affectedHand)` defaults to the right hand for existing
callers; `FrameProcessor` always passes the configured hand, independently of
MediaPipe's label. With a wrong configured hand, a confidently labelled lone hand
is dropped (see above) and Setup reports a label mismatch. Any frame that still
gets through has its long-finger flexion reversed rather than silently made
absolute, so closure can stay at zero. Correct the affected-hand setting. Thumb
direction stays label-independent. A view change resets smoothing.

A calibration only normalizes closure when its affected hand and camera view
match the current observation. Missing `camera_view` means `front_diagonal`;
upright observations retain joints and raw flexion but have null closure until a
compatible calibration is supplied.

## Setup robustness API

F7 can import `useVisionRobustness()` from `../vision` alongside `useVision()`.
It returns a reactive `VisionRobustnessStats` on every source frame. For polling or
non-React use, call `vision.robustness()`; for standalone sources, subscribe frames
to `new VisionRobustnessTracker().add(frame, camera.diagnostics())` and call `tracker.stats(performance.now())`.
A restart, source switch, affected-hand calibration change or stop clears the
provider's window. The API stays in
`vision/`; no frozen `VisionSource` or `VisionFrame` contract additions are needed.

```tsx
const vision = useVision();
const check = useVisionRobustness();
// Only present this as a bare-hand-with-points check when vision.source.kind === 'camera'.
// SimVision has no camera landmarks, so it cannot validate hand/point visibility.
const label = `Hand detected: ${Math.round(check.detectionRate * 100)}% of the last 5 s`;
// check.meanConfidence, check.perFingerVisibility.ring, check.status,
// check.guidance (English strings), ROBUSTNESS_THRESHOLDS
// check.lighting?.status, check.lighting?.meanLuminance,
// check.handednessMismatchRate (null when unmeasured)
```

Rates are time-weighted over the latest 5000 ms (the elapsed partial window while
collecting). Each observation expires after 100 ms; camera stalls and missing
intervals count as zero, irrespective of watchdog frame frequency. Mean confidence
is also over elapsed time, including zero for missing/low-confidence intervals.
Confidence is MediaPipe's handedness score, a heuristic rather than a calibrated
probability of correct tracking. `status` stays `collecting` until 5 s have elapsed,
then is `ready` when detection ≥90%, mean confidence ≥75%, and every finger's
visibility ≥85%, no exposure warning, and handedness mismatch rate ≤20%
(when measured); otherwise it is `poor`. Exported thresholds are provisional
Setup heuristics for the team's day-1 bare-hand-with-points detection check, not clinical thresholds.

Per-finger visibility is the fraction of time with finite joints and all four
finger landmarks within the image. It is a **usable skeleton estimate, not an
occlusion detector**: MediaPipe can infer hidden joints. Check the overlay by eye
while opening and closing the hand. `CAMERA_PLACEMENT_GUIDANCE` and the returned
`guidance` cover the upright palm-to-screen posture, elbow support, front webcam
at 40–60 cm, good front lighting with no window behind, a rolled-up sleeve,
no rings/watch/bracelet, and the whole hand in frame. Keep the small black guides
and yellow fingertip anchors on the back of the fingers, attached with skin-safe
tape and clear of palm-side joint creases. If detection stays low, check lighting
and point size/placement. Setup's layout and diagram belong to V2.

Exposure is sampled from a reusable 64×48 canvas of the actual video frame. It
reports normalized RGB luminance for the frame and, when a complete skeleton is
in frame, the hand bounding region and remaining background. Low hand/frame
luminance (<0.18) warns about low light. A dark hand (<0.28) against a background
at least 0.25 brighter warns about backlight. These are provisional heuristics;
the bounding box includes non-hand pixels. Warnings give lighting guidance even
while collecting. Values are time-weighted and expire with frame observations.
Unavailable canvas/video, stalls and simulators report null rather than a good
exposure measurement. No image pixels are retained or uploaded.

## Five-finger calibration

`captureStats(frames, seconds)` captures the latest continuous hold-still window
for **all five fingers**, including distinct ring and pinky readings. Use the open
hand for `open_flex` and the relaxed hand closed **as far as the glove goes on all
five fingers** for `closed_flex`; there is no ring/pinky active-fist exception.
Capture pinch separately. Captures reject missing/low or invalid confidence,
changes of affected hand, sparse data and >8° standard deviation in any finger.
Signed raw flexion changes stored calibration values: recapture open/closed
ranges when upgrading. No calibration version field is added; this work ships
before or together with the upright Setup/Calibrate update (V2).

## Preview, real recordings and tests

Run `make dev-camera`, then open `/src/vision/preview.html` on the frontend port
printed by the launcher (normally `http://127.0.0.1:5173`). This standalone
development page supports camera selection, affected hand, the two-hand label
inversion, simulator, theme toggle, stop, latency stats and the robustness check.
It does not connect to or move a physical glove. It is not part of the production
application. Real closure percentages still require the calibration wizard.

For the team's day-1 bare-hand-with-points detection check and real recording:

1. Raise the hand upright, palm to the laptop, elbow supported as on the preview. Choose the
   affected hand and camera. Choose **Bare hand with points** (the default).
   There is no hand covering: small black guides and yellow fingertip anchors
   attach directly to the back of the fingers with skin-safe tape. Keep palm-side
   joint creases clear, roll up your sleeve, remove rings/watch/bracelet, and use
   good front light with no window behind you.
2. Start the camera; use **Hand detection check** to check the overlay and the
   five-second robustness stats while opening and closing all five fingers.
3. Select a pose, click **Record 30 seconds**, hold the pose, then **Download
   landmarks**. Repeat for open, hook, tabletop, straight fist, full fist and pinch.
   **Finish recording** saves a shorter clip; stop/source switch ends the capture.
4. Review the JSON before committing. Save team-reviewed real captures inside
   `frontend/src/vision/fixtures/` with distinct `recorded_...` names. Keep their
   source and covering metadata; never relabel synthetic fixtures as real.

The exported `recordLandmarks(camera, { pose, affectedHand, glove })` helper also
works in a development harness. Omit `glove` to default to `bare-hand-points`;
explicit `glove`, `bare-hand` and `exposed-fingertips` metadata remain supported
for existing recordings. It captures raw image/world landmarks and labels
before smoothing, including missed detections and low scores. It copies MediaPipe
buffers, caps recording at 30 s / 1800 samples, unsubscribes on completion, and
returns `{ stop(), finished }`. Nothing is sent to a server; explicit Download
saves only JSON, never video/audio. `requestedSetup` records the instructions,
not a claim that the physical camera position was measured. Relative timestamps
allow replay, including empty results:

```ts
for (const { t, result } of recording.frames) {
  const frame = processor.process(result, t, recording.affectedHand);
  // Consume or assert frame; keep gaps to represent real dropouts.
}
```

The six `fixtures/front_upright_*.json` and six legacy
`fixtures/palm-down_*.json` clips are **synthetic**, not real webcam recordings. Each contains 30 frames from the same forward-kinematic model. Upright fixtures
project toward a front camera 50 cm away, fingers curling toward the lens with no
rotation. Legacy fixtures retain the diagonal thumb-side camera 36 cm away.
Tests mirror each view for the left hand, verify five-finger open/closed endpoints,
long-finger tendon-glide closure ordering, pinch contact, calibration capture, and
smoothing through lone-hand label flips, wrist-tilt invariance, exposure guidance,
and calibration view compatibility. The thumb is free in hook/tabletop and
therefore does not have the same closure ordering as the four long fingers.
Regenerate only these owned fixtures from the repository root:

```sh
python3 frontend/src/vision/fixtures/generateFixtures.py
pnpm --dir frontend test --run src/vision
```

The older shared `contracts/fixtures/landmarks_*.json` clips remain frozen.
They contain the historical mirrored "right" geometry; vision's legacy math
tests reflect their inputs into an anatomical right hand. The owned upright
and palm-down fixtures now have correct anatomical chirality and thumb
opposition across the palm with a palmar component. Performance ground truth
uses an independent unsigned angle oracle on exact geometry, not production
`jointAngles`. Real bare-hand-with-points detection, physical
camera-to-display lag and the target laptop benchmark remain team hardware
acceptance work. `fixtures/browser-benchmark.json` records the prior automated
browser measurements and their workload limits.
