/* global AudioWorkletProcessor, sampleRate, registerProcessor */
// Integrate source samples into 16 kHz bins; retain phase across render quanta.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.sum = 0;
    this.weight = 0;
    this.samples = [];
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    const width = sampleRate / 16000;
    for (const value of input) {
      let remaining = 1;
      while (remaining > 0) {
        const used = Math.min(remaining, width - this.phase);
        this.sum += value * used;
        this.weight += used;
        this.phase += used;
        remaining -= used;
        if (this.phase >= width - 1e-8) {
          const sample = Math.max(-1, Math.min(1, this.sum / this.weight));
          this.samples.push(Math.round(sample * (sample < 0 ? 32768 : 32767)));
          this.phase = 0;
          this.sum = 0;
          this.weight = 0;
          if (this.samples.length === 320) {
            const buffer = new ArrayBuffer(640);
            const view = new DataView(buffer);
            this.samples.forEach((v, i) => view.setInt16(i * 2, v, true));
            this.port.postMessage(buffer, [buffer]);
            this.samples = [];
          }
        }
      }
    }
    return true;
  }
}
registerProcessor('voice-capture', Capture);
