// Browser-only test fixture. This fake never reaches a motor or the real runtime.
import { createRoot } from 'react-dom/client';
import { Button } from '../../design-system';
import '../../styles/tokens.css';
import '../../styles/base.css';
import '../../design-system/ds.css';
import { FakeTherapy } from '../../components/therapy/testing/FakeTherapy';
import { CoachDecisions } from './CoachDecisions';
const therapy = new FakeTherapy();
therapy.emit('adjust_help', {
  finger: 'ring',
  direction: 'less',
  reason: 'A gentler pace for your ring finger.',
});
const brake = () => therapy.brake('You pressed Brake.', 'patient_ui');
createRoot(document.getElementById('root')!).render(
  <main>
    <Button size="lg" variant="danger" onClick={brake}>
      Brake
    </Button>
    <Button
      size="lg"
      onClick={() =>
        therapy.emit('add_rest', { seconds: 10, reason: 'Time to rest.' })
      }
    >
      Test coach decision
    </Button>
    <Button
      size="lg"
      onClick={() => {
        therapy.emit('highlight_finger', { finger: 'index' });
        window.setTimeout(() => {
          therapy.live!.highlighted_finger = null;
        }, 4000);
      }}
    >
      Test finger highlight
    </Button>
    <CoachDecisions therapy={therapy} onBrake={brake} sessionId={1} />
  </main>,
);
