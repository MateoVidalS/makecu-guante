import {
  forwardRef,
  useId,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { Icon } from './Icon';
import { cx } from './cx';

interface FieldIds {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export interface FieldProps {
  label: ReactNode;
  /** Short help under the label. */
  hint?: ReactNode;
  /** Validation message; also sets aria-invalid on the control. Say how to fix it. */
  error?: ReactNode;
  /** Visually hide the label (still read by screen readers). Rarely right. */
  hideLabel?: boolean;
  /** `inline` puts the label left of a short control (doctor/settings rows). */
  layout?: 'stacked' | 'inline';
  className?: string;
}

/**
 * Label + hint + error around any control. For custom controls use the render prop:
 * <Field label="Reps">{(ids) => <MyStepper {...ids} />}</Field>
 */
export function Field({
  label,
  hint,
  error,
  hideLabel,
  layout = 'stacked',
  className,
  id: given,
  children,
}: FieldProps & { id?: string; children: (ids: FieldIds) => ReactNode }) {
  const auto = useId();
  const id = given ?? auto;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div
      className={cx(
        'ds-field',
        `ds-field--${layout}`,
        error != null && error !== false && 'ds-field--error',
        className,
      )}
    >
      <label
        htmlFor={id}
        className={cx('ds-field__label', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      {hint && (
        <p id={hintId} className="ds-field__hint">
          {hint}
        </p>
      )}
      <div className="ds-field__control">
        {children({
          id,
          'aria-describedby': describedBy,
          'aria-invalid': error ? true : undefined,
        })}
      </div>
      {error && (
        <p id={errorId} className="ds-field__error">
          <Icon name="info" size="1em" /> {error}
        </p>
      )}
    </div>
  );
}

type Size = 'md' | 'lg';

export const Input = forwardRef<
  HTMLInputElement,
  FieldProps &
    Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
      size?: Size;
      suffix?: ReactNode;
    }
>(function Input(
  {
    label,
    hint,
    error,
    hideLabel,
    layout,
    className,
    size = 'md',
    suffix,
    id,
    ...rest
  },
  ref,
) {
  return (
    <Field {...{ label, hint, error, hideLabel, layout, className, id }}>
      {(ids) => (
        <span
          className={cx(
            'ds-input-wrap',
            suffix != null && 'ds-input-wrap--suffix',
          )}
        >
          <input
            ref={ref}
            className={cx('ds-input', `ds-input--${size}`)}
            {...ids}
            {...rest}
          />
          {suffix != null && <span className="ds-input__suffix">{suffix}</span>}
        </span>
      )}
    </Field>
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  FieldProps &
    Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
      size?: Size;
      options?: { value: string; label: ReactNode; disabled?: boolean }[];
    }
>(function Select(
  {
    label,
    hint,
    error,
    hideLabel,
    layout,
    className,
    size = 'md',
    options,
    children,
    id,
    ...rest
  },
  ref,
) {
  return (
    <Field {...{ label, hint, error, hideLabel, layout, className, id }}>
      {(ids) => (
        <span className="ds-select-wrap">
          <select
            ref={ref}
            className={cx('ds-input', 'ds-select', `ds-input--${size}`)}
            {...ids}
            {...rest}
          >
            {options?.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
            {children}
          </select>
          <Icon name="chevron-down" className="ds-select__chevron" />
        </span>
      )}
    </Field>
  );
});

/**
 * Range slider with a visible value. `format` renders the value (e.g. v => `${v}°`).
 * For servo jogging pair it with ±1/±5 Buttons; never rely on drag alone.
 */
export const Slider = forwardRef<
  HTMLInputElement,
  FieldProps &
    Omit<
      InputHTMLAttributes<HTMLInputElement>,
      'type' | 'value' | 'onChange'
    > & {
      value: number;
      onValueChange: (value: number) => void;
      format?: (value: number) => ReactNode;
    }
>(function Slider(
  {
    label,
    hint,
    error,
    hideLabel,
    layout,
    className,
    value,
    onValueChange,
    format,
    min = 0,
    max = 100,
    step = 1,
    id,
    ...rest
  },
  ref,
) {
  const pct = ((value - Number(min)) / (Number(max) - Number(min) || 1)) * 100;
  return (
    <Field {...{ label, hint, error, hideLabel, layout, className, id }}>
      {(ids) => (
        <span className="ds-slider">
          <input
            ref={ref}
            type="range"
            className="ds-slider__input"
            min={min}
            max={max}
            step={step}
            value={value}
            aria-valuetext={format ? String(format(value)) : undefined}
            style={{ '--fill': `${pct}%` } as CSSProperties}
            onChange={(e) => onValueChange(Number(e.target.value))}
            {...ids}
            {...rest}
          />
          <output htmlFor={ids.id} className="ds-slider__value">
            {format ? format(value) : value}
          </output>
        </span>
      )}
    </Field>
  );
});

/** On/off setting that applies immediately (role="switch"). For form choices submitted later, use Checkbox. */
export function Switch({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cx('ds-switch-row', className)}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={hint ? `${id}-hint` : undefined}
        disabled={disabled}
        className="ds-switch"
        onClick={() => onCheckedChange(!checked)}
      >
        <span className="ds-switch__thumb" aria-hidden="true" />
      </button>
      <span className="ds-switch-row__text">
        <label htmlFor={id} className="ds-switch-row__label">
          {label}
        </label>
        {hint && (
          <span id={`${id}-hint`} className="ds-field__hint">
            {hint}
          </span>
        )}
      </span>
    </div>
  );
}

/** Native checkbox with a large, clear box and the whole row clickable. `lg` for patient checklists. */
export const Checkbox = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
    label: ReactNode;
    hint?: ReactNode;
    size?: Size;
  }
>(function Checkbox(
  { label, hint, size = 'md', className, id: given, ...rest },
  ref,
) {
  const auto = useId();
  const id = given ?? auto;
  return (
    <div className={cx('ds-checkbox', `ds-checkbox--${size}`, className)}>
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className="ds-checkbox__input"
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...rest}
      />
      <span className="ds-checkbox__box" aria-hidden="true">
        <Icon name="check" size="0.9em" />
      </span>
      <span className="ds-checkbox__text">
        <label htmlFor={id} className="ds-checkbox__label">
          {label}
        </label>
        {hint && (
          <span id={`${id}-hint`} className="ds-field__hint">
            {hint}
          </span>
        )}
      </span>
    </div>
  );
});
