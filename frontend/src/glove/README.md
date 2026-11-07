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
// As on hardware, send all five servo ranges and the patient's current limit.
world.glove.calib(0, 20, 150);
world.glove.calib(1, 20, 150);
world.glove.calib(2, 20, 150);
world.glove.calib(3, 20, 150);
world.glove.calib(4, 20, 150);
world.glove.limit(1500);
await world.vision.start({ affectedHand: 'right' });
world.vision.setCalibration(cameraCalibration);
world.setIntent('full_fist', 'ATTEMPT'); // Call on engine phase/pose changes.
world.glove.follow([0.3, 0.2, 0.4, 0.25, 0.2]);
// On ASSIST, the engine sends its target via GloveClient as usual.
world.setIntent('full_fist', 'ASSIST');
world.glove.target([0.7, 0.95, 0.95, 0.95, 0.95], 0.3);
world.controls.setRigid('index', true);
// Rigidity can target any finger, including ring and pinky.
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

All five camera fingers come from their own physical world position. Mild,
moderate and severe presets give ring/pinky less active range than the middle
finger. A rigid finger stops at closure 0.22; its commanded ramp can continue,
creating a vision/telemetry gap for engine resistance detection.

## Servo profiles and power

`sim/servoProfiles.ts` mirrors F1's `firmware/include/config.h`. Idle, moving,
stall currents and unloaded speeds are **provisional values to be measured at
5 V**, including identifying the thumb servo. Firmware command speed limits
remain unchanged. `world.servoPosition` tracks the physical shafts separately
from commanded telemetry and respects each servo's mechanical speed.

Attached servos draw their own idle current plus motion/friction and patient
resistance, capped at their nominal stall current; detached servos draw zero.
Unwinding removes tendon resistance. Total demand is the sum of those currents
plus 30 mA for electronics. `world.power` exposes each 5 ms sample:

- `perServoMa`: five servo demands, in wire order.
- `demandMa`: total before supply saturation (five stalls demand 3530 mA).
- `totalMa`: total capped at the 2500 mA supply, fed into the firmware filter.
- `saturated`: supply limit reached; physical closing stalls until demand falls.

This is a deterministic current-limited supply model; it models loss of closing
torque rather than an ESP32 reboot. Track both `demandMa` and `saturated` in
engine stagger tests so supply clipping cannot hide overload. Firmware
overcurrent still trips after 100 ms continuously above the selected limit;
normal/default limits are 1500/2200 mA. A single stalled servo can stay below
the total default limit, so engine resistance detection remains necessary;
the 600 mA evaluation limit catches the rigid-index conformance example.

## Provider and subscriptions

`useGlove()` exposes `client`, `connection`, `connectionError`, `latest`, `events` (last 100),
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

An `info` reporting a finger count other than five immediately rejects the
handshake with "This glove reports N fingers. Rehab Hub requires 5-finger
firmware." The connection becomes `error`, streams close, and
`connectionError` retains the message for Setup. The same check applies to
later `info` messages. Reconnect and source switches clear the old message.
`onError` forwards local connection failures with `c: 'connect'`; firmware
error messages retain their wire command/reason. Incompatible identities are
rejected separately from `codecStats.malformedLines`.

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
