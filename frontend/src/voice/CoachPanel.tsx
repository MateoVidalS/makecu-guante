import { useVoice } from './VoiceProvider';
import './coach.css';
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
    <aside className="card coach-panel" aria-label="Voice coach">
      <div className="coach-controls">
        <span
          className={`coach-avatar ${voice.status === 'speaking' ? 'coach-speaking' : ''}`}
          aria-hidden="true"
        >
          <i />
          <i />
          <i />
        </span>
        <span role="status">
          {voice.mode === 'simple' ? 'Simple voice' : labels[voice.status]}
        </span>
        <button
          type="button"
          onClick={() => voice.setMuted(!voice.muted)}
          aria-pressed={voice.mode === 'live' && !voice.muted}
          disabled={voice.mode !== 'live'}
        >
          Mic {voice.mode === 'live' && !voice.muted ? 'on' : 'off'}
        </button>
        <label>
          Voice mode
          <select
            value={voice.mode}
            onChange={(e) =>
              voice.setMode(e.target.value as 'live' | 'simple' | 'off')
            }
          >
            <option value="live">Live coach</option>
            <option value="simple">Simple voice</option>
            <option value="off">Off</option>
          </select>
        </label>
      </div>
      {voice.unavailable && (
        <p className="coach-notice" role="status">
          Live coach unavailable — using simple voice
        </p>
      )}
      {voice.lastCoachLine && (
        <h3 key={voice.lastCoachLine} className="coach-caption">
          {voice.lastCoachLine}
        </h3>
      )}
      {voice.lastPatientLine && (
        <p className="coach-patient">You said: {voice.lastPatientLine}</p>
      )}
      {voice.transcriptError && (
        <p role="status">
          Transcript save pending. Please keep this page open.
        </p>
      )}
      <details>
        <summary>You can say…</summary>
        <p>“Pause”, “continue”, “skip”, “repeat”, “stop”, “how am I doing?”</p>
        <p>Voice commands need Live coach. Session buttons always work.</p>
      </details>
    </aside>
  );
}
