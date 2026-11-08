import captureUrl from './capture.worklet.js?url';
import playerUrl from './player.worklet.js?url';

export interface VoiceAudio {
  open(send: (data: string) => void): Promise<void>;
  play(data: string): void;
  flush(): void;
  setMuted(muted: boolean): void;
  close(): void;
}
export function encodePCM(buffer: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}
export function decodePCM(data: string): ArrayBuffer {
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0)).buffer;
}
export class BrowserAudio implements VoiceAudio {
  private context?: AudioContext;
  private stream?: MediaStream;
  private capture?: AudioWorkletNode;
  private player?: AudioWorkletNode;
  private muted = false;
  private generation = 0;
  /** True while queued reply audio is still playing. */
  playing = false;
  /** Called when queued reply audio has finished playing. */
  onIdle?: () => void;
  async open(send: (data: string) => void) {
    this.close();
    const generation = this.generation;
    const context = new AudioContext();
    this.context = context;
    await context.resume();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
    });
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    await Promise.all([
      context.audioWorklet.addModule(captureUrl),
      context.audioWorklet.addModule(playerUrl),
    ]);
    if (generation !== this.generation) return;
    this.capture = new AudioWorkletNode(context, 'voice-capture');
    this.player = new AudioWorkletNode(context, 'voice-player');
    this.player.port.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (data === 'idle') {
        this.playing = false;
        this.onIdle?.();
      }
    };
    this.capture.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
      if (!this.muted) send(encodePCM(data));
    };
    context.createMediaStreamSource(stream).connect(this.capture);
    // Processor emits silence; connecting keeps capture alive without mic monitoring.
    this.capture.connect(context.destination);
    this.player.connect(context.destination);
    this.setMuted(this.muted);
  }
  play(data: string) {
    if (this.player) this.playing = true;
    const buffer = decodePCM(data);
    this.player?.port.postMessage(buffer, [buffer]);
  }
  flush() {
    this.playing = false;
    this.player?.port.postMessage('flush');
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    this.stream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }
  close() {
    this.generation++;
    this.playing = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.capture?.disconnect();
    this.player?.disconnect();
    this.capture = undefined;
    this.player = undefined;
    void this.context?.close().catch(() => {});
    this.context = undefined;
  }
}
