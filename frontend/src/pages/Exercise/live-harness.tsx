// Browser layout fixture only. ScriptedRuntime never commands a glove or engine.
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Shell } from '../../App';
import { useEffect } from 'react';
import { GloveProvider, useGlove } from '../../glove';
import { VisionProvider, useVision } from '../../vision';
import { RuntimeProvider } from '../../runtime';
import { ScriptedRuntime } from '../../runtime/ScriptedRuntime';
import { VoiceProvider } from '../../voice';
import { SessionProgressProvider } from '../../components/common/SessionProgress';
import {
  POSES,
  DEFAULT_PLAN,
  DEFAULT_EXERCISE_SETTINGS,
} from '../../contracts/poses';
import { mockState } from '../../mocks/handlers';
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
    pose: phase.startsWith('ASSIST') ? POSES.open : POSES.hook,
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
// Freeze display-only simulator telemetry for reproducible opening-help screenshots.
function DisplayFixture() {
  const glove = useGlove();
  const vision = useVision();
  useEffect(() => {
    Object.assign(window.u4Layout, {
      opening() {
        glove.world.stop();
        vision.stop();
        glove.store.setState({
          connection: 'connected',
          latest: {
            t: performance.now(),
            ms: 1000,
            a: [0.4, 0.6, 0.5, 0.3, 0.2],
            tg: [0.95, 0.95, 0.95, 0.95, 0.95],
            ma: 500,
            st: 'run',
            md: 'target',
          },
        });
        vision.store.setState({
          latest: {
            t: performance.now(),
            detected: true,
            confidence: 1,
            handedness: 'right',
            closure: {
              thumb: 0.6,
              index: 0.4,
              middle: 0.5,
              ring: 0.7,
              pinky: 0.8,
            },
            rawFlexSum: null,
            joints: null,
            pinch: null,
            landmarks: null,
          },
        });
        setPhase('ASSIST');
        runtime.exerciseStore.setState({
          activeMax: {
            thumb: 0.8,
            index: 0.8,
            middle: 0.8,
            ring: 0.8,
            pinky: 0.9,
          },
        });
      },
      evaluationResult() {
        runtime.evaluationStore.setState({
          stage: 'done',
          result: mockState.evaluations[0],
        });
      },
    });
  }, [glove, vision]);
  return null;
}
await worker.start({ onUnhandledRequest: 'bypass' });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    <GloveProvider>
      <VisionProvider>
        <RuntimeProvider runtime={runtime}>
          <VoiceProvider>
            <DisplayFixture />
            <MemoryRouter
              initialEntries={[
                new URLSearchParams(location.search).get('view') ===
                'evaluation'
                  ? '/evaluate'
                  : '/exercise',
              ]}
            >
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
