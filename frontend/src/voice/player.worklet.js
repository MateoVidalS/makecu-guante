/* global AudioWorkletProcessor, sampleRate, registerProcessor */
class Player extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.started = false;
    this.port.onmessage = ({ data }) => {
      if (data === 'flush') {
        this.queue = [];
        this.offset = 0;
        this.started = false;
        return;
      }
      const view = new DataView(data);
      for (let i = 0; i + 1 < view.byteLength; i += 2)
        this.queue.push(view.getInt16(i, true) / 32768);
      // Bound latency and memory to two seconds if a producer outruns playback.
      if (this.queue.length > 48000)
        this.queue.splice(0, this.queue.length - 48000);
    };
  }
  process(_inputs, outputs) {
    const output = outputs[0][0];
    if (!this.started && this.queue.length >= 960) this.started = true;
    for (let i = 0; i < output.length; i++) {
      if (!this.started || !this.queue.length) {
        output[i] = 0;
        continue;
      }
      const at = Math.floor(this.offset);
      output[i] = this.queue[at] ?? 0;
      this.offset += 24000 / sampleRate;
      const used = Math.floor(this.offset);
      if (used) {
        this.queue.splice(0, used);
        this.offset -= used;
      }
      if (!this.queue.length) this.started = false;
    }
    return true;
  }
}
registerProcessor('voice-player', Player);
