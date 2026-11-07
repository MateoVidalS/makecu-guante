import {
  Button,
  ButtonLink,
  PageHeader,
  Checkbox,
  StatusDot,
  Banner,
} from '../../design-system';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from 'zustand';
import { useRuntime, useEvaluationView } from '../../runtime';
import { useGlove } from '../../glove';
import { GLOVE_FINGERS, type GloveFinger } from '../../contracts/glove';
import { DEFAULT_EVAL_SETTINGS } from '../../contracts/poses';
import {
  Section,
  StatusList,
  title,
  percent,
  useSessionLeaveGuard,
} from '../../components/common';
import {
  SpeedDumbbell,
  SweepTracker,
  stifferAtSpeed,
} from '../../components/metrics';
import { hasCompleteFriction, hasRecentFriction } from './friction';
import './evaluate.css';
interface Point {
  pos: number;
  ma: number;
}
const FINGER_ORDER = GLOVE_FINGERS;
// Chart geometry (viewBox units). Current is plotted up to 900 mA.
const CHART = { left: 56, right: 780, top: 32, bottom: 236, maxMa: 900 };
const px = (pos: number) => CHART.left + pos * (CHART.right - CHART.left);
const py = (ma: number) =>
  CHART.bottom -
  (Math.min(CHART.maxMa, Math.max(0, ma)) / CHART.maxMa) *
    (CHART.bottom - CHART.top);
function SweepChart({ measuringFriction }: { measuringFriction: boolean }) {
  const runtime = useRuntime(),
    { client } = useGlove(),
    view = useEvaluationView();
  const [points, setPoints] = useState<Point[]>([]);
  useEffect(() => {
    setPoints([]);
    return client.onTelemetry((t) => {
      const v = runtime.evaluation.view();
      if (v.stage !== 'sweep' || !v.finger) return;
      const i = FINGER_ORDER.indexOf(v.finger);
      setPoints((p) => [...p, { pos: t.a[i], ma: t.ma }].slice(-600));
    });
  }, [client, runtime, view.finger, view.speed]);
  const friction =
    view.finger && !measuringFriction
      ? (runtime.calibration.current?.friction[view.finger]?.find(
          (f) =>
            f.v ===
            (view.speed === 'slow'
              ? DEFAULT_EVAL_SETTINGS.slow_v
              : DEFAULT_EVAL_SETTINGS.fast_v),
        )?.points ?? [])
      : [];
  const path = (values: Point[]) =>
    values.map((p) => `${px(p.pos)},${py(p.ma)}`).join(' ');
  return (
    <>
      <svg
        className="hp-chart"
        viewBox="0 0 800 290"
        role="img"
        aria-label="Resistance estimate by finger position"
      >
        {[0, 300, 600, 900].map((ma) => (
          <g key={ma}>
            <line
              x1={CHART.left}
              x2={CHART.right}
              y1={py(ma)}
              y2={py(ma)}
              stroke="var(--border)"
              strokeWidth="1"
            />
            <text x={CHART.left - 8} y={py(ma) + 4} textAnchor="end">
              {ma}
            </text>
          </g>
        ))}
        {[0, 0.5, 1].map((pos) => (
          <text
            key={pos}
            x={px(pos)}
            y={CHART.bottom + 20}
            textAnchor={pos === 0 ? 'start' : pos === 1 ? 'end' : 'middle'}
          >
            {pos * 100}%
          </text>
        ))}
        <text
          x={(CHART.left + CHART.right) / 2}
          y={CHART.bottom + 44}
          textAnchor="middle"
        >
          Finger position
        </text>
        <text x={CHART.left - 8} y={CHART.top - 18} textAnchor="end">
          mA
        </text>
        <polyline
          points={path(friction)}
          stroke="var(--target)"
          fill="none"
          strokeWidth="2"
        />
        <polyline
          points={path(points)}
          stroke="var(--accent)"
          fill="none"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.length > 0 && (
          <circle
            className="eval-head"
            cx={px(points[points.length - 1].pos)}
            cy={py(points[points.length - 1].ma)}
            r="6"
          />
        )}
      </svg>
      <p className="hp-legend">
        <span>
          <i className="hp-legend--measured" aria-hidden="true" />
          <span className="hp-legend__text">Measured current</span>
        </span>
        <span>
          <i className="hp-legend--friction" aria-hidden="true" />
          <span className="hp-legend__text">Empty-glove friction</span>
        </span>
      </p>
      <details className="hp-disclosure">
        <summary>Show as table</summary>
        <table className="hp-table">
          <caption>Current vs position</caption>
          <thead>
            <tr>
              <th scope="col">Position</th>
              <th scope="col" className="hp-num">
                Current (mA)
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={i}>
                <td>{percent(p.pos)}</td>
                <td className="hp-num">{Math.round(p.ma)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
function SafetyLine({ text, release }: { text: string; release: () => void }) {
  return (
    <Banner
      tone="warning"
      title={text}
      action={
        <Button size="sm" onClick={release}>
          Release glove now
        </Button>
      }
    >
      Keep the hand relaxed. Press STOP anytime. Stop if it hurts.
    </Banner>
  );
}
const mA = (value: number | null) =>
  value == null ? (
    'Unavailable'
  ) : (
    <>
      {percent(value / DEFAULT_EVAL_SETTINGS.limit_ma)}
      <span className="hp-unit">{Math.round(value)} mA</span>
    </>
  );
export default function Evaluate() {
  const runtime = useRuntime(),
    view = useEvaluationView(),
    { store, client } = useGlove();
  const connected = useStore(store, (s) => s.connection === 'connected');
  const [relaxed, setRelaxed] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [again, setAgain] = useState(false),
    [emptyGlove, setEmptyGlove] = useState(false),
    [measuringFriction, setMeasuringFriction] = useState(false),
    [ignoredResult, setIgnoredResult] = useState<typeof view.result>(null),
    [selected, setSelected] = useState<GloveFinger[]>([...GLOVE_FINGERS]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const selectedFingers = GLOVE_FINGERS.filter((f) => selected.includes(f));
  useSessionLeaveGuard('evaluation');
  const running = ['prepare', 'sweep', 'cooldown'].includes(view.stage);
  const frictionReady = hasRecentFriction(runtime.calibration.current);
  function release() {
    client.release();
    void runtime.evaluation.stop();
  }
  async function measureFriction() {
    const calibration = runtime.calibration.current;
    if (!calibration || !emptyGlove || !connected || busy) return;
    setError('');
    setBusy(true);
    setMeasuringFriction(true);
    setRelaxed(false);
    try {
      const friction = await runtime.evaluation.runFriction([...GLOVE_FINGERS]);
      if (!mounted.current) return;
      setIgnoredResult(runtime.evaluation.view().result);
      if (
        runtime.evaluation.view().stage === 'aborted' ||
        !hasCompleteFriction(friction)
      )
        throw new Error(
          'Friction measurement stopped. Measure again before evaluating.',
        );
      await runtime.calibration.save({
        servo: calibration.servo,
        camera: calibration.camera,
        current_limit_ma: calibration.current_limit_ma,
        friction,
      });
      if (mounted.current) setEmptyGlove(false);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) {
        setBusy(false);
        setMeasuringFriction(false);
      }
    }
  }
  async function start() {
    if (
      !hasRecentFriction(runtime.calibration.current) ||
      !relaxed ||
      !connected ||
      !selectedFingers.length ||
      busy
    )
      return;
    setError('');
    setBusy(true);
    try {
      await runtime.evaluation.start({
        ...DEFAULT_EVAL_SETTINGS,
        fingers: selectedFingers,
      });
      setAgain(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (running) {
    const activeFingers = measuringFriction ? GLOVE_FINGERS : selectedFingers;
    const sweep =
      Math.max(0, activeFingers.indexOf(view.finger ?? activeFingers[0])) * 2 +
      (view.speed === 'fast' ? 2 : 1);
    return (
      <div className="hp-page hp-live">
        <PageHeader
          title={
            measuringFriction
              ? `Measuring empty-glove friction · ${title(view.finger ?? 'thumb')}`
              : `Measuring ${view.finger ?? ''}`
          }
          lead={
            <span aria-live="polite">
              {view.stage === 'prepare'
                ? 'Get ready'
                : view.stage === 'cooldown'
                  ? 'Relax your hand'
                  : `${title(view.speed ?? 'slow')} movement`}{' '}
              · Sweep {sweep} of {activeFingers.length * 2}
            </span>
          }
        />
        <SafetyLine
          text={
            measuringFriction
              ? 'Keep the glove empty and hanging freely.'
              : 'Keep your hand relaxed.'
          }
          release={release}
        />
        <progress
          className="hp-progress eval-progress"
          aria-label="Sweep progress"
          value={view.progress}
          max={1}
        />
        <SweepTracker
          fingers={activeFingers}
          finger={view.finger}
          speed={view.speed}
          progress={view.stage === 'sweep' ? view.progress : 0}
        />
        <SweepChart measuringFriction={measuringFriction} />
      </div>
    );
  }
  if (
    view.stage === 'done' &&
    view.result &&
    view.result !== ignoredResult &&
    !again &&
    !measuringFriction
  ) {
    const result = view.result;
    const stiffCount = result.fingers.filter((f) =>
      stifferAtSpeed(f.resistance_slow_ma, f.resistance_fast_ma),
    ).length;
    return (
      <div className="hp-page">
        <PageHeader
          title="Your evaluation"
          lead="An estimate inspired by clinical practice."
        />
        <Section
          flush
          title={
            stiffCount > 0
              ? `${stiffCount === 1 ? 'One finger is' : `${stiffCount} fingers are`} stiffer when moved quickly`
              : 'Similar resistance at both speeds'
          }
          description={
            <>
              How hard the glove had to pull each finger, slowly and then
              quickly. A big jump at speed can mean stiffness (spasticity).{' '}
              {result.friction_used
                ? 'Empty-glove friction was accounted for.'
                : 'No empty-glove friction correction was used.'}
            </>
          }
        >
          <SpeedDumbbell
            rows={result.fingers.map((f) => ({
              finger: f.finger,
              slow: f.resistance_slow_ma,
              fast: f.resistance_fast_ma,
              aborted: f.aborted,
              abortedAt: result.sweeps.find(
                (s) => s.finger === f.finger && s.aborted_at != null,
              )?.aborted_at,
            }))}
            axisLabel={
              result.friction_used ? 'mA above glove friction' : 'mA measured'
            }
          />
          <p className="hp-note">
            Results are saved with your history. Lower values suggest less
            resistance.
          </p>
          <details className="hp-disclosure">
            <summary>Show as table</summary>
            <p className="hp-note">
              Resistance as a share of the {DEFAULT_EVAL_SETTINGS.limit_ma} mA
              safety limit.
            </p>
            <table className="hp-table">
              <thead>
                <tr>
                  <th scope="col">Finger</th>
                  <th scope="col" className="hp-num">
                    Slow resistance
                  </th>
                  <th scope="col" className="hp-num">
                    Fast resistance
                  </th>
                  <th scope="col" className="hp-num">
                    Speed difference
                  </th>
                  <th scope="col">Sweep</th>
                </tr>
              </thead>
              <tbody>
                {result.fingers.map((f) => {
                  const abortedAt = result.sweeps.find(
                    (s) => s.finger === f.finger && s.aborted_at != null,
                  )?.aborted_at;
                  return (
                    <tr key={f.finger}>
                      <th scope="row">{title(f.finger)}</th>
                      <td className="hp-num">{mA(f.resistance_slow_ma)}</td>
                      <td className="hp-num">{mA(f.resistance_fast_ma)}</td>
                      <td className="hp-num">{mA(f.velocity_dependence_ma)}</td>
                      <td>
                        {f.aborted ? (
                          <span className="hp-capture-status">
                            <StatusDot tone="caution" />
                            <span>
                              Stopped safely
                              {abortedAt != null
                                ? ` at ${percent(abortedAt)}`
                                : ''}
                            </span>
                          </span>
                        ) : (
                          'Complete'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </details>
        </Section>
        <div className="hp-actions">
          <Button
            onClick={() => {
              setAgain(true);
              setRelaxed(false);
            }}
          >
            Evaluate again
          </Button>
          <ButtonLink variant="quiet" to="/doctor">
            See evaluation history
          </ButtonLink>
          <ButtonLink variant="quiet" to="/">
            Home
          </ButtonLink>
        </div>
      </div>
    );
  }
  const calibrated = !!runtime.calibration.current;
  const blocked =
    !relaxed ||
    !connected ||
    !calibrated ||
    !frictionReady ||
    !selectedFingers.length;
  return (
    <div className="hp-page">
      <PageHeader
        title="Check your comfortable movement"
        lead="The glove moves each finger gently, slowly and then quickly, and estimates resistance."
      />
      <div className="hp-wizard">
        <SafetyLine text="Keep your hand relaxed." release={release} />
        {view.stage === 'aborted' && (
          <p role="status">Evaluation stopped. Rest before trying again.</p>
        )}
        <Section flush title="Before you start">
          <StatusList
            label="Evaluation checklist"
            items={[
              {
                label: 'Calibration',
                value: calibrated ? 'Ready' : 'Needed',
                tone: calibrated ? 'reached' : 'caution',
                action: <Link to="/calibrate">Review calibration</Link>,
              },
              {
                label: 'Glove',
                value: connected ? 'Connected' : 'Not connected',
                tone: connected ? 'reached' : 'off',
                action: <Link to="/setup">Check connection</Link>,
              },
            ]}
          />
          {!frictionReady ? (
            <div className="eval-friction">
              <h3>Measure empty-glove friction first</h3>
              <p>Take the glove off. Let it hang freely.</p>
              <p className="hp-note">
                Required before evaluation. Allow about 2 minutes for all five
                fingers.
              </p>
              <Checkbox
                label="The glove is empty and hanging freely"
                checked={emptyGlove}
                disabled={busy}
                onChange={(e) => setEmptyGlove(e.target.checked)}
              />
              <Button
                variant="primary"
                disabled={!emptyGlove || !connected || !calibrated || busy}
                loading={busy}
                onClick={() => void measureFriction()}
              >
                {busy ? 'Measuring friction…' : 'Measure glove friction'}
              </Button>
              <p className="hp-note">
                Put the glove back on after measurement finishes.
              </p>
            </div>
          ) : (
            <p role="status">
              Recent glove friction saved. Put the glove on, then relax.
            </p>
          )}
          <fieldset className="eval-fingers" disabled={busy}>
            <legend>Fingers to measure</legend>
            <div className="hp-actions">
              {GLOVE_FINGERS.map((finger) => (
                <Checkbox
                  key={finger}
                  label={title(finger)}
                  checked={selected.includes(finger)}
                  onChange={(e) =>
                    setSelected((current) =>
                      e.target.checked
                        ? [...current, finger]
                        : current.filter((f) => f !== finger),
                    )
                  }
                />
              ))}
            </div>
            <p className="hp-note" aria-live="polite">
              {selectedFingers.length * 2} sweeps · Slow then fast per finger.
              {selectedFingers.length === 5 && ' Allow about 2 minutes.'}
            </p>
          </fieldset>
          <p className="hp-note">
            Rest palm down, fingers beyond the table edge.
          </p>
          <Checkbox
            label="Hand relaxed in the glove"
            disabled={!frictionReady || busy}
            checked={relaxed}
            onChange={(e) => setRelaxed(e.target.checked)}
          />
        </Section>
        {error && (
          <p role="alert" className="hp-alert">
            {error}
          </p>
        )}
        <div className="hp-actions">
          <Button
            variant={frictionReady ? 'primary' : 'secondary'}
            size="lg"
            disabled={busy || blocked}
            aria-describedby={blocked ? 'evaluation-start-hint' : undefined}
            onClick={() => void start()}
          >
            Start evaluation
          </Button>
          {blocked && (
            <p id="evaluation-start-hint" className="hp-note">
              {!connected
                ? 'Connect your glove in Setup first.'
                : !calibrated
                  ? 'Calibrate your comfortable range first.'
                  : !frictionReady
                    ? 'Measure empty-glove friction before evaluating.'
                    : !selectedFingers.length
                      ? 'Choose at least one finger to measure.'
                      : 'Confirm your hand is relaxed to start.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
