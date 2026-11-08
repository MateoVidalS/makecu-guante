/** Simple voice can receive interim patient text without a Gemini connection. */
export interface PatientTranscriber {
  start(receive: (text: string, finished: boolean) => void): void;
  stop(): void;
}
interface RecognitionResult {
  isFinal: boolean;
  [index: number]: { transcript: string };
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<RecognitionResult>;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  abort(): void;
}
type RecognitionWindow = typeof globalThis & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
export class BrowserPatientTranscriber implements PatientTranscriber {
  private recognition?: Recognition;
  private retry?: ReturnType<typeof setTimeout>;
  start(receive: (text: string, finished: boolean) => void) {
    this.stop();
    const scope = globalThis as RecognitionWindow;
    const Constructor =
      scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
    if (!Constructor) return;
    const recognition = new Constructor();
    this.recognition = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = globalThis.navigator?.language?.startsWith('es')
      ? 'es-ES'
      : 'en-US';
    recognition.onresult = (event) => {
      if (this.recognition !== recognition) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        // Browser interim hypotheses replace earlier ones, unlike Live deltas.
        receive(result[0].transcript, result.isFinal);
      }
    };
    recognition.onerror = (event) => {
      if (
        ['not-allowed', 'service-not-allowed', 'audio-capture'].includes(
          event.error,
        )
      )
        this.stop();
    };
    recognition.onend = () => {
      if (this.recognition !== recognition) return;
      this.retry = setTimeout(() => {
        if (this.recognition !== recognition) return;
        try {
          recognition.start();
        } catch {
          this.stop();
        }
      }, 250);
    };
    try {
      recognition.start();
    } catch {
      this.stop();
    }
  }
  stop() {
    clearTimeout(this.retry);
    const recognition = this.recognition;
    this.recognition = undefined;
    if (recognition) {
      recognition.onend = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.abort();
    }
  }
}
