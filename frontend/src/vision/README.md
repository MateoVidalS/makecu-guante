# Vision integration

`CameraVision` implements the frozen `VisionSource` contract. It loads the local
MediaPipe task and WASM files documented in `public/models/README.md`, requests
640×480 at 30 Hz, and uses video frame callbacks (animation frames on older
browsers). Inference is synchronous in MediaPipe VIDEO mode; duplicate frames,
callbacks while fallback is pending, and callbacks arriving above 30 Hz are skipped.

```ts
const source = new CameraVision();
const devices = await CameraVision.devices(); // Labels appear after permission.
source.setMirrorHandedness(true);             // Label inversion, not video mirroring.
source.setCalibration(cameraCalibration);
const unsubscribe = source.onFrame(frame => consume(frame));
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
as required by `VisionFrame`. Filters reset on a hand change or a 200 ms gap.

## Provider and overlay

`VisionProvider` uses camera by default and simulator with `VITE_SIM=1`. It obtains
the simulator from the existing `createSimWorld()` export (WP0 returns its stub
until WP2 merges). At runtime integration, pass the **same** world used by the
glove so simulated assist and camera observations agree:

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

The frozen `CameraCalibration` has no mirror field. The mirror setting is kept
separately in localStorage (`rehab-hub.camera.mirror-handedness`) until a contract
revision adds one. Changing it invalidates the frame and resets the filters.

## Preview and tests

Run `pnpm --dir frontend dev`, then open `/src/vision/preview.html` on the port
printed by Vite. This standalone development page supports camera selection,
affected hand, mirroring, simulator, theme toggle, stop, and latency statistics.
It does not move the glove and is not included in the production application.
Real camera percentages require the calibration wizard; the preview does not
invent a patient calibration.

Run `pnpm --dir frontend test --run src/vision` for math, capture stability,
handedness, filter response, GPU/CPU fallback, lifecycle, provider, and overlay
coverage. One Euro step checks use degree-valued flexion (90°, 180°, 260°) at
30 Hz with the specified 1 Hz / 0.02 / 1 Hz parameters.

All six new `contracts/fixtures/landmarks_*.json` clips are **synthetic**, not
webcam recordings. Each has 30 frames from a forward-kinematic hand model with
small rigid translations/rotations. The extra straight-fist clip checks the full
closure ordering. Regenerate them from the repository root:

```sh
python3 frontend/src/vision/fixtures/generateFixtures.py
```

Recorded patient clips, physical camera-to-display lag, and the target laptop
benchmark remain hardware acceptance work. See `fixtures/browser-benchmark.json`
for the automated browser measurements and their workload limits.
