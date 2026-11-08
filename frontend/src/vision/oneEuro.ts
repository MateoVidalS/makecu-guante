/** One Euro filter. Timestamps are performance.now() milliseconds; cutoff is Hz. */
export class OneEuroFilter {
  private time: number | null = null;
  private rawSpeed = 0;
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
  /** Use a shared speed signal when related channels must keep equal gains. */
  filter(value: number, time: number, speedValue = value): number {
    if (
      !Number.isFinite(value) ||
      !Number.isFinite(time) ||
      !Number.isFinite(speedValue)
    )
      throw new Error('Filter input must be finite');
    if (this.time === null) {
      this.time = time;
      this.rawSpeed = speedValue;
      this.value = value;
      return value;
    }
    if (time <= this.time) return this.value;
    const dt = (time - this.time) / 1000;
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    const velocity = (speedValue - this.rawSpeed) / dt;
    this.derivative += alpha(this.dCutoff) * (velocity - this.derivative);
    this.value +=
      alpha(this.minCutoff + this.beta * Math.abs(this.derivative)) *
      (value - this.value);
    this.rawSpeed = speedValue;
    this.time = time;
    return this.value;
  }
  reset() {
    this.time = null;
    this.derivative = 0;
  }
}
