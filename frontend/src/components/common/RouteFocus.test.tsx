import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import {
  Link,
  MemoryRouter,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom';
import { RouteFocus } from './RouteFocus';

function Back() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      Back
    </button>
  );
}
function mount(initial = '/doctor') {
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  render(
    <MemoryRouter initialEntries={[initial]}>
      <RouteFocus />
      <main id="main" tabIndex={-1}>
        <Routes>
          <Route
            path="/doctor"
            element={
              <>
                <h1>Doctor view</h1>
                <Link to="/history/sessions/1">Open session 1</Link>
              </>
            }
          />
          <Route
            path="/history"
            element={
              <>
                <h1>History</h1>
                <Link to="/history?tab=sessions">Sessions tab</Link>
              </>
            }
          />
          <Route
            path="/history/sessions/:id"
            element={
              <>
                <h1>Session replay</h1>
                <Link to="/history/sessions/2">Next session</Link>
                <Link to="/history">All history</Link>
                <Back />
              </>
            }
          />
        </Routes>
      </main>
    </MemoryRouter>,
  );
  return { scrollTo, main: document.getElementById('main')! };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('route focus', () => {
  it('leaves the first page load alone', () => {
    const { scrollTo } = mount();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });
  it('starts a new page at the top with focus on main, not on <body>', () => {
    const { scrollTo, main } = mount();
    const link = screen.getByRole('link', { name: 'Open session 1' });
    link.focus();
    fireEvent.click(link);
    expect(
      screen.getByRole('heading', { name: 'Session replay' }),
    ).toBeTruthy();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(document.activeElement).toBe(main);
  });
  it('also resets when the same page shows another record', () => {
    const { scrollTo, main } = mount('/history/sessions/1');
    const next = screen.getByRole('link', { name: 'Next session' });
    next.focus();
    fireEvent.click(next);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    // The link survived the navigation; focus still moves to the new page's start.
    expect(document.activeElement).toBe(main);
  });
  it('keeps the place on query-only changes such as ?tab=', () => {
    const { scrollTo } = mount('/history');
    const tab = screen.getByRole('link', { name: 'Sessions tab' });
    tab.focus();
    fireEvent.click(tab);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(tab);
  });
  it('leaves scroll restoration to the browser on back/forward', () => {
    const { scrollTo, main } = mount();
    fireEvent.click(screen.getByRole('link', { name: 'Open session 1' }));
    scrollTo.mockClear();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    });
    expect(screen.getByRole('heading', { name: 'Doctor view' })).toBeTruthy();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(main);
  });
});
