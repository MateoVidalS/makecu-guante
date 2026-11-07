import {
  GLOVE_FINGERS,
  type GloveFinger,
  type Quint,
} from '../contracts/glove';
import { MAX_ASSIST_CLOSURE } from '../contracts/poses';
import type { PoseDef } from '../contracts/poses';

export const DEFAULT_ASSIST_STAGGER_MS = 150;
export const MAX_ASSIST_PARALLEL = 3;
const ARRIVED_EPSILON = 1e-6;

/** Provisional values; hardware bench measurements must replace these estimates. */
export const SERVO_PROFILES: Record<GloveFinger, { stall_ma: number }> = {
  thumb: { stall_ma: 650 },
  index: { stall_ma: 800 },
  middle: { stall_ma: 700 },
  ring: { stall_ma: 650 },
  pinky: { stall_ma: 650 },
};

/** Full-vector protocol commands hold every unscheduled servo at its measured position. */
export class AssistScheduler {
  readonly target: Quint;
  readonly goal: Quint;
  private moving = new Set<number>();
  private lastStart = -Infinity;

  constructor(
    pose: PoseDef,
    position: Quint,
    private readonly staggerMs: number,
    private readonly maxParallel: number,
  ) {
    this.target = [...position];
    this.goal = GLOVE_FINGERS.map((f, i) =>
      pose.closure[f] === null
        ? position[i]
        : Math.min(MAX_ASSIST_CLOSURE, pose.closure[f]!),
    ) as Quint;
  }

  candidates(position: Quint, vision: Quint, unreached: boolean[]): number[] {
    return GLOVE_FINGERS.map((_, i) => i)
      .filter(
        (i) =>
          unreached[i] &&
          !this.moving.has(i) &&
          Math.abs(position[i] - this.goal[i]) > ARRIVED_EPSILON,
      )
      .sort(
        (a, b) =>
          Math.abs(this.goal[b] - vision[b]) -
          Math.abs(this.goal[a] - vision[a]),
      );
  }

  /** Start at most one finger per tick, even when the caller's clock jumps. */
  advance(
    now: number,
    position: Quint,
    vision: Quint,
    unreached: boolean[],
  ): boolean {
    for (const i of this.moving)
      if (Math.abs(position[i] - this.target[i]) <= ARRIVED_EPSILON)
        this.moving.delete(i);
    if (
      this.moving.size >= this.maxParallel ||
      now - this.lastStart < this.staggerMs
    )
      return false;
    const next = this.candidates(position, vision, unreached)[0];
    if (next === undefined) return false;
    this.target[next] = this.goal[next];
    this.moving.add(next);
    this.lastStart = now;
    return true;
  }

  complete(position: Quint, vision: Quint, unreached: boolean[]): boolean {
    return (
      this.moving.size === 0 &&
      this.candidates(position, vision, unreached).length === 0
    );
  }
}
