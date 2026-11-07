import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type CardTone =
  'default' | 'inset' | 'demo' | 'assist' | 'reached' | 'caution';

/**
 * A surface that groups one topic. `inset` sits flat on --surface-2 (inside other cards, chart wells).
 * `demo` marks simulator/demo content with the purple edge. Don't nest default cards inside default cards.
 */
export function Card({
  as: As = 'section',
  tone = 'default',
  padding = 'md',
  title,
  titleLevel = 2,
  description,
  actions,
  footer,
  className,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  as?: ElementType;
  tone?: CardTone;
  padding?: 'sm' | 'md' | 'lg';
  title?: ReactNode;
  titleLevel?: 2 | 3 | 4;
  description?: ReactNode;
  /** Small actions in the card header (quiet buttons, links). */
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  const H = `h${titleLevel}` as ElementType;
  return (
    <As
      className={cx(
        'ds-card',
        `ds-card--${tone}`,
        `ds-card--pad-${padding}`,
        className,
      )}
      {...rest}
    >
      {(title || actions) && (
        <header className="ds-card__header">
          <div className="ds-card__titles">
            {title && <H className="ds-card__title">{title}</H>}
            {description && (
              <p className="ds-card__description">{description}</p>
            )}
          </div>
          {actions && <div className="ds-card__actions">{actions}</div>}
        </header>
      )}
      {children}
      {footer && <footer className="ds-card__footer">{footer}</footer>}
    </As>
  );
}
