import { useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGlove } from '../../glove';
import { useRuntime } from '../../runtime';

export const PRACTICE_PREFLIGHT_URL =
  '/setup?preflight=required#before-practice';
export const PRACTICE_PREFLIGHT_MESSAGE =
  'Confirm the guide and skin checks before practice.';
const STORAGE_KEY = 'rehab-hub.practice.preflight';
export interface PracticePreflight {
  guidesNotReattached: boolean;
  skinNormal: boolean;
  /** Keep confirmations unavailable until the re-attachment redo is saved. */
  recalibrateFrom?: number | null;
}
const empty = (): PracticePreflight => ({
  guidesNotReattached: false,
  skinNormal: false,
});
let fallback = empty();
let memoryOnly = false;
const listeners = new Set<() => void>();

export function readPracticePreflight(): PracticePreflight {
  if (memoryOnly) return fallback;
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable; confirmations still survive route changes.
    return fallback;
  }
  if (!raw) return empty();
  try {
    const value = JSON.parse(raw) as Partial<PracticePreflight> | null;
    return {
      guidesNotReattached: value?.guidesNotReattached === true,
      skinNormal: value?.skinNormal === true,
      ...(value?.recalibrateFrom === null ||
      (typeof value?.recalibrateFrom === 'number' &&
        Number.isFinite(value.recalibrateFrom))
        ? { recalibrateFrom: value.recalibrateFrom }
        : {}),
    };
  } catch {
    return empty();
  }
}
function write(value: PracticePreflight) {
  fallback = value;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    memoryOnly = false;
  } catch {
    // A restricted browser keeps this visit in memory only.
    memoryOnly = true;
  }
  listeners.forEach((notify) => notify());
}
export function updatePracticePreflight(
  patch: Partial<Pick<PracticePreflight, 'guidesNotReattached' | 'skinNormal'>>,
) {
  write({ ...readPracticePreflight(), ...patch });
}
export function guidesReattached(calibrationId: number | null) {
  write({ ...empty(), recalibrateFrom: calibrationId });
}
export function gloveRecalibrationPending(
  preflight: PracticePreflight,
  calibrationId: number | null,
) {
  return (
    preflight.recalibrateFrom !== undefined &&
    (calibrationId === null || preflight.recalibrateFrom === calibrationId)
  );
}
function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}
const snapshot = () => JSON.stringify(readPracticePreflight());
export function usePracticePreflight(): PracticePreflight {
  return JSON.parse(useSyncExternalStore(subscribe, snapshot));
}

/** Check fresh transport and visit state immediately before every practice start. */
export function usePracticePreflightGate() {
  const glove = useGlove();
  const runtime = useRuntime();
  const navigate = useNavigate();
  const isRealGlove = () => {
    const { client, connection } = glove.store.getState();
    return client.kind === 'serial' && connection === 'connected';
  };
  return {
    realGlove: isRealGlove(),
    checkPreflight() {
      if (!isRealGlove()) return true;
      const state = readPracticePreflight();
      if (
        state.guidesNotReattached &&
        state.skinNormal &&
        !gloveRecalibrationPending(
          state,
          runtime.calibration.current?.id ?? null,
        )
      )
        return true;
      navigate(PRACTICE_PREFLIGHT_URL);
      return false;
    },
  };
}
