import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { useStore } from 'zustand';
import { useQueryClient } from '@tanstack/react-query';
import type { ExerciseView, EvaluationView } from '../contracts/runtime';
import { useGlove } from '../glove';
import { useVision } from '../vision';
import { RehabRuntime } from './runtime';
import type { ScriptedRuntime } from './ScriptedRuntime';

const Context = createContext<RehabRuntime | ScriptedRuntime | null>(null);
export function RuntimeProvider({
  children,
  runtime,
}: {
  children: ReactNode;
  runtime?: RehabRuntime | ScriptedRuntime;
}) {
  return runtime ? (
    <InjectedRuntime runtime={runtime}>{children}</InjectedRuntime>
  ) : (
    <ConnectedRuntime>{children}</ConnectedRuntime>
  );
}
function InjectedRuntime({
  children,
  runtime,
}: {
  children: ReactNode;
  runtime: RehabRuntime | ScriptedRuntime;
}) {
  useEffect(() => {
    if (runtime instanceof RehabRuntime) runtime.mount();
    return () => runtime.dispose();
  }, [runtime]);
  return <Context.Provider value={runtime}>{children}</Context.Provider>;
}
function ConnectedRuntime({ children }: { children: ReactNode }) {
  const glove = useGlove(),
    vision = useVision(),
    cache = useQueryClient();
  const runtime = useMemo(() => {
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      /* Private browsers may disable storage. */
    }
    return new RehabRuntime({
      glove,
      vision,
      storage,
      onSaved: () => {
        for (const key of [
          'sessions',
          'evaluations',
          'history',
          'calibrations',
        ])
          void cache.invalidateQueries({ queryKey: [key] });
      },
    });
  }, [glove, vision, cache]);
  return <InjectedRuntime runtime={runtime}>{children}</InjectedRuntime>;
}
export function useRuntime() {
  const runtime = useContext(Context);
  if (!runtime) throw new Error('RuntimeProvider is missing');
  return runtime;
}
export function useExerciseView<T = ExerciseView>(
  selector: (view: ExerciseView) => T = (v) => v as T,
) {
  return useStore(useRuntime().exerciseStore, selector);
}
export function useEvaluationView<T = EvaluationView>(
  selector: (view: EvaluationView) => T = (v) => v as T,
) {
  return useStore(useRuntime().evaluationStore, selector);
}
