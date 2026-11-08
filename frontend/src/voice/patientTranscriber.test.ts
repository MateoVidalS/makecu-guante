import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BrowserPatientTranscriber } from './patientTranscriber';

class Recognition {
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  abort = vi.fn();
  constructor() {
    instances.push(this);
  }
}
let instances: Recognition[];
beforeEach(() => {
  instances = [];
  vi.useFakeTimers();
  vi.stubGlobal('SpeechRecognition', Recognition);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('delivers replacing interim hypotheses, final results and the browser language', () => {
  const receive = vi.fn();
  const transcriber = new BrowserPatientTranscriber();
  transcriber.start(receive);
  const recognition = instances[0];
  expect(recognition).toMatchObject({
    continuous: true,
    interimResults: true,
    lang: 'en-US',
  });
  recognition.onresult?.({
    resultIndex: 0,
    results: [{ 0: { transcript: 'me' }, isFinal: false }],
  });
  recognition.onresult?.({
    resultIndex: 0,
    results: [{ 0: { transcript: 'me duele' }, isFinal: true }],
  });
  expect(receive.mock.calls).toEqual([
    ['me', false],
    ['me duele', true],
  ]);
  transcriber.stop();
  expect(recognition.abort).toHaveBeenCalledOnce();
});
it('restarts after recognition ends, and cancels pending restarts on stop', async () => {
  const transcriber = new BrowserPatientTranscriber();
  transcriber.start(vi.fn());
  const recognition = instances[0];
  recognition.onend?.();
  await vi.advanceTimersByTimeAsync(250);
  expect(recognition.start).toHaveBeenCalledTimes(2);
  recognition.onend?.();
  transcriber.stop();
  await vi.advanceTimersByTimeAsync(1000);
  expect(recognition.start).toHaveBeenCalledTimes(2);
  expect(recognition.onresult).toBeNull();
});
it('does not loop on denied microphone permission or consume stale events', () => {
  const receive = vi.fn();
  const transcriber = new BrowserPatientTranscriber();
  transcriber.start(receive);
  const recognition = instances[0];
  const stale = recognition.onresult;
  recognition.onerror?.({ error: 'not-allowed' });
  expect(recognition.abort).toHaveBeenCalledOnce();
  stale?.({
    resultIndex: 0,
    results: [{ 0: { transcript: 'stop' }, isFinal: true }],
  });
  expect(receive).not.toHaveBeenCalled();
});
it('tolerates browsers with no recognition API', () => {
  vi.stubGlobal('SpeechRecognition', undefined);
  vi.stubGlobal('webkitSpeechRecognition', undefined);
  const transcriber = new BrowserPatientTranscriber();
  expect(() => transcriber.start(vi.fn())).not.toThrow();
  expect(instances).toHaveLength(0);
  transcriber.stop();
});
