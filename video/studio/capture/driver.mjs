// Vite serves the production modules; this driver only controls the simulator and clock.
import { RehabRuntime } from '/src/runtime/runtime.ts';
import { SimWorld } from '/src/glove/sim/simWorld.ts';
import { DEFAULT_EXERCISE_SETTINGS } from '/src/contracts/poses.ts';
let runtime;
let world;
const mount = RehabRuntime.prototype.mount;
RehabRuntime.prototype.mount = function () {
  runtime = this;
  mount.call(this);
};
const advance = SimWorld.prototype.advance;
SimWorld.prototype.advance = function (ms) {
  world = this;
  advance.call(this, ms);
};
window.captureDriver = {
  preset: (name) => world.controls.setPreset(name),
  start: (settings = {}) => runtime.exercise.start(
    [{ pose: 'open', reps: 1 }], { ...DEFAULT_EXERCISE_SETTINGS, ...settings },
  ),
  state: () => ({ now: world.now, phase: runtime.exercise.view().phase,
    position: [...world.patient.position], firmware: [...world.firmware.position] }),
};
await import('/e2e/ai-therapist-harness.ts');
