// Today's plan for the next practice (docs/plan/17-progression.md).
//
// Off unless the therapist turned the adaptive plan on in the Doctor view. Every "Start
// practice" button passes its settings through `apply`, which returns them unchanged when the
// plan is off, still loading, failed to load, or standard: practice never waits for it.
import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { getSession, getSessions, useProgressionSettings } from '../api/client';
import type { Session } from '../contracts/api';
import type { ExerciseSettings } from '../contracts/engine';
import { DEFAULT_EXERCISE_SETTINGS } from '../contracts/poses';
import { useOptionalRuntime } from '../runtime';
import { PROGRESSION, applyPlan, planToday, type TodaysPlan } from './plan';

/** Same cohort rule as the session records: any simulated source makes it demo data. */
function runtimeIsDemo(
  runtime: ReturnType<typeof useOptionalRuntime>,
): boolean {
  const sources = (
    runtime as { sources?: { glove: string; vision: string } } | null
  )?.sources;
  return !!sources && (sources.glove === 'sim' || sources.vision === 'sim');
}

const candidate = (s: Session) =>
  s.assist_direction === 'open' &&
  s.ended_at !== null &&
  s.plan.some((p) => p.pose === 'open');

export interface TodaysPlanState {
  /** The therapist turned the adaptive plan on. */
  enabled: boolean;
  loading: boolean;
  /** Plan for the cohort the next practice will be recorded in (null while loading or off). */
  plan: TodaysPlan | null;
  /** Settings with today's plan applied; unchanged when off, loading or standard. */
  apply<T extends ExerciseSettings>(
    settings: T,
    options?: { skip?: boolean },
  ): T;
}

/**
 * @param preview compute the plan even when it is off (Doctor view preview). The cohort is then
 * the most recent opening session's, since the Doctor view does not start practice.
 */
export function useTodaysPlan({ preview = false } = {}): TodaysPlanState {
  const runtime = useOptionalRuntime();
  const settings = useProgressionSettings();
  const enabled = settings.data?.enabled === true;
  const challenge = settings.data?.challenge ?? 'standard';
  const active = enabled || preview;
  const list = useQuery({
    queryKey: ['sessions', 'progression'],
    queryFn: () => getSessions({ mode: 'exercise', limit: 40 }),
    enabled: active,
  });
  // A few extra per cohort: a session can have open-hand attempts that were all interrupted.
  const picked = useMemo(() => {
    const open = (list.data ?? []).filter(candidate);
    return [true, false].flatMap((demo) =>
      open.filter((s) => s.is_demo === demo).slice(0, PROGRESSION.window + 2),
    );
  }, [list.data]);
  const details = useQueries({
    queries: picked.map((s) => ({
      queryKey: ['sessions', s.id],
      queryFn: () => getSession(s.id),
      enabled: active,
    })),
  });
  const loaded = details.flatMap((q) => (q.data ? [q.data] : []));
  const loadedKey = loaded.map((s) => s.id).join(',');
  const plans = useMemo(() => {
    const make = (demo: boolean) =>
      planToday(
        loaded.filter((s) => s.is_demo === demo),
        { challenge, settings: DEFAULT_EXERCISE_SETTINGS },
      );
    return { demo: make(true), real: make(false) };
    // loadedKey stands for `loaded`, a new array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey, challenge]);
  const loading =
    settings.isPending ||
    (active && (list.isPending || details.some((q) => q.isPending)));
  const ready = active && !loading && !list.isError;
  const cohortDemo = () =>
    preview
      ? ((list.data ?? []).find(candidate)?.is_demo ?? false)
      : runtimeIsDemo(runtime);
  const planFor = (demo: boolean) => (demo ? plans.demo : plans.real);
  return {
    enabled,
    loading,
    plan: ready ? planFor(cohortDemo()) : null,
    apply: (value, options) => {
      // Read the sources now: Demo tools can switch them after this render.
      if (!enabled || !ready || options?.skip) return value;
      return applyPlan(value, planFor(runtimeIsDemo(runtime))) as typeof value;
    },
  };
}
