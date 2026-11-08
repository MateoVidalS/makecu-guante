import type { ReactNode } from 'react';
import type { ResistancePoint } from '../../contracts/api';
import { directionOf, directionLabel, LEGACY_GLOVE } from './direction';
import { GLOVE_FINGERS } from '../../contracts/glove';
import {
  compactDumbbellRows,
  dumbbellDomain,
  dumbbellRows,
  resistanceTakeaway,
  type DumbbellRow,
  type StoppedSweeps,
} from './visuals';
import { useWidth, VisualCard } from './VisualCard';

const fingerName = (f: string) => f.charAt(0).toUpperCase() + f.slice(1);
const shortDate = (d: string) =>
  new Date(d).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
const longDate = (d: string) =>
  new Date(d).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
const ma = (v: number | null | undefined) =>
  v == null ? 'Not measured' : `${Math.round(v)} mA`;
/** Same wording as the evaluation detail's sweep status. */
const STOPPED = 'Stopped safely; incomplete';

const GROUP_GAP = 10;
const M = { top: 4, right: 76, left: 100, axis: 40 };

function Diamond({
  x,
  y,
  r,
  className,
}: {
  x: number;
  y: number;
  r: number;
  className: string;
}) {
  return (
    <path
      className={className}
      d={`M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z`}
    />
  );
}

/**
 * Slow vs fast resistance per finger and evaluation. The bar between the dots is the
 * speed-dependent part (fast − slow); further right means stiffer.
 */
export function ResistanceDumbbells({
  points,
  highlightId,
  upTo,
  loading,
  title,
  hint,
  table,
  compact = false,
  evaluations,
}: {
  points: ResistancePoint[];
  /** Evaluation records: sweeps that stopped safely are marked and left out of comparisons. */
  evaluations?: StoppedSweeps;
  /** Evaluation to draw in color; defaults to the latest. */
  highlightId?: number;
  /** Only evaluations up to this time (ms). */
  upTo?: number;
  loading?: boolean;
  title?: ReactNode;
  hint?: ReactNode;
  /** Replaces the default table view. */
  table?: ReactNode;
  /** Only the first and the highlighted evaluation per finger, in tighter rows. */
  compact?: boolean;
}) {
  const ROW = compact ? 16 : 24;
  const GROUP_HEAD = compact ? 16 : 22;
  const groupGap = compact ? 6 : GROUP_GAP;
  const [ref, width] = useWidth<HTMLDivElement>(480);
  const visible = points.filter(
    (p) => upTo == null || Date.parse(p.started_at) <= upTo,
  );
  const focusId =
    highlightId ??
    [...visible]
      .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))
      .at(-1)?.evaluation_id;
  const every = dumbbellRows(visible, evaluations);
  // Compact: per finger, the first finished result and the latest one, which may be
  // older than the focus evaluation when that one stopped early or skipped the finger.
  const groups = compact ? compactDumbbellRows(every, focusId) : every;
  const all = GLOVE_FINGERS.flatMap((f) => groups[f]);
  const focusRows = new Set(
    compact
      ? GLOVE_FINGERS.flatMap((f) => groups[f].slice(-1))
      : all.filter((r) => r.evaluationId === focusId),
  );
  const [lo, hi] = dumbbellDomain(all);
  const plotW = Math.max(80, width - M.left - M.right);
  const x = (v: number) => M.left + ((v - lo) / (hi - lo)) * plotW;
  // Keep at least ~56px between tick labels.
  const step =
    [50, 100, 200, 500].find((s) => (plotW * s) / (hi - lo) >= 56) ?? 1000;
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += step) ticks.push(t);
  let cursor = M.top;
  const layout = GLOVE_FINGERS.filter((f) => groups[f].length).map((f) => {
    const top = cursor;
    cursor += GROUP_HEAD + groups[f].length * ROW + groupGap;
    return { finger: f, top, rows: groups[f] };
  });
  const plotBottom = cursor - groupGap + 4;
  const height = plotBottom + M.axis;
  const row = (f: string, r: DumbbellRow, cy: number) => {
    const on = focusRows.has(r) && directionOf(r) === 'open';
    const cls = `${on ? 'db-on' : 'db-off'}${r.demo ? ' viz-demo' : ''}`;
    const color = on ? `var(--chart-${f})` : undefined;
    return (
      <g
        key={r.evaluationId}
        className={`db-row ${cls}`}
        style={color ? { color } : undefined}
      >
        <title>
          {`${fingerName(f)} · ${directionLabel(r)} · ${longDate(r.date)}${r.demo ? ' · Demo data' : ''}${r.stopped ? ` · ${STOPPED}` : ''} · Slow ${ma(r.slow)} · Fast ${ma(r.fast)} · Fast − slow ${ma(r.gap)}`}
        </title>
        <rect
          className="viz-hit"
          x={0}
          y={cy - ROW / 2}
          width={width}
          height={ROW}
        />
        <text
          className={on ? 'viz-label db-date db-date--on' : 'viz-label db-date'}
          x={M.left - 12}
          y={cy}
          dy={4}
          textAnchor="end"
        >
          {shortDate(r.date)}
          {directionOf(r) === 'close'
            ? ' · earlier'
            : r.stopped
              ? ' · stopped'
              : r.demo
                ? ' · demo'
                : ''}
        </text>
        {r.slow != null && r.fast != null && (
          <line
            className="db-bar"
            x1={x(r.slow)}
            x2={x(r.fast)}
            y1={cy}
            y2={cy}
          />
        )}
        {r.slow != null && (
          <circle className="db-slow" cx={x(r.slow)} cy={cy} r={5} />
        )}
        {r.fast != null && (
          <Diamond className="db-fast" x={x(r.fast)} y={cy} r={6.5} />
        )}
        {r.slow == null && r.fast == null && (
          <text className="viz-label" x={M.left} y={cy} dy={4}>
            Not measured
          </text>
        )}
        {on && (
          <text
            className="viz-label db-gap"
            x={M.left + plotW + 12}
            y={cy}
            dy={4}
          >
            {r.gap == null
              ? '—'
              : // Sign from the shown value: 0.4 mA is "0 mA", never "+0 mA".
                `${Math.round(r.gap) > 0 ? '+' : ''}${Math.round(r.gap) || 0} mA`}
          </text>
        )}
      </g>
    );
  };
  return (
    <VisualCard
      className="resistance-dumbbells"
      title={title ?? resistanceTakeaway(groups, upTo)}
      hint={
        hint ??
        `Resistance to opening (flexor tone). Fast − slow: velocity dependence (spasticity). ${LEGACY_GLOVE} is muted; changes use the same direction.`
      }
      label={`Resistance per finger and evaluation, in mA of extra motor current. ${layout
        .map(
          (g) =>
            `${fingerName(g.finger)}: ${g.rows
              .map(
                (r) =>
                  `${shortDate(r.date)} ${directionLabel(r)}${r.stopped ? ` (${STOPPED})` : ''} slow ${ma(r.slow)}, fast ${ma(r.fast)}, gap ${ma(r.gap)}`,
              )
              .join('; ')}`,
        )
        .join('. ')}.`}
      loading={loading}
      empty={!all.some((r) => r.slow != null || r.fast != null)}
      emptyText="No evaluations recorded yet."
      legend={[
        { label: 'Slow sweep', mark: 'dot', color: 'var(--text)' },
        { label: 'Fast sweep', mark: 'diamond', color: 'var(--text)' },
        {
          label: 'Earlier evaluations',
          mark: 'dot',
          color: 'var(--chart-muted)',
        },
      ]}
      table={
        table ?? (
          <table className="data-table">
            <caption>Mean excess current over 20–90% of the range</caption>
            <thead>
              <tr>
                <th scope="col">Finger</th>
                <th scope="col">Evaluation (UTC)</th>
                <th scope="col" className="num">
                  Slow
                </th>
                <th scope="col" className="num">
                  Fast
                </th>
                <th scope="col" className="num">
                  Fast − slow
                </th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {layout.flatMap((g) =>
                g.rows.map((r) => (
                  <tr key={`${g.finger}-${r.evaluationId}`}>
                    <th scope="row">{fingerName(g.finger)}</th>
                    <td>{longDate(r.date)}</td>
                    <td className="num">{ma(r.slow)}</td>
                    <td className="num">{ma(r.fast)}</td>
                    <td className="num">{ma(r.gap)}</td>
                    <td>
                      {r.demo ? 'Demo data' : 'Recorded'} · {directionLabel(r)}
                      {r.stopped && ` · ${STOPPED}`}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        )
      }
    >
      <div ref={ref} className="viz-measure">
        <svg
          className="viz-svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                className="viz-grid"
                x1={x(t)}
                x2={x(t)}
                y1={M.top}
                y2={plotBottom}
              />
              <text
                className="viz-tick"
                x={x(t)}
                y={plotBottom + 14}
                textAnchor="middle"
              >
                {t === ticks.at(-1) ? `${t} mA` : t}
              </text>
            </g>
          ))}
          <text
            className="viz-tick db-direction"
            x={M.left}
            y={plotBottom + 32}
          >
            ← Looser
          </text>
          <text
            className="viz-tick db-direction"
            x={M.left + plotW}
            y={plotBottom + 32}
            textAnchor="end"
          >
            Stiffer →
          </text>
          {layout.map((g) => (
            <g key={g.finger}>
              <text className="viz-label db-finger" x={0} y={g.top + 14}>
                {fingerName(g.finger)}
              </text>
              {g.rows.map((r, i) =>
                row(g.finger, r, g.top + GROUP_HEAD + i * ROW + ROW / 2),
              )}
            </g>
          ))}
          {layout[0] && (
            <text
              className="viz-tick"
              x={M.left + plotW + 12}
              y={layout[0].top + 14}
            >
              Fast − slow
            </text>
          )}
        </svg>
      </div>
    </VisualCard>
  );
}
