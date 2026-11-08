interface RecognitionResult {
  isFinal: boolean;
  [index: number]: { transcript: string };
}
export interface Recognition {
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
export function recognitionConstructor() {
  const scope = globalThis as typeof globalThis & {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}
