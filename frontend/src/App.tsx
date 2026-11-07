import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Link,
  useLocation,
} from 'react-router-dom';
import { GloveProvider } from './glove';
import { VisionProvider } from './vision';
import {
  RuntimeProvider,
  useExerciseView,
  useEvaluationView,
  useRuntime,
  RuntimeStatus,
} from './runtime';
import { VoiceProvider } from './voice';
import { StatusChip, Toasts } from './components/common';
import Home from './pages/Home';
import Setup from './pages/Setup';
import Calibrate from './pages/Calibrate';
import Exercise from './pages/Exercise';
import Evaluation from './pages/Evaluation';
import History from './pages/History';
import SessionReplay from './pages/SessionReplay';
import EvaluationDetail from './pages/EvaluationDetail';
import Doctor from './pages/Doctor';
import Profile from './pages/Profile';
import DevHand from './pages/DevHand';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
function Shell() {
  const location = useLocation(),
    phase = useExerciseView((v) => v.phase),
    stage = useEvaluationView((v) => v.stage);
  const index = useExerciseView((v) => v.index),
    total = useExerciseView((v) => v.total),
    rep = useExerciseView((v) => v.rep);
  const runtime = useRuntime();
  const focus =
    (location.pathname === '/exercise' && phase !== 'DONE') ||
    (location.pathname === '/evaluate' &&
      ['prepare', 'sweep', 'cooldown'].includes(stage));
  const doctor = location.pathname === '/doctor';
  return (
    <div className={focus ? 'focus' : doctor ? 'doctor' : 'setup-data'}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {doctor && (
        <div className="doctor-banner">
          Doctor view · read-only
          <Link className="button" to="/">
            Exit doctor view
          </Link>
        </div>
      )}
      <header>
        {focus ? (
          <>
            <button
              onClick={() => {
                void runtime.exercise.stop();
                void runtime.evaluation.stop();
              }}
            >
              End session
            </button>
            <span>
              Pose {index + 1} of {total} · Rep {rep}
            </span>
          </>
        ) : (
          <>
            <Link to="/">◐ Rehab Hub</Link>
            {!doctor && (
              <nav aria-label="Main navigation">
                {[
                  ['/', 'Home'],
                  ['/exercise', 'Exercise'],
                  ['/evaluate', 'Evaluate'],
                  ['/history', 'History'],
                  ['/setup', 'Setup'],
                  ['/profile', 'Profile'],
                ].map(([to, label]) => (
                  <NavLink key={to} to={to}>
                    {label}
                  </NavLink>
                ))}
              </nav>
            )}
          </>
        )}
        <div className="statuses">
          <RuntimeStatus />
          <StatusChip>● Glove: Simulator</StatusChip>
          <StatusChip>● Camera: Simulated hand</StatusChip>
          {!focus && !doctor && (
            <Link className="button" to="/doctor">
              Doctor view
            </Link>
          )}
        </div>
      </header>
      <div id="safety-banner-slot" aria-live="assertive" aria-atomic="true" />
      <main id="main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/calibrate" element={<Calibrate />} />
          <Route path="/exercise" element={<Exercise />} />
          <Route path="/evaluate" element={<Evaluation />} />
          <Route path="/history" element={<History />} />
          <Route path="/history/sessions/:id" element={<SessionReplay />} />
          <Route
            path="/history/evaluations/:id"
            element={<EvaluationDetail />}
          />
          <Route path="/doctor" element={<Doctor />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/_dev/hand" element={<DevHand />} />

          <Route
            path="*"
            element={
              <section>
                <h1>Page not found</h1>
                <Link to="/">Go home</Link>
              </section>
            }
          />
        </Routes>
      </main>
      <Toasts />
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {focus ? `Exercise ${phase.toLowerCase()}. Evaluation ${stage}.` : ''}
      </div>
    </div>
  );
}
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <GloveProvider>
        <VisionProvider>
          <RuntimeProvider>
            <VoiceProvider>
              <BrowserRouter>
                <Shell />
              </BrowserRouter>
            </VoiceProvider>
          </RuntimeProvider>
        </VisionProvider>
      </GloveProvider>
    </QueryClientProvider>
  );
}
