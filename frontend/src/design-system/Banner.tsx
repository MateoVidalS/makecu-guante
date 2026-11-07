import { useEffect, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { IconButton } from './Button';
import { cx } from './cx';

export type BannerTone = 'info' | 'warning' | 'demo' | 'safety';

const icons: Record<BannerTone, IconName> = {
  info: 'info',
  warning: 'caution',
  demo: 'monitor',
  safety: 'safety',
};

/**
 * Page-level message.
 * - `info`: neutral context ("Your progress stays here if you leave").
 * - `warning`: a heads-up that is NOT a safety event (live coach unavailable, calibration is old).
 *   Also the persistent "Keep the hand relaxed" strip on glove-moving steps.
 * - `demo`: simulator / demo data notice.
 * - `safety`: the ONLY red, full-width banner. role="alert", moves focus to its action
 *   (Resume) when it appears. Never use it for anything that is not a safety stop.
 */
export function Banner({
  tone = 'info',
  title,
  children,
  action,
  details,
  detailsLabel = 'What happened?',
  onDismiss,
  focusAction = tone === 'safety',
  icon,
  className,
}: {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  /** One action. For safety: the Resume button (use <Button variant="secondary"> — it is styled white on red). */
  action?: ReactNode;
  /** Technical detail for the helper, in a disclosure. */
  details?: ReactNode;
  detailsLabel?: string;
  /** Not allowed on safety banners (they clear when the condition clears). */
  onDismiss?: () => void;
  focusAction?: boolean;
  icon?: IconName;
  className?: string;
}) {
  const actionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusAction)
      actionRef.current?.querySelector<HTMLElement>('button, a')?.focus();
  }, [focusAction]);
  return (
    <div
      className={cx('ds-banner', `ds-banner--${tone}`, className)}
      role={
        tone === 'safety'
          ? 'alert'
          : tone === 'info' || tone === 'demo'
            ? 'status'
            : undefined
      }
    >
      <span className="ds-banner__icon">
        <Icon name={icon ?? icons[tone]} />
      </span>
      <div className="ds-banner__text">
        {title && <strong className="ds-banner__title">{title}</strong>}
        {children && <div className="ds-banner__body">{children}</div>}
        {details && (
          <details className="ds-banner__details">
            <summary>{detailsLabel}</summary>
            <div>{details}</div>
          </details>
        )}
      </div>
      {action && (
        <div className="ds-banner__action" ref={actionRef}>
          {action}
        </div>
      )}
      {onDismiss && tone !== 'safety' && (
        <IconButton icon="x" label="Dismiss" size="sm" onClick={onDismiss} />
      )}
    </div>
  );
}
