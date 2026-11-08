import type { ChartSection } from '../../../contracts/chat';

const sections: readonly ChartSection[] = [
  'summary',
  'glance',
  'range',
  'assistance',
  'therapy',
  'sessions',
  'evaluations',
];
export function isChartSection(value: unknown): value is ChartSection {
  return sections.includes(value as ChartSection);
}

const highlights = new Map<Element, ReturnType<typeof setTimeout>>();
const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Markers may be on a details element or on a wrapper containing lazy content. */
export async function showChart(section: ChartSection): Promise<boolean> {
  const selector = `[data-chat-section="${section}"]`;
  let target = document.querySelector<HTMLElement>(selector);
  if (!target) return false;
  for (
    let parent: HTMLElement | null = target;
    parent;
    parent = parent.parentElement
  ) {
    if (parent instanceof HTMLDetailsElement && !parent.open)
      parent.open = true;
  }
  if (target instanceof HTMLDetailsElement) target.open = true;
  await frame();
  await frame();
  target = document.querySelector<HTMLElement>(selector);
  if (!target) return false;
  target.scrollIntoView?.({
    behavior: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
      .matches
      ? 'instant'
      : 'smooth',
    block: 'start',
  });
  clearTimeout(highlights.get(target));
  target.classList.add('doctor-chat-highlight');
  const highlighted = target;
  highlights.set(
    target,
    setTimeout(() => {
      highlighted.classList.remove('doctor-chat-highlight');
      highlights.delete(highlighted);
    }, 2000),
  );
  return true;
}
