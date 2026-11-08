import { useCallback, useEffect, useRef, useState } from 'react';
import type { EngineEvent } from '../../contracts/engine';
import { useGlove } from '../../glove';
import { useRuntime } from '../../runtime';

export type SafetyEvent = Extract<EngineEvent, { kind: 'safety' }>;

/**
 * 11-ux-design §6.2 step 4: after Resume the banner reads "Releasing the glove…" until the
 * firmware is back to idle. When that release does not happen, one of these replaces the
 * title and Resume is offered again.
 */
export const recoveryCopy = {
  // 04-firmware §3: `release` cannot clear the fault while STOP is held, so nothing resumed.
  stop_held: 'Release the STOP button first, then press Resume.',
  // Copy only: practice stays paused until the user presses Resume.
  stop_released: 'STOP released. Press Resume when ready.',
  unconfirmed:
    "The glove didn't confirm the release. Check it, then press Resume.",
} as const;
export type SafetyRecovery = keyof typeof recoveryCopy;

/** "Releasing the glove…" is never permanent: after this the banner offers Resume again. */
export const RELEASE_CONFIRM_MS = 5000;

const EVALUATION_RUNNING = new Set(['prepare', 'sweep', 'cooldown']);

/**
 * State of the SafetyBanner (06-session §3 PAUSED row, 11-ux-design §6.2). The firmware stays
 * the safety authority: this only decides what the banner says and whether Resume is offered.
 * It never resumes on its own; every resume starts from an explicit press.
 */
export function useSafetyRecovery() {
  const runtime = useRuntime(),
    { client } = useGlove();
  const [event, setEvent] = useState<SafetyEvent | null>(null),
    [releasing, setReleasing] = useState(false),
    [recovery, setRecovery] = useState<SafetyRecovery | null>(null);
  // Transport callbacks can run inside resume() itself (the simulator answers synchronously),
  // before React re-renders, so they read refs instead of possibly stale state.
  const shown = useRef<SafetyEvent | null>(null),
    pending = useRef(false),
    stopHeld = useRef<boolean | null>(null);

  const show = useCallback((next: SafetyEvent | null) => {
    shown.current = next;
    pending.current = false;
    setEvent(next);
    setReleasing(false);
    setRecovery(null);
  }, []);
  /** Leave "Releasing the glove…" for an actionable banner that says why nothing resumed. */
  const settle = useCallback((why?: SafetyRecovery) => {
    if (!shown.current) return;
    pending.current = false;
    setReleasing(false);
    setRecovery(why ?? (stopHeld.current ? 'stop_held' : 'unconfirmed'));
  }, []);

  useEffect(
    () =>
      runtime.exercise.onEvent((e) => {
        if (e.kind === 'safety') show(e);
      }),
    [runtime, show],
  );
  useEffect(
    () =>
      runtime.exercise.subscribe((v) => {
        if (v.phase === 'DONE' || v.phase === 'REST') show(null);
        // 06-session §3: the engine latched PAUSED again, so the release did not take.
        else if (v.phase === 'PAUSED' && pending.current) settle();
      }),
    [runtime, show, settle],
  );
  useEffect(() => {
    // A different transport: its STOP state is unknown until it reports one.
    stopHeld.current = null;
    const off = [
      client.onTelemetry((t) => {
        // The firmware is back to idle: the stop is cleared (11-ux-design §6.2 step 4).
        if (pending.current && t.st === 'idle') show(null);
      }),
      client.onEvent((e) => {
        if (e.e === 'stop_button') {
          stopHeld.current = true;
          if (pending.current) settle('stop_held');
          else setRecovery((r) => (r ? 'stop_held' : r));
        } else if (e.e === 'stop_released') {
          stopHeld.current = false;
          if (!shown.current || pending.current) return;
          const stopBanner = shown.current.source === 'stop_button';
          // Copy only: the user still has to press Resume.
          setRecovery((r) =>
            r === 'stop_held' || (r === null && stopBanner)
              ? 'stop_released'
              : r,
          );
        }
      }),
      client.onError((e) => {
        // 04-firmware §3: `release` is answered with `err fault` only while STOP is held.
        if (e.c === 'release' && e.why === 'fault') {
          stopHeld.current = true;
          settle('stop_held');
        }
      }),
    ];
    return () => off.forEach((unsubscribe) => unsubscribe());
  }, [client, show, settle]);
  useEffect(() => {
    if (!releasing) return;
    const timer = setTimeout(() => {
      if (pending.current) settle();
    }, RELEASE_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [releasing, settle]);

  const resume = () => {
    if (!shown.current) return;
    // A paused exercise, or an evaluation still sweeping, owns the glove and its release.
    const sessionOwnsGlove =
      runtime.exercise.view().phase !== 'DONE' ||
      EVALUATION_RUNNING.has(runtime.evaluation.view().stage);
    pending.current = true;
    setReleasing(true);
    setRecovery(null);
    runtime.exercise.resume();
    // Nothing is left to resume (e.g. an evaluation ended on this stop), so clear the firmware
    // latch directly. `release` only lets the fingers go, and the firmware refuses it while
    // STOP is held, so it cannot start motion.
    if (!sessionOwnsGlove && pending.current) client.release();
  };
  return { event, releasing, recovery, resume };
}
