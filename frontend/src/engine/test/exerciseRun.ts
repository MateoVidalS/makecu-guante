import { expect } from 'vitest';
import type {
  AttemptResult,
  EngineEvent,
  ExercisePlanItem,
} from '../../contracts/engine';
import { DEFAULT_EXERCISE_SETTINGS } from '../../contracts/poses';
import type { PoseId } from '../../contracts/poses';
import { createExerciseEngine } from '../exercise';
import type {
  EngineInput,
  EngineOptions,
  ExerciseEngine,
  Output,
  PowerAwareExerciseSettings,
} from '../types';
import { calibration, FakeWorld } from './fakeWorld';

export class Run {
  world = new FakeWorld();
  engine: ExerciseEngine;
  outputs: Output[] = [];
  events: EngineEvent[] = [];
  constructor(
    pose: PoseId = 'open',
    overrides: Partial<PowerAwareExerciseSettings> = {},
    options: EngineOptions = {},
    plan?: ExercisePlanItem[],
  ) {
    this.world.hand = [0.8, 0.8, 0.8, 0.8, 0.8];
    this.engine = createExerciseEngine({
      ...options,
      onTherapyOutput: (out) => this.accept(out),
    });
    this.accept(
      this.engine.start(
        plan ?? [{ pose, reps: 1 }],
        {
          ...DEFAULT_EXERCISE_SETTINGS,
          present_s: 0,
          attempt_s: 1,
          rest_s: 0.1,
          hold_s: 0.2,
          ...overrides,
        },
        calibration,
        0,
      ),
    );
  }
  accept(out: Output): Output {
    this.world.apply(out.commands);
    this.outputs.push(out);
    this.events.push(...out.events);
    return out;
  }
  step(ms = 50, change?: (input: EngineInput) => void): Output {
    const input = this.world.step(ms);
    change?.(input);
    return this.accept(this.engine.tick(input));
  }
  until(
    phase: ReturnType<ExerciseEngine['state']>['phase'],
    limit = 2000,
  ): void {
    for (let i = 0; i < limit && this.engine.state().phase !== phase; i++)
      this.step();
    expect(this.engine.state().phase).toBe(phase);
  }
  results(): AttemptResult[] {
    return this.events.flatMap((e) =>
      e.kind === 'attempt_done' ? [e.result] : [],
    );
  }
  targets() {
    return this.outputs
      .flatMap((o) => o.commands)
      .filter((c) => c.t === 'target');
  }
}
