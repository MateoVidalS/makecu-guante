import { useEffect, useState } from 'react';

export function useHandPreferences() {
  const read = () => ({
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)')
      .matches,
    dark:
      document.documentElement.dataset.theme === 'dark' ||
      (document.documentElement.dataset.theme !== 'light' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches),
  });
  const [preferences, setPreferences] = useState(read);
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const theme = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setPreferences(read());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    motion.addEventListener('change', update);
    theme.addEventListener('change', update);
    return () => {
      observer.disconnect();
      motion.removeEventListener('change', update);
      theme.removeEventListener('change', update);
    };
  }, []);
  return preferences;
}
