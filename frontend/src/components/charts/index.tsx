import {
  Card,
  KpiTile as DSKpiTile,
  DemoBadge as DSDemoBadge,
  Skeleton,
  EmptyState,
  Banner,
} from '../../design-system';
import { useId, type ReactNode } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  AssistPoint,
  ResistancePoint,
  RomPoint,
} from '../../contracts/api';
import type {
  AttemptResult,
  AttemptTrace,
  ExercisePhase,
} from '../../contracts/engine';
import type { EvalSweep } from '../../contracts/evaluation';
import { GLOVE_FINGERS, type GloveFinger } from '../../contracts/glove';
import { tokens } from '../../styles/tokens';
import {
  assistSeries,
  decimate,
  phaseBands,
  resistanceSeries,
  toFingerSeries,
  type ChartRow,
  type TimelineEntry,
} from './transforms';
import './charts.css';

export {
  assistSeries,
  decimate,
  phaseBands,
  resistanceSeries,
  toFingerSeries,
} from './transforms';
export const fingerName = (finger: string) =>
  finger.charAt(0).toUpperCase() + finger.slice(1);
export const formatDate = (value: string | number) =>
  new Date(value).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
export const percentage = (value: number | null | undefined) =>
  value == null ? 'Not recorded' : `${Math.round(value * 100)}%`;
const numberLabel = (
  value: number | string | boolean | null | undefined,
  unit = '',
) =>
  typeof value === 'number'
    ? `${unit.includes('mA') || unit === '%' ? Math.round(value) : value.toFixed(1)}${unit}`
    : 'Not recorded';
const color = (finger: GloveFinger) => `var(--finger-${finger})`;
export function DemoBadge() {
  return <DSDemoBadge />;
}
export function DataStatus({
  loading,
  error,
  children,
}: {
  loading?: boolean;
  error?: unknown;
  children?: ReactNode;
}) {
  if (loading)
    return (
      <p className="data-status" role="status">
        Loading your records…
      </p>
    );
  if (error)
    return (
      <p className="data-status" role="alert">
        Records are unavailable. Please try again.
      </p>
    );
  return <>{children}</>;
}
export function KpiTile({
  label,
  value,
  hint,
  loading = false,
}: {
  label: string;
  value?: ReactNode;
  hint?: string;
  loading?: boolean;
}) {
  return loading ? (
    <Skeleton height="var(--space-64)" />
  ) : (
    <DSKpiTile label={label} value={value ?? '—'} hint={hint} />
  );
}

interface Series {
  data?: ChartRow[];
  key: string;
  label: string;
  unit: string;
  color: string;
  dashed?: boolean;
  right?: boolean;
}
interface ChartProps {
  title: string;
  hint: string;
  rows: ChartRow[];
  series: Series[];
  xLabel: string;
  yLabel: string;
  xKind?: 'date' | 'number';
  yDomain?: [number | 'auto', number | 'auto'];
  baseline?: boolean;
  loading?: boolean;
  compact?: boolean;
  children?: ReactNode;
}
function Chart({
  title,
  hint,
  rows,
  series,
  xLabel,
  yLabel,
  xKind = 'date',
  yDomain = [0, 'auto'],
  baseline = true,
  loading,
  compact,
  children,
}: ChartProps) {
  const id = useId().replace(/:/g, '');
  const hasData = rows.some((r) =>
    series.some((s) => typeof r[s.key] === 'number'),
  );
  const right = series.some((s) => s.right);
  const first = rows.find((r) => typeof r[series[0]?.key] === 'number');
  const axisX = (x: number) =>
    xKind === 'date'
      ? new Date(x).toLocaleDateString('en', {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        })
      : `${Number(x.toFixed(1))}`;
  return (
    <Card
      as="article"
      actions={rows.some((r) => r.demo) ? <DemoBadge /> : undefined}
      className={`chart-card${compact ? ' compact' : ''}`}
      aria-labelledby={`${id}-title`}
    >
      <h3 id={`${id}-title`}>{title}</h3>
      <p className="chart-hint">{hint}</p>
      {loading ? (
        <div role="status">
          Loading chart…
          <Skeleton height="var(--placeholder-height)" />
        </div>
      ) : !hasData ? (
        <EmptyState title="No measurements recorded yet." />
      ) : (
        <>
          <div
            className="chart-canvas"
            role="img"
            aria-label={`${title}. ${xLabel}; ${yLabel}. ${hint} Data table follows.`}
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              initialDimension={{ width: 320, height: 240 }}
            >
              <LineChart
                data={rows}
                margin={{
                  top: parseInt(tokens.space16),
                  bottom: parseInt(tokens.space24),
                  left: parseInt(tokens.space12),
                  right: parseInt(tokens.space16),
                }}
                accessibilityLayer
              >
                <defs>
                  <pattern
                    id={`${id}-hatch`}
                    width={6}
                    height={6}
                    patternUnits="userSpaceOnUse"
                  >
                    <rect width={6} height={6} fill="var(--surface)" />
                    <path d="M0 6L6 0" stroke="var(--demo)" strokeWidth={1} />
                  </pattern>
                </defs>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis
                  type="number"
                  dataKey="x"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={axisX}
                  minTickGap={parseInt(tokens.space32)}
                  label={{
                    value: xLabel,
                    position: 'bottom',
                    fill: 'var(--muted)',
                  }}
                />
                <YAxis
                  yAxisId="primary"
                  width={parseInt(tokens.space48)}
                  domain={yDomain}
                  label={{
                    value: yLabel,
                    angle: -90,
                    position: 'insideLeft',
                    content: ({ viewBox }) => {
                      if (!viewBox || !('x' in viewBox)) return <g />;
                      const x = (viewBox.x ?? 0) + parseInt(tokens.space4);
                      const y =
                        (viewBox.y ?? 0) +
                        (viewBox.height ?? 0) / 2 +
                        parseInt(tokens.space16);
                      return (
                        <text
                          x={x}
                          y={y}
                          transform={`rotate(-90 ${x} ${y})`}
                          textAnchor="middle"
                          fill="var(--muted)"
                          fontSize={tokens.caption}
                        >
                          {yLabel}
                        </text>
                      );
                    },
                    fill: 'var(--muted)',
                  }}
                />
                {right && (
                  <YAxis
                    yAxisId="current"
                    orientation="right"
                    width={parseInt(tokens.space64)}
                    stroke="var(--muted)"
                    label={{
                      value: 'Total current (mA)',
                      angle: 90,
                      position: 'insideRight',
                      style: { textAnchor: 'middle' },
                      fill: 'var(--muted)',
                    }}
                  />
                )}
                <Tooltip
                  labelFormatter={(x) =>
                    xKind === 'date'
                      ? formatDate(Number(x))
                      : `${numberLabel(Number(x))} ${xLabel}`
                  }
                  formatter={(value, name) => {
                    const s = series.find((s) => s.label === name);
                    return [
                      numberLabel(
                        typeof value === 'number' ? value : Number(value),
                        s?.unit,
                      ),
                      name,
                    ];
                  }}
                />
                {baseline && first && (
                  <ReferenceLine
                    yAxisId="primary"
                    y={Number(first[series[0].key])}
                    stroke="var(--muted)"
                    strokeDasharray="4 4"
                  />
                )}
                {children}
                {series.map((s) => (
                  <Line
                    key={s.key}
                    yAxisId={s.right ? 'current' : 'primary'}
                    type="linear"
                    dataKey={s.key}
                    data={s.data}
                    name={s.label}
                    stroke={s.color}
                    strokeWidth={2}
                    strokeDasharray={s.dashed ? '6 4' : undefined}
                    connectNulls={false}
                    isAnimationActive={false}
                    dot={
                      xKind !== 'date'
                        ? false
                        : (props: {
                            cx?: number;
                            cy?: number;
                            payload?: ChartRow;
                            index?: number;
                          }) => (
                            <circle
                              key={`${s.key}-${props.index}`}
                              cx={props.cx}
                              cy={props.cy}
                              r={4}
                              stroke={s.color}
                              strokeWidth={2}
                              fill={
                                props.payload?.demo
                                  ? `url(#${id}-hatch)`
                                  : s.color
                              }
                            >
                              <title>
                                {props.payload?.date
                                  ? formatDate(props.payload.date)
                                  : ''}
                                {props.payload?.demo ? ' · Demo data' : ''} ·{' '}
                                {s.label}:{' '}
                                {numberLabel(props.payload?.[s.key], s.unit)}
                              </title>
                            </circle>
                          )
                    }
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-legend">
            {series.map((s) => (
              <span key={s.key}>
                <svg
                  className="chart-swatch"
                  aria-hidden="true"
                  viewBox="0 0 24 12"
                >
                  <path
                    d="M0 6H24"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeDasharray={s.dashed ? '6 4' : undefined}
                  />
                </svg>
                {s.label} ({s.unit.trim()}){s.right ? ' · right axis' : ''}
              </span>
            ))}
            {baseline && <span>Dashed grey: first recorded value</span>}
            {rows.some((r) => r.demo) && (
              <span>
                <svg
                  className="chart-swatch"
                  viewBox="0 0 24 12"
                  aria-hidden="true"
                >
                  <circle
                    cx={12}
                    cy={6}
                    r={4}
                    stroke="var(--muted)"
                    fill={`url(#${id}-hatch)`}
                  />
                </svg>
                Hollow / hatched: Demo data
              </span>
            )}
          </div>
          <details>
            <summary>Show as table</summary>
            <div className="data-table-wrap">
              <table className="data-table">
                <caption>{title} · missing values are not interpolated</caption>
                <thead>
                  <tr>
                    <th scope="col">{xLabel}</th>
                    {series.map((s) => (
                      <th key={s.key} scope="col">
                        {s.label} ({s.unit.trim()})
                      </th>
                    ))}
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.x}-${i}`}>
                      <th scope="row">
                        {r.date ? formatDate(r.date) : numberLabel(r.x)}
                      </th>
                      {series.map((s) => (
                        <td key={s.key}>{numberLabel(r[s.key], s.unit)}</td>
                      ))}
                      <td>{r.demo ? 'Demo data' : 'Recorded'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </Card>
  );
}
interface TrendProps {
  finger: GloveFinger;
  timeline?: TimelineEntry[];
  loading?: boolean;
  compact?: boolean;
}
export function FingerTrend({
  points,
  finger,
  timeline = [],
  loading,
  compact,
  opening = false,
}: TrendProps & { points: RomPoint[]; opening?: boolean }) {
  const rows = toFingerSeries(points, finger, timeline);
  const measured = rows.flatMap((r) =>
    typeof r.active === 'number' ? [r.active] : [],
  );
  const improving =
    measured.length > 1 &&
    (opening ? measured.at(-1)! < measured[0] : measured.at(-1)! > measured[0]);
  const takeaway = improving
    ? opening
      ? 'opening further on your own'
      : 'closing further on your own'
    : 'your movement over time';
  return (
    <Chart
      title={`${fingerName(finger)}: ${takeaway}`}
      hint={`${opening ? '↓ Lower is better for opening' : '↑ Higher is better for closing'}. Estimated from the camera.`}
      rows={rows}
      series={[
        {
          key: 'active',
          label: 'On your own',
          unit: '%',
          color: color(finger),
        },
      ]}
      xLabel="Session date (UTC)"
      yLabel="Finger position (%)"
      yDomain={[0, 110]}
      loading={loading}
      compact={compact}
    />
  );
}
export function TrendSmallMultiples({
  points,
  timeline,
  loading,
  compact,
  opening,
}: Omit<TrendProps, 'finger'> & { points: RomPoint[]; opening?: boolean }) {
  return (
    <div className="chart-grid">
      {GLOVE_FINGERS.map((finger) => (
        <FingerTrend
          key={finger}
          {...{ points, finger, timeline, loading, compact, opening }}
        />
      ))}
    </div>
  );
}
export function AssistTrend({
  points,
  finger,
  timeline = [],
  loading,
  compact,
}: TrendProps & { points: AssistPoint[] }) {
  return (
    <Chart
      title={`${fingerName(finger)}: help from the glove`}
      hint="↓ Less help is better. Dashed: rate of assisted attempts."
      rows={assistSeries(points, finger, timeline)}
      series={[
        {
          key: 'needed',
          label: 'Help needed',
          unit: '%',
          color: color(finger),
        },
        {
          key: 'rate',
          label: 'Assisted attempts',
          unit: '%',
          color: color(finger),
          dashed: true,
        },
      ]}
      xLabel="Session date (UTC)"
      yLabel="Assistance (%)"
      yDomain={[0, 100]}
      loading={loading}
      compact={compact}
    />
  );
}
export function ResistanceSlowFast({
  points,
  finger,
  timeline = [],
  loading,
  compact,
}: TrendProps & { points: ResistancePoint[] }) {
  const rows = resistanceSeries(points, finger, timeline);
  const last = [...rows].reverse().find((r) => r.dependence != null);
  return (
    <Chart
      title={`${fingerName(finger)}: resistance over time`}
      hint={`↓ Lower resistance is better. Latest fast − slow: ${numberLabel(last?.dependence, ' mA')}. Estimate inspired by clinical practice.`}
      rows={rows}
      series={[
        { key: 'slow', label: 'Slow', unit: ' mA', color: color(finger) },
        {
          key: 'fast',
          label: 'Fast',
          unit: ' mA',
          color: color(finger),
          dashed: true,
        },
        {
          key: 'dependence',
          label: 'Fast − slow',
          unit: ' mA',
          color: 'var(--muted)',
          dashed: true,
        },
      ]}
      xLabel="Evaluation date (UTC)"
      yLabel="Excess current (mA)"
      yDomain={['auto', 'auto']}
      loading={loading}
      compact={compact}
    />
  );
}
const phaseColor: Record<ExercisePhase, string> = {
  PRESENT: 'var(--target)',
  ATTEMPT: 'var(--active)',
  HOLD: 'var(--reached)',
  ASSIST: 'var(--assist)',
  ASSIST_HOLD: 'var(--assist)',
  RELEASE: 'var(--target)',
  PAUSED: 'var(--muted)',
  REST: 'var(--target)',
  DONE: 'var(--target)',
};
export function ReplayChart({
  trace,
  safety = [],
  isDemo = false,
  loading = false,
}: {
  trace?: AttemptTrace;
  safety?: AttemptResult['safety_events'];
  isDemo?: boolean;
  loading?: boolean;
}) {
  const rows: ChartRow[] =
    trace?.t.map((t, i) => ({
      x: t,
      demo: isDemo,
      phase: trace.phase[i],
      current: trace.ma[i] ?? null,
      ...Object.fromEntries(
        GLOVE_FINGERS.flatMap((f) => [
          [
            `${f}Closure`,
            trace.closure[f][i] == null ? null : trace.closure[f][i]! * 100,
          ],
          [
            `${f}Servo`,
            trace.servo[f][i] == null ? null : trace.servo[f][i] * 100,
          ],
        ]),
      ),
    })) ?? [];
  const reduced = decimate(
    rows,
    600,
    (r) =>
      [
        ...GLOVE_FINGERS.flatMap((f) => [r[`${f}Closure`], r[`${f}Servo`]]),
        r.current,
      ].map((v) => (typeof v === 'number' ? v : null)),
    (r, p) =>
      r.phase !== p.phase ||
      safety.some((e) => e.t_rel >= p.x && e.t_rel <= r.x),
  );
  return (
    <div className="data-section">
      <Chart
        title="Your attempt, moment by moment"
        hint="Higher means further closed. Solid: camera. Dashed: commanded servo position. Grey right axis: total current; no direction-of-better."
        rows={reduced}
        series={[
          ...GLOVE_FINGERS.flatMap((f) => [
            {
              key: `${f}Closure`,
              label: `${fingerName(f)} camera`,
              unit: '%',
              color: color(f),
            },
            {
              key: `${f}Servo`,
              label: `${fingerName(f)} servo`,
              unit: '%',
              color: color(f),
              dashed: true,
            },
          ]),
          {
            key: 'current',
            label: 'Total current',
            unit: ' mA',
            color: 'var(--muted)',
            right: true,
          },
        ]}
        xKind="number"
        xLabel="Time (s)"
        yLabel="Position (%)"
        yDomain={[0, 110]}
        baseline={false}
        loading={loading}
      >
        {trace &&
          phaseBands(trace).map((b, i) => (
            <ReferenceArea
              key={i}
              yAxisId="primary"
              x1={b.start}
              x2={b.end}
              fill={phaseColor[b.phase]}
              fillOpacity={0.1}
              label={{
                value: b.phase.toLowerCase().replaceAll('_', ' '),
                position: 'insideTop',
                fill: 'var(--text)',
                fontSize: tokens.caption,
              }}
            />
          ))}
        {safety.map((e, i) => (
          <ReferenceDot
            key={i}
            yAxisId="primary"
            x={e.t_rel}
            y={100}
            ifOverflow="extendDomain"
            shape={(props: { cx?: number; cy?: number }) => (
              <g transform={`translate(${props.cx}, ${props.cy})`}>
                <path d="M0 -8L8 6H-8Z" fill="var(--danger)" />
                <title>{`${e.source} at ${e.t_rel}s · ${e.finger ?? 'finger unknown'} · ${numberLabel(e.ma, ' mA')}`}</title>
              </g>
            )}
          />
        ))}
      </Chart>
      {safety.length > 0 && (
        <ul aria-label="Safety events">
          {safety.map((e, i) => (
            <li key={i}>
              ▲ {e.source.replaceAll('_', ' ')} · {e.t_rel.toFixed(1)} s ·{' '}
              {e.finger ?? 'finger unknown'} · {numberLabel(e.ma, ' mA')}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
export function SweepCurves({
  sweeps,
  finger,
  isDemo = false,
  loading,
}: {
  sweeps: EvalSweep[];
  finger: GloveFinger;
  isDemo?: boolean;
  loading?: boolean;
}) {
  // Each speed has its own position samples; combine only matching positions.
  const relevant = sweeps.filter((s) => s.finger === finger);
  const positions = [
    ...new Set(relevant.flatMap((s) => s.points.map((p) => p.pos))),
  ].sort((a, b) => a - b);
  const rows = positions.map((pos): ChartRow => ({
    x: pos * 100,
    demo: isDemo,
    ...Object.fromEntries(
      relevant.flatMap((s) => {
        const p = s.points.find((p) => p.pos === pos);
        return [
          [s.speed, p?.ma ?? null],
          [`${s.speed}Friction`, p ? p.ma - p.excess_ma : null],
        ];
      }),
    ),
  }));
  return (
    <div className="data-section">
      <Chart
        title={`${fingerName(finger)}: slow and fast sweeps`}
        hint="↓ Lower excess above friction suggests less resistance. Grey: stored friction (measured − excess)."
        rows={rows}
        series={[
          {
            key: 'slow',
            data: rows.filter((r) => typeof r.slow === 'number'),
            label: 'Slow current',
            unit: ' mA',
            color: color(finger),
          },
          {
            key: 'fast',
            data: rows.filter((r) => typeof r.fast === 'number'),
            label: 'Fast current',
            unit: ' mA',
            color: color(finger),
            dashed: true,
          },
          {
            key: 'slowFriction',
            data: rows.filter((r) => typeof r.slowFriction === 'number'),
            label: 'Slow friction',
            unit: ' mA',
            color: 'var(--muted)',
          },
          {
            key: 'fastFriction',
            data: rows.filter((r) => typeof r.fastFriction === 'number'),
            label: 'Fast friction',
            unit: ' mA',
            color: 'var(--muted)',
            dashed: true,
          },
        ]}
        xKind="number"
        xLabel="Commanded position (%)"
        yLabel="Total current (mA)"
        baseline={false}
        loading={loading}
      />
      {isDemo &&
        relevant.some(
          (s) =>
            s.points.length > 1 &&
            s.points.every((p) => p.ma === s.points[0].ma),
        ) && (
          <Banner
            tone="demo"
            title="Sample sweep values are constant in these demo records."
          />
        )}
      {relevant
        .filter((s) => s.aborted_at != null)
        .map((s) => (
          <p key={s.speed}>
            {s.speed === 'slow' ? 'Slow' : 'Fast'} sweep stopped safely at{' '}
            {percentage(s.aborted_at)}.
          </p>
        ))}
    </div>
  );
}
export function Sparkline({
  values,
  label = 'Recent progress',
  isDemo = false,
  loading,
}: {
  values: (number | null)[];
  label?: string;
  isDemo?: boolean;
  loading?: boolean;
}) {
  return (
    <Chart
      title={label}
      hint="↑ Higher is better for closing. Missing values stay gaps."
      rows={values.map((v, i) => ({ x: i + 1, demo: isDemo, value: v }))}
      series={[
        {
          key: 'value',
          label: 'Progress',
          unit: '%',
          color: 'var(--finger-index)',
        },
      ]}
      xKind="number"
      xLabel="Session number"
      yLabel="Progress (%)"
      loading={loading}
      compact
    />
  );
}
