import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';

export interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  icon?: IconName;
  /** Panel content. Omit when the tab only drives state (e.g. a chart metric switch). */
  content?: ReactNode;
  disabled?: boolean;
}

/**
 * WAI-ARIA tabs with roving focus: ←/→ move and activate, Home/End jump. Use for switching views of
 * the same data (History: Overview / Active range / Assistance…). Not for navigation between pages.
 */
export function Tabs<T extends string>({
  items,
  value,
  defaultValue,
  onChange,
  label,
  size = 'md',
  className,
}: {
  items: TabItem<T>[];
  value?: T;
  defaultValue?: T;
  onChange?: (id: T) => void;
  /** Accessible name of the tab list. */
  label: string;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const [inner, setInner] = useState<T>(defaultValue ?? items[0]?.id);
  const current = value ?? inner;
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const select = (id: T) => {
    if (value === undefined) setInner(id);
    onChange?.(id);
  };
  const enabled = items
    .map((item, i) => (item.disabled ? -1 : i))
    .filter((i) => i >= 0);
  function onKeyDown(e: KeyboardEvent, index: number) {
    const pos = enabled.indexOf(index);
    let next: number | undefined;
    if (e.key === 'ArrowRight') next = enabled[(pos + 1) % enabled.length];
    else if (e.key === 'ArrowLeft')
      next = enabled[(pos - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (next === undefined) return;
    e.preventDefault();
    refs.current[next]?.focus();
    select(items[next].id);
  }
  const active = items.find((i) => i.id === current);
  return (
    <div className={cx('ds-tabs', `ds-tabs--${size}`, className)}>
      <div role="tablist" aria-label={label} className="ds-tabs__list">
        {items.map((item, i) => {
          const selected = item.id === current;
          return (
            <button
              key={item.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={
                item.content !== undefined
                  ? `${base}-panel-${item.id}`
                  : undefined
              }
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              className="ds-tabs__tab"
              onClick={() => select(item.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {item.icon && <Icon name={item.icon} />}
              {item.label}
            </button>
          );
        })}
      </div>
      {active?.content !== undefined && (
        <div
          role="tabpanel"
          id={`${base}-panel-${active.id}`}
          aria-labelledby={`${base}-tab-${active.id}`}
          tabIndex={0}
          className="ds-tabs__panel"
        >
          {active.content}
        </div>
      )}
    </div>
  );
}
