/** One Euro filter. Timestamps are performance.now() milliseconds; cutoff is Hz. */
export class OneEuroFilter {
  private time: number | null = null;
  private raw = 0;
  private value = 0;
  private derivative = 0;
  constructor(
    private minCutoff = 1,
    private beta = 0.02,
    private dCutoff = 1,
  ) {
    if (minCutoff <= 0 || beta < 0 || dCutoff <= 0)
      throw new Error('Invalid filter parameters');
  }
  filter(value: number, time: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(time))
      throw new Error('Filter input must be finite');
    if (this.time === null) {
      this.time = time;
      this.raw = this.value = value;
      return value;
    }
    if (time <= this.time) return this.value;
    const dt = (time - this.time) / 1000;
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    const velocity = (value - this.raw) / dt;
    this.derivative += alpha(this.dCutoff) * (velocity - this.derivative);
    this.value +=
      alpha(this.minCutoff + this.beta * Math.abs(this.derivative)) *
      (value - this.value);
    this.raw = value;
    this.time = time;
    return this.value;
  }
  reset() {
    this.time = null;
    this.derivative = 0;
  }
}
