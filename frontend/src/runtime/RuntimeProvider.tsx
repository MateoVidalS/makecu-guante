import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { useStore } from 'zustand';
import type { ExerciseView, EvaluationView } from '../contracts/runtime';
import { ScriptedRuntime } from './ScriptedRuntime';
const Context = createContext<ScriptedRuntime | null>(null);
export function RuntimeProvider({
  children,
  runtime,
}: {
  children: ReactNode;
  runtime?: ScriptedRuntime;
}) {
  const value = useMemo(() => runtime ?? new ScriptedRuntime(), [runtime]);
  useEffect(() => () => value.dispose(), [value]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
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
