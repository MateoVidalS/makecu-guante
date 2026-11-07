import { useEffect, useState } from 'react';
import { Icon, type IconName } from './Icon';

export type ThemePreference = 'system' | 'light' | 'dark';
const KEY = 'rehab-hub.theme';

function read(): ThemePreference {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Applies the preference as `data-theme` on <html> (tokens.css and the 3D hand both follow it). */
export function applyTheme(pref: ThemePreference) {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>(read);
  useEffect(() => {
    applyTheme(theme);
    try {
      if (theme === 'system') window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, theme);
    } catch {
      /* storage blocked: the preference lasts for this visit */
    }
  }, [theme]);
  return [theme, setTheme] as const;
}

const options: { id: ThemePreference; label: string; icon: IconName }[] = [
  { id: 'system', label: 'Match system', icon: 'monitor' },
  { id: 'light', label: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', icon: 'moon' },
];

/** One icon button that cycles Match system → Light → Dark. Used in the header where space is tight. */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  const i = options.findIndex((o) => o.id === theme);
  const current = options[i];
  const next = options[(i + 1) % options.length];
  return (
    <button
      type="button"
      className={[
        'ds-button',
        'ds-icon-button',
        'ds-button--quiet',
        'ds-button--sm',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={`Theme: ${current.label}. Switch to ${next.label}`}
      title={`Theme: ${current.label}`}
      onClick={() => setTheme(next.id)}
    >
      <Icon name={current.icon} />
    </button>
  );
}

/** Three-way segmented control (settings pages, gallery). */
export function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="ds-segmented" role="radiogroup" aria-label="Color theme">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={theme === o.id}
          aria-label={o.label}
          title={o.label}
          className="ds-segmented__option"
          onClick={() => setTheme(o.id)}
          onKeyDown={(e) => {
            const i = options.findIndex((x) => x.id === theme);
            const step =
              e.key === 'ArrowRight' || e.key === 'ArrowDown'
                ? 1
                : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                  ? -1
                  : 0;
            if (!step) return;
            e.preventDefault();
            const next = options[(i + step + options.length) % options.length];
            setTheme(next.id);
            (
              e.currentTarget.parentElement?.querySelector(
                `[aria-label="${next.label}"]`,
              ) as HTMLElement | null
            )?.focus();
          }}
          tabIndex={theme === o.id ? 0 : -1}
        >
          <Icon name={o.icon} size="1.1em" />
        </button>
      ))}
    </div>
  );
}
