/** Browser-only QA harness. Loaded explicitly by browser-check.mjs, never by the app. */
import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import { RuntimeProvider } from '../runtime';
import { ScriptedRuntime } from '../runtime/ScriptedRuntime';
import { createVoiceToken } from '../api/client';
import type { EngineEvent } from '../contracts/engine';
import { VoiceProvider, useVoice } from './VoiceProvider';
import { CoachPanel } from './CoachPanel';
import { BrowserAudio } from './audio';
import { BrowserLocalVoice } from './safetyNet';
import { FakeTransport } from './transport';

export function mountCheck() {
  const runtime = new ScriptedRuntime({ persist: false });
  const audio = new BrowserAudio();
  const local = new BrowserLocalVoice();
  let patient: (text: string, finished: boolean) => void = () => {};
  let brakes = 0;
  const pause = runtime.exercise.pause;
  runtime.exercise.pause = () => {
    brakes++;
    pause();
  };
  let receive: (event: EngineEvent) => void = () => {};
  runtime.exercise.onEvent = (cb) => {
    receive = cb;
    return () => {};
  };
  const dependencies = {
    token: createVoiceToken,
    sessions: async () => [],
    save: async () => {},
    audio,
    local,
    patient: {
      start: (cb: typeof patient) => {
        patient = cb;
      },
      stop: () => {},
    },
    transport: () => new FakeTransport(),
  };
  const check = {
    audio,
    local,
    capture: [] as string[],
    timings: {} as Record<string, number>,
    voice: null as ReturnType<typeof useVoice> | null,
    emit: (event: EngineEvent) => receive(event),
    patient: (text: string) => patient(text, true),
    brakes: () => brakes,
    dispose: () => {
      root.unmount();
      runtime.dispose();
    },
  };
  function Probe() {
    const voice = useVoice();
    useEffect(() => {
      check.voice = voice;
    }, [voice]);
    return (
      <>
        <button onClick={() => void voice.start(null)}>
          Start voice browser check
        </button>
        <CoachPanel />
      </>
    );
  }
  const container = document.createElement('div');
  document.querySelector('main')!.prepend(container);
  const root = createRoot(container);
  root.render(
    <RuntimeProvider runtime={runtime}>
      <VoiceProvider dependencies={dependencies}>
        <Probe />
      </VoiceProvider>
    </RuntimeProvider>,
  );
  return check;
}
