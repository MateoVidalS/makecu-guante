/* global AudioWorkletProcessor, sampleRate, registerProcessor */
class Player extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(48000); // Two seconds at the source rate.
    this.reset();
    this.port.onmessage = ({ data }) => {
      if (data === 'flush') {
        this.reset();
        return;
      }
      const view = new DataView(data);
      for (let i = 0; i + 1 < view.byteLength; i += 2) {
        if (this.length === this.buffer.length) {
          this.read = (this.read + 1) % this.buffer.length;
          this.length--;
          this.offset = 0;
        }
        this.buffer[(this.read + this.length) % this.buffer.length] =
          view.getInt16(i, true) / 32768;
        this.length++;
      }
    };
  }
  reset() {
    this.read = 0;
    this.length = 0;
    this.offset = 0;
    this.started = false;
    this.waited = 0;
  }
  process(_inputs, outputs) {
    const output = outputs[0][0];
    if (!this.started && this.length) {
      this.waited += output.length;
      // Start after 40 ms even for a short final chunk, so no tail is stranded.
      if (this.length >= 960 || this.waited >= sampleRate * 0.04)
        this.started = true;
    }
    for (let i = 0; i < output.length; i++) {
      if (!this.started || !this.length) {
        output[i] = 0;
        continue;
      }
      const a = this.buffer[this.read];
      const b =
        this.length > 1 ? this.buffer[(this.read + 1) % this.buffer.length] : a;
      output[i] = a + (b - a) * this.offset;
      this.offset += 24000 / sampleRate;
      const used = Math.min(this.length, Math.floor(this.offset));
      this.read = (this.read + used) % this.buffer.length;
      this.length -= used;
      this.offset -= used;
      if (!this.length) {
        this.started = false;
        this.waited = 0;
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('voice-player', Player);
