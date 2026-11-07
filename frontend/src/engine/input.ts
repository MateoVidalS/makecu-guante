import type { EngineInput, Output } from './types';
import type { Quint } from '../contracts/glove';
import { GLOVE_FINGERS } from '../contracts/glove';

export const output = (): Output => ({ commands: [], events: [] });

/** Treat stale frames as unseen even if the last reported confidence was high. */
export const visible = (input: EngineInput): boolean =>
  !!(
    input.vision?.detected &&
    input.vision.confidence >= 0.6 &&
    input.vision.closure &&
    input.now >= input.vision.t &&
    input.now - input.vision.t <= 300 &&
    GLOVE_FINGERS.every((f) => Number.isFinite(input.vision!.closure![f]))
  );
export const closure = (input: EngineInput): Quint =>
  GLOVE_FINGERS.map((f) =>
    Math.min(1, Math.max(0, input.vision?.closure?.[f] ?? 0)),
  ) as Quint;
export const motorSafe = (input: EngineInput): boolean =>
  input.gloveConnected &&
  input.tel !== null &&
  (input.tel.st === 'idle' || input.tel.st === 'run') &&
  visible(input);
