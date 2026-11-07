# Glove link

`WebSerialGlove` and `world.glove` implement the frozen `GloveClient` contract.
The provider exports remain `GloveProvider`, `useGlove`, and `useGloveTelemetry`.
`StubGlove` remains exported for the WP0 scripted-runtime/foundation tests; the
provider uses the real clients.

## Shared simulator

Use one world for both sources; separate worlds cannot model assistance correctly.

```ts
import { createSimWorld } from './sim';

const world = createSimWorld({ seed: 42, preset: 'moderate' });
await world.glove.connect();
// As on hardware, send the patient's three servo ranges and current limit.
world.glove.calib(0, 20, 150);
world.glove.calib(1, 20, 150);
world.glove.calib(2, 20, 150);
world.glove.limit(900);
await world.vision.start({ affectedHand: 'right' });
world.vision.setCalibration(cameraCalibration);
world.setIntent('full_fist', 'ATTEMPT'); // Call on engine phase/pose changes.
world.glove.follow([0.3, 0.2, 0.4]);
// On ASSIST, the engine sends its target via GloveClient as usual.
world.setIntent('full_fist', 'ASSIST');
world.glove.target([0.7, 1, 1], 0.3);
world.controls.setRigid('index', true);
world.controls.pressStop();
world.controls.releaseStop(); // Still faulted: release is required to clear it.
world.glove.release();
world.controls.handOutOfFrame(2000);
world.controls.unplug(); // Stops transport/keepalive; firmware continues to watchdog.
world.controls.setPreset('severe');
world.stop(); // Application teardown; releases, disconnects, stops camera and clock.
```

For tests, pass `{ autoStart: false }` and drive `world.advance(milliseconds)`.
For demos, `timeScale` scales elapsed wall time. The control step is always 5 ms;
telemetry deadlines come from integer tick indices. Live timestamps share
`world.origin + world.now`, while firmware `ms` starts at zero. Tests using an
accelerated/manual world should pass `world.timestamp()` to the engine.

The camera delivers 30 Hz captures after 60 ms. Before camera calibration,
`closure` is null, but raw flex/joints remain available for the wizard. Dropouts
clear all hand measurements. Linear `jointsFromClosure` is local until WP6 is
integrated. No image landmarks or video element are synthesized.

## Provider and subscriptions

`useGlove()` exposes `client`, `connection`, `latest`, `events` (last 100),
`setKind`, and the shared `world` (use `world.vision` in the simulator runtime).
`VITE_SIM=1` selects and connects the simulator. Serial starts disconnected:
call `client.connect()` from a user gesture. Switching kind disconnects/releases
the old transport; switching to serial does not open the chooser automatically.

Use `useGloveTelemetry(selector)` for React telemetry reads. For non-React
consumers, `subscribe(cb)` receives telemetry and `subscribeTelemetry(selector,
cb)` emits only when the selected value changes. Both return unsubscribe
functions and remain bound to the active client across source switches.

## Serial behavior

The serial adapter accepts an injected `SerialPortLike` or `SerialApi` for tests.
It uses incremental UTF-8 decoding on byte streams, bounded line buffering,
a 2 s info timeout, a 100 ms keepalive check, and at most 30 Hz follow writes.
Malformed lines increment `codecStats.malformedLines`; they never stop reading.
Reconnect reuses the selected/granted port. Chooser cancellation is respected;
unsupported filters retry without filters.

Release jumps ahead of queued configuration. It also cancels unsent motion
(target/follow/jog) so stale motion cannot restart after release. In-flight writes
cannot be recalled. A target/jog replaces an older pending follow. Other commands
are sent in order. Disconnect/unload release is best effort; the independent
firmware watchdog remains the safety layer when USB or the browser fails.

## Verification

Run `pnpm --dir frontend test --run src/glove`. The named conformance suite maps
to firmware safety rules, including filtered current timing, calibration, STOP,
watchdog, ramps and detach. Fake-port tests cover framing, handshakes, recovery,
write stalls, keepalive and release priority. Patient/camera/provider tests cover
shared timing, reaction, stiffness, deterministic noise, latency and lifecycle.
Hardware bench verification remains a team task; these tests never flash or move
physical servos.
