import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useStore } from 'zustand';
import { useProfile, useSessions, useHistoryOverview } from '../../api/client';
import { useRuntime } from '../../runtime';
import { useGlove } from '../../glove';
import { useVisionFrame } from '../../vision';
import { DEFAULT_PLAN, DEFAULT_EXERCISE_SETTINGS } from '../../contracts/poses';
import { percent } from '../../components/common';
import {
  Button,
  ButtonLink,
  Card,
  Stack,
  Inline,
  Grid,
  PageHeader,
  Checkbox,
  StatusChip,
  DemoBadge,
  EmptyState,
  Banner,
  KpiTile,
} from '../../design-system';
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
    <Stack as="section" gap={24}>
      <PageHeader
        title={`Hello${profile.data?.pseudonym ? `, ${profile.data.pseudonym}` : ''}`}
        lead="Practice at your pace."
      />
      <Inline>
        <Button
          variant="primary"
          size="lg"
          disabled={busy}
          onClick={() => void start()}
        >
          Start today's practice
        </Button>
        <ButtonLink to="/evaluate">Evaluate</ButtonLink>
      </Inline>
      <Checkbox
        label="Short session (1 rep each)"
        size="lg"
        checked={short}
        onChange={(e) => setShort(e.target.checked)}
      />
      {error && <p role="alert">{error}</p>}
      {!runtime.calibration.current && (
        <Banner tone="info" title="Calibration needed">
          Let's find your comfortable range first.{' '}
          <Link to="/calibrate">Calibrate</Link>
        </Banner>
      )}
      <Grid columns={2}>
        <Card title="Ready to practice?">
          <Stack gap={12}>
            {[
              {
                ok: connected,
                label: 'Glove',
                path: '/setup',
                action: 'Check glove',
              },
              {
                ok: !!runtime.calibration.current,
                label: 'Calibration',
                path: '/calibrate',
                action: 'Check range',
              },
              {
                ok: seen,
                label: 'Camera',
                path: '/setup',
                action: 'Check camera',
              },
            ].map(({ ok, label, path, action }) => (
              <Inline key={label} justify="between">
                <StatusChip
                  icon={ok ? 'check' : 'info'}
                  label={label}
                  value={ok ? 'Ready' : 'Needs setup'}
                  tone={ok ? 'reached' : 'caution'}
                />
                <Link to={path}>{action}</Link>
              </Inline>
            ))}
          </Stack>
        </Card>
        <Card title="Last session">
          {last ? (
            <>
              <p>
                {formatDate(last.started_at)} {last.is_demo && <DemoBadge />}
              </p>
              <KpiTile
                label="On your own"
                value={percent(last.summary?.active_ratio_mean)}
              />
              <svg
                viewBox="0 0 400 90"
                role="img"
                aria-label="Recent practice estimates, oldest to newest"
              >
                {sessions.data
                  ?.slice()
                  .reverse()
                  .map((s, i, values) => {
                    const value = s.summary?.active_ratio_mean,
                      previous = values[i - 1]?.summary?.active_ratio_mean;
                    return value == null ? null : (
                      <g key={s.id}>
                        {previous != null && (
                          <line
                            x1={(i - 1) * 80 + 20}
                            y1={80 - previous * 70}
                            x2={i * 80 + 20}
                            y2={80 - value * 70}
                            stroke="var(--active)"
                            strokeWidth="3"
                          />
                        )}
                        <circle
                          cx={i * 80 + 20}
                          cy={80 - value * 70}
                          r="5"
                          fill={s.is_demo ? 'var(--surface)' : 'var(--active)'}
                          stroke="var(--active)"
                          strokeWidth="3"
                        />
                      </g>
                    );
                  })}
              </svg>
              <Link to={`/history/sessions/${last.id}`}>See session</Link>
            </>
          ) : (
            <EmptyState title="Your first practice starts here">
              {sessions.isPending
                ? 'Loading your last session…'
                : sessions.isError
                  ? 'Session history is unavailable.'
                  : 'Your first practice starts here.'}
            </EmptyState>
          )}
        </Card>
      </Grid>
      <p className="muted">
        {overview.data
          ? `This week: ${overview.data.days_practiced_last_7} of 5 days`
          : 'Each day of practice counts.'}
      </p>
    </Stack>
  );
}
