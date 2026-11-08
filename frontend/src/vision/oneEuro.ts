export interface OneEuroOptions {
  /**
   * First-order stages that smooth the speed estimate, each at `dCutoff`. 1 (the
   * default) is the classic One Euro filter. Frame-to-frame differences of white
   * landmark noise are mostly high-frequency, and a second stage removes far more
   * of them (2.3x less noise speed at 30 Hz, two 1 Hz stages vs one 0.5 Hz stage,
   * similar low-frequency delay). Noise and one-frame glitches then open the
   * filter less. Not enabled for joints yet: see `perf/README.md`, temporal tuning.
   */
  speedOrder?: 1 | 2;
}

/** One Euro filter. Timestamps are performance.now() milliseconds; cutoff is Hz. */
export class OneEuroFilter {
  private time: number | null = null;
  private rawSpeed = 0;
  private value = 0;
  private derivative = 0;
  private smoothDerivative = 0;
  private readonly speedOrder: 1 | 2;
  constructor(
    private minCutoff = 1,
    private beta = 0.02,
    private dCutoff = 1,
    { speedOrder = 1 }: OneEuroOptions = {},
  ) {
    if (
      minCutoff <= 0 ||
      beta < 0 ||
      dCutoff <= 0 ||
      (speedOrder !== 1 && speedOrder !== 2)
    )
      throw new Error('Invalid filter parameters');
    this.speedOrder = speedOrder;
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
    if (this.speedOrder === 2)
      this.smoothDerivative +=
        alpha(this.dCutoff) * (this.derivative - this.smoothDerivative);
    const speed = Math.abs(
      this.speedOrder === 2 ? this.smoothDerivative : this.derivative,
    );
    this.value +=
      alpha(this.minCutoff + this.beta * speed) * (value - this.value);
    this.rawSpeed = speedValue;
    this.time = time;
    return this.value;
  }
  reset() {
    this.time = null;
    this.derivative = 0;
    this.smoothDerivative = 0;
  }
}
