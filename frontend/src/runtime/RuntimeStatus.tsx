import { useStore } from 'zustand';
import { useRuntime } from './RuntimeProvider';
import { RehabRuntime } from './runtime';

export function RuntimeStatus() {
  const runtime = useRuntime();
  return runtime instanceof RehabRuntime ? (
    <SavingStatus runtime={runtime} />
  ) : null;
}
function SavingStatus({ runtime }: { runtime: RehabRuntime }) {
  const state = useStore(runtime.persistence.store);
  return (
    <span role="status" aria-label="Session saving status">
      {state.status}
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
  const ms = (value: number | null) =>
    value === null ? 'Waiting for samples' : `${value.toFixed(1)} ms`;
  return (
    <section aria-label="Runtime latency diagnostics">
      <h2>Latency diagnostics</h2>
      <dl>
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
