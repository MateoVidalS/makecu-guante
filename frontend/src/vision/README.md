# Vision integration

`CameraVision` implements the frozen `VisionSource` contract. It loads the local
MediaPipe task and WASM files documented in `public/models/README.md`, requests
640×480 at 30 Hz, and uses video frame callbacks (animation frames on older
browsers). Inference is synchronous in MediaPipe VIDEO mode; duplicate frames,
callbacks while fallback is pending, and callbacks arriving above 30 Hz are skipped.

```ts
const source = new CameraVision();
const devices = await CameraVision.devices(); // Labels appear after permission.
source.setMirrorHandedness(true); // Only for disambiguating two hands.
source.setCalibration(cameraCalibration);
const unsubscribe = source.onFrame((frame) => consume(frame));
await source.start({ affectedHand: 'right', deviceId: devices[0]?.deviceId });
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
hand; the mirror preference only changes this disambiguation. Flipping a lone
hand's MediaPipe label does not reset joint smoothing. Loading a saved affected-hand
calibration also updates an already running camera's configured hand.

Smoothing: `JointFilter` (`jointFilter.ts`) runs a One Euro filter on every joint
angle (degrees; `minCutoff 0.3 Hz`, `beta 0.01`, `dCutoff 1 Hz`). `rawFlexSum`
and `closure` are derived from those filtered joints, so the rendered hand and the
engine read one timeline. The 3D hand adds frame-rate-independent damping and a
1° dead-band (`hand3d/smoothing.ts`). `hand3d/jitter.test.ts` measures the result.

## Provider and overlay

`VisionProvider` uses camera by default and simulator with `VITE_SIM=1`. It obtains
the shared simulator from the enclosing `GloveProvider`, so the simulated glove
and camera observe the same patient. For standalone use, inject `simSource`
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

The frozen `CameraCalibration` has no mirror field. The optional two-hand mirror setting is kept
separately in localStorage (`rehab-hub.camera.mirror-handedness`) until a contract
revision adds one. Changing it invalidates the frame and resets the filters.

## Setup robustness API

F7 can import `useVisionRobustness()` from `../vision` alongside `useVision()`.
It returns a reactive `VisionRobustnessStats` on every source frame. For polling or
non-React use, call `vision.robustness()`; for standalone sources, subscribe frames
to `new VisionRobustnessTracker().add(frame)` and call `tracker.stats(performance.now())`.
A restart, source switch, affected-hand calibration change or stop clears the
provider's window. The API stays in
`vision/`; no frozen `VisionSource` or `VisionFrame` contract additions are needed.

```tsx
const vision = useVision();
const check = useVisionRobustness();
// Only present this as a real glove check when vision.source.kind === 'camera'.
// SimVision has no camera landmarks, so it cannot validate glove visibility.
const label = `Hand detected: ${Math.round(check.detectionRate * 100)}% of the last 5 s`;
// check.meanConfidence, check.perFingerVisibility.ring, check.status,
// check.guidance (English strings), ROBUSTNESS_THRESHOLDS
```

Rates are time-weighted over the latest 5000 ms (the elapsed partial window while
collecting). Each observation expires after 100 ms; camera stalls and missing
intervals count as zero, irrespective of watchdog frame frequency. Mean confidence
is also over elapsed time, including zero for missing/low-confidence intervals.
Confidence is MediaPipe's handedness score, a heuristic rather than a calibrated
probability of correct tracking. `status` stays `collecting` until 5 s have elapsed,
then is `ready` when detection ≥90%, mean confidence ≥75%, and every finger's
visibility ≥85%; otherwise it is `poor`. Exported thresholds are provisional
Setup heuristics for the team's day-1 glove check, not clinical thresholds.

Per-finger visibility is the fraction of time with finite joints and all four
finger landmarks within the image. It is a **usable skeleton estimate, not an
occlusion detector**: MediaPipe can infer hidden joints. Check the overlay by eye
while opening and closing the glove. `CAMERA_PLACEMENT_GUIDANCE` and the returned
`guidance` cover palm-down posture, front diagonal thumb-side placement above the
hand at 30–40 cm, lighting, light thin gloves, and the team-assisted exposed-tip or
bare-hand demo fallback. Setup's layout and diagram belong to F7.

## Five-finger calibration

`captureStats(frames, seconds)` captures the latest continuous hold-still window
for **all five fingers**, including distinct ring and pinky readings. Use the open
hand for `open_flex` and the relaxed hand closed **as far as the glove goes on all
five fingers** for `closed_flex`; there is no ring/pinky active-fist exception.
Capture pinch separately. Captures reject missing/low or invalid confidence,
changes of affected hand, sparse data and >8° standard deviation in any finger.
The existing joint filter and closure normalization remain unchanged.

## Preview, real recordings and tests

Run `make dev-camera`, then open `/src/vision/preview.html` on the frontend port
printed by the launcher (normally `http://127.0.0.1:5173`). This standalone
development page supports camera selection, affected hand, the two-hand label
inversion, simulator, theme toggle, stop, latency stats and the robustness check.
It does not connect to or move a physical glove. It is not part of the production
application. Real closure percentages still require the calibration wizard.

For the team's real-glove fixtures:

1. Arrange the palm-down hand and camera as described on the preview. Choose the
   affected hand, camera and actual covering (glove, exposed fingertips or bare).
2. Start the camera; check the overlay and the five-second robustness stats.
3. Select a pose, click **Record 30 seconds**, hold the pose, then **Download
   landmarks**. Repeat for open, hook, tabletop, straight fist, full fist and pinch.
   **Finish recording** saves a shorter clip; stop/source switch ends the capture.
4. Review the JSON before committing. Save team-reviewed real captures inside
   `frontend/src/vision/fixtures/` with distinct `recorded_...` names. Keep their
   source and covering metadata; never relabel synthetic fixtures as real.

The exported `recordLandmarks(camera, { pose, affectedHand, glove })` helper also
works in a development harness. It captures raw image/world landmarks and labels
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

The six `fixtures/palm-down_*.json` clips are **synthetic**, not webcam or glove
recordings. Each contains 30 frames from a forward-kinematic model, projected
through a diagonal thumb-side camera 36 cm above/in front of the palm-down hand.
Tests mirror this view for the left hand, verify five-finger open/closed endpoints,
long-finger tendon-glide closure ordering, pinch contact, calibration capture, and
smoothing through lone-hand label flips. The thumb is free in hook/tabletop and
therefore does not have the same closure ordering as the four long fingers.
Regenerate only these owned fixtures from the repository root:

```sh
python3 frontend/src/vision/fixtures/generateFixtures.py
pnpm --dir frontend test --run src/vision
```

The older shared `contracts/fixtures/landmarks_*.json` clips remain frozen and
continue to test legacy math invariance. Real glove detection, physical
camera-to-display lag and the target laptop benchmark remain team hardware
acceptance work. `fixtures/browser-benchmark.json` records the prior automated
browser measurements and their workload limits.
