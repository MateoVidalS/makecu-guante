import {
  KpiTile as DSKpiTile,
  DemoBadge as DSDemoBadge,
  Skeleton,
  Text,
  cx,
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
import type { AttemptResult, AttemptTrace } from '../../contracts/engine';
import type { ExercisePhase } from '../../contracts/engine';
import type { EvalSweep } from '../../contracts/evaluation';
import { GLOVE_FINGERS, type GloveFinger } from '../../contracts/glove';
import {
  assistSeries,
  decimate,
  phaseBands,
  replayRows,
  resistanceSeries,
  sweepRows,
  toFingerSeries,
  type ChartRow,
  type TimelineEntry,
} from './transforms';
import type { TherapyMarker } from '../therapy/data';
import { PhaseStrip } from './PhaseStrip';
import './charts.css';
import './visuals.css';

export { HandFigure, HandRangeMap, AttemptHand } from './HandMap';
export {
  EffortColumns,
  EffortSmallMultiples,
  LatestEffortBars,
} from './EffortBars';
export { PracticeCalendar } from './PracticeCalendar';
export { ResistanceDumbbells } from './ResistanceDumbbells';
export { PhaseStrip } from './PhaseStrip';
export { VisualCard, VisualLegend } from './VisualCard';
export * from './visuals';
export {
  assistSeries,
  decimate,
  phaseBands,
  replayRows,
  resistanceSeries,
  sweepRows,
  sweepsAreConstant,
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
  value == null ? '—' : `${Math.round(value * 100)}%`;
const numberLabel = (
  value: number | string | boolean | null | undefined,
  unit = '',
) =>
  typeof value === 'number'
    ? `${unit.includes('mA') || unit === '%' ? Math.round(value) : value.toFixed(1)}${unit}`
    : 'Not measured';

/** Softened finger colours: defined in charts.css from the --finger-* tokens. */
const color = (finger: GloveFinger) => `var(--chart-${finger})`;
const MUTED = 'var(--chart-muted)';
const AXIS_FONT = 12;
const PERCENT_TICKS = [0, 25, 50, 75, 100];

export function DemoBadge() {
  return <DSDemoBadge />;
}

/** The one demo-data note for a section. Charts draw demo values as hollow points. */
export function DemoNote({
  children = 'Demo data, shown as hollow points',
}: {
  children?: ReactNode;
}) {
  return (
    <p className="demo-note">
      <svg viewBox="0 0 10 10" aria-hidden="true">
        <circle cx={5} cy={5} r={3.5} />
      </svg>
      {children}
    </p>
  );
}

/** A titled block of a data page: heading, one-line description, optional demo note, content. */
export function DataSection({
  title,
  description,
  demo,
  demoNote,
  actions,
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  demo?: boolean;
  demoNote?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <section className={cx('data-section', className)} aria-labelledby={id}>
      <header className="data-section__header">
        <div className="data-section__titles">
          <h2 id={id}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {(actions || demo) && (
          <div className="data-section__aside">
            {demo && <DemoNote>{demoNote}</DemoNote>}
            {actions}
          </div>
        )}
      </header>
      {children}
    </section>
  );
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

/** A row of plain numbers separated by hairlines: no boxes. */
export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="kpi-row">{children}</div>;
}

interface Series {
  data?: ChartRow[];
  key: string;
  label: string;
  /** Short name drawn at the end of the line when the chart uses direct labels. */
  short?: string;
  unit: string;
  color: string;
  dashed?: boolean;
  right?: boolean;
}
interface LegendItem {
  label: string;
  color: string;
  dashed?: boolean;
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
  /** Dotted reference at the first value of the first series. */
  baseline?: boolean;
  /** Label each line at its last point instead of showing a legend. */
  direct?: boolean;
  /** Replaces the default one-item-per-series legend. */
  legend?: LegendItem[];
  loading?: boolean;
  compact?: boolean;
  tall?: boolean;
  short?: boolean;
  /** Drawn above the plot, inside the card (e.g. the phase strip). */
  prelude?: ReactNode;
  children?: ReactNode;
}

const lastIndex = (rows: ChartRow[], key: string) => {
  for (let i = rows.length - 1; i >= 0; i--)
    if (typeof rows[i][key] === 'number') return i;
  return -1;
};

function Swatch({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <svg className="chart-swatch" aria-hidden="true" viewBox="0 0 16 8">
      <path
        d="M0 4H16"
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray={dashed ? '4 3' : undefined}
      />
    </svg>
  );
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
  baseline = false,
  direct = false,
  legend,
  loading,
  compact,
  tall,
  short,
  prelude,
  children,
}: ChartProps) {
  const id = useId().replace(/:/g, '');
  const hasData = rows.some((r) =>
    series.some((s) => typeof r[s.key] === 'number'),
  );
  const right = series.some((s) => s.right);
  const first = rows.find((r) => typeof r[series[0]?.key] === 'number');
  const labelWidth = direct
    ? Math.max(...series.map((s) => (s.short ?? s.label).length)) * 6.5 + 12
    : 0;
  const axisX = (x: number) =>
    xKind === 'date'
      ? new Date(x).toLocaleDateString('en', {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        })
      : `${Number(x.toFixed(1))}`;
  const legendItems: LegendItem[] =
    legend ??
    (direct || series.length < 2
      ? []
      : series.map((s) => ({
          label: s.label,
          color: s.color,
          dashed: s.dashed,
        })));
  return (
    <article
      className={cx(
        'chart-card',
        compact && 'compact',
        tall && 'tall',
        short && 'short',
      )}
      aria-labelledby={`${id}-title`}
    >
      <header className="chart__header">
        <h3 id={`${id}-title`} className="chart__title">
          {title}
        </h3>
        <p className="chart-hint">{hint}</p>
      </header>
      {loading ? (
        <div role="status" className="chart__loading">
          <span className="sr-only">Loading chart…</span>
          <Skeleton height="100%" />
        </div>
      ) : !hasData ? (
        <Text size="small" tone="muted" className="chart__empty">
          Not measured. No measurements recorded yet.
        </Text>
      ) : (
        <>
          {prelude}
          <div className="chart__units" aria-hidden="true">
            <span>{yLabel}</span>
            {right && <span>Total current (mA)</span>}
          </div>
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
                  top: 8,
                  bottom: xKind === 'number' ? 16 : 0,
                  left: 0,
                  right: Math.max(12, labelWidth),
                }}
                accessibilityLayer
              >
                <CartesianGrid
                  stroke="var(--chart-grid)"
                  vertical={false}
                  strokeDasharray=""
                />
                <XAxis
                  type="number"
                  dataKey="x"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={axisX}
                  minTickGap={32}
                  axisLine={false}
                  tickLine={false}
                  tickMargin={8}
                  fontSize={AXIS_FONT}
                  label={
                    xKind === 'number'
                      ? {
                          value: xLabel,
                          position: 'insideBottom',
                          offset: -12,
                          fill: MUTED,
                          fontSize: AXIS_FONT,
                        }
                      : undefined
                  }
                />
                <YAxis
                  yAxisId="primary"
                  width={36}
                  domain={yDomain}
                  axisLine={false}
                  tickLine={false}
                  tickCount={4}
                  ticks={
                    yDomain[0] === 0 &&
                    (yDomain[1] === 100 || yDomain[1] === 110)
                      ? PERCENT_TICKS
                      : undefined
                  }
                  fontSize={AXIS_FONT}
                />
                {right && (
                  <YAxis
                    yAxisId="current"
                    orientation="right"
                    width={40}
                    axisLine={false}
                    tickLine={false}
                    tickCount={4}
                    fontSize={AXIS_FONT}
                  />
                )}
                <Tooltip
                  isAnimationActive={false}
                  cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
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
                    stroke={MUTED}
                    strokeOpacity={0.6}
                    strokeDasharray="2 3"
                  />
                )}
                {children}
                {series.map((s) => {
                  const data = s.data ?? rows;
                  const end = lastIndex(data, s.key);
                  return (
                    <Line
                      key={s.key}
                      yAxisId={s.right ? 'current' : 'primary'}
                      type="linear"
                      dataKey={s.key}
                      data={s.data}
                      name={s.label}
                      stroke={s.color}
                      strokeWidth={1.5}
                      strokeDasharray={s.dashed ? '4 3' : undefined}
                      connectNulls={false}
                      isAnimationActive={false}
                      activeDot={{ r: 4, strokeWidth: 0, fill: s.color }}
                      label={
                        direct
                          ? (props: {
                              x?: number | string;
                              y?: number | string;
                              index?: number;
                            }) =>
                              props.index === end ? (
                                <text
                                  key={`${s.key}-label`}
                                  x={Number(props.x) + 8}
                                  y={Number(props.y)}
                                  dy={4}
                                  fill={s.color}
                                  fontSize={AXIS_FONT}
                                >
                                  {s.short ?? s.label}
                                </text>
                              ) : (
                                <g key={`${s.key}-${props.index}`} />
                              )
                          : undefined
                      }
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
                                className={
                                  props.payload?.demo
                                    ? 'chart-dot chart-dot--demo'
                                    : 'chart-dot'
                                }
                                cx={props.cx}
                                cy={props.cy}
                                r={props.payload?.demo ? 3 : 2.5}
                                stroke={s.color}
                                strokeWidth={1.25}
                                fill={
                                  props.payload?.demo
                                    ? 'var(--chart-surface)'
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
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {legendItems.length > 0 && (
            <ul className="chart-legend" aria-label="Legend">
              {legendItems.map((item) => (
                <li key={item.label}>
                  <Swatch color={item.color} dashed={item.dashed} />
                  {item.label}
                </li>
              ))}
            </ul>
          )}
          <details className="chart__details">
            <summary>Show as table</summary>
            <div className="data-table-wrap">
              <table className="data-table">
                <caption>{title} · missing values are not interpolated</caption>
                <thead>
                  <tr>
                    <th scope="col">{xLabel}</th>
                    {series.map((s) => (
                      <th key={s.key} scope="col" className="num">
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
                        <td key={s.key} className="num">
                          {numberLabel(r[s.key], s.unit)}
                        </td>
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
    </article>
  );
}

interface TrendProps {
  finger: GloveFinger;
  timeline?: TimelineEntry[];
  loading?: boolean;
  compact?: boolean;
}

/** Takeaway title for a finger's active-range trend. */
export function trendTakeaway(rows: ChartRow[], opening: boolean) {
  const measured = rows.flatMap((r) =>
    typeof r.active === 'number' ? [r.active] : [],
  );
  const improving =
    measured.length > 1 &&
    (opening ? measured.at(-1)! < measured[0] : measured.at(-1)! > measured[0]);
  return improving
    ? opening
      ? 'opening further on your own'
      : 'closing further on your own'
    : 'your movement over time';
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
  return (
    <Chart
      title={`${fingerName(finger)}: ${trendTakeaway(rows, opening)}`}
      hint={`${opening ? 'Lower is better for opening' : 'Higher is better'}. Dotted line: first session.`}
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
      yLabel="Finger position, %"
      yDomain={[0, 100]}
      baseline
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
      hint="Lower is better."
      rows={assistSeries(points, finger, timeline)}
      series={[
        {
          key: 'needed',
          label: 'Help needed',
          short: 'Help',
          unit: '%',
          color: color(finger),
        },
        {
          key: 'rate',
          label: 'Assisted attempts',
          short: 'Assisted',
          unit: '%',
          color: MUTED,
          dashed: true,
        },
      ]}
      xLabel="Session date (UTC)"
      yLabel="Assistance, %"
      yDomain={[0, 100]}
      direct
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
      hint={`Lower is better. Latest fast − slow: ${numberLabel(last?.dependence, ' mA')}.`}
      rows={rows}
      series={[
        {
          key: 'slow',
          label: 'Slow',
          unit: ' mA',
          color: color(finger),
        },
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
          color: MUTED,
          dashed: true,
        },
      ]}
      xLabel="Evaluation date (UTC)"
      yLabel="Excess current, mA"
      yDomain={['auto', 'auto']}
      direct
      loading={loading}
      compact={compact}
    />
  );
}

const phaseColor: Record<ExercisePhase, string> = {
  PRESENT: 'transparent',
  ATTEMPT: 'var(--active)',
  HOLD: 'var(--reached)',
  ASSIST: 'var(--assist)',
  ASSIST_HOLD: 'var(--assist)',
  RELEASE: 'transparent',
  PAUSED: 'var(--muted)',
  REST: 'transparent',
  DONE: 'transparent',
};
const safetyLabel = (e: AttemptResult['safety_events'][number]) =>
  `${e.source.replaceAll('_', ' ')} · ${e.t_rel.toFixed(1)} s · ${e.finger ?? 'finger unknown'} · ${numberLabel(e.ma, ' mA')}`;

export function ReplayChart({
  trace,
  safety = [],
  therapyMarkers = [],
  isDemo = false,
  loading = false,
}: {
  trace?: AttemptTrace;
  safety?: AttemptResult['safety_events'];
  therapyMarkers?: TherapyMarker[];
  isDemo?: boolean;
  loading?: boolean;
}) {
  const reduced = decimate(
    replayRows(trace, isDemo),
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
  const bands = trace ? phaseBands(trace) : [];
  const assistRows = reduced.filter(
    (r) => r.phase === 'ASSIST' || r.phase === 'ASSIST_HOLD',
  );
  const peak = Math.max(
    ...assistRows.map((r) => (typeof r.current === 'number' ? r.current : 0)),
    0,
  );
  const faintBands = bands.map((b, i) => (
    <ReferenceArea
      key={`band-${i}`}
      yAxisId="primary"
      x1={b.start}
      x2={b.end}
      fill={phaseColor[b.phase]}
      fillOpacity={0.045}
      stroke="var(--chart-grid)"
      strokeOpacity={i === 0 ? 0 : 1}
    />
  ));
  const markers = (y: (e: AttemptResult['safety_events'][number]) => number) =>
    safety.map((e, i) => (
      <ReferenceDot
        key={`safety-${i}`}
        yAxisId="primary"
        x={e.t_rel}
        y={y(e)}
        ifOverflow="extendDomain"
        shape={(props: { cx?: number; cy?: number }) => (
          <g transform={`translate(${props.cx}, ${props.cy})`}>
            <path
              d="M0 5L-5.5 -4.5H5.5Z"
              fill="var(--danger)"
              stroke="var(--chart-surface)"
              strokeWidth={2}
              paintOrder="stroke"
            />
            <title>{safetyLabel(e)}</title>
          </g>
        )}
      />
    ));
  return (
    <div className="data-stack">
      <Chart
        title="Your attempt, moment by moment"
        hint="Higher means further closed. Solid lines: camera. Dashed: where the glove was told to go."
        rows={reduced}
        series={GLOVE_FINGERS.flatMap((f) => [
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
        ])}
        legend={[
          ...GLOVE_FINGERS.map((f) => ({
            label: fingerName(f),
            color: color(f),
          })),
          { label: 'Servo (commanded)', color: MUTED, dashed: true },
        ]}
        xKind="number"
        xLabel="Time (s)"
        yLabel="Position, %"
        yDomain={[0, 110]}
        loading={loading}
        tall
        prelude={
          <PhaseStrip
            trace={trace}
            safety={safety}
            therapyMarkers={therapyMarkers}
          />
        }
      >
        {faintBands}
        {markers(() => 104)}
      </Chart>
      {!loading && reduced.some((r) => typeof r.current === 'number') && (
        <Chart
          title={
            peak > 0
              ? `Motor current peaked at ${Math.round(peak)} mA while the glove helped`
              : 'Motor current stayed low: the glove did not need to help'
          }
          hint="Total motor current from the recorded glove. Spikes can indicate resistance."
          rows={reduced}
          series={[
            {
              key: 'current',
              label: 'Total current',
              unit: ' mA',
              color: 'var(--chart-current)',
            },
          ]}
          xKind="number"
          xLabel="Time (s)"
          yLabel="Total current, mA"
          short
        >
          {faintBands}
          {markers((e) => e.ma ?? 0)}
        </Chart>
      )}
      {safety.length > 0 && (
        <ul aria-label="Safety events" className="safety-list">
          {safety.map((e, i) => (
            <li key={i}>
              <svg viewBox="0 0 10 10" aria-hidden="true">
                <path d="M5 9L1 1H9Z" />
              </svg>
              {safetyLabel(e)}
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
  compact,
}: {
  sweeps: EvalSweep[];
  finger: GloveFinger;
  isDemo?: boolean;
  loading?: boolean;
  compact?: boolean;
}) {
  const rows = sweepRows(sweeps, finger, isDemo);
  const has = (key: string) => rows.filter((r) => typeof r[key] === 'number');
  return (
    <div className="data-stack">
      <Chart
        title={`${fingerName(finger)}: slow and fast sweeps`}
        hint="Lower excess above friction suggests less resistance."
        rows={rows}
        series={[
          {
            key: 'slow',
            data: has('slow'),
            label: 'Slow current',
            unit: ' mA',
            color: color(finger),
          },
          {
            key: 'fast',
            data: has('fast'),
            label: 'Fast current',
            unit: ' mA',
            color: color(finger),
            dashed: true,
          },
          {
            key: 'slowFriction',
            data: has('slowFriction'),
            label: 'Slow friction',
            unit: ' mA',
            color: MUTED,
          },
          {
            key: 'fastFriction',
            data: has('fastFriction'),
            label: 'Fast friction',
            unit: ' mA',
            color: MUTED,
            dashed: true,
          },
        ]}
        legend={[
          { label: 'Slow', color: color(finger) },
          { label: 'Fast', color: color(finger), dashed: true },
          { label: 'Stored friction', color: MUTED },
        ]}
        xKind="number"
        xLabel="Commanded position (%)"
        yLabel="Total current, mA"
        loading={loading}
        compact={compact}
      />
      {sweeps
        .filter((s) => s.finger === finger && s.aborted_at != null)
        .map((s) => (
          <Text key={s.speed} size="small" tone="muted">
            {s.speed === 'slow' ? 'Slow' : 'Fast'} sweep stopped safely at{' '}
            {percentage(s.aborted_at)}.
          </Text>
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
      hint="Higher is better for closing. Missing values stay gaps."
      rows={values.map((v, i) => ({ x: i + 1, demo: isDemo, value: v }))}
      series={[
        {
          key: 'value',
          label: 'Progress',
          unit: '%',
          color: color('index'),
        },
      ]}
      xKind="number"
      xLabel="Session number"
      yLabel="Progress, %"
      loading={loading}
      compact
    />
  );
}
