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
