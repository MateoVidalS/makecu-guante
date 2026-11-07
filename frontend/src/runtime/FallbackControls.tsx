import { useState } from 'react';
import { Button, Stack, Text } from '../design-system';
import { useRuntime } from './RuntimeProvider';
import { useVoice } from '../voice';
import './fallback.css';

/** Available in the focus shell too: recovery must not require navigation or a reload. */
export function RuntimeFallbackControls() {
  const runtime = useRuntime();
  const { setMode } = useVoice();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const change = (source: 'glove' | 'vision') => {
    setBusy(true);
    setMessage('');
    void (
      source === 'glove'
        ? runtime.sources.setGlove('sim')
        : runtime.sources.setVision('sim')
    )
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
  return (
    <details className="runtime-fallback">
      <summary>Demo recovery</summary>
      <Stack className="runtime-fallback__panel" gap={8}>
        <Text>Switching sources ends and saves the current run.</Text>
        <Button disabled={busy} onClick={() => change('glove')}>
          Use simulated glove
        </Button>
        <Button disabled={busy} onClick={() => change('vision')}>
          Use simulated camera
        </Button>
        <Button
          onClick={() => {
            setMode('simple');
            setMessage('Simple voice ready.');
          }}
        >
          Use simple voice
        </Button>
        <Text role="status">{message}</Text>
      </Stack>
    </details>
  );
}
