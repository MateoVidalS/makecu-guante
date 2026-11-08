import type { AttemptResult, EngineEvent } from '../contracts/engine';
import type { ExerciseView } from '../contracts/runtime';
import { poseInstruction } from './fallbackCoach';
import { GLOVE_FINGERS } from '../contracts/glove';
import { safetyPhrase } from './safetyNet';
import { fingerName } from './fingerNames';
import { attemptContext, pct, summaryContext, targetUnmet } from './context';
export interface Cue {
  text: string;
  speak: boolean;
  present?: boolean;
  opening?: boolean;
  /** What the cue is about, for timing logs (set by VoiceController). */
  label?: string;
  /** performance.now() of the engine event behind the cue. */
  at?: number;
  /** Attempt index when the cue was made. */
  index?: number;
  /**
   * Still worth saying aloud? A spoken cue that is no longer true (its attempt ended,
   * help already released) is passed as context instead, never spoken late.
   */
  valid?: (view: ExerciseView) => boolean;
}

/** Spoken-cue validity by event: what must still hold when the coach would say it. */
export function cueValidity(
  event: EngineEvent,
  index: number,
): ((view: ExerciseView) => boolean) | undefined {
  switch (event.kind) {
    case 'phase':
      return event.phase === 'PRESENT'
        ? (v) =>
            v.index === index && (v.phase === 'PRESENT' || v.phase === 'ATTEMPT')
        : (v) => v.index === index;
    case 'progress':
      return (v) => v.index === index && v.phase === 'ATTEMPT';
    case 'reached':
      // Praise belongs to the attempt: never during the rest or the next invitation.
      return (v) =>
        v.index === index && v.phase !== 'REST' && v.phase !== 'PRESENT';
    case 'assist_started':
      return (v) => v.index === index && v.assisting;
    case 'help_offered':
      return (v) => v.index === index && !!v.helpOffered;
    default:
      return undefined; // check-ins, results and the goodbye stay valid
  }
}
export function eventCue(
  event: EngineEvent,
  view: ExerciseView,
  previous?: AttemptResult | null,
): Cue | null {
  switch (event.kind) {
    case 'phase':
      if (event.phase === 'PRESENT')
        return {
          text: `[session] PRESENT: ${event.pose}, rep ${event.rep}. Attempt ${event.index + 1} of ${view.total}. Pose: ${poseInstruction(event.pose)}${
            previous && event.index > 0
              ? ` Previous attempt: ${attemptContext(previous)} In ONE short turn, react to it in a few words, then invite this pose.`
              : ''
          } Invite it in your own words, differently from before.${event.index === 0 ? ' First pose: if natural, mention once that the glove only helps fingers open; for fists they work alone.' : ''}`,
          speak: true,
          present: true,
        };
      if (event.phase === 'ATTEMPT')
        return { text: '[session] Attempt started.', speak: false };
      return null;
    case 'progress':
      if (!targetUnmet(event.active_max, view.pose.closure[event.finger]))
        return null;
      return {
        opening: view.pose.closure[event.finger] === 0,
        text: `[session] ${fingerName(event.finger)} closure now at ${pct(event.active_max)} (target ${pct(view.pose.closure[event.finger])}).`,
        speak: true,
      };
    case 'reached':
      return {
        text: `[session] Reached the position ${event.assisted ? 'with help' : 'on their own'} in ${event.t_rel.toFixed(1)} s.`,
        speak: true,
      };
    case 'assist_started':
      return {
        text: `[session] Not reached alone (${GLOVE_FINGERS.filter((f) =>
          event.fingers.includes(f),
        )
          .map((f) => {
            const i = GLOVE_FINGERS.indexOf(f);
            return `${fingerName(f)} ${pct(event.from[i])}/${pct(event.to[i])}`;
          })
          .join('; ')}). The glove is helping open now.`,
        speak: true,
      };
    case 'attempt_done':
      // Context only: the coach reacts to it together with the next pose, in one turn,
      // so it never falls behind the screen.
      return {
        text: `[session] Result: ${attemptContext(event.result, previous)} Do not speak yet; you will react with the next pose.`,
        speak: false,
      };
    case 'safety':
    case 'resistance':
      return {
        text: `[safety] ${safetyPhrase(event)} Already announced locally. The runtime paused; check if they are OK.`,
        speak: false,
      };
    case 'help_offered':
      return {
        text: `[session] Not reached alone yet (${event.fingers
          .map(fingerName)
          .join(
            ', ',
          )} still closed). Offer the glove's help in ONE short question, e.g. "Want the glove to help you open?". Never start help yourself: it starts only when the patient asks ("help", "yes", "ayuda").`,
        speak: true,
      };
    case 'session_done':
      return {
        text: `[session] Session complete. Summary: ${summaryContext(event.summary)} In one or two short sentences, recap and say goodbye. The session is over: do not start new exercises or ask questions.`,
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
      const last = this.progress.get(event.finger) ?? (cue.opening ? 1 : 0);
      if (
        (cue.opening ? last - event.active_max : event.active_max - last) <
          0.1 - 1e-9 ||
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
    if (this.pending?.present && !cue.present) {
      this.send({ ...cue, speak: false });
      return;
    }
    this.pending = cue;
    this.drain();
  }
  private drain() {
    clearTimeout(this.timer);
    const cue = this.pending;
    if (!cue || (this.talking && !cue.present)) return;
    // The pose invitation never waits for the spacing: the attempt waits for it (F4), and
    // live runs measured up to 2 s of spacing in its 3.4 s worst case to first sound.
    const delay = cue.present
      ? 0
      : Math.max(0, 2500 - (this.now() - this.lastSpoke));
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
  /** A spoken cue is waiting for its turn. */
  hasPending() {
    return this.pending !== null;
  }
}
