import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useStore } from 'zustand';
import { useProfile, useSessions } from '../../api/client';
import { useRuntime } from '../../runtime';
import { useGlove } from '../../glove';
import { useVisionFrame } from '../../vision';
import { DEFAULT_EXERCISE_SETTINGS } from '../../contracts/poses';
import { Section, StatusList } from '../../components/common';
import {
  Button,
  PageHeader,
  Checkbox,
  DemoBadge,
  Stack,
} from '../../design-system';
import { formatDate } from '../../components/charts';
import { ThenNow, WeekStrip, lastSevenDays } from '../../components/metrics';
import { rangeComparison } from './range';
import {
  practicePlan,
  useShortPractice,
} from '../../components/common/practice';
import {
  useCalibrationStatus,
  calibrationReadiness,
} from '../../runtime/calibrationValidation';
import { CalibrationIssueBanner } from '../../components/calibration';
import {
  CurrentSensorNotice,
  useCurrentSensorMissing,
} from '../Setup/CurrentSensorNotice';
import './home.css';
export default function Home() {
  const profile = useProfile(),
    sessions = useSessions({ limit: 30 });
  const runtime = useRuntime(),
    navigate = useNavigate(),
    { store } = useGlove();
  const missingCurrentSensor = useCurrentSensorMissing();
  const connected = useStore(store, (s) => s.connection === 'connected');
  const seen = useVisionFrame((f) => !!f?.detected && f.confidence >= 0.6);
  const [short, setShort] = useShortPractice();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const calibrationStatus = useCalibrationStatus();
  const readiness = calibrationReadiness(calibrationStatus);
  async function start() {
    if (calibrationStatus.state !== 'ok') {
      navigate(readiness.href);
      return;
    }
    if (!connected || !seen || missingCurrentSensor) {
      navigate('/setup');
      return;
    }
    setBusy(true);
    try {
      await runtime.exercise.start(
        practicePlan(short),
        DEFAULT_EXERCISE_SETTINGS,
      );
      navigate('/exercise');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const blocker =
    calibrationStatus.state === 'invalid'
      ? `${calibrationStatus.issues[0].message} Start opens calibration first.`
      : calibrationStatus.state === 'missing'
        ? 'Calibration needed. Start opens calibration first.'
        : !connected
          ? 'Glove not connected. Start opens Setup first.'
          : missingCurrentSensor
            ? 'The glove cannot help without its current sensor. Start opens Setup first.'
            : !seen
              ? "The camera can't see the hand. Start opens Setup first."
              : null;
  const list = sessions.data ?? [];
  const week = lastSevenDays(list.map((s) => s.started_at));
  const range = rangeComparison(list);
  const mirrored = runtime.calibration.current?.camera.affected_hand === 'left';
  return (
    <div className="hp-page">
      <PageHeader
        title={`Hello${profile.data?.pseudonym ? `, ${profile.data.pseudonym}` : ''}`}
        lead="Check that everything is ready, then start today's practice."
      />
      <CurrentSensorNotice missing={missingCurrentSensor} />
      <Section flush>
        <div className="hp-actions">
          <Stack gap={8}>
            <Button
              variant="primary"
              size="lg"
              disabled={busy}
              onClick={() => void start()}
            >
              Start today's practice
            </Button>
            <Link to="/exercise?customize=1">Customize plan</Link>
          </Stack>
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
      <p className="hp-note">
        Raise your hand, palm to the screen. Support your elbow and relax.
      </p>
      <CalibrationIssueBanner issue={calibrationStatus.issues[0]} />
      <div className="hp-columns">
        <Stack gap={32}>
          <Section title="This week">
            {sessions.isPending ? (
              <p className="hp-note">Loading your week…</p>
            ) : (
              <WeekStrip days={week} />
            )}
          </Section>
          <Section title="Readiness">
            <StatusList
              label="Readiness checklist"
              items={[
                {
                  label: 'Glove',
                  value: connected
                    ? missingCurrentSensor
                      ? 'Calibration only'
                      : 'Connected'
                    : 'Not connected',
                  tone: connected
                    ? missingCurrentSensor
                      ? 'caution'
                      : 'reached'
                    : 'off',
                  action: (
                    <Link to="/setup">{connected ? 'Setup' : 'Connect'}</Link>
                  ),
                },
                {
                  ...readiness,
                  action: <Link to={readiness.href}>{readiness.action}</Link>,
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
        </Stack>
        <Section
          title="Your active range"
          description="How far each finger closes on its own."
          actions={list.some((s) => s.is_demo) ? <DemoBadge /> : undefined}
        >
          {range ? (
            <div className="home-range">
              <ThenNow
                deltas={range.deltas}
                thenLabel={range.thenLabel}
                nowLabel={`Latest · ${formatDate(range.latest.started_at)}`}
                size={104}
                mirrored={mirrored}
              />
              <p className="hp-note">
                {range.changeText}{' '}
                <Link to={`/history/sessions/${range.latest.id}`}>
                  See session
                </Link>
              </p>
            </div>
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
