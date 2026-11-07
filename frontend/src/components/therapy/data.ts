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
  'adjust_target',
  'repeat_pose',
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
  const args = { ...decision.requested, ...decision.applied };
  const finger = typeof args.finger === 'string' ? ` · ${args.finger}` : '';
  switch (decision.tool) {
    case 'adjust_help':
      return `${args.direction === 'more' ? 'Help starts sooner' : args.direction === 'less' ? 'Help starts later' : args.direction === 'gentler' ? 'Gentler help' : 'Help adjusted'}${finger}`;
    case 'assist_finger_now':
      return `Immediate help${finger}`;
    case 'adjust_target':
      return `${args.direction === 'lower' ? 'Target lowered' : args.direction === 'raise' ? 'Target restored' : 'Target adjusted'}${finger}`;
    case 'highlight_finger':
      return `Coach focus${finger}`;
    case 'note_for_therapist':
      return 'Therapist note';
    case 'repeat_pose':
      return 'Extra repetition queued';
    case 'pause_session':
      return 'Practice paused';
    case 'resume_session':
      return 'Practice resumed';
    case 'skip_pose':
      return 'Pose skipped';
    case 'repeat_instruction':
      return 'Instruction repeated';
    case 'stop_session':
      return 'Practice ended';
    case 'get_progress':
      return 'Progress checked';
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
