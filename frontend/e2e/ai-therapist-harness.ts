import { RehabRuntime } from '../src/runtime/runtime';
import { SimWorld } from '../src/glove/sim/simWorld';
import { SimGlove } from '../src/glove/sim/simGlove';
import { FakeTransport } from '../src/voice/transport';
import { browserVoiceDependencies } from '../src/voice/VoiceController';
import type { ToolCall, TransportEvent } from '../src/voice/transport';
import type { VoiceToken } from '../src/contracts/api';
import type { EngineEvent, ExercisePhase } from '../src/contracts/engine';
import type { GloveFinger } from '../src/contracts/glove';
import type { CoachDecision } from '../src/contracts/therapist';

// Test entry only. Mount the actual App, changing its external Live/audio devices
// and driving the production simulator clock explicitly. Runtime, engine, pages,
// firmware simulation and REST persistence are unchanged.
let runtime: RehabRuntime;
let world: SimWorld;
const events: { at: number; event: EngineEvent }[] = [];
const commands: {
  at: number;
  kind: 'target' | 'release';
  f?: number[];
  v?: number;
  from?: number[];
}[] = [];
const audio: string[] = [];
let coachTurns = 0;
let transport: ScriptedLiveTransport;

class ScriptedLiveTransport extends FakeTransport {
  connected = false;
  override async connect(
    token: VoiceToken,
    receive: (event: TransportEvent) => void,
  ) {
    await super.connect(token, receive);
    this.connected = true;
  }
}

Object.assign(browserVoiceDependencies, {
  transport: () => (transport = new ScriptedLiveTransport()),
  audio: () => ({
    open: async () => {},
    play: (data: string) => audio.push(data),
    flush: () => {},
    setMuted: () => {},
    close: () => {},
  }),
});

// Observe the App's existing providers instead of recreating a second UI tree.
const mount = RehabRuntime.prototype.mount;
const observed = new WeakSet<RehabRuntime>();
RehabRuntime.prototype.mount = function () {
  // eslint-disable-next-line @typescript-eslint/no-this-alias -- Observe the provider-created runtime without replacing it.
  runtime = this;
  if (!observed.has(this)) {
    observed.add(this);
    this.exercise.onEvent((event) => events.push({ at: world.now, event }));
  }
  mount.call(this);
};
SimWorld.prototype.start = function () {
  // eslint-disable-next-line @typescript-eslint/no-this-alias -- Keep the provider's simulator, with an explicitly stepped clock.
  world = this;
};
const target = SimGlove.prototype.target;
SimGlove.prototype.target = function (f, v) {
  commands.push({
    at: this.world.now,
    kind: 'target',
    f: [...f],
    v,
    from: [...this.world.firmware.position],
  });
  target.call(this, f, v);
};
const release = SimGlove.prototype.release;
SimGlove.prototype.release = function () {
  commands.push({ at: this.world.now, kind: 'release' });
  release.call(this);
};

function snapshot() {
  return {
    connected: Boolean(transport?.connected && !transport.closed),
    view: runtime.exercise.view(),
    state: runtime.therapy.state()!,
    decisions: runtime.therapy.decisions(),
    feelings: runtime.therapy.feelings(),
    events: structuredClone(events),
    commands: structuredClone(commands),
    firmware: {
      mode: world.firmware.mode,
      position: [...world.firmware.position],
      goal: [...world.firmware.goal],
      attached: [...world.firmware.attached],
      limit: world.firmware.info().limit,
    },
    coachTurns,
    playedAudio: [...audio],
    texts: structuredClone(transport?.texts ?? []),
  };
}

function until(predicate: () => boolean, budgetMs = 90_000) {
  for (let elapsed = 0; !predicate() && elapsed < budgetMs; elapsed += 20)
    world.advance(20);
  if (!predicate())
    throw new Error(
      `Simulator condition not reached: ${JSON.stringify(snapshot())}`,
    );
  return snapshot();
}

const harness = {
  snapshot,
  advance(ms: number) {
    world.advance(ms);
    return snapshot();
  },
  untilPhase(phase: ExercisePhase, index?: number) {
    return until(() => {
      const view = runtime.exercise.view();
      return view.phase === phase && (index == null || view.index === index);
    });
  },
  untilEvent(kind: EngineEvent['kind'], finger?: GloveFinger) {
    return until(() =>
      events.some(
        ({ event }) =>
          event.kind === kind &&
          (finger == null || ('finger' in event && event.finger === finger)),
      ),
    );
  },
  rigid(finger: GloveFinger, enabled: boolean) {
    world.controls.setRigid(finger, enabled);
  },
  async tool(name: string, args: Record<string, unknown> = {}) {
    if (!transport?.connected || transport.closed)
      throw new Error('The production voice controller has not connected.');
    const call: ToolCall = {
      id: `script-${transport.responses.length}-${crypto.randomUUID()}`,
      name,
      args,
    };
    transport.emit({ type: 'tools', calls: [call] });
    const beforeResponse = {
      phase: runtime.exercise.view().phase,
      mode: world.firmware.mode,
      responded: transport.responses.some((r) => r.call.id === call.id),
    };
    // The dispatcher applies safety synchronously and responds on a microtask.
    await Promise.resolve();
    const result = transport.responses.find((r) => r.call.id === call.id);
    if (!result) throw new Error(`No tool response for ${name}`);
    return { ...result.response, beforeResponse } as {
      ok: boolean;
      reason: string;
      decision?: CoachDecision;
      beforeResponse: typeof beforeResponse;
    };
  },
  patient(text: string, finished = true) {
    transport.emit({ type: 'transcript', role: 'patient', text, finished });
    // Read before yielding to React, a timer or any model response.
    return snapshot();
  },
  coach(text: string) {
    coachTurns++;
    transport.emit({ type: 'transcript', role: 'coach', text, finished: true });
    transport.emit({ type: 'turnComplete' });
  },
  modelAudio(data: string) {
    transport.emit({ type: 'audio', data });
  },
  async flush() {
    await runtime.persistence.flush();
  },
};

declare global {
  interface Window {
    aiTherapist: typeof harness;
  }
}
window.aiTherapist = harness;
history.replaceState(null, '', '/calibrate');
await import('../src/main');

export type TherapistSnapshot = ReturnType<typeof snapshot>;
