import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Button, type ButtonVariant } from './Button';
import { IconButton } from './Button';
import { cx } from './cx';

/**
 * Modal dialog on the native <dialog> element: focus is trapped by the browser, Escape closes,
 * focus returns to the opener on close. Keep it short: a title that is a question, one sentence,
 * two buttons. The safe choice is the default focus.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'sm',
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      const auto = dialog.querySelector<HTMLElement>(
        '[autofocus],[data-autofocus]',
      );
      (
        auto ??
        dialog.querySelector<HTMLElement>(
          'button, [href], input, select, textarea',
        )
      )?.focus();
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      (opener.current as HTMLElement | null)?.focus?.();
    }
  }, [open]);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };
  return (
    <dialog
      ref={ref}
      className={cx('ds-dialog', `ds-dialog--${size}`, className)}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-desc` : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="ds-dialog__body">
          <div className="ds-dialog__header">
            <h2 id={`${id}-title`} className="ds-dialog__title">
              {title}
            </h2>
            <IconButton icon="x" label="Close" size="sm" onClick={onClose} />
          </div>
          {description && (
            <p id={`${id}-desc`} className="ds-dialog__description">
              {description}
            </p>
          )}
          {children}
          {footer && <div className="ds-dialog__footer">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** Two-button confirmation. The cancel ("keep going") button gets initial focus. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  size = 'md',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  /** `danger` only for destructive actions (delete). Ending a session is `primary`. */
  confirmVariant?: Extract<ButtonVariant, 'primary' | 'danger'>;
  size?: 'md' | 'lg';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      footer={
        <>
          <Button size={size} data-autofocus onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button size={size} variant={confirmVariant} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
