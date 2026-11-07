import {
  THERAPY_LIMITS,
  type CoachDecision,
  type CoachToolName,
  type FeelingEntry,
  type TherapyApi,
} from '../../../contracts/therapist';

/** UI test double only. It never connects to the glove or controls the engine. */
export class FakeTherapy implements TherapyApi {
  readonly limits = THERAPY_LIMITS;
  private log: CoachDecision[] = [];
  private entries: FeelingEntry[] = [];
  private listeners = new Set<(d: CoachDecision) => void>();
  brakes = 0;
  undos = 0;
  state = () => null;
  decisions = () => this.log;
  feelings = () => this.entries;
  onDecision = (cb: (d: CoachDecision) => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };
  emit(
    tool: CoachToolName,
    args: Record<string, unknown>,
    result: CoachDecision['result'] = 'applied',
    source: CoachDecision['source'] = 'coach',
  ) {
    const decision: CoachDecision = {
      id: String(this.log.length),
      t: new Date(
        Date.UTC(2026, 10, 7, 12, 0, this.log.length * 5),
      ).toISOString(),
      session_id: 1,
      tool,
      requested: args,
      applied: result === 'rejected' ? null : args,
      result,
      reason:
        typeof args.reason === 'string' ? args.reason : 'For your comfort.',
      source,
    };
    this.log.push(decision);
    this.listeners.forEach((cb) => cb(decision));
    return decision;
  }
  adjust = (
    tool: CoachToolName,
    args: Record<string, unknown>,
    source: CoachDecision['source'],
  ) => this.emit(tool, args, 'applied', source);
  undo = () => {
    this.undos++;
    return this.emit('undo_last_adjustment', {}, 'undone', 'patient_ui');
  };
  brake = (reason: string, source: CoachDecision['source']) => {
    this.brakes++;
    return this.emit('brake', { reason }, 'applied', source);
  };
  recordFeeling = (
    f: Omit<FeelingEntry, 't' | 'session_id' | 'attempt_index'>,
  ) => {
    this.entries.push({
      ...f,
      t: new Date().toISOString(),
      session_id: 1,
      attempt_index: 0,
    });
    const decision = this.emit('record_feeling', f, 'applied', 'patient_ui');
    if (f.pain >= this.limits.pain_brake_at)
      this.brake('Pain reported.', 'patient_ui');
    return decision;
  };
}
