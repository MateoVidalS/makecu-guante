import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { ExercisePlanItem } from '../../contracts/engine';
import type { GloveFinger } from '../../contracts/glove';
import { GLOVE_FINGERS } from '../../contracts/glove';

const Context = createContext<{
  plan: ExercisePlanItem[];
  setPlan: (plan: ExercisePlanItem[]) => void;
  fingers: GloveFinger[];
  setFingers: (fingers: GloveFinger[]) => void;
} | null>(null);

export function SessionProgressProvider({ children }: { children: ReactNode }) {
  const [plan, setPlan] = useState<ExercisePlanItem[]>([]);
  const [fingers, setFingers] = useState<GloveFinger[]>([...GLOVE_FINGERS]);
  return (
    <Context.Provider value={{ plan, setPlan, fingers, setFingers }}>
      {children}
    </Context.Provider>
  );
}

export function useSessionProgress() {
  return useContext(Context);
}

export function useProgressPlan(plan: ExercisePlanItem[]) {
  const setPlan = useContext(Context)?.setPlan;
  useEffect(() => {
    setPlan?.(plan);
  }, [plan, setPlan]);
}

export function useProgressFingers(fingers: GloveFinger[]) {
  const setFingers = useContext(Context)?.setFingers;
  const key = fingers.join(',');
  useEffect(() => {
    setFingers?.(key.split(',').filter(Boolean) as GloveFinger[]);
  }, [key, setFingers]);
}

/** Runtime index counts attempts. The patient sees the plan item and its reps. */
export function exerciseProgress(
  plan: ExercisePlanItem[],
  index: number,
  rep: number,
) {
  let start = 0;
  for (const [poseIndex, item] of plan.entries()) {
    if (index < start + item.reps)
      return `Pose ${poseIndex + 1} of ${plan.length} · Rep ${rep} of ${Math.max(item.reps, rep)}`;
    start += item.reps;
  }
  return 'Your practice';
}

export function evaluationProgress(
  fingers: GloveFinger[],
  finger: GloveFinger | null,
  speed: 'slow' | 'fast' | null,
  stage: string,
) {
  if (!finger) return `Evaluation · ${stage}`;
  const index = fingers.indexOf(finger);
  const name = finger.charAt(0).toUpperCase() + finger.slice(1);
  return `${name} · ${speed ?? stage} (${index * 2 + (speed === 'fast' ? 2 : 1)} of ${fingers.length * 2})`;
}
