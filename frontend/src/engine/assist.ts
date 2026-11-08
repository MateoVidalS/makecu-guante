import {
  GLOVE_FINGERS,
  pullFromClosure,
  type GloveFinger,
  type Quint,
} from '../contracts/glove';
import { MAX_ASSIST_PULL } from '../contracts/poses';
import type { PoseDef } from '../contracts/poses';

export const DEFAULT_ASSIST_STAGGER_MS = 150;
export const MAX_ASSIST_PARALLEL = 3;
const ARRIVED_EPSILON = 1e-6;
export const FOLLOW_SLACK = 0.08;

/** A held tendon may only pay out; it must leave the patient free to close. */
export const heldPull = (position: number, vision: number): number =>
  Math.min(position, Math.max(0, pullFromClosure(vision) - FOLLOW_SLACK));

/** Provisional values; hardware bench measurements must replace these estimates. */
export const SERVO_PROFILES: Record<GloveFinger, { stall_ma: number }> = {
  thumb: { stall_ma: 650 },
  index: { stall_ma: 800 },
  middle: { stall_ma: 750 },
  ring: { stall_ma: 650 },
  pinky: { stall_ma: 650 },
};

/** Goals and commands are pull; vision and scheduling deficits remain closure. */
export class AssistScheduler {
  readonly target: Quint;
  readonly goal: Quint;
  private moving = new Set<number>();
  private started = new Set<number>();
  private startOrder: number[] = [];
  private shed = new Set<number>();
  private heldAtStart = new Map<number, number>();
  hasStarted(index: number) {
    return this.started.has(index);
  }
  suspend(index: number, position: number) {
    this.moving.delete(index);
    this.started.delete(index);
    this.target[index] = position;
  }
  private lastStart = -Infinity;

  constructor(
    private readonly pose: PoseDef,
    position: Quint,
    private readonly staggerMs: number,
    private readonly maxParallel: number,
    private readonly caps: Quint = [
      MAX_ASSIST_PULL,
      MAX_ASSIST_PULL,
      MAX_ASSIST_PULL,
      MAX_ASSIST_PULL,
      MAX_ASSIST_PULL,
    ],
  ) {
    this.target = [...position];
    this.goal = GLOVE_FINGERS.map((f, i) =>
      pose.closure[f] === null
        ? position[i]
        : Math.min(this.caps[i], pullFromClosure(pose.closure[f]!)),
    ) as Quint;
  }

  reduceGoals(pose: PoseDef, caps: Quint): void {
    for (const [i, f] of GLOVE_FINGERS.entries()) {
      if (pose.closure[f] === null) continue;
      const goal = Math.min(caps[i], pullFromClosure(pose.closure[f]!));
      this.goal[i] = Math.min(this.goal[i], goal);
      this.target[i] = Math.min(this.target[i], goal);
    }
  }

  refreshHeld(position: Quint, vision: Quint, assistable: boolean[]): void {
    for (const i of GLOVE_FINGERS.keys()) {
      if (!assistable[i]) this.suspend(i, heldPull(position[i], vision[i]));
      else if (!this.started.has(i))
        this.target[i] = heldPull(position[i], vision[i]);
      if (this.shed.has(i))
        this.target[i] = Math.min(this.target[i], this.goal[i]);
    }
  }

  /** Shed the newest tendon first, including tendons already holding still. */
  shedLoad(position: Quint, vision: Quint): number | null {
    for (const i of [...this.startOrder].reverse()) {
      const held = Math.min(
        this.heldAtStart.get(i) ?? position[i],
        heldPull(position[i], vision[i]),
      );
      if (this.target[i] <= held + ARRIVED_EPSILON) {
        if (position[i] > held + 0.02) return null;
        continue;
      }
      this.target[i] = Math.max(held, this.target[i] - 0.05);
      this.goal[i] = Math.min(this.goal[i], this.target[i]);
      this.shed.add(i);
      return i;
    }
    return null;
  }

  candidates(position: Quint, vision: Quint, unreached: boolean[]): number[] {
    return GLOVE_FINGERS.map((_, i) => i)
      .filter(
        (i) =>
          unreached[i] &&
          !this.started.has(i) &&
          !this.shed.has(i) &&
          this.goal[i] > position[i] + ARRIVED_EPSILON,
      )
      .sort(
        (a, b) =>
          vision[b] -
          this.pose.closure[GLOVE_FINGERS[b]]! -
          (vision[a] - this.pose.closure[GLOVE_FINGERS[a]]!),
      );
  }

  /** Start at most one finger per tick, even when the caller's clock jumps. */
  advance(
    now: number,
    position: Quint,
    vision: Quint,
    unreached: boolean[],
    blocked = false,
  ): boolean {
    for (const i of this.moving)
      if (Math.abs(position[i] - this.target[i]) <= ARRIVED_EPSILON)
        this.moving.delete(i);
    if (
      blocked ||
      this.moving.size >= this.maxParallel ||
      now - this.lastStart < this.staggerMs
    )
      return false;
    const next = this.candidates(position, vision, unreached)[0];
    if (next === undefined) return false;
    this.heldAtStart.set(next, this.target[next]);
    this.target[next] = this.goal[next];
    this.moving.add(next);
    this.started.add(next);
    this.startOrder = this.startOrder.filter((i) => i !== next);
    this.startOrder.push(next);
    this.lastStart = now;
    return true;
  }

  complete(position: Quint, vision: Quint, unreached: boolean[]): boolean {
    return (
      position.every((a, i) => Math.abs(a - this.target[i]) <= 0.02) &&
      this.candidates(position, vision, unreached).length === 0
    );
  }
}
