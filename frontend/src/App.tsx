import { lazy, Suspense } from 'react';
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
import { RuntimeFallbackControls } from './runtime/FallbackControls';
import {
  GloveChip,
  CameraChip,
  SafetyBanner,
  Toasts,
} from './components/common';
import {
  applyTheme,
  Button,
  ButtonLink,
  EmptyState,
  Icon,
  PageErrorBoundary,
  ToastProvider,
} from './design-system';
import {
  SessionProgressProvider,
  useSessionProgress,
  exerciseProgress,
  evaluationProgress,
} from './components/common/SessionProgress';
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

// Light by default (whatever the OS says). Applied before the first render so no route flashes dark,
// including the focus and doctor shells, which don't mount the theme toggle.
if (typeof document !== 'undefined') applyTheme('light');

const DesignGallery = lazy(() => import('./design-system/gallery'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

// Patient navigation stays short; planning and evaluation are reached from Home.
// Text-only links: icons next to every nav word are decoration, not information.
const NAV: [to: string, label: string][] = [
  ['/', 'Home'],
  ['/history', 'History'],
  ['/setup', 'Setup'],
];

function Brand() {
  return (
    <Link className="app-brand" to="/" aria-label="Rehab Hub, home">
      <Icon name="logo" size={20} />
      <span>Rehab Hub</span>
    </Link>
  );
}

export function Shell() {
  const location = useLocation(),
    phase = useExerciseView((v) => v.phase),
    stage = useEvaluationView((v) => v.stage);
  const index = useExerciseView((v) => v.index),
    rep = useExerciseView((v) => v.rep);
  const runtime = useRuntime();
  const progress = useSessionProgress();
  const evaluation = useEvaluationView();
  const focus =
    (location.pathname === '/exercise' && phase !== 'DONE') ||
    (location.pathname === '/evaluate' &&
      ['prepare', 'sweep', 'cooldown'].includes(stage));
  const doctor = location.pathname === '/doctor';
  const mode = focus ? 'focus' : doctor ? 'doctor' : 'setup-data';
  return (
    <ToastProvider suppress={focus}>
      <div className={`shell shell--${mode} ${mode}`}>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div className="app-top">
          <header className="app-header">
            {focus ? (
              <>
                <Button
                  icon="x"
                  onClick={() => {
                    if (location.pathname === '/evaluate')
                      void runtime.evaluation.stop();
                    else
                      window.dispatchEvent(new Event('rehab-finish-practice'));
                  }}
                >
                  {location.pathname === '/evaluate'
                    ? 'Stop evaluation'
                    : 'End session'}
                </Button>
                <span className="app-progress">
                  {location.pathname === '/evaluate'
                    ? evaluationProgress(
                        progress?.fingers ?? [],
                        evaluation.finger,
                        evaluation.speed,
                        evaluation.stage,
                      )
                    : exerciseProgress(progress?.plan ?? [], index, rep)}
                </span>
              </>
            ) : doctor ? (
              <>
                <Brand />
                <span className="doctor-label">Doctor view · read-only</span>
                <div className="app-tools">
                  <ButtonLink to="/" size="sm" icon="arrow-left">
                    Exit doctor view
                  </ButtonLink>
                </div>
              </>
            ) : (
              <>
                <Brand />
                <nav className="app-nav" aria-label="Main navigation">
                  {NAV.map(([to, label]) => (
                    <NavLink key={to} to={to} end={to === '/'}>
                      {label}
                    </NavLink>
                  ))}
                </nav>
              </>
            )}
            <div className="statuses">
              <RuntimeStatus focus={focus} />
              <GloveChip />
              <CameraChip />
              <RuntimeFallbackControls live={focus} />
            </div>
            {!focus && !doctor && (
              <div className="app-tools">
                <span className="app-divider" aria-hidden="true" />
                <ButtonLink
                  to="/doctor"
                  variant="quiet"
                  size="sm"
                  icon="doctor"
                >
                  <span className="doctor-link__label">Doctor view</span>
                </ButtonLink>
                <NavLink
                  to="/profile"
                  className="ds-button ds-icon-button ds-button--quiet ds-button--sm"
                  aria-label="Profile"
                  title="Profile"
                >
                  <Icon name="user" />
                </NavLink>
              </div>
            )}
          </header>
          <div id="safety-banner-slot" aria-live="assertive" aria-atomic="true">
            <SafetyBanner />
          </div>
        </div>
        <main id="main" tabIndex={-1}>
          <PageErrorBoundary resetKey={location.pathname}>
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
                path="/_dev/design"
                element={
                  <Suspense fallback={null}>
                    <DesignGallery />
                  </Suspense>
                }
              />

              <Route
                path="*"
                element={
                  <EmptyState
                    icon="help"
                    title="Page not found"
                    action={
                      <ButtonLink to="/" variant="primary" icon="home">
                        Go home
                      </ButtonLink>
                    }
                  >
                    This page does not exist. Your data is safe.
                  </EmptyState>
                }
              />
            </Routes>
          </PageErrorBoundary>
        </main>
        <Toasts />
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {focus ? `Exercise ${phase.toLowerCase()}. Evaluation ${stage}.` : ''}
        </div>
      </div>
    </ToastProvider>
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
                <SessionProgressProvider>
                  <Shell />
                </SessionProgressProvider>
              </BrowserRouter>
            </VoiceProvider>
          </RuntimeProvider>
        </VisionProvider>
      </GloveProvider>
    </QueryClientProvider>
  );
}
