import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Badge } from './Badge';
import { cx } from './cx';

/**
 * One number with its label. `delta` follows spec §5.5: improvement is green ▲, decline is muted ▼,
 * never red. Mark estimates and demo data honestly.
 */
export function KpiTile({
  label,
  value,
  unit,
  delta,
  deltaLabel,
  better = 'up',
  hint,
  icon,
  demo,
  size = 'md',
  className,
}: {
  label: ReactNode;
  /** Pre-formatted value; use "—" for missing data, never 0. */
  value: ReactNode;
  unit?: ReactNode;
  /** Signed change in display units (e.g. +15 for +15 points). */
  delta?: number;
  /** e.g. "vs last time" */
  deltaLabel?: ReactNode;
  /** Which direction is good for this metric. */
  better?: 'up' | 'down';
  hint?: ReactNode;
  icon?: IconName;
  demo?: boolean;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const improved =
    delta !== undefined && delta !== 0 && delta > 0 === (better === 'up');
  return (
    <div className={cx('ds-kpi', `ds-kpi--${size}`, className)}>
      <div className="ds-kpi__label">
        {icon && <Icon name={icon} size="1.1em" />}
        <span>{label}</span>
        {demo && <Badge tone="demo">Demo</Badge>}
      </div>
      <div className="ds-kpi__value">
        {value}
        {unit && <span className="ds-kpi__unit">{unit}</span>}
      </div>
      {delta !== undefined && (
        <div
          className={cx(
            'ds-kpi__delta',
            improved ? 'ds-tone--reached' : 'ds-tone--muted',
          )}
        >
          <span aria-hidden="true">
            {delta > 0 ? '▲' : delta < 0 ? '▼' : '•'}
          </span>
          <span>
            {delta > 0 ? '+' : ''}
            {delta}
          </span>
          {deltaLabel && (
            <span className="ds-kpi__delta-label">{deltaLabel}</span>
          )}
          <span className="sr-only">
            {improved ? '(better)' : delta === 0 ? '(no change)' : ''}
          </span>
        </div>
      )}
      {hint && <div className="ds-kpi__hint">{hint}</div>}
    </div>
  );
}

/** Nothing here yet: an icon, one sentence on why, and the one action that fixes it. */
export function EmptyState({
  icon = 'chart',
  title,
  children,
  action,
  className,
}: {
  icon?: IconName;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('ds-empty', className)}>
      <span className="ds-empty__icon">
        <Icon name={icon} size={28} />
      </span>
      <strong className="ds-empty__title">{title}</strong>
      {children && <p className="ds-empty__body">{children}</p>}
      {action && <div className="ds-empty__action">{action}</div>}
    </div>
  );
}

/** Loading placeholder. Prefer it over spinners for content areas; it keeps the layout still. */
export function Skeleton({
  width = '100%',
  height = '1em',
  radius = 'var(--radius-sm)',
  lines,
  className,
}: {
  width?: string | number;
  height?: string | number;
  radius?: string;
  /** Render N text lines (last one shorter). */
  lines?: number;
  className?: string;
}) {
  if (lines)
    return (
      <span className={cx('ds-skeleton-lines', className)} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            className="ds-skeleton"
            style={{ width: i === lines - 1 ? '60%' : '100%', height: '0.9em' }}
          />
        ))}
      </span>
    );
  return (
    <span
      aria-hidden="true"
      className={cx('ds-skeleton', className)}
      style={{ width, height, borderRadius: radius } as CSSProperties}
    />
  );
}

/** Label/value rows (profile, evaluation settings). */
export function DescriptionList({
  items,
  className,
}: {
  items: { label: ReactNode; value: ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cx('ds-dl', className)}>
      {items.map((item, i) => (
        <div key={i} className="ds-dl__row">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
