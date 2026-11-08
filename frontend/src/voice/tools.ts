import type { Runtime } from '../contracts/runtime';
import type { SessionSummary } from '../contracts/engine';
import type { ToolCall } from './transport';

export function decisionResponse(
  decision: import('../contracts/therapist').CoachDecision,
) {
  return {
    ok: decision.result !== 'rejected',
    reason: decision.reason,
    decision,
  };
}

export async function dispatchTool(
  runtime: Runtime,
  call: ToolCall,
  previous: SessionSummary | null,
) {
  try {
    const therapy = runtime.therapy;
    const args = call.args ?? {};
    switch (call.name) {
      case 'get_live_state': {
        const state = therapy?.state();
        return state
          ? { ok: true, state }
          : { ok: false, reason: 'Therapy state unavailable.' };
      }
      case 'adjust_help':
      case 'set_attempt_time':
      case 'add_rest':
      case 'choose_next_pose':
      case 'assist_finger_now':
      case 'adjust_target':
      case 'highlight_finger':
      case 'note_for_therapist':
      case 'repeat_pose':
      case 'intensify':
      case 'record_feeling':
      case 'brake':
      case 'undo_last_adjustment': {
        if (!therapy)
          return { ok: false, reason: 'Therapy controls unavailable.' };
        if (
          call.name === 'intensify' &&
          typeof therapy.notePatientSpeech !== 'function'
        )
          return { ok: false, reason: 'Patient consent tracking unavailable.' };
        if (call.name === 'brake')
          return decisionResponse(
            therapy.brake(
              typeof args.reason === 'string'
                ? args.reason
                : 'Coach requested a brake.',
              'coach',
            ),
          );
        if (call.name === 'undo_last_adjustment') {
          const decision = therapy.undo();
          return decision
            ? decisionResponse(decision)
            : { ok: false, reason: 'No adjustment to undo.' };
        }
        if (
          call.name === 'record_feeling' &&
          typeof args.pain === 'number' &&
          Number.isFinite(args.pain) &&
          args.pain >= 0 &&
          args.pain <= 10 &&
          typeof args.fatigue === 'number' &&
          Number.isFinite(args.fatigue) &&
          args.fatigue >= 0 &&
          args.fatigue <= 10 &&
          typeof args.note === 'string'
        ) {
          return decisionResponse(
            therapy.recordFeeling({
              pain: args.pain,
              fatigue: args.fatigue,
              note: args.note,
              source: 'voice',
            }),
          );
        }
        // The runtime validates, clamps, schedules and audits even rejected calls.
        return decisionResponse(therapy.adjust(call.name, args, 'coach'));
      }
      case 'pause_session':
        runtime.exercise.pause();
        break;
      case 'resume_session':
        runtime.exercise.resume();
        break;
      case 'skip_pose':
        runtime.exercise.skip();
        break;
      case 'stop_session':
        await runtime.exercise.stop();
        break;
      case 'repeat_instruction':
        return { instruction: runtime.exercise.view().pose.instruction };
      case 'get_progress':
        return {
          current: runtime.exercise.view().activeMax,
          previous: previous?.per_finger ?? null,
        };
      default:
        return { error: 'Unknown tool' };
    }
    return { ok: true };
  } catch {
    return { error: 'Action unavailable. Check the session controls.' };
  }
}
