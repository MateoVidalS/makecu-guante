import { useSyncExternalStore } from 'react';

function subscribe(notify: () => void) {
  const slot = document.getElementById('safety-banner-slot');
  if (!slot) return () => {};
  const observer = new MutationObserver(notify);
  observer.observe(slot, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/** Presentation only: keep previously hidden controls unavailable while safety owns recovery. */
export function useSafetyBannerVisible() {
  return useSyncExternalStore(
    subscribe,
    () => !!document.querySelector('#safety-banner-slot [role="alert"]'),
    () => false,
  );
}
