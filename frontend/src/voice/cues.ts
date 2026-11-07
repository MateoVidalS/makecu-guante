import type { AttemptResult, EngineEvent } from '../contracts/engine';
import type { ExerciseView } from '../contracts/runtime';
import { POSES } from '../contracts/poses';
import { safetyPhrase } from './safetyNet';
export interface Cue {
  text: string;
  speak: boolean;
  present?: boolean;
}
const pct = (value: number | null | undefined) =>
  value == null ? 'n/a' : `${Math.round(value * 100)}%`;
export function eventCue(
  event: EngineEvent,
  view: ExerciseView,
  previous?: AttemptResult | null,
): Cue | null {
  switch (event.kind) {
    case 'phase':
      if (event.phase === 'PRESENT')
        return {
          text: `[session] PRESENT: Pose ${event.index + 1} of ${view.total}, ${event.pose}, rep ${event.rep}. Instruction: ${POSES[event.pose].instruction}`,
          speak: true,
          present: true,
        };
      if (event.phase === 'ATTEMPT')
        return { text: '[session] Attempt started.', speak: false };
      return null;
    case 'progress':
      return {
        text: `[session] ${event.finger} now at ${pct(event.active_max)} (target ${pct(view.pose.closure[event.finger])}).`,
        speak: true,
      };
    case 'reached':
      return {
        text: `[session] Reached the position ${event.assisted ? 'with help' : 'on their own'} in ${event.t_rel.toFixed(1)} s.`,
        speak: true,
      };
    case 'assist_started':
      return {
        text: `[session] Not reached alone (${event.fingers.map((f) => `${f} ${pct(view.activeMax[f])}/${pct(view.pose.closure[f])}`).join(', ')}). The glove is helping now.`,
        speak: true,
      };
    case 'attempt_done':
      return {
        text: `[session] Result: ${event.result.fingers
          .filter((f) => f.scored)
          .map(
            (f) =>
              `active ${f.finger} ${pct(f.active_max)}, glove helped ${pct(f.assist_needed)}`,
          )
          .join('; ')}. Previous rep: ${
          previous?.fingers
            .filter((f) => f.scored)
            .map((f) => `${f.finger} ${pct(f.active_max)}`)
            .join(', ') ?? 'unavailable'
        }.`,
        speak: true,
      };
    case 'safety':
    case 'resistance':
      return {
        text: `[safety] ${safetyPhrase(event)} Already announced locally. The runtime paused; check if they are OK.`,
        speak: false,
      };
    case 'session_done':
      return {
        text: `[session] Session complete. Summary: ${JSON.stringify(event.summary)}.`,
        speak: true,
      };
  }
}

/** Newer speech replaces pending speech. Context updates always pass immediately. */
export class CueScheduler {
  private pending: Cue | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private lastSpoke = -Infinity;
  private talking = false;
  private progress = new Map<string, number>();
  private lastProgress = -Infinity;
  private encouraged = false;
  constructor(
    private send: (cue: Cue) => void,
    private now = () => performance.now(),
  ) {}
  noteCoachSpeech() {
    this.lastSpoke = this.now();
  }
  setTalking(talking: boolean) {
    this.talking = talking;
    this.drain();
  }
  push(cue: Cue, event?: EngineEvent) {
    if (event?.kind === 'phase' && event.phase === 'PRESENT') {
      this.progress.clear();
      this.encouraged = false;
    }
    if (event?.kind === 'progress') {
      const last = this.progress.get(event.finger) ?? 0;
      if (
        event.active_max - last < 0.1 - 1e-9 ||
        this.now() - this.lastProgress < 3000 ||
        this.encouraged
      )
        return;
      this.progress.set(event.finger, event.active_max);
      this.lastProgress = this.now();
      cue = {
        ...cue,
        speak: !this.talking && this.now() - this.lastSpoke >= 4000,
      };
      if (cue.speak) this.encouraged = true;
    }
    if (!cue.speak) {
      this.send(cue);
      return;
    }
    this.pending = cue;
    this.drain();
  }
  private drain() {
    clearTimeout(this.timer);
    const cue = this.pending;
    if (!cue || (this.talking && !cue.present)) return;
    const delay = Math.max(0, 2500 - (this.now() - this.lastSpoke));
    if (delay) {
      this.timer = setTimeout(() => this.drain(), delay);
      return;
    }
    this.pending = null;
    this.lastSpoke = this.now();
    this.send(cue);
  }
  clear() {
    clearTimeout(this.timer);
    this.pending = null;
  }
}
