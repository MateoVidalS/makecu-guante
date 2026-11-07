import type {
  CSSProperties,
  ElementType,
  HTMLAttributes,
  ReactNode,
} from 'react';
import { cx } from './cx';

export type Space = 0 | 4 | 8 | 12 | 16 | 24 | 32 | 48 | 64;
const space = (s: Space) => (s === 0 ? '0' : `var(--space-${s})`);

interface BoxProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  gap?: Space;
  children?: ReactNode;
}

/** Vertical rhythm. Children get no outer margins; spacing comes from `gap` only. */
export function Stack({
  as: As = 'div',
  gap = 16,
  align,
  className,
  style,
  ...rest
}: BoxProps & { align?: 'start' | 'center' | 'end' | 'stretch' }) {
  return (
    <As
      className={cx('ds-stack', className)}
      style={
        { '--gap': space(gap), alignItems: align, ...style } as CSSProperties
      }
      {...rest}
    />
  );
}

/** Horizontal row that wraps. Use for button groups, chips, label + value pairs. */
export function Inline({
  as: As = 'div',
  gap = 12,
  align = 'center',
  justify,
  wrap = true,
  className,
  style,
  ...rest
}: BoxProps & {
  align?: 'start' | 'center' | 'end' | 'baseline' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between';
  wrap?: boolean;
}) {
  return (
    <As
      className={cx('ds-inline', className)}
      style={
        {
          '--gap': space(gap),
          alignItems: align,
          justifyContent: justify === 'between' ? 'space-between' : justify,
          flexWrap: wrap ? 'wrap' : 'nowrap',
          ...style,
        } as CSSProperties
      }
      {...rest}
    />
  );
}

/**
 * Responsive grid. `min` is the smallest column width before it wraps (auto-fit), or pass a fixed
 * `columns` count. Columns collapse to one below 720 px either way.
 */
export function Grid({
  as: As = 'div',
  gap = 24,
  min,
  columns,
  className,
  style,
  ...rest
}: BoxProps & { min?: string; columns?: number }) {
  const template = columns
    ? `repeat(${columns}, minmax(0, 1fr))`
    : `repeat(auto-fit, minmax(min(${min ?? '16rem'}, 100%), 1fr))`;
  return (
    <As
      className={cx('ds-grid', className)}
      style={
        { '--gap': space(gap), '--cols': template, ...style } as CSSProperties
      }
      {...rest}
    />
  );
}

/** Page header: title, optional lead text, optional actions on the right. One per page. */
export function PageHeader({
  title,
  lead,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="ds-page-header">
      <div className="ds-page-header__text">
        {eyebrow && <div className="ds-eyebrow">{eyebrow}</div>}
        <h1 className="ds-h1">{title}</h1>
        {lead && <p className="ds-lead">{lead}</p>}
      </div>
      {actions && <div className="ds-page-header__actions">{actions}</div>}
    </div>
  );
}
