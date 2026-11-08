import type { AssistPoint, RomPoint } from '../../contracts/api';
import { GLOVE_FINGERS, type GloveFinger } from '../../contracts/glove';
import { directionOf, directionLabel, LEGACY_GLOVE } from './direction';
import type { TimelineEntry } from './transforms';
import {
  effortSeries,
  effortTakeaway,
  latestEffort,
  latestEffortTitle,
  type EffortPoint,
} from './visuals';
import { useWidth, VisualCard, type LegendEntry } from './VisualCard';

const pct = (v: number | null | undefined) =>
  v == null ? 'Not measured' : `${Math.round(v * 100)}%`;
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

export const EFFORT_LEGEND: LegendEntry[] = [
  { label: 'On your own', mark: 'block', color: 'var(--active)' },
  {
    label: 'Opening the glove completed',
    mark: 'block',
    color: 'var(--assist)',
  },
];

/** Rectangle with only the top corners rounded (data end), square at the baseline. */
export function roundedTop(x: number, y: number, w: number, h: number, r = 4) {
  if (h <= 0 || w <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x} ${y + h}V${y + rr}Q${x} ${y} ${x + rr} ${y}H${x + w - rr}Q${x + w} ${y} ${x + w} ${y + rr}V${y + h}Z`;
}

function EffortTable({
  rows,
  caption,
}: {
  rows: EffortPoint[];
  caption: string;
}) {
  return (
    <table className="data-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Session date (UTC)</th>
          <th scope="col" className="num">
            On your own
          </th>
          <th scope="col" className="num">
            Glove helped
          </th>
          <th scope="col" className="num">
            Assisted attempts
          </th>
          <th scope="col">Source</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.sessionId}
            data-legacy={directionOf(r) === 'close' || undefined}
          >
            <th scope="row">{longDate(r.date)}</th>
            <td className="num">{pct(r.own)}</td>
            <td className="num">{pct(r.glove)}</td>
            <td className="num">{pct(r.rate)}</td>
            <td>
              {r.demo ? 'Demo data' : 'Recorded'} · {directionLabel(r)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const PLOT_H = 150;
const M = { top: 10, right: 76, bottom: 24, left: 36 };

/** Stacked columns per session: blue is active opening in open poses, orange is what the glove added. */
export function EffortColumns({
  rom,
  assist,
  finger,
  loading,
  timeline,
}: {
  rom: RomPoint[];
  assist: AssistPoint[];
  timeline?: TimelineEntry[];
  finger: GloveFinger;
  loading?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(320);
  const rows = effortSeries(rom, assist, finger, timeline);
  const has = rows.some((r) => r.own != null || r.glove != null);
  const plotW = Math.max(60, width - M.left - M.right);
  const band = plotW / Math.max(1, rows.length);
  const colW = Math.max(4, Math.min(24, band * 0.62));
  const y = (v: number) => M.top + PLOT_H * (1 - v);
  const last = [...rows].reverse().find((r) => r.own != null);
  const lastIndex = last ? rows.lastIndexOf(last) : -1;
  const ticks =
    rows.length > 2
      ? [0, Math.floor((rows.length - 1) / 2), rows.length - 1]
      : rows.map((_, i) => i);
  // Direct labels for the latest column, kept at least 14px apart.
  let ownLabelY = 0,
    gloveLabelY = 0;
  if (last) {
    ownLabelY = y((last.own ?? 0) / 2);
    gloveLabelY = y((last.own ?? 0) + (last.glove ?? 0) / 2);
    if (ownLabelY - gloveLabelY < 14) gloveLabelY = ownLabelY - 14;
  }
  return (
    <VisualCard
      title={effortTakeaway(rows, finger)}
      hint={`Each column is one session. Active opening in open poses and mean opening the glove completed. ${LEGACY_GLOVE} is muted; directions are compared separately.`}
      label={`${fingerName(finger)}, per session: ${rows
        .map(
          (r) =>
            `${shortDate(r.date)} ${directionLabel(r)} ${pct(r.own)} on your own, ${pct(r.glove)} glove${r.demo ? ' (demo)' : ''}`,
        )
        .join('; ')}.`}
      legend={EFFORT_LEGEND}
      loading={loading}
      empty={!has}
      table={
        <EffortTable
          rows={rows}
          caption={`${fingerName(finger)}: on your own and glove help per session`}
        />
      }
    >
      <div ref={ref} className="viz-measure">
        <svg
          className="viz-svg"
          width={width}
          height={PLOT_H + M.top + M.bottom}
          viewBox={`0 0 ${width} ${PLOT_H + M.top + M.bottom}`}
          aria-hidden="true"
        >
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line
                className="viz-grid"
                x1={M.left}
                x2={M.left + plotW}
                y1={y(t)}
                y2={y(t)}
              />
              <text
                className="viz-tick"
                x={M.left - 6}
                y={y(t)}
                dy={4}
                textAnchor="end"
              >
                {Math.round(t * 100)}%
              </text>
            </g>
          ))}
          {rows.map((r, i) => {
            const cx = M.left + band * (i + 0.5);
            const x = cx - colW / 2;
            const own = r.own ?? 0,
              glove = r.glove ?? 0;
            const ownH = PLOT_H * own;
            const gloveH = Math.max(0, PLOT_H * glove - (ownH > 0 ? 2 : 0));
            const demo = r.demo ? ' viz-demo' : '';
            return (
              <g
                key={r.sessionId}
                className="viz-col"
                data-legacy={directionOf(r) === 'close' || undefined}
              >
                <title>
                  {`${longDate(r.date)} · ${directionLabel(r)}${r.demo ? ' · Demo data' : ''} · On your own ${pct(r.own)} · Glove helped ${pct(r.glove)}`}
                </title>
                <rect
                  className="viz-hit"
                  x={cx - band / 2}
                  y={M.top}
                  width={band}
                  height={PLOT_H}
                />
                {r.own == null && r.glove == null && (
                  <text
                    className="viz-tick"
                    x={cx}
                    y={y(0) - 6}
                    textAnchor="middle"
                  >
                    —
                  </text>
                )}
                {ownH > 0 && (
                  <path
                    className={`viz-own${demo}`}
                    d={
                      gloveH > 0
                        ? `M${x} ${y(own)}h${colW}v${ownH}h${-colW}Z`
                        : roundedTop(x, y(own), colW, ownH)
                    }
                  />
                )}
                {gloveH > 0 && (
                  <path
                    className={`viz-glove${demo}`}
                    d={roundedTop(x, y(own + glove), colW, gloveH)}
                  />
                )}
              </g>
            );
          })}
          {last && (
            <g className="viz-direct">
              <text
                x={M.left + band * (lastIndex + 0.5) + colW / 2 + 6}
                y={ownLabelY}
                dy={4}
              >
                {pct(last.own)} own
              </text>
              {(last.glove ?? 0) > 0.005 && (
                <text
                  x={M.left + band * (lastIndex + 0.5) + colW / 2 + 6}
                  y={gloveLabelY}
                  dy={4}
                >
                  {pct(last.glove)} glove
                </text>
              )}
            </g>
          )}
          {ticks.map((i) => (
            <text
              key={i}
              className="viz-tick"
              x={M.left + band * (i + 0.5)}
              y={M.top + PLOT_H + 17}
              textAnchor="middle"
            >
              {shortDate(rows[i].date)}
            </text>
          ))}
        </svg>
      </div>
    </VisualCard>
  );
}

export function EffortSmallMultiples(props: {
  rom: RomPoint[];
  assist: AssistPoint[];
  timeline?: TimelineEntry[];
  loading?: boolean;
}) {
  return (
    <div className="chart-grid">
      {GLOVE_FINGERS.map((f) => (
        <EffortColumns key={f} finger={f} {...props} />
      ))}
    </div>
  );
}

/** Latest session per finger as one whole: blue (own) + orange (glove) on a 0–100% track. */
export function LatestEffortBars({
  rom,
  assist,
  loading,
  timeline,
}: {
  rom: RomPoint[];
  assist: AssistPoint[];
  /** Sessions from the API: unfinished ones (summary null) are never "the latest". */
  timeline?: (TimelineEntry & { summary?: unknown })[];
  loading?: boolean;
}) {
  // The newest finished session that measured something; a fist-only or unfinished
  // session never blanks the bars. Fingers it did not measure stay "Not measured".
  const { session, rows, note } = latestEffort(
    GLOVE_FINGERS.map((finger) => ({
      finger,
      rows: effortSeries(rom, assist, finger, timeline),
    })),
    timeline,
  );
  const date = session?.date;
  return (
    <VisualCard
      className="effort-latest"
      title={latestEffortTitle(rows)}
      hint={`Latest session${date ? `, ${longDate(date)}` : ''}. Blue: active opening in open poses. Orange: mean opening the glove completed.`}
      note={note}
      label={`Latest session per finger: ${rows
        .map(
          (l) =>
            `${fingerName(l.finger)} ${directionLabel(l.row)} ${pct(l.row?.own)} on your own and ${pct(l.row?.glove)} from the glove`,
        )
        .join('; ')}.`}
      legend={EFFORT_LEGEND}
      loading={loading}
      empty={!date}
      table={
        <table className="data-table">
          <caption>
            Latest session: on your own and glove help by finger
          </caption>
          <thead>
            <tr>
              <th scope="col">Finger</th>
              <th scope="col" className="num">
                On your own
              </th>
              <th scope="col" className="num">
                Glove helped
              </th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ finger, row }) => (
              <tr key={finger}>
                <th scope="row">{fingerName(finger)}</th>
                <td className="num">{pct(row?.own)}</td>
                <td className="num">{pct(row?.glove)}</td>
                <td>
                  {row?.demo ? 'Demo data' : 'Recorded'} · {directionLabel(row)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="effort-bars">
        {rows.map(({ finger, row }) => {
          const own = row?.own ?? 0,
            glove = row?.glove ?? 0;
          return (
            <div
              key={finger}
              className="effort-bars__row"
              data-legacy={directionOf(row) === 'close' || undefined}
            >
              <span className="effort-bars__name">{fingerName(finger)}</span>
              <div
                className={`effort-bars__track${row?.demo ? ' viz-demo' : ''}`}
              >
                {own > 0 && (
                  <span
                    className="effort-bars__seg effort-bars__seg--own"
                    style={{ width: `${own * 100}%` }}
                  >
                    {own >= 0.14 && pct(own)}
                  </span>
                )}
                {glove > 0.005 && (
                  <span
                    className="effort-bars__seg effort-bars__seg--glove"
                    style={{ width: `${glove * 100}%` }}
                  >
                    {glove >= 0.14 && pct(glove)}
                  </span>
                )}
              </div>
              <span className="effort-bars__total">
                {row?.own == null || row?.glove == null
                  ? 'Not measured'
                  : pct(own + glove)}
              </span>
            </div>
          );
        })}
        <div className="effort-bars__row effort-bars__scale" aria-hidden="true">
          <span />
          <span className="effort-bars__ticks">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </span>
          <span className="effort-bars__total">Total</span>
        </div>
      </div>
    </VisualCard>
  );
}
