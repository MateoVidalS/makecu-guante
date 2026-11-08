import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useGlove } from '../glove';
import { Banner } from '../design-system';
import { boardRestartMessage } from './boardRestart';
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

export function RuntimeStatus({ focus = false }: { focus?: boolean }) {
  const runtime = useRuntime();
  return runtime instanceof RehabRuntime ? (
    <>
      <SavingStatus runtime={runtime} focus={focus} />
      <RuntimeBrownoutNotice inline />
    </>
  ) : null;
}
function SavingStatus({
  runtime,
  focus,
}: {
  runtime: RehabRuntime;
  focus: boolean;
}) {
  const state = useStore(runtime.persistence.store);
  const status = useSavingStatus();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (status !== 'Saving…') return;
    const timer = setTimeout(() => setSlow(true), 2000);
    return () => clearTimeout(timer);
  }, [status]);
  if (focus && status !== 'Offline' && !(status === 'Saving…' && slow))
    return null;
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

/** The latest boot belongs to the currently selected glove; source switches clear its events. */
export function RuntimeBrownoutNotice({
  inline = false,
}: {
  inline?: boolean;
}) {
  const glove = useGlove();
  const message = boardRestartMessage(glove.events);
  if (!message) return null;
  if (!inline) return <Banner tone="warning" title={message} />;
  const notice = (
    <div role="alert" aria-label="Glove board status">
      <Banner tone="warning" title={message} />
    </div>
  );
  // Keep advisory power guidance out of the compact header and the hard-stop
  // slot: that slot's safety styles intentionally hide ordinary live controls.
  const slot = document.querySelector('.app-top');
  return slot ? createPortal(notice, slot) : notice;
}
