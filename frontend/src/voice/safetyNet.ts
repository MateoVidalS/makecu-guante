import type { EngineEvent } from '../contracts/engine';
export type SafetyEvent = Extract<
  EngineEvent,
  { kind: 'safety' | 'resistance' }
>;
export function safetyPhrase(event: SafetyEvent): string {
  if (event.kind === 'resistance' || event.source === 'overcurrent')
    return `Stopping. I felt resistance${event.finger ? ` in your ${event.finger}` : ''}.`;
  if (event.source === 'stop_button')
    return "Stopped. Press release when you're ready.";
  if (event.source === 'camera_lost') return "I can't see your hand. Pausing.";
  return 'The glove disconnected. It has released.';
}
export interface LocalVoice {
  unlock(): void;
  tone(kind: 'safety' | 'cue' | 'reached' | 'assist'): void;
  speak(text: string, done?: () => void): void;
  cancel(): void;
  dispose(): void;
}
export class BrowserLocalVoice implements LocalVoice {
  private context?: AudioContext;
  unlock() {
    try {
      this.context ??= new AudioContext();
      globalThis.speechSynthesis?.getVoices();
      void this.context.resume().catch(() => {});
    } catch {
      /* Captions remain available. */
    }
  }
  tone(kind: 'safety' | 'cue' | 'reached' | 'assist') {
    this.unlock();
    if (!this.context) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.frequency.value = {
      safety: 440,
      cue: 660,
      reached: 880,
      assist: 550,
    }[kind];
    gain.gain.setValueAtTime(0.12, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      this.context.currentTime + 0.16,
    );
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start();
    oscillator.stop(this.context.currentTime + 0.18);
  }
  speak(text: string, done?: () => void) {
    if (!globalThis.speechSynthesis) {
      done?.();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    const localVoice = speechSynthesis
      .getVoices()
      .find((voice) => voice.localService && voice.lang.startsWith('en'));
    if (localVoice) utterance.voice = localVoice;
    utterance.rate = 0.95;
    utterance.onend = () => done?.();
    utterance.onerror = () => done?.();
    speechSynthesis.speak(utterance);
  }
  cancel() {
    globalThis.speechSynthesis?.cancel();
  }
  dispose() {
    this.cancel();
    void this.context?.close().catch(() => {});
    this.context = undefined;
  }
}
export class SafetyNet {
  private generation = 0;
  constructor(
    private local: LocalVoice,
    private interrupt: () => void,
    private caption: (text: string) => void,
    private finished?: () => void,
  ) {}
  handle(event: EngineEvent): boolean {
    if (event.kind !== 'safety' && event.kind !== 'resistance') return false;
    // No promises, timers, React effects, or network on this path.
    const generation = ++this.generation;
    this.interrupt();
    try {
      this.local.tone('safety');
    } catch {
      /* Speech and captions must survive audio failures. */
    }
    this.local.cancel();
    const phrase = safetyPhrase(event);
    this.caption(phrase);
    this.local.speak(phrase, () => {
      if (generation === this.generation) this.finished?.();
    });
    return true;
  }
}
