import { useVoice } from './VoiceProvider';
export function CoachPanel() {
  const { status } = useVoice();
  return (
    <aside className="card" aria-label="Voice coach">
      Voice {status} · Coming in WP8
    </aside>
  );
}
