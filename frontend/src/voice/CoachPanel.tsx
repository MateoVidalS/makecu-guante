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
export function CoachPanel() {
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
    <Card as="aside" className="coach-panel" aria-label="Voice coach">
      <Stack gap={12}>
        <Inline justify="between">
          <StatusChip
            icon="mic"
            label="Coach"
            value={
              voice.mode === 'simple' ? 'Simple voice' : labels[voice.status]
            }
            tone={voice.status === 'listening' ? 'active' : 'neutral'}
          />
          <Switch
            label="Mic on"
            checked={voice.mode === 'live' && !voice.muted}
            disabled={voice.mode !== 'live'}
            onCheckedChange={(on) => voice.setMuted(!on)}
          />
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
        </Inline>
        {voice.unavailable && (
          <Banner
            tone="warning"
            title="Live coach unavailable — using simple voice"
          />
        )}
        {voice.lastCoachLine && (
          <Text className="coach-caption" size="lead">
            {voice.lastCoachLine}
          </Text>
        )}
        {voice.lastPatientLine && (
          <Text tone="muted">You said: {voice.lastPatientLine}</Text>
        )}
        {voice.transcriptError && (
          <Banner
            tone="warning"
            title="Transcript save pending. Please keep this page open."
          />
        )}
        <details>
          <summary>You can say…</summary>
          <Text>
            “Pause”, “continue”, “skip”, “repeat”, “stop”, “how am I doing?”
          </Text>
          <Text tone="muted">
            Voice commands need Live coach. Session buttons always work.
          </Text>
        </details>
      </Stack>
    </Card>
  );
}
