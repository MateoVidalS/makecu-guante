import { MAX_ASSIST_PULL } from '../../contracts/poses';
import type { Quint } from '../../contracts/glove';

/** Calibration opens within the straight-finger pull cap, with at most 3 moving.
 * Firmware current limits, STOP and watchdog remain the safety layer.
 */
export class CalibrationOpening {
  readonly target: Quint;
  private started = new Set<number>();
  private moving = new Set<number>();
  private lastStart = -Infinity;

  constructor(position: Quint) {
    this.target = position.map((p) => Math.min(MAX_ASSIST_PULL, p)) as Quint;
  }
  advance(now: number, position: Quint): boolean {
    for (const i of this.moving)
      if (position[i] >= MAX_ASSIST_PULL - 0.01) this.moving.delete(i);
    if (this.moving.size >= 3 || now - this.lastStart < 150) return false;
    const next = this.target.findIndex((_, i) => !this.started.has(i));
    if (next < 0) return false;
    this.started.add(next);
    this.target[next] = MAX_ASSIST_PULL;
    if (position[next] < MAX_ASSIST_PULL - 0.01) this.moving.add(next);
    this.lastStart = now;
    return true;
  }
  settled(position: Quint): boolean {
    return (
      this.started.size === 5 &&
      position.every((p) => p >= MAX_ASSIST_PULL - 0.01)
    );
  }
}
