import type { TherapyMarker } from '../therapy/data';
import type { AttemptResult, AttemptTrace } from '../../contracts/engine';
import { phaseSegments, type PhaseKind } from './visuals';
import { useWidth, VisualLegend, type LegendEntry } from './VisualCard';

const KIND_LEGEND: Record<PhaseKind, LegendEntry> = {
  active: { label: 'On your own', mark: 'block', color: 'var(--active)' },
  hold: { label: 'Holding', mark: 'block', color: 'var(--reached)' },
  assist: { label: 'Glove helping', mark: 'block', color: 'var(--assist)' },
  assistHold: {
    label: 'Glove holding',
    mark: 'block',
    color: 'color-mix(in oklab, var(--assist) 55%, var(--surface))',
  },
  neutral: {
    label: 'Get ready / release',
    mark: 'block',
    color: 'var(--surface-3)',
  },
  paused: { label: 'Paused', mark: 'hollow', color: 'var(--muted)' },
};

/**
 * The attempt as a horizontal strip of phases on the same time axis as the chart below it.
 * Safety events are red markers above the strip.
 */
export function PhaseStrip({
  trace,
  safety = [],
  therapyMarkers = [],
  padLeft = 36,
  padRight = 12,
}: {
  trace?: AttemptTrace;
  safety?: AttemptResult['safety_events'];
  therapyMarkers?: TherapyMarker[];
  padLeft?: number;
  padRight?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const segments = phaseSegments(trace);
  if (!trace || !segments.length) return null;
  const t0 = trace.t[0],
    t1 = trace.t.at(-1)!;
  const plotW = Math.max(40, width - padLeft - padRight);
  const x = (t: number) =>
    padLeft + ((t - t0) / Math.max(1e-6, t1 - t0)) * plotW;
  const visibleMarkers = therapyMarkers.filter((m) => m.t >= t0 && m.t <= t1);
  const kinds = [...new Set(segments.map((s) => s.kind))];
  const describe = segments
    .map((s) => `${s.label} ${s.start.toFixed(1)}–${s.end.toFixed(1)} s`)
    .join(', ');
  return (
    <div className="phase-strip">
      <div
        ref={ref}
        className="viz-measure"
        role="img"
        aria-label={`Attempt phases: ${describe}.${safety.length ? ` ${safety.length} safety event${safety.length > 1 ? 's' : ''} marked.` : ''}${visibleMarkers.length ? ` Coach timeline: ${visibleMarkers.map((m) => `${m.label} at ${m.t.toFixed(1)} s`).join('; ')}.` : ''}`}
      >
        <svg
          className="viz-svg"
          width={width}
          height={56}
          viewBox={`0 0 ${width} 56`}
          aria-hidden="true"
        >
          {segments.map((s, i) => {
            const x1 = x(s.start) + (i > 0 ? 1 : 0);
            const x2 = x(s.end) - (i < segments.length - 1 ? 1 : 0);
            const w = Math.max(0, x2 - x1);
            const fits = w > s.label.length * 6.6 + 8;
            return (
              <g key={i}>
                <title>{`${s.label}: ${s.start.toFixed(1)} s to ${s.end.toFixed(1)} s`}</title>
                <rect
                  className={`phase phase--${s.kind}`}
                  x={x1}
                  y={14}
                  width={w}
                  height={18}
                  rx={4}
                />
                {fits && (
                  <text className="viz-tick phase-label" x={x1 + 2} y={48}>
                    {s.label}
                  </text>
                )}
              </g>
            );
          })}
          {visibleMarkers.map((marker, i) => (
            <g key={`therapy-${i}`} transform={`translate(${x(marker.t)} 8)`}>
              <title>{`${marker.label} at ${marker.t.toFixed(1)} s`}</title>
              {marker.kind === 'decision' ? (
                <circle r={4} fill="var(--accent)" />
              ) : (
                <path d="M0 -5L5 0L0 5L-5 0Z" fill="var(--muted)" />
              )}
              <line
                y1={5}
                y2={24}
                stroke={
                  marker.kind === 'decision' ? 'var(--accent)' : 'var(--muted)'
                }
                strokeDasharray="2 2"
              />
            </g>
          ))}
          {safety.map((e, i) => (
            <g
              key={i}
              transform={`translate(${x(Math.min(t1, Math.max(t0, e.t_rel)))} 8)`}
            >
              <title>{`${e.source === 'load_shed' ? 'Eased off to protect the glove' : `Safety: ${e.source.replaceAll('_', ' ')}`} at ${e.t_rel.toFixed(1)} s`}</title>
              <path
                className="safety-marker"
                style={
                  e.source === 'load_shed'
                    ? { fill: 'var(--caution)' }
                    : undefined
                }
                d="M0 6L-5.5 -3.5H5.5Z"
              />
              <line
                className="safety-marker__line"
                style={
                  e.source === 'load_shed'
                    ? { stroke: 'var(--caution)' }
                    : undefined
                }
                x1={0}
                x2={0}
                y1={6}
                y2={24}
              />
            </g>
          ))}
        </svg>
      </div>
      <VisualLegend
        items={[
          ...kinds.map((k) => KIND_LEGEND[k]),
          ...(visibleMarkers.some((m) => m.kind === 'decision')
            ? [
                {
                  label: 'Coach decision',
                  mark: 'dot' as const,
                  color: 'var(--accent)',
                },
              ]
            : []),
          ...(visibleMarkers.some((m) => m.kind === 'feeling')
            ? [
                {
                  label: 'Feeling check-in',
                  mark: 'diamond' as const,
                  color: 'var(--muted)',
                },
              ]
            : []),
          ...(safety.some((e) => e.source === 'load_shed')
            ? [
                {
                  label: 'Eased off to protect the glove',
                  mark: 'triangle' as const,
                  color: 'var(--caution)',
                },
              ]
            : []),
          ...(safety.some((e) => e.source !== 'load_shed')
            ? [
                {
                  label: 'Safety event',
                  mark: 'triangle' as const,
                  color: 'var(--danger)',
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
