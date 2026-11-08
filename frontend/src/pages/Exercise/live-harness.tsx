// Browser layout fixture only. ScriptedRuntime never commands a glove or engine.
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Shell } from '../../App';
import { GloveProvider } from '../../glove';
import { VisionProvider } from '../../vision';
import { RuntimeProvider } from '../../runtime';
import { ScriptedRuntime } from '../../runtime/ScriptedRuntime';
import { VoiceProvider } from '../../voice';
import { SessionProgressProvider } from '../../components/common/SessionProgress';
import {
  POSES,
  DEFAULT_PLAN,
  DEFAULT_EXERCISE_SETTINGS,
} from '../../contracts/poses';
import type { EngineEvent, ExercisePhase } from '../../contracts/engine';
import { worker } from '../../mocks/browser';
import '../../styles/base.css';
import '@fontsource/atkinson-hyperlegible/400.css';

const runtime = new ScriptedRuntime({ persist: false });
const listeners = new Set<(event: EngineEvent) => void>();
runtime.exercise.onEvent = (callback) => {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
};
await runtime.exercise.start(DEFAULT_PLAN, DEFAULT_EXERCISE_SETTINGS);
runtime.dispose();
const setPhase = (phase: ExercisePhase) => {
  runtime.exerciseStore.setState({
    phase,
    paused: phase === 'PAUSED',
    assisting: phase.startsWith('ASSIST'),
    pose: POSES.hook,
    index: 3,
    rep: 1,
    total: 15,
    phaseElapsed: 1,
    phaseDuration: 6,
    activeMax: { thumb: 0.2, index: 0.5, middle: 0.6, ring: 0.4, pinky: 0.3 },
  });
  listeners.forEach((callback) =>
    callback({ kind: 'phase', phase, pose: 'hook', rep: 1, index: 3 }),
  );
};
Object.assign(window, {
  u4Layout: {
    phase: setPhase,
    progress(index: number, rep: number) {
      runtime.exerciseStore.setState({ index, rep });
    },
    safety(source: Extract<EngineEvent, { kind: 'safety' }>['source']) {
      setPhase('PAUSED');
      listeners.forEach((callback) =>
        callback({
          kind: 'safety',
          source,
          finger: source === 'overcurrent' ? 'index' : null,
          ma: source === 'overcurrent' ? 950 : null,
        }),
      );
    },
  },
});
setPhase('PRESENT');
await worker.start({ onUnhandledRequest: 'bypass' });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    <GloveProvider>
      <VisionProvider>
        <RuntimeProvider runtime={runtime}>
          <VoiceProvider>
            <MemoryRouter initialEntries={['/exercise']}>
              <SessionProgressProvider>
                <Shell />
              </SessionProgressProvider>
            </MemoryRouter>
          </VoiceProvider>
        </RuntimeProvider>
      </VisionProvider>
    </GloveProvider>
  </QueryClientProvider>,
);
