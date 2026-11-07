import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
/** `sm` 36 px (doctor/dense data only) · `md` 48 px (helper, data views) · `lg` 64 px (patient views). */
export type ButtonSize = 'sm' | 'md' | 'lg';

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon before the label. */
  icon?: IconName;
  /** Icon after the label (e.g. a chevron). */
  iconAfter?: IconName;
  /** Stretch to the container width. Use sparingly: wizard footers and narrow columns. */
  block?: boolean;
}

const classes = ({
  variant = 'secondary',
  size = 'md',
  block,
  className,
}: CommonProps & { className?: string }) =>
  cx(
    'ds-button',
    `ds-button--${variant}`,
    `ds-button--${size}`,
    block && 'ds-button--block',
    className,
  );

function Content({
  icon,
  iconAfter,
  loading,
  children,
}: {
  icon?: IconName;
  iconAfter?: IconName;
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      {loading ? (
        <span className="ds-spinner" aria-hidden="true" />
      ) : (
        icon && <Icon name={icon} />
      )}
      {children != null && <span className="ds-button__label">{children}</span>}
      {iconAfter && <Icon name={iconAfter} />}
    </>
  );
}

export interface ButtonProps
  extends CommonProps, ButtonHTMLAttributes<HTMLButtonElement> {
  /** Shows a spinner, sets aria-busy and blocks clicks while keeping focus. */
  loading?: boolean;
}

/**
 * The one button. Exactly one `primary` per view. `danger` is reserved for safety and destructive
 * confirmations (Delete session), never for "End session" or "Stop practice".
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant,
      size,
      icon,
      iconAfter,
      block,
      loading = false,
      className,
      children,
      type = 'button',
      disabled,
      onClick,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={classes({ variant, size, block, className })}
        disabled={disabled}
        aria-busy={loading || undefined}
        aria-disabled={loading || undefined}
        onClick={loading ? (e) => e.preventDefault() : onClick}
        {...rest}
      >
        <Content icon={icon} iconAfter={iconAfter} loading={loading}>
          {children}
        </Content>
      </button>
    );
  },
);

/** A react-router link that looks like a button (navigation, not an action). */
export function ButtonLink({
  variant,
  size,
  icon,
  iconAfter,
  block,
  className,
  children,
  ...rest
}: CommonProps & LinkProps) {
  return (
    <Link className={classes({ variant, size, block, className })} {...rest}>
      <Content icon={icon} iconAfter={iconAfter}>
        {children}
      </Content>
    </Link>
  );
}

/** An external/plain anchor that looks like a button (downloads, exports). */
export function ButtonAnchor({
  variant,
  size,
  icon,
  iconAfter,
  block,
  className,
  children,
  ...rest
}: CommonProps & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={classes({ variant, size, block, className })} {...rest}>
      <Content icon={icon} iconAfter={iconAfter}>
        {children}
      </Content>
    </a>
  );
}

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> {
  icon: IconName;
  /** Required: becomes the accessible name and the tooltip. */
  label: string;
  variant?: Exclude<ButtonVariant, 'primary'>;
  size?: ButtonSize;
}

/** Square icon-only button. Always labelled. Not for patient-critical actions — use a labelled Button there. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      icon,
      label,
      variant = 'quiet',
      size = 'md',
      className,
      type = 'button',
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        className={cx(
          'ds-button',
          'ds-icon-button',
          `ds-button--${variant}`,
          `ds-button--${size}`,
          className,
        )}
        {...rest}
      >
        <Icon name={icon} />
      </button>
    );
  },
);
