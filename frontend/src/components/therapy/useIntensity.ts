import { useEffect, useState } from 'react';
import type { CoachDecision, TherapyApi } from '../../contracts/therapist';
import type { FingerId } from '../../contracts/vision';

interface IntensityView {
  active: FingerId[];
  restored: FingerId[];
  automatic: boolean;
}
const same = (a: FingerId[], b: FingerId[]) =>
  a.length === b.length && a.every((finger) => b.includes(finger));

/** Reflect authoritative intensity and reversions; never grant consent in the UI. */
export function useIntensity(
  therapy: TherapyApi | undefined,
  sessionId: number | null,
) {
  const read = () => [...(therapy?.state()?.adjustments.intensified ?? [])];
  const [view, setView] = useState<IntensityView>(() => ({
    active: read(),
    restored: [],
    automatic: false,
  }));
  useEffect(() => {
    const current = () => [
      ...(therapy?.state()?.adjustments.intensified ?? []),
    ];
    setView({ active: current(), restored: [], automatic: false });
    if (!therapy) return;
    const update = (decision?: CoachDecision) => {
      const active = current();
      setView((previous) => {
        if (same(previous.active, active)) return previous;
        const removed = previous.active.filter(
          (finger) => !active.includes(finger),
        );
        const added = active.some(
          (finger) => !previous.active.includes(finger),
        );
        return {
          active,
          restored: removed.length ? removed : added ? [] : previous.restored,
          automatic: removed.length
            ? decision?.source === 'local_rule'
            : added
              ? false
              : previous.automatic,
        };
      });
    };
    const unsubscribe = therapy.onDecision(update);
    const timer = window.setInterval(update, 250);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [therapy, sessionId]);
  return view;
}
