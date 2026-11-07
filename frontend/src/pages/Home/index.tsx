import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useStore } from 'zustand';
import { useProfile, useSessions, useHistoryOverview } from '../../api/client';
import { useRuntime } from '../../runtime';
import { useGlove } from '../../glove';
import { useVisionFrame } from '../../vision';
import { DEFAULT_PLAN, DEFAULT_EXERCISE_SETTINGS } from '../../contracts/poses';
import { BigButton, EmptyState, percent } from '../../components/common';
export default function Home() {
  const profile = useProfile(),
    sessions = useSessions({ limit: 5 }),
    overview = useHistoryOverview();
  const runtime = useRuntime(),
    navigate = useNavigate(),
    { store } = useGlove();
  const connected = useStore(store, (s) => s.connection === 'connected');
  const seen = useVisionFrame((f) => !!f?.detected && f.confidence >= 0.6);
  const [short, setShort] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const last = sessions.data?.[0];
  async function start() {
    if (!runtime.calibration.current) {
      navigate('/calibrate');
      return;
    }
    if (!connected || !seen) {
      navigate('/setup');
      return;
    }
    setBusy(true);
    try {
      await runtime.exercise.start(
        DEFAULT_PLAN.map((p) => ({ ...p, reps: short ? 1 : p.reps })),
        DEFAULT_EXERCISE_SETTINGS,
      );
      navigate('/exercise');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="live-stack">
      <h1>
        Hello{profile.data?.pseudonym ? `, ${profile.data.pseudonym}` : ''}
      </h1>
      <p>Practice at your pace.</p>
      <div className="actions">
        <BigButton
          variant="primary"
          disabled={busy}
          onClick={() => void start()}
        >
          Start today's practice
        </BigButton>
        <Link className="button" to="/evaluate">
          Evaluate
        </Link>
      </div>
      <label>
        <input
          type="checkbox"
          checked={short}
          onChange={(e) => setShort(e.target.checked)}
        />
        Short session (1 rep each)
      </label>
      {error && <p role="alert">{error}</p>}
      {!runtime.calibration.current && (
        <aside className="card">
          Calibration needed. Let's find your comfortable range first.{' '}
          <Link to="/calibrate">Calibrate</Link>
        </aside>
      )}
      <div className="two-columns">
        <section className="card">
          <h2>Ready to practice?</h2>
          <ul>
            {[
              [connected, 'Glove connected', '/setup'],
              [!!runtime.calibration.current, 'Calibrated', '/calibrate'],
              [seen, 'Camera sees your hand', '/setup'],
            ].map(([ok, label, path]) => (
              <li key={String(label)}>
                {ok ? '✓' : '○'} {label}{' '}
                {!ok && <Link to={String(path)}>Set up</Link>}
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h2>Last session</h2>
          {last ? (
            <>
              <p>
                {new Date(last.started_at).toLocaleDateString()}{' '}
                {last.is_demo && <span className="chip">Demo data</span>}
              </p>
              <p>{percent(last.summary?.active_ratio_mean)} on your own</p>
              <div aria-label="Recent session estimates">
                {sessions.data
                  ?.slice()
                  .reverse()
                  .map((s) => (
                    <span
                      key={s.id}
                      title={new Date(s.started_at).toLocaleDateString()}
                    >
                      {percent(s.summary?.active_ratio_mean)} ·{' '}
                    </span>
                  ))}
              </div>
              <Link to={`/history/sessions/${last.id}`}>See session</Link>
            </>
          ) : (
            <EmptyState>
              {sessions.isPending
                ? 'Loading your last session…'
                : sessions.isError
                  ? 'Session history is unavailable.'
                  : 'Your first practice starts here.'}
            </EmptyState>
          )}
        </section>
      </div>
      <p className="muted">
        {overview.data
          ? `This week: ${overview.data.days_practiced_last_7} of 5 days`
          : 'Each day of practice counts.'}
      </p>
    </section>
  );
}
