import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';

/**
 * Status tones. Each one means exactly one thing (see DESIGN_SYSTEM.md "Color meaning"):
 * neutral · info (accent) · active (moving on your own) · assist (glove helping) · reached ·
 * danger (safety only) · demo (demo data) · caution (heads-up, not safety) · off (not connected / idle).
 */
export type StatusTone =
  | 'neutral'
  | 'info'
  | 'active'
  | 'assist'
  | 'reached'
  | 'danger'
  | 'demo'
  | 'caution'
  | 'off';

/** A small colored dot. Decorative: always pair it with a word. */
export function StatusDot({
  tone = 'neutral',
  pulse = false,
  className,
}: {
  tone?: StatusTone;
  /** Gentle pulse for "live" states. Disabled under reduced motion. */
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'ds-dot',
        `ds-dot--${tone}`,
        pulse && 'ds-dot--pulse',
        className,
      )}
    />
  );
}

/** Static label: "Demo data", "Estimate", "Aborted at 30%". Not interactive. */
export function Badge({
  tone = 'neutral',
  icon,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: StatusTone; icon?: IconName }) {
  return (
    <span className={cx('ds-badge', `ds-badge--${tone}`, className)} {...rest}>
      {icon && <Icon name={icon} size="1em" />}
      {children}
    </span>
  );
}

/** The demo-data badge. Use it wherever demo records can appear (spec §6.3). */
export function DemoBadge({
  children = 'Demo data',
}: {
  children?: ReactNode;
}) {
  return <Badge tone="demo">{children}</Badge>;
}

/**
 * Dot + word status for system things (glove, camera, voice). Lives in the header and in Setup.
 * Example: <StatusChip tone="reached" label="Glove" value="Ready" />
 */
export function StatusChip({
  tone = 'neutral',
  label,
  value,
  icon,
  detail,
  pulse,
  className,
}: {
  tone?: StatusTone;
  /** The thing: "Glove", "Camera". */
  label: ReactNode;
  /** Its state in a word or two: "Ready", "Helping", "Not connected". */
  value: ReactNode;
  icon?: IconName;
  /** Extra detail shown as a tooltip (e.g. firmware, latency). */
  detail?: string;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cx('ds-status-chip', `ds-status-chip--${tone}`, className)}
      title={detail}
    >
      {icon ? (
        <Icon name={icon} size="1.1em" className="ds-status-chip__icon" />
      ) : null}
      <StatusDot tone={tone} pulse={pulse} />
      <span className="ds-status-chip__label">{label}:</span>{' '}
      <strong className="ds-status-chip__value">{value}</strong>
    </span>
  );
}

/**
 * A toggle chip for choosing between presets or filters (aria-pressed). For mutually exclusive
 * views use Tabs; for settings use Switch/Checkbox.
 */
export function Pill({
  selected = false,
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
  icon?: IconName;
}) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cx('ds-pill', selected && 'ds-pill--selected', className)}
      {...rest}
    >
      {selected ? (
        <Icon name="check" size="1em" />
      ) : (
        icon && <Icon name={icon} size="1em" />
      )}
      {children}
    </button>
  );
}
