import type { Runtime } from '../contracts/runtime';
import type { SessionSummary } from '../contracts/engine';
import type { ToolCall } from './transport';
export async function dispatchTool(
  runtime: Runtime,
  call: ToolCall,
  previous: SessionSummary | null,
) {
  try {
    switch (call.name) {
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
