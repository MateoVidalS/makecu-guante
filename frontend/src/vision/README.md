# Vision integration

`CameraVision` implements the frozen `VisionSource` contract. It loads the local
MediaPipe task and WASM files documented in `public/models/README.md`, requests
640×480 at 30 Hz, and uses video frame callbacks (animation frames on older
browsers). Inference is synchronous in MediaPipe VIDEO mode; duplicate frames,
callbacks while fallback is pending, and callbacks arriving above 30 Hz are skipped.

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
200 ms gap. With one visible hand, its published handedness is always the configured
affected hand, regardless of MediaPipe's label (including an unknown label).
The score must still be at least 0.6. With two hands, labels select the configured
hand. In `front_upright`, a recognized label is also a lone-hand cross-check;
`source.diagnostics().handednessMismatch` reports disagreement without changing
the configured hand, geometry or smoothing. Unknown labels and the legacy view
report `null`. The label inversion preference affects this cross-check and
multiple-hand selection; it is independent of CSS preview mirroring.
[MediaPipe Tasks labels refer to the subject's hands](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker?tab=Web).
Inference receives the unmirrored video element, without rotation; mirror the
preview with `CameraOverlay mirrored` to match a laptop selfie view. Flipping a lone
hand's MediaPipe label does not reset joint smoothing. Loading a saved affected-hand
calibration also updates an already running camera's configured hand.

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

## Glove colours

MediaPipe's palm detector is trained on bare skin, so solid violet, sky blue,
magenta and black gloves are often not detected at all. `gloveColor.ts` repaints
pixels of the glove colour in a skin tone (keeping their shading) on a copy of the
frame before inference. The preview video and recordings of the image are unchanged.

The setting (`CameraVision.setGloveSetting`, persisted in localStorage under
`rehab-hub.camera.glove-color`, chosen in Setup as **Glove color**) is one of:

- `auto` (default): uses the raw video while the hand is tracked, exactly as before.
  After the hand has been missing for 250 ms it tries bare → violet → sky blue →
  magenta → black, one per frame, and keeps the first that finds the hand. While
  tracking, it moves to the most specific colour the hand actually wears (≥ 60% of
  skeleton points; violet before sky blue before magenta; never black), reading the
  raw video's pixels every 15th frame for this. So a lavender glove found as sky
  blue, or tracked on the raw image, moves to violet. If the hand found while
  repainting is not actually that colour (under 30% of skeleton points match for
  5 frames), it returns to the raw video.
- `none`: never repaints. `violet`, `sky-blue`, `magenta`, `black`: always repaint
  that colour.

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
black and violet, included in `stats().inference`); `stats().glove` reports the setting and
active colour. If the browser cannot read pixels, the raw video is used. Known
limits: a background of the glove's colour (a blue towel with a sky blue glove, a
black table with a black glove) becomes skin-coloured too, so use a contrasting
background; a uniformly coloured fist that fills most of the frame may still be
missed; and a black glove the camera clips to pure black has no folds to recover.

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
boundary and is positive by convention. Thumb landmarks 1–4 are first smoothed
in metres (`minCutoff 3 Hz`, `beta 10` per m/s, `dCutoff 1 Hz`) to reduce
non-planar near-straight magnitude bias and jitter. This prefilter shares the
existing hand/view/gap reset rules; the joint filters still run afterward. Small negative joint angles represent hyperextension and pass through
the joint filters; only normalized closure is clamped to [0, 1.1]. Every flexion
calculation uses world landmarks; image landmarks serve the overlay, pinch ratio and exposure region. Degenerate palms produce a
missing frame rather than fabricated flexion. The legacy view retains the old
wrist-to-MCP bone reference, using signed flexion in the same finger plane.
`jointAngles(points, view, affectedHand)` defaults to the right hand for existing
callers; `FrameProcessor` always passes the configured hand, independently of
MediaPipe's label. A wrong configured hand reverses long-finger flexion rather
than silently taking an absolute value; closure can then stay at zero. Correct
the affected-hand setting. Thumb direction stays label-independent. A view
change resets smoothing.

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
