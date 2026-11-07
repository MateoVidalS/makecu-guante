import { useState } from 'react';
import { DEFAULT_PLAN } from '../../contracts/poses';

const SHORT_KEY = 'rehab-hub.practice.short';
export function useShortPractice() {
  const [short, setValue] = useState(() => {
    try {
      return localStorage.getItem(SHORT_KEY) === 'true';
    } catch {
      return false;
    }
  });
  return [
    short,
    (value: boolean) => {
      setValue(value);
      try {
        localStorage.setItem(SHORT_KEY, String(value));
      } catch {
        /* Optional preference. */
      }
    },
  ] as const;
}
export const practicePlan = (short = false) =>
  DEFAULT_PLAN.map((item) => ({ ...item, reps: short ? 1 : item.reps }));
