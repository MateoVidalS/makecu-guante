import type { ElementType, HTMLAttributes } from 'react';
import { cx } from './cx';

export type HeadingSize = 'display' | 'h1' | 'h2' | 'h3';
export type HeadingLevel = 1 | 2 | 3 | 4;

/**
 * Semantic level and visual size are separate: pick `level` from the document outline and `size`
 * from the design. E.g. a card title is usually `level={2} size="h3"`.
 */
export function Heading({
  level = 2,
  size,
  className,
  ...rest
}: HTMLAttributes<HTMLHeadingElement> & {
  level?: HeadingLevel;
  size?: HeadingSize;
}) {
  const Tag = `h${level}` as ElementType;
  const visual = size ?? (level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3');
  return (
    <Tag className={cx('ds-heading', `ds-${visual}`, className)} {...rest} />
  );
}

export type TextSize = 'lead' | 'body' | 'small' | 'caption';
export type TextTone =
  | 'default'
  | 'muted'
  | 'active'
  | 'assist'
  | 'reached'
  | 'danger'
  | 'demo'
  | 'caution';

/**
 * Body copy. `caption` is for charts and the doctor view only (spec §3.2) — never in patient views.
 * `tone="danger"` is for safety text only.
 */
export function Text({
  as: As = 'p',
  size = 'body',
  tone = 'default',
  weight,
  numeric,
  className,
  ...rest
}: HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  size?: TextSize;
  tone?: TextTone;
  weight?: 'regular' | 'bold';
  /** Tabular numbers (already the body default); kept for inline spans inside proportional text. */
  numeric?: boolean;
}) {
  return (
    <As
      className={cx(
        'ds-text',
        `ds-text--${size}`,
        tone !== 'default' && `ds-tone--${tone}`,
        weight === 'bold' && 'ds-text--bold',
        numeric && 'ds-text--numeric',
        className,
      )}
      {...rest}
    />
  );
}

/** Visually hidden text for screen readers. */
export function VisuallyHidden({
  as: As = 'span',
  ...rest
}: HTMLAttributes<HTMLElement> & { as?: ElementType }) {
  return <As className="sr-only" {...rest} />;
}
