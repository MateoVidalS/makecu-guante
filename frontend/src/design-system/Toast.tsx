import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './Icon';
import { IconButton } from './Button';
import { cx } from './cx';

export type ToastTone = 'neutral' | 'reached' | 'assist' | 'caution' | 'danger';

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** ms before it hides; 0 keeps it until dismissed. Default 5000 (4000 for attempt feedback). */
  duration?: number;
}

const toneIcon: Record<ToastTone, IconName> = {
  neutral: 'info',
  reached: 'check',
  assist: 'glove',
  caution: 'caution',
  danger: 'safety',
};

/** Presentational toast. Use `useToast()` for system messages; use this directly for in-flow feedback. */
export function Toast({
  title,
  description,
  tone = 'neutral',
  onDismiss,
  className,
}: ToastOptions & { onDismiss?: () => void; className?: string }) {
  return (
    <div className={cx('ds-toast', `ds-toast--${tone}`, className)}>
      <span className="ds-toast__icon">
        <Icon name={toneIcon[tone]} />
      </span>
      <div className="ds-toast__text">
        <strong className="ds-toast__title">{title}</strong>
        {description && (
          <span className="ds-toast__description">{description}</span>
        )}
      </div>
      {onDismiss && (
        <IconButton icon="x" label="Dismiss" size="sm" onClick={onDismiss} />
      )}
    </div>
  );
}

interface Item extends ToastOptions {
  id: number;
}
const Context = createContext<{
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
} | null>(null);

function TimedToast({
  item,
  onDismiss,
}: {
  item: Item;
  onDismiss: (id: number) => void;
}) {
  const { id, duration = 5000 } = item;
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!duration || paused) return;
    const t = window.setTimeout(() => onDismiss(id), duration);
    return () => window.clearTimeout(t);
  }, [id, duration, paused, onDismiss]);
  return (
    <li
      className="ds-toast-region__item"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Toast {...item} onDismiss={() => onDismiss(id)} />
    </li>
  );
}

/**
 * Hosts system toasts (top-right). Safety never uses toasts — that's the SafetyBanner.
 * `suppress` hides non-error toasts (pass `true` in the focus shell, spec §4).
 */
export function ToastProvider({
  children,
  suppress = false,
}: {
  children: ReactNode;
  suppress?: boolean;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const next = useRef(1);
  const dismiss = useCallback(
    (id: number) => setItems((all) => all.filter((t) => t.id !== id)),
    [],
  );
  const toast = useCallback((options: ToastOptions) => {
    const id = next.current++;
    setItems((all) => [...all.slice(-2), { ...options, id }]);
    return id;
  }, []);
  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);
  const visible = suppress ? items.filter((t) => t.tone === 'danger') : items;
  return (
    <Context.Provider value={value}>
      {children}
      <ol
        className="ds-toast-region"
        aria-live="polite"
        aria-label="Notifications"
      >
        {visible.map((item) => (
          <TimedToast key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </ol>
    </Context.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useToast needs <ToastProvider>');
  return ctx;
}
