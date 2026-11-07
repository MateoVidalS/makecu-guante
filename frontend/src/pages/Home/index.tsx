import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useStore } from 'zustand';
import { useProfile, useSessions, useHistoryOverview } from '../../api/client';
import { useRuntime } from '../../runtime';
import { useGlove } from '../../glove';
import { useVisionFrame } from '../../vision';
import { DEFAULT_PLAN, DEFAULT_EXERCISE_SETTINGS } from '../../contracts/poses';
import {
  percent,
  Section,
  StatusList,
  Readouts,
} from '../../components/common';
import { Button, PageHeader, Checkbox, DemoBadge } from '../../design-system';
import { formatDate } from '../../components/charts';
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
  const calibrated = !!runtime.calibration.current;
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
  const blocker = !calibrated
    ? 'Calibration needed. Start opens calibration first.'
    : !connected
      ? 'Glove not connected. Start opens Setup first.'
      : !seen
        ? "The camera can't see the hand. Start opens Setup first."
        : null;
  const trend =
    sessions.data
      ?.slice()
      .reverse()
      .map((s) => s.summary?.active_ratio_mean ?? null) ?? [];
  const x = (i: number) => i * 90 + 20;
  return (
    <div className="hp-page">
      <PageHeader
        title={`Hello${profile.data?.pseudonym ? `, ${profile.data.pseudonym}` : ''}`}
        lead="Check that everything is ready, then start today's practice."
      />
      <Section flush>
        <div className="hp-actions">
          <Button
            variant="primary"
            size="lg"
            disabled={busy}
            onClick={() => void start()}
          >
            Start today's practice
          </Button>
          <Checkbox
            label="Short session (1 rep each)"
            checked={short}
            onChange={(e) => setShort(e.target.checked)}
          />
        </div>
        {blocker && <p className="hp-note">{blocker}</p>}
        {error && (
          <p role="alert" className="hp-alert">
            {error}
          </p>
        )}
      </Section>
      <div className="hp-columns">
        <Section title="Readiness">
          <StatusList
            label="Readiness checklist"
            items={[
              {
                label: 'Glove',
                value: connected ? 'Connected' : 'Not connected',
                tone: connected ? 'reached' : 'off',
                action: (
                  <Link to="/setup">{connected ? 'Setup' : 'Connect'}</Link>
                ),
              },
              {
                label: 'Calibration',
                value: calibrated ? 'Saved' : 'Needed',
                tone: calibrated ? 'reached' : 'caution',
                action: (
                  <Link to="/calibrate">
                    {calibrated ? 'Review' : 'Calibrate'}
                  </Link>
                ),
              },
              {
                label: 'Camera',
                value: seen ? 'Sees the hand' : "Can't see the hand",
                tone: seen ? 'reached' : 'caution',
                action: <Link to="/setup">{seen ? 'Setup' : 'Fix'}</Link>,
              },
            ]}
          />
          <p className="hp-note">
            To measure resistance before practice,{' '}
            <Link to="/evaluate">run an evaluation</Link>.
          </p>
        </Section>
        <Section
          title="Last session"
          actions={
            sessions.data?.some((s) => s.is_demo) ? <DemoBadge /> : undefined
          }
        >
          {last ? (
            <>
              <Readouts
                label="Last session summary"
                items={[
                  { label: 'Date', value: formatDate(last.started_at) },
                  {
                    label: 'On your own',
                    value: percent(last.summary?.active_ratio_mean),
                  },
                  {
                    label: 'This week',
                    value: overview.data
                      ? `${overview.data.days_practiced_last_7} of 5`
                      : '—',
                    unit: 'days',
                  },
                ]}
              />
              <svg
                className="hp-sparkline"
                viewBox="0 0 400 90"
                role="img"
                aria-label="Recent practice estimates, oldest to newest"
              >
                {trend.map((value, i) => {
                  const previous = trend[i - 1];
                  return value == null ? null : (
                    <g key={i}>
                      {previous != null && (
                        <line
                          x1={x(i - 1)}
                          y1={80 - previous * 70}
                          x2={x(i)}
                          y2={80 - value * 70}
                          stroke="var(--active)"
                          strokeWidth="2"
                        />
                      )}
                      <circle
                        cx={x(i)}
                        cy={80 - value * 70}
                        r="3.5"
                        fill="var(--surface)"
                        stroke="var(--active)"
                        strokeWidth="2"
                      />
                    </g>
                  );
                })}
              </svg>
              <Link to={`/history/sessions/${last.id}`}>See session</Link>
            </>
          ) : (
            <p className="hp-note">
              {sessions.isPending
                ? 'Loading your last session…'
                : sessions.isError
                  ? 'Session history is unavailable.'
                  : 'No sessions yet. Your first practice will appear here.'}
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}
