import { Skeleton, Text, cx } from '../../design-system';
import { useId, useLayoutEffect, useState, type ReactNode } from 'react';

/** Width of a container in CSS px, kept in sync with ResizeObserver. */
export function useWidth<T extends HTMLElement>(fallback = 360) {
  // A callback ref: the measured element can mount later (after a loading state).
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    if (!node) return;
    if (node.clientWidth > 0) setWidth(node.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, width] as const;
}

export interface LegendEntry {
  label: string;
  /** Swatch kind: filled block, hollow block, a dot, a diamond, or a short line. */
  mark: 'block' | 'hollow' | 'dot' | 'diamond' | 'triangle' | 'line';
  color: string;
}

export function VisualLegend({ items }: { items: LegendEntry[] }) {
  return (
    <ul className="chart-legend viz-legend" aria-label="Legend">
      {items.map((item) => (
        <li key={item.label}>
          <svg className="viz-swatch" viewBox="0 0 12 12" aria-hidden="true">
            {item.mark === 'block' && (
              <rect
                x={1}
                y={1}
                width={10}
                height={10}
                rx={2}
                fill={item.color}
              />
            )}
            {item.mark === 'hollow' && (
              <rect
                x={1.5}
                y={1.5}
                width={9}
                height={9}
                rx={2}
                fill="var(--surface)"
                stroke={item.color}
                strokeWidth={1.5}
              />
            )}
            {item.mark === 'dot' && (
              <circle cx={6} cy={6} r={4} fill={item.color} />
            )}
            {item.mark === 'diamond' && (
              <path d="M6 1.5L10.5 6L6 10.5L1.5 6Z" fill={item.color} />
            )}
            {item.mark === 'triangle' && (
              <path d="M6 11L0.5 1.5H11.5Z" fill={item.color} />
            )}
            {item.mark === 'line' && (
              <path d="M0 6H12" stroke={item.color} strokeWidth={2} />
            )}
          </svg>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The frame every custom visual shares with the line charts: takeaway title, a short hint,
 * the figure (role=img with a full description), legend and a "Show as table" twin.
 */
export function VisualCard({
  title,
  hint,
  label,
  legend,
  table,
  loading,
  empty,
  emptyText = 'No measurements recorded yet.',
  className,
  aside,
  note,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  /** Accessible description of the figure. */
  label: string;
  legend?: LegendEntry[];
  table?: ReactNode;
  loading?: boolean;
  empty?: boolean;
  emptyText?: string;
  className?: string;
  aside?: ReactNode;
  /** A short caveat on which records are shown, e.g. an older session than the newest. */
  note?: ReactNode;
  children?: ReactNode;
}) {
  const id = useId().replace(/:/g, '');
  return (
    <article
      className={cx('chart-card viz-card', className)}
      aria-labelledby={`${id}-title`}
    >
      <header className="chart__header">
        <h3 id={`${id}-title`} className="chart__title">
          {title}
        </h3>
        {hint && <p className="chart-hint">{hint}</p>}
        {note && !loading && <p className="chart-hint chart-note">{note}</p>}
      </header>
      {loading ? (
        <div role="status" className="viz-loading">
          <span className="sr-only">Loading chart…</span>
          <Skeleton height="100%" />
        </div>
      ) : empty ? (
        <Text size="small" tone="muted" className="chart__empty">
          {emptyText}
        </Text>
      ) : (
        <>
          <div className="viz-body">
            <div className="viz-figure" role="img" aria-label={label}>
              {children}
            </div>
            {aside}
          </div>
          {legend && legend.length > 0 && <VisualLegend items={legend} />}
          {table && (
            <details className="chart__details">
              <summary>Show as table</summary>
              <div className="data-table-wrap">{table}</div>
            </details>
          )}
        </>
      )}
    </article>
  );
}
