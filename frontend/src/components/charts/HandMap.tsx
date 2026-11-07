import { useId, type ReactNode } from 'react';
import { GLOVE_FINGERS, type GloveFinger } from '../../contracts/glove';
import type { HandValue, HandValues } from './visuals';
import { VisualCard, type LegendEntry } from './VisualCard';

type FingerKey = GloveFinger;
interface Geometry {
  x: number;
  y: number;
  /** Degrees, clockwise from straight up. */
  angle: number;
  length: number;
  width: number;
}
/** A right hand, palm toward the viewer, thumb on the left. */
const FINGERS: Record<FingerKey, Geometry> = {
  thumb: { x: 70, y: 180, angle: -50, length: 72, width: 25 },
  index: { x: 76, y: 122, angle: -8, length: 88, width: 23 },
  middle: { x: 102, y: 118, angle: -1, length: 98, width: 23 },
  ring: { x: 127, y: 120, angle: 5, length: 90, width: 22 },
  pinky: { x: 151, y: 128, angle: 12, length: 70, width: 20 },
};
const CENTER = 113;
const PALM =
  'M82 114 H144 Q168 116 167 144 L162 194 Q158 216 136 218 H90 Q68 216 64 194 L59 146 Q58 116 82 114 Z';
const WRIST = 'M88 208 H138 Q141 230 139 252 H87 Q85 230 88 208 Z';
const pct = (v: number | null | undefined) =>
  v == null ? 'Not measured' : `${Math.round(v * 100)}%`;
const fingerName = (f: string) => f.charAt(0).toUpperCase() + f.slice(1);

function place(g: Geometry, mirror: boolean): Geometry {
  return mirror ? { ...g, x: 2 * CENTER - g.x, angle: -g.angle } : g;
}
function along(g: Geometry, distance: number) {
  const a = (g.angle * Math.PI) / 180;
  return { x: g.x + distance * Math.sin(a), y: g.y - distance * Math.cos(a) };
}

/** One hand drawing. Each glove finger is a gauge from knuckle (0%) to tip (100% closed). */
export function HandFigure({
  values,
  mirror = false,
  demo = false,
  caption,
  width = 200,
}: {
  values: HandValues;
  mirror?: boolean;
  demo?: boolean;
  caption?: ReactNode;
  width?: number;
}) {
  const id = useId().replace(/:/g, '');
  const glove = (f: GloveFinger) => {
    const g = place(FINGERS[f], mirror);
    const v: HandValue = values[f] ?? { own: null };
    const L = g.length,
      W = g.width;
    const own = Math.max(0, Math.min(1, v.own ?? 0)) * L;
    const help = Math.max(0, v.glove ?? 0) * L;
    const gap = own > 0 && help > 0 ? 2 : 0;
    const label = along(g, L + 13);
    return (
      <g key={f} className={`hand-finger hand-finger--${f}`}>
        <title>
          {`${fingerName(f)}: ${pct(v.own)} on your own${v.glove != null ? `, glove added ${pct(v.glove)}` : ''}${v.target != null ? `, target ${pct(v.target)}` : ''}`}
        </title>
        <g transform={`translate(${g.x} ${g.y}) rotate(${g.angle})`}>
          <clipPath id={`${id}-${f}`}>
            <rect x={-W / 2} y={-L} width={W} height={L + 16} rx={W / 2} />
          </clipPath>
          <rect
            className="hand-track"
            x={-W / 2}
            y={-L}
            width={W}
            height={L + 16}
            rx={W / 2}
          />
          <g clipPath={`url(#${id}-${f})`}>
            {own > 0 && (
              <rect
                className={demo ? 'hand-own hand-own--demo' : 'hand-own'}
                x={-W / 2}
                y={-own}
                width={W}
                height={own + 16}
              />
            )}
            {help > gap && (
              <rect
                className={demo ? 'hand-glove hand-glove--demo' : 'hand-glove'}
                x={-W / 2}
                y={-own - help}
                width={W}
                height={help - gap}
              />
            )}
          </g>
          {v.target != null && (
            <path
              className="hand-target"
              d={`M${-W / 2 - 4} ${-v.target * L}H${W / 2 + 4}`}
            />
          )}
        </g>
        <text
          className="hand-value"
          x={label.x}
          y={label.y}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {pct(v.own)}
        </text>
      </g>
    );
  };
  const flip = mirror ? `translate(${2 * CENTER} 0) scale(-1 1)` : undefined;
  return (
    <figure className="hand-figure" style={{ width }}>
      <svg viewBox="-26 -10 278 264" aria-hidden="true">
        <g className="hand-palm" transform={flip}>
          <path d={WRIST} className="hand-wrist" />
        </g>
        {GLOVE_FINGERS.map(glove)}
        <g className="hand-palm" transform={flip}>
          <path d={PALM} />
        </g>
      </svg>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

const OWN: LegendEntry = {
  label: 'On your own',
  mark: 'block',
  color: 'var(--active)',
};
const GLOVE: LegendEntry = {
  label: 'Glove helped',
  mark: 'block',
  color: 'var(--assist)',
};

/** First session next to the latest: each glove finger filled as far as it closed on its own. */
export function HandRangeMap({
  first,
  last,
  firstDemo,
  lastDemo,
  mirror,
  loading,
  firstDate,
  lastDate,
  compact,
}: {
  first: HandValues;
  last: HandValues;
  firstDemo?: boolean;
  lastDemo?: boolean;
  mirror?: boolean;
  loading?: boolean;
  firstDate?: string;
  lastDate?: string;
  compact?: boolean;
}) {
  const has = GLOVE_FINGERS.some(
    (f) => first[f]?.own != null || last[f]?.own != null,
  );
  const gains = GLOVE_FINGERS.flatMap((f) =>
    first[f]?.own != null && last[f]?.own != null
      ? [Math.round(last[f]!.own! * 100) - Math.round(first[f]!.own! * 100)]
      : [],
  );
  const title =
    gains.length && gains.every((g) => g > 0)
      ? 'Every glove finger closes further on its own'
      : gains.some((g) => g > 0)
        ? 'Some fingers close further on their own'
        : 'How far each finger closes on its own';
  const size = compact ? 150 : 230;
  return (
    <VisualCard
      className="hand-map"
      title={title}
      hint="Each finger fills from the knuckle (0%) to the tip (fully closed). Higher is better."
      label={`Hand map, first session compared with the latest. ${GLOVE_FINGERS.map(
        (f) =>
          `${fingerName(f)} ${pct(first[f]?.own)} then, ${pct(last[f]?.own)} now`,
      ).join('; ')}.`}
      loading={loading}
      empty={!has}
      legend={[
        OWN,
        {
          label: 'Not measured',
          mark: 'hollow',
          color: 'var(--border-strong)',
        },
      ]}
      aside={
        <ul className="hand-deltas">
          {GLOVE_FINGERS.map((f) => {
            const a = first[f]?.own,
              b = last[f]?.own;
            const d =
              a != null && b != null
                ? Math.round(b * 100) - Math.round(a * 100)
                : null;
            return (
              <li key={f}>
                <span className="hand-deltas__name">{fingerName(f)}</span>
                <span className="hand-deltas__value">{`${pct(a)} → ${pct(b)}`}</span>
                <span className="hand-deltas__change">
                  {d == null
                    ? '—'
                    : d > 0
                      ? `▲ ${d} points (better)`
                      : d < 0
                        ? `▼ ${-d} points`
                        : 'No change'}
                </span>
              </li>
            );
          })}
        </ul>
      }
      table={
        <table className="data-table">
          <caption>Best closure on your own, first and latest session</caption>
          <thead>
            <tr>
              <th scope="col">Finger</th>
              <th scope="col" className="num">
                First session
              </th>
              <th scope="col" className="num">
                Latest session
              </th>
            </tr>
          </thead>
          <tbody>
            {GLOVE_FINGERS.map((f) => (
              <tr key={f}>
                <th scope="row">{fingerName(f)}</th>
                <td className="num">{pct(first[f]?.own)}</td>
                <td className="num">{pct(last[f]?.own)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="hand-pair">
        <HandFigure
          values={first}
          mirror={mirror}
          demo={firstDemo}
          width={size}
          caption={
            <>
              <strong>Then</strong>
              {firstDate && <span>{firstDate}</span>}
            </>
          }
        />
        <svg
          className="hand-pair__arrow"
          viewBox="0 0 24 12"
          aria-hidden="true"
        >
          <path d="M1 6H21M16 1L21 6L16 11" />
        </svg>
        <HandFigure
          values={last}
          mirror={mirror}
          demo={lastDemo}
          width={size}
          caption={
            <>
              <strong>Now</strong>
              {lastDate && <span>{lastDate}</span>}
            </>
          }
        />
      </div>
    </VisualCard>
  );
}

/** Small hand for one attempt: own effort, what the glove added, and the target notch. */
export function AttemptHand({
  values,
  demo,
  mirror,
}: {
  values: HandValues;
  demo?: boolean;
  mirror?: boolean;
}) {
  return (
    <div className="attempt-hand">
      <div
        role="img"
        aria-label={`Hand map for this attempt. ${GLOVE_FINGERS.filter(
          (f) => values[f],
        )
          .map(
            (f) =>
              `${fingerName(f)}: ${pct(values[f]?.own)} on your own, glove added ${pct(values[f]?.glove)}, target ${pct(values[f]?.target)}`,
          )
          .join('; ')}.`}
      >
        <HandFigure values={values} demo={demo} mirror={mirror} width={230} />
      </div>
      <ul
        className="chart-legend viz-legend attempt-hand__legend"
        aria-label="Legend"
      >
        <li>
          <svg className="viz-swatch" viewBox="0 0 12 12" aria-hidden="true">
            <rect
              x={1}
              y={1}
              width={10}
              height={10}
              rx={2}
              fill="var(--active)"
            />
          </svg>
          {OWN.label}
        </li>
        <li>
          <svg className="viz-swatch" viewBox="0 0 12 12" aria-hidden="true">
            <rect
              x={1}
              y={1}
              width={10}
              height={10}
              rx={2}
              fill="var(--assist)"
            />
          </svg>
          {GLOVE.label}
        </li>
        <li>
          <svg className="viz-swatch" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M0 6H12" stroke="var(--text)" strokeWidth={2} />
          </svg>
          Target
        </li>
      </ul>
    </div>
  );
}

export const HAND_LEGEND = { OWN, GLOVE };
