import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { GloveProvider } from '../../glove';
import { VisionProvider } from '../../vision';
import { RuntimeProvider, ScriptedRuntime } from '../../runtime';
import { freshDraft, saveDraft } from '../../pages/Calibrate/draft';

export function helperRuntime() {
  const runtime = new ScriptedRuntime({ persist: false });
  runtime.calibration.current!.camera.closed_flex = {
    thumb: 100,
    index: 270,
    middle: 270,
    ring: 270,
    pinky: 270,
  };
  return runtime;
}
export function resetHelperStorage() {
  localStorage.clear();
  sessionStorage.clear();
  saveDraft(freshDraft());
}
function Location() {
  const location = useLocation();
  return (
    <output aria-label="Current route">
      {location.pathname + location.search}
    </output>
  );
}
export function mountHelper(
  page: ReactNode,
  runtime = helperRuntime(),
  route = '/',
) {
  return {
    runtime,
    ...render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <GloveProvider>
          <VisionProvider>
            <RuntimeProvider runtime={runtime}>
              <MemoryRouter initialEntries={[route]}>
                {page}
                <Location />
              </MemoryRouter>
            </RuntimeProvider>
          </VisionProvider>
        </GloveProvider>
      </QueryClientProvider>,
    ),
  };
}
