import { useSyncExternalStore } from 'react';
import { useGlove } from '../glove';
import { benchMirror } from '../glove/benchMirror';

/**
 * On the practice screen with the simulated glove: are the real motors receiving the
 * session's commands? Without this a bench test can run with no motor connected.
 */
export function BenchMirrorStatus() {
  const { client } = useGlove();
  const mirror = useSyncExternalStore(benchMirror.subscribe, benchMirror.state);
  if (client.kind !== 'sim') return null;
  const on = mirror.active && mirror.connection === 'connected';
  return (
    <p
      role="status"
      className={on ? 'hp-note' : 'hp-alert'}
      data-testid="bench-mirror-status"
    >
      {on
        ? `Real motors: connected, ${mirror.commands} commands sent` +
          (mirror.lastEvent
            ? `, last board event: ${mirror.lastEvent.e}`
            : '') +
          (mirror.lastError
            ? `, last board error: ${mirror.lastError.why}`
            : '')
        : 'Real motors: not connected. Simulated glove only (Demo tools → Mirror to real glove).'}
    </p>
  );
}
