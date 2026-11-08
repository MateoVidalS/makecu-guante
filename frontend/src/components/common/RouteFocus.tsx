import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * In-app navigation behaves like a page load: a new page starts at its top and focus moves to
 * the main region (`#main`, tabIndex -1, no focus ring), so the next Tab or screen-reader read
 * starts at the new page instead of on <body> halfway down the old one.
 *
 * - Only when the pathname changes: `?tab=` switches inside a page keep their place.
 * - Back/forward (POP) keeps the browser's own scroll restoration; focus still moves.
 * - The first render is a real page load: the browser already starts at the top.
 * - Runs as a layout effect, before the new page's own effects, so a page that focuses or
 *   scrolls to something on mount (a dialog, `#before-practice`) still wins.
 */
export function RouteFocus({ target = 'main' }: { target?: string }) {
  const { pathname } = useLocation();
  const navigation = useNavigationType();
  const previous = useRef(pathname);
  useLayoutEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    if (navigation !== 'POP') window.scrollTo(0, 0);
    document.getElementById(target)?.focus({ preventScroll: true });
  }, [pathname, navigation, target]);
  return null;
}
