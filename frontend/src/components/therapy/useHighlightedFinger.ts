import { useEffect, useState } from 'react';
import type { TherapyApi } from '../../contracts/therapist';
import type { FingerId } from '../../contracts/vision';

/** Decision events set focus immediately; polling observes the runtime's expiry. */
export function useHighlightedFinger(therapy?: TherapyApi) {
  const [finger, setFinger] = useState<FingerId | null>(
    () => therapy?.state()?.highlighted_finger ?? null,
  );
  useEffect(() => {
    const update = () =>
      setFinger(therapy?.state()?.highlighted_finger ?? null);
    update();
    if (!therapy) return;
    const unsubscribe = therapy.onDecision(update);
    const timer = window.setInterval(update, 250);
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [therapy]);
  return finger;
}
