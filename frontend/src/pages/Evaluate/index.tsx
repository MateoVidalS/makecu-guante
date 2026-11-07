import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from 'zustand';
import { useRuntime, useEvaluationView } from '../../runtime';
import { useGlove } from '../../glove';
import { DEFAULT_EVAL_SETTINGS } from '../../contracts/poses';
import {
  BigButton,
  title,
  percent,
  useSessionLeaveGuard,
} from '../../components/common';
interface Point {
  pos: number;
  ma: number;
}
function SweepChart() {
  const runtime = useRuntime(),
    { client } = useGlove(),
    view = useEvaluationView();
  const [points, setPoints] = useState<Point[]>([]);
  useEffect(() => {
    setPoints([]);
    return client.onTelemetry((t) => {
      const v = runtime.evaluation.view();
      if (v.stage !== 'sweep' || !v.finger) return;
      const i = ['thumb', 'index', 'middle'].indexOf(v.finger);
      setPoints((p) => [...p, { pos: t.a[i], ma: t.ma }].slice(-600));
    });
  }, [client, runtime, view.finger, view.speed]);
  const friction = view.finger
    ? (runtime.calibration.current?.friction[view.finger]?.find(
        (f) =>
          f.v ===
          (view.speed === 'slow'
            ? DEFAULT_EVAL_SETTINGS.slow_v
            : DEFAULT_EVAL_SETTINGS.fast_v),
      )?.points ?? [])
    : [];
  const path = (values: Point[]) =>
    values
      .map((p) => `${60 + p.pos * 680},${250 - Math.min(900, p.ma) / 4}`)
      .join(' ');
  return (
    <>
      <svg
        className="live-chart"
        viewBox="0 0 800 300"
        role="img"
        aria-label="Resistance estimate by finger position"
      >
        <path d="M60 20V250H760" stroke="var(--text)" fill="none" />
        <polyline
          points={path(friction)}
          stroke="var(--target)"
          fill="none"
          strokeWidth="3"
        />
        <polyline
          points={path(points)}
          stroke="var(--active)"
          fill="none"
          strokeWidth="3"
        />
        <text x="320" y="290">
          Finger position (%)
        </text>
        <text x="70" y="30">
          Resistance estimate
        </text>
        <text x="60" y="275">
          0
        </text>
        <text x="720" y="275">
          100
        </text>
      </svg>
      <p className="muted">Blue: measured · Grey: empty glove</p>
      <details>
        <summary>Show as table (helper details)</summary>
        <table>
          <caption>Current vs position</caption>
          <thead>
            <tr>
              <th>Position</th>
              <th>Current (mA)</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={i}>
                <td>{percent(p.pos)}</td>
                <td>{p.ma}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
export default function Evaluate() {
  const runtime = useRuntime(),
    view = useEvaluationView(),
    { store } = useGlove();
  const connected = useStore(store, (s) => s.connection === 'connected');
  const [relaxed, setRelaxed] = useState(false),
    [calibrated, setCalibrated] = useState(false),
    [gloveChecked, setGloveChecked] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [again, setAgain] = useState(false);
  useSessionLeaveGuard('evaluation');
  const running = ['prepare', 'sweep', 'cooldown'].includes(view.stage);
  async function start() {
    setError('');
    setBusy(true);
    try {
      await runtime.evaluation.start(DEFAULT_EVAL_SETTINGS);
      setAgain(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (running)
    return (
      <section className="live-stack">
        <h1>Measuring {view.finger}</h1>
        <p className="phase" aria-live="polite">
          {view.stage === 'prepare'
            ? 'Get ready'
            : view.stage === 'cooldown'
              ? 'Relax your hand'
              : `${title(view.speed ?? 'slow')} movement`}{' '}
          ·{' '}
          {Math.max(
            0,
            ['thumb', 'index', 'middle'].indexOf(view.finger ?? 'thumb'),
          ) *
            2 +
            (view.speed === 'fast' ? 2 : 1)}{' '}
          of 6
        </p>
        <progress aria-label="Sweep progress" value={view.progress} max={1} />
        <SweepChart />
        <BigButton onClick={() => void runtime.evaluation.stop()}>
          Stop evaluation
        </BigButton>
      </section>
    );
  if (view.result && !again)
    return (
      <section className="live-stack">
        <h1>Your evaluation</h1>
        <p>An estimate inspired by clinical practice.</p>
        <p>
          {view.result.friction_used
            ? 'Empty-glove friction was accounted for.'
            : 'No empty-glove friction correction was used.'}
        </p>
        <div className="summary-fingers">
          {view.result.fingers.map((f) => (
            <section className="card" key={f.finger}>
              <h2>{title(f.finger)}</h2>
              {f.aborted && (
                <p className="chip">
                  Stopped safely
                  {view.result!.sweeps.find(
                    (s) => s.finger === f.finger && s.aborted_at != null,
                  )?.aborted_at != null
                    ? ` at ${percent(view.result!.sweeps.find((s) => s.finger === f.finger && s.aborted_at != null)!.aborted_at)}`
                    : ''}
                </p>
              )}
              {[
                ['Slow resistance', f.resistance_slow_ma],
                ['Fast resistance', f.resistance_fast_ma],
                ['Speed difference', f.velocity_dependence_ma],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <p>
                    {label}:{' '}
                    {value == null
                      ? 'Unavailable'
                      : `${percent(Number(value) / DEFAULT_EVAL_SETTINGS.limit_ma)} of the safety limit`}
                  </p>
                  {value != null && (
                    <meter
                      aria-label={String(label)}
                      min={0}
                      max={600}
                      value={Math.min(600, Math.max(0, Number(value)))}
                    />
                  )}
                </div>
              ))}
              <details>
                <summary>Helper details</summary>
                <p>
                  Slow: {f.resistance_slow_ma ?? '—'} mA · Fast:{' '}
                  {f.resistance_fast_ma ?? '—'} mA · Difference:{' '}
                  {f.velocity_dependence_ma ?? '—'} mA
                </p>
              </details>
            </section>
          ))}
        </div>
        <p className="muted">Results are saved by the session runtime.</p>
        <div className="actions">
          <BigButton
            onClick={() => {
              setAgain(true);
              setRelaxed(false);
            }}
          >
            Evaluate again
          </BigButton>
          <Link className="button" to="/history">
            See evaluation history
          </Link>
          <Link className="button" to="/">
            Home
          </Link>
        </div>
      </section>
    );
  return (
    <section className="live-stack">
      <h1>Check your comfortable movement</h1>
      <p>Relax your hand. The glove moves each finger gently.</p>
      {view.stage === 'aborted' && (
        <p role="status">Evaluation stopped. Rest before trying again.</p>
      )}
      <aside className="safety-strip">
        Press STOP anytime. Stop if it hurts.
      </aside>
      <label>
        <input
          type="checkbox"
          checked={relaxed}
          onChange={(e) => setRelaxed(e.target.checked)}
        />
        Hand relaxed in the glove
      </label>
      <label>
        <input
          type="checkbox"
          checked={calibrated}
          disabled={!runtime.calibration.current}
          onChange={(e) => setCalibrated(e.target.checked)}
        />
        Calibrated
      </label>
      {!runtime.calibration.current && (
        <Link to="/calibrate">Calibrate first</Link>
      )}
      <label>
        <input
          type="checkbox"
          checked={gloveChecked}
          disabled={!connected}
          onChange={(e) => setGloveChecked(e.target.checked)}
        />
        Glove connected
      </label>
      {!connected && <Link to="/setup">Connect the glove</Link>}
      {error && <p role="alert">{error}</p>}
      <BigButton
        variant="primary"
        disabled={
          busy ||
          !relaxed ||
          !calibrated ||
          !gloveChecked ||
          !connected ||
          !runtime.calibration.current
        }
        onClick={() => void start()}
      >
        Start evaluation
      </BigButton>
    </section>
  );
}
