import type { SessionDetail } from '../../contracts/api';
import type { CoachDecision, FeelingEntry } from '../../contracts/therapist';

// Local read adapter until the coordinator adds these REST fields to SessionDetail.
// The frozen shared contract is deliberately unchanged.
export type TherapySession = SessionDetail & {
  coach_decisions?: CoachDecision[];
  feelings?: FeelingEntry[];
};

export const adjustmentTools = new Set([
  'adjust_help',
  'set_attempt_time',
  'add_rest',
  'choose_next_pose',
]);

export function canUndo(decisions: CoachDecision[]) {
  let pending = 0;
  for (const decision of decisions) {
    if (decision.result === 'rejected') continue;
    if (decision.tool === 'undo_last_adjustment')
      pending = Math.max(0, pending - 1);
    else if (adjustmentTools.has(decision.tool) && decision.result !== 'undone')
      pending++;
  }
  return pending > 0;
}

export function decisionLabel(decision: CoachDecision) {
  const args = decision.applied ?? decision.requested;
  switch (decision.tool) {
    case 'adjust_help':
      return `Help adjusted${typeof args.finger === 'string' ? ` · ${args.finger}` : ''}`;
    case 'set_attempt_time':
      return 'Try time adjusted';
    case 'add_rest':
      return 'Rest added';
    case 'choose_next_pose':
      return 'Next pose changed';
    case 'record_feeling':
      return 'Feeling recorded';
    case 'brake':
      return decision.result === 'rejected'
        ? 'Brake request'
        : 'Brake · glove released';
    case 'undo_last_adjustment':
      return 'Adjustment undone';
    case 'get_live_state':
      return 'Live state checked';
    default:
      return decision.tool.replaceAll('_', ' ');
  }
}

export function elapsedTime(t: string, start: string) {
  const seconds = Math.max(
    0,
    Math.floor((Date.parse(t) - Date.parse(start)) / 1000),
  );
  if (!Number.isFinite(seconds)) return '—';
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export interface TherapyMarker {
  t: number;
  kind: 'decision' | 'feeling';
  label: string;
}

export function attemptTherapyMarkers(
  start: string,
  end: string,
  decisions: CoachDecision[] = [],
  feelings: FeelingEntry[] = [],
): TherapyMarker[] {
  const beginning = Date.parse(start),
    ending = Date.parse(end);
  const events: (TherapyMarker & { absolute: number })[] = [
    ...decisions.map((d) => ({
      absolute: Date.parse(d.t),
      t: (Date.parse(d.t) - beginning) / 1000,
      kind: 'decision' as const,
      label: `${decisionLabel(d)} · ${d.result}: ${d.reason}`,
    })),
    ...feelings.map((f) => ({
      absolute: Date.parse(f.t),
      t: (Date.parse(f.t) - beginning) / 1000,
      kind: 'feeling' as const,
      label: `Pain ${f.pain}/10 · Fatigue ${f.fatigue}/10`,
    })),
  ];
  return events
    .filter((e) => e.absolute >= beginning && e.absolute <= ending)
    .sort((a, b) => a.t - b.t);
}
