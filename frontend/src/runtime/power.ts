import { useSyncExternalStore } from 'react';
import type { ExerciseSettings } from '../contracts/engine';

/**
 * Low-power supply mode: the glove helps one finger at a time.
 *
 * A small bench supply (e.g. ~0.8 A) cannot start several servos together; the weaker
 * ones barely move. With this mode on, the engine starts one finger at a time instead of
 * up to three, and the assist phase gets proportionally more time so every finger still
 * gets its turn. The firmware already powers only the fingers that pull. It applies only
 * to a real glove; the simulator models the full 2.5 A supply.
 */
const KEY = 'rehab-hub.power.one-motor';
const MULTI_MOTOR_PARALLEL = 3; // engine/assist.ts MAX_ASSIST_PARALLEL
const listeners = new Set<() => void>();

export function oneMotorAtATime(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'false'; // on unless turned off
  } catch {
    return true;
  }
}

export function setOneMotorAtATime(value: boolean): void {
  try {
    localStorage.setItem(KEY, String(value));
  } catch {
    /* Optional preference; the default stays on. */
  }
  listeners.forEach((listener) => listener());
}

export function useOneMotorAtATime(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    oneMotorAtATime,
    () => true,
  );
  return [value, setOneMotorAtATime];
}

/** Settings the engine runs with for this glove. Never raises speed or force. */
export function powerAwareSettings<T extends ExerciseSettings>(
  settings: T,
  realGlove: boolean,
  oneMotor = oneMotorAtATime(),
): T & { assist_max_parallel?: number } {
  if (!realGlove || !oneMotor) return settings;
  return {
    ...settings,
    assist_max_parallel: 1,
    // Fingers now take turns, so give the assist phase the time three would have shared.
    assist_max_s: settings.assist_max_s * MULTI_MOTOR_PARALLEL,
  };
}

/** Firmware follow keeps the thread this much slacker than the vision opening (config.h). */
const FOLLOW_SLACK = 0.08;
/** A finger counts as still winding until it is within telemetry precision (2 decimals). */
const WINDING_EPS = 0.011;

/**
 * Low-power follow: take up slack one finger at a time.
 *
 * In follow mode the firmware winds every finger at once at its follow speed, and five
 * servos starting together trip a small supply's current limit (bench: overcurrent 0.15 s
 * into the first opening attempt). This passes every DECREASE immediately, so the thread
 * always pays out at once and never blocks the patient closing, and lets only one finger
 * wind at a time: the one that wants the most, once no finger is still winding.
 */
export class FollowShaper {
  private sent: number[] | null = null;
  reset() {
    this.sent = null;
  }
  shape<T extends number[]>(f: T, tel: { a: readonly number[] } | null): T {
    const prev = this.sent ?? f.map(() => 0);
    const out = f.map((v, i) => Math.min(v, prev[i]));
    const winding =
      !!tel &&
      tel.a.some(
        (a, i) => a < Math.max(0, prev[i] - FOLLOW_SLACK) - WINDING_EPS,
      );
    if (!winding) {
      let best = -1;
      let gain = 1e-6;
      f.forEach((v, i) => {
        if (v - prev[i] > gain) {
          gain = v - prev[i];
          best = i;
        }
      });
      if (best >= 0) out[best] = f[best];
    }
    this.sent = out;
    return out as T;
  }
}

const SLACK_EPS = 0.02;

/**
 * Low-power end of help: unwind one finger at a time, then release.
 *
 * At the end of ASSIST_HOLD the engine releases, and the firmware unwinds all five at
 * once at its release speed: on the bench that drew 750-926 mA and tripped the 700 mA
 * limit. In one-motor mode the runtime instead unwinds the most-pulled finger, then the
 * next (about 0.3 s each), holding the others where they are (never winding), and sends
 * the real release once all are slack. Only the engine's routine RELEASE phase is staged:
 * brake, pause, STOP, faults and the watchdog still release everything at once. If the
 * board leaves run mode (someone released it), staging stops and sends nothing more.
 */
export class StagedRelease {
  private goals: number[] | null = null;
  active() {
    return this.goals !== null;
  }
  cancel() {
    this.goals = null;
  }
  /** First command, or null when already slack (release normally). */
  start(a: readonly number[]): number[] | null {
    if (Math.max(...a) <= SLACK_EPS) return null;
    this.goals = [...a];
    const first = this.step({ a, st: 'run' });
    return Array.isArray(first) ? first : null;
  }
  /** On each telemetry: a target lowering one more finger, 'release' at the end, or null. */
  step(tel: { a: readonly number[]; st: string }): number[] | 'release' | null {
    if (!this.goals) return null;
    if (tel.st !== 'run') {
      this.goals = null; // released or faulted elsewhere: never re-power anything
      return null;
    }
    const goals = this.goals;
    if (goals.some((g, i) => g === 0 && tel.a[i] > SLACK_EPS)) return null;
    let next = -1;
    goals.forEach((g, i) => {
      if (g > 0 && (next < 0 || tel.a[i] > tel.a[next])) next = i;
    });
    if (next < 0 || Math.max(...tel.a) <= SLACK_EPS) {
      this.goals = null;
      return 'release';
    }
    goals[next] = 0;
    return goals.map((g, i) => Math.min(g, tel.a[i]));
  }
}
