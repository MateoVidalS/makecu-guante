import { useStore } from 'zustand';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useVision } from '../vision';
import { CameraVision } from '../vision/cameraVision';
import { useRuntime } from './RuntimeProvider';
import { RehabRuntime } from './runtime';

export function useSavingStatus() {
  const runtime = useRuntime();
  return useSyncExternalStore(
    (cb) =>
      runtime instanceof RehabRuntime
        ? runtime.persistence.store.subscribe(cb)
        : () => {},
    () => {
      if (!(runtime instanceof RehabRuntime)) return 'Saved';
      const state = runtime.persistence.store.getState();
      return state.pending && state.status === 'Saved'
        ? 'Saving…'
        : state.status;
    },
  );
}

export function RuntimeStatus() {
  const runtime = useRuntime();
  return runtime instanceof RehabRuntime ? (
    <SavingStatus runtime={runtime} />
  ) : null;
}
function SavingStatus({ runtime }: { runtime: RehabRuntime }) {
  const state = useStore(runtime.persistence.store);
  const status = useSavingStatus();
  return (
    <span role="status" aria-label="Session saving status">
      {status}
      {!state.durable && ' · Keep this tab open to finish saving'}
    </span>
  );
}
export function RuntimeDiagnostics() {
  const runtime = useRuntime();
  return runtime instanceof RehabRuntime ? (
    <Diagnostics runtime={runtime} />
  ) : null;
}
function Diagnostics({ runtime }: { runtime: RehabRuntime }) {
  const state = useStore(runtime.diagnosticsStore);
  const vision = useVision();
  const [, refresh] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => refresh((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const camera =
    vision.source instanceof CameraVision ? vision.source.stats() : null;
  const ms = (value: number | null) =>
    value === null ? 'Waiting for samples' : `${value.toFixed(1)} ms`;
  return (
    <section aria-label="Runtime latency diagnostics">
      <h2>Latency diagnostics</h2>
      <dl>
        {camera && (
          <>
            <dt>Camera → vision frame (p95)</dt>
            <dd>{ms(camera.cameraToFrame.p95)}</dd>
            <dt>Vision inference (p95)</dt>
            <dd>{ms(camera.inference.p95)}</dd>
          </>
        )}
        <dt>Vision → command (p95)</dt>
        <dd>{ms(state.visionToCommandP95)}</dd>
        <dt>Command → telemetry echo (p95)</dt>
        <dd>{ms(state.commandToEchoP95)}</dd>
      </dl>
      <p>
        Latest {state.samples} samples. Echo confirms the firmware goal, not
        physical servo position.
      </p>
    </section>
  );
}
