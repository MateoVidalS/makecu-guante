import { useVoice } from './VoiceProvider';
import {
  Banner,
  Card,
  Inline,
  Select,
  Stack,
  StatusChip,
  Switch,
  Text,
} from '../design-system';
import './CoachPanel.css';
export function CoachPanel({ compact = false }: { compact?: boolean }) {
  const voice = useVoice();
  const labels = {
    off: 'Voice off',
    connecting: 'Connecting',
    listening: 'Listening',
    speaking: 'Speaking',
    paused: 'Paused',
    fallback: 'Simple voice',
  };
  return (
    <Card
      as="aside"
      className={`coach-panel ${compact ? 'coach-panel--compact coach-compact' : ''}`}
      aria-label="Voice coach"
    >
      <Stack gap={12}>
        <Inline justify="between" className="coach-quick-controls">
          <span className="coach-state">
            <span
              className="coach-speaking"
              data-speaking={voice.status === 'speaking'}
              aria-hidden="true"
            >
              <i />
              <i />
              <i />
            </span>
            <StatusChip
              icon="mic"
              label="Coach"
              value={
                voice.mode === 'simple' ? 'Simple voice' : labels[voice.status]
              }
              tone={voice.status === 'listening' ? 'active' : 'neutral'}
            />
          </span>
          <Switch
            label="Microphone"
            checked={voice.mode !== 'off' && !voice.muted}
            disabled={voice.mode === 'off'}
            onCheckedChange={(on) => voice.setMuted(!on)}
          />
          <details
            data-safety-popover
            className="coach-options"
            onToggle={(event) => {
              if (document.querySelector('#safety-banner-slot [role="alert"]'))
                event.currentTarget.open = false;
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.open = false;
                event.currentTarget.querySelector('summary')?.focus();
              }
            }}
          >
            <summary>Coach controls</summary>
            <div className="coach-popover">
              <Select
                label="Voice mode"
                value={voice.mode}
                onChange={(e) =>
                  voice.setMode(e.target.value as 'live' | 'simple' | 'off')
                }
                options={[
                  { value: 'live', label: 'Live coach' },
                  { value: 'simple', label: 'Simple voice' },
                  { value: 'off', label: 'Off' },
                ]}
              />
              <p>
                You can say “pause”, “continue”, “skip”, “repeat” or “stop”.
              </p>
              <p className="muted">
                Stop and pain words work in Simple voice with microphone access.
              </p>
              <p className="muted">
                Other commands need Live coach. Session buttons always work.
              </p>
            </div>
          </details>
        </Inline>
        {voice.unavailable && (
          <Banner
            tone="warning"
            title="Live coach unavailable — using simple voice"
          />
        )}
        <h3 className="coach-caption">
          {voice.lastCoachLine ??
            (voice.mode === 'off' ? 'Voice off' : 'Your coach is here.')}
        </h3>
        {voice.lastPatientLine && (
          <Text className="coach-patient" tone="muted">
            You said: {voice.lastPatientLine}
          </Text>
        )}
        {voice.transcriptError && (
          <Banner
            tone="warning"
            title="Transcript save pending. Please keep this page open."
          />
        )}
      </Stack>
    </Card>
  );
}
