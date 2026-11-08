/* global AudioWorkletProcessor, sampleRate, registerProcessor */
// Up to five minutes of 24 kHz audio queued ahead of playback (about 29 MB).
const MAX_SAMPLES = 24000 * 300;
class Player extends AudioWorkletProcessor {
  constructor() {
    super();
    this.reset();
    this.port.onmessage = ({ data }) => {
      if (data === 'flush') {
        this.reset();
        return;
      }
      const view = new DataView(data);
      for (let i = 0; i + 1 < view.byteLength; i += 2) {
        if (this.length === this.buffer.length) this.grow();
        if (this.length === this.buffer.length) {
          // Only past the cap: drop the oldest sample rather than the newest.
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
  /**
   * Live sends a reply's audio in bursts, far ahead of playback. Queue all of it: a fixed
   * two-second ring dropped the oldest audio, so long answers played with gaps.
   */
  grow() {
    if (this.buffer.length >= MAX_SAMPLES) return;
    const bigger = new Float32Array(
      Math.min(this.buffer.length * 2, MAX_SAMPLES),
    );
    for (let i = 0; i < this.length; i++)
      bigger[i] = this.buffer[(this.read + i) % this.buffer.length];
    this.buffer = bigger;
    this.read = 0;
  }
  reset() {
    // Back to two seconds at the 24 kHz source rate; grows again for long replies.
    this.buffer = new Float32Array(48000);
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
        // Tell the page the reply has finished playing (half-duplex mic gating).
        this.port.postMessage('idle');
      }
    }
    return true;
  }
}
registerProcessor('voice-player', Player);
