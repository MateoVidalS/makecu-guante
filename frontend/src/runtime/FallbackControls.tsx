import { useEffect, useRef, useState } from 'react';
import { Button, Stack, Text } from '../design-system';
import { useRuntime } from './RuntimeProvider';
import { useVoice } from '../voice';
import { useGlove } from '../glove';
import { useVision } from '../vision';
import { RuntimeSimulatorControls } from './SimulatorControls';
import './fallback.css';

/** One recovery menu, available during a run without navigation or reload. */
export function RuntimeFallbackControls({ live = false }: { live?: boolean }) {
  const runtime = useRuntime();
  const glove = useGlove(),
    vision = useVision();
  const { setMode, mode } = useVoice();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const menu = useRef<HTMLDetailsElement>(null);
  const simulated = glove.client.kind === 'sim' || vision.source.kind === 'sim';
  useEffect(() => {
    const close = runtime.exercise.onEvent((event) => {
      if (event.kind === 'safety' && menu.current) menu.current.open = false;
    });
    const top = document.querySelector('.app-top');
    if (!top || !menu.current) return close;
    const position = () =>
      menu.current?.style.setProperty(
        '--recovery-top',
        `${top.getBoundingClientRect().bottom}px`,
      );
    const observer = new ResizeObserver(position);
    observer.observe(top);
    position();
    return () => {
      close();
      observer.disconnect();
    };
  }, [runtime, simulated]);
  const change = (source: 'glove' | 'vision' | 'both') => {
    setBusy(true);
    setMessage('');
    void (async () => {
      if (source !== 'vision') await runtime.sources.setGlove('sim');
      if (source !== 'glove') await runtime.sources.setVision('sim');
    })()
      .then(() =>
        setMessage('Simulator ready. Start a new practice when you are ready.'),
      )
      .catch(() =>
        setMessage(
          'Could not switch sources. Release the glove and try again.',
        ),
      )
      .finally(() => setBusy(false));
  };
  if (import.meta.env.VITE_DEMO !== '1' && import.meta.env.VITE_SIM !== '1')
    return null;
  return (
    <details
      ref={menu}
      hidden={live}
      className="runtime-fallback"
      data-safety-popover
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.open = false;
          e.currentTarget.querySelector('summary')?.focus();
        }
      }}
    >
      <summary>Demo tools</summary>
      <Stack className="runtime-fallback__panel" gap={8}>
        <Text>
          For live demos and testing without hardware: switch to a simulated
          glove or camera if something fails, and trigger safety moments (rigid
          finger, STOP) on the simulated glove. Switching ends and saves the
          current run.
        </Text>
        {!simulated && (
          <Button size="sm" disabled={busy} onClick={() => change('both')}>
            Use simulator
          </Button>
        )}
        <Button size="sm" disabled={busy} onClick={() => change('glove')}>
          {glove.client.kind === 'sim' && glove.connection === 'connected'
            ? 'Restart simulated glove'
            : 'Use simulated glove'}
        </Button>
        <Button size="sm" disabled={busy} onClick={() => change('vision')}>
          {vision.source.kind === 'sim'
            ? 'Restart simulated camera'
            : 'Use simulated camera'}
        </Button>
        {mode !== 'simple' && (
          <Button
            onClick={() => {
              setMode('simple');
              setMessage('Simple voice ready.');
            }}
          >
            Use simple voice
          </Button>
        )}
        <RuntimeSimulatorControls />
        <Text role="status">{message}</Text>
      </Stack>
    </details>
  );
}
