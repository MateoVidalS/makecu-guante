import type { Quint } from '../../contracts/glove';

/** Calibration reaches the full comfortable servo range, with at most 3 moving.
 * Firmware current limits, STOP and watchdog remain the safety layer.
 */
export class CalibrationClosure {
  readonly target: Quint;
  private started = new Set<number>();
  private moving = new Set<number>();
  private lastStart = -Infinity;

  constructor(position: Quint) {
    this.target = [...position];
  }
  advance(now: number, position: Quint): boolean {
    for (const i of this.moving) if (position[i] >= 0.99) this.moving.delete(i);
    if (this.moving.size >= 3 || now - this.lastStart < 150) return false;
    const next = this.target.findIndex((_, i) => !this.started.has(i));
    if (next < 0) return false;
    this.started.add(next);
    this.target[next] = 1;
    if (position[next] < 0.99) this.moving.add(next);
    this.lastStart = now;
    return true;
  }
  settled(position: Quint): boolean {
    return this.started.size === 5 && position.every((p) => p >= 0.99);
  }
}
