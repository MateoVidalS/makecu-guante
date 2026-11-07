import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import {
  Banner,
  Button,
  ButtonLink,
  Checkbox,
  ConfirmDialog,
  IconButton,
  Input,
  KpiTile,
  Meter,
  Pill,
  ProgressRing,
  Select,
  Slider,
  StatusChip,
  Stepper,
  Switch,
  Tabs,
  ThemeToggle,
  ToastProvider,
  useToast,
} from '.';
import { PageErrorBoundary } from './ErrorBoundary';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete document.documentElement.dataset.theme;
  window.localStorage.clear();
});

describe('Button', () => {
  it('defaults to type=button, maps variant and size to classes, and forwards clicks', () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" size="lg" icon="play" onClick={onClick}>
        Start
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Start' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.className).toContain('ds-button--primary');
    expect(button.className).toContain('ds-button--lg');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
  it('blocks clicks and announces busy while loading, but stays focusable', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
  it('IconButton always has an accessible name; ButtonLink is a link', () => {
    render(
      <MemoryRouter>
        <IconButton icon="x" label="Close" />
        <ButtonLink to="/history">See progress</ButtonLink>
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeDefined();
    expect(
      screen.getByRole('link', { name: 'See progress' }).getAttribute('href'),
    ).toBe('/history');
  });
});

describe('Tabs', () => {
  it('uses roving focus: arrows move and select, Home/End jump, disabled tabs are skipped', () => {
    const onChange = vi.fn();
    render(
      <Tabs
        label="History views"
        onChange={onChange}
        items={[
          { id: 'a', label: 'Overview', content: 'Panel A' },
          { id: 'b', label: 'Active range', content: 'Panel B' },
          { id: 'c', label: 'Hidden', disabled: true, content: 'Panel C' },
          { id: 'd', label: 'Sessions', content: 'Panel D' },
        ]}
      />,
    );
    const tabs = screen.getAllByRole('tab');
    expect(screen.getByRole('tablist').getAttribute('aria-label')).toBe(
      'History views',
    );
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1, -1]);
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel A');
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tabs[1], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[3]);
    fireEvent.keyDown(tabs[3], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[0]);
    fireEvent.keyDown(tabs[0], { key: 'End' });
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel D');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(
      tabs[3].id,
    );
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['b', 'd', 'a', 'd']);
  });
});

describe('Stepper', () => {
  it('marks the current step, lets you go back to completed steps only', () => {
    const onSelect = vi.fn();
    render(
      <Stepper
        steps={[
          { id: 'glove', label: 'Glove range' },
          { id: 'camera', label: 'Camera range' },
          { id: 'review', label: 'Review' },
        ]}
        current="camera"
        completed={['glove']}
        onSelect={onSelect}
      />,
    );
    const back = screen.getByRole('button', { name: /Glove range/ });
    expect(back.textContent).toContain('(done)');
    fireEvent.click(back);
    expect(onSelect).toHaveBeenCalledWith('glove');
    expect(
      screen
        .getByRole('button', { name: /Camera range/ })
        .getAttribute('aria-current'),
    ).toBe('step');
    expect(screen.queryByRole('button', { name: /Review/ })).toBeNull();
  });
});

describe('form controls', () => {
  it('Input wires label, hint and error to the control', () => {
    render(
      <Input
        label="Repetitions"
        hint="1 to 10"
        error="Choose 10 or fewer."
        defaultValue="12"
      />,
    );
    const input = screen.getByLabelText('Repetitions');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = input.getAttribute('aria-describedby')!.split(' ');
    expect(
      described.map((id) => document.getElementById(id)!.textContent),
    ).toEqual(['1 to 10', ' Choose 10 or fewer.']);
  });
  it('Select renders options and is labelled', () => {
    render(
      <Select
        label="Affected hand"
        options={[
          { value: 'right', label: 'Right' },
          { value: 'left', label: 'Left' },
        ]}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Affected hand' });
    expect(select.querySelectorAll('option')).toHaveLength(2);
  });
  it('Slider reports numbers and a readable value text', () => {
    function Demo() {
      const [v, setV] = useState(90);
      return (
        <Slider
          label="Servo angle"
          min={0}
          max={180}
          value={v}
          onValueChange={setV}
          format={(x) => `${x}°`}
        />
      );
    }
    render(<Demo />);
    const slider = screen.getByRole('slider', { name: 'Servo angle' });
    expect(slider.getAttribute('aria-valuetext')).toBe('90°');
    fireEvent.change(slider, { target: { value: '95' } });
    expect(slider.getAttribute('aria-valuetext')).toBe('95°');
    expect(screen.getByText('95°').tagName).toBe('OUTPUT');
  });
  it('Switch is a labelled role=switch that toggles aria-checked', () => {
    function Demo() {
      const [on, setOn] = useState(false);
      return (
        <Switch label="Mirror preview" checked={on} onCheckedChange={setOn} />
      );
    }
    render(<Demo />);
    const sw = screen.getByRole('switch', { name: 'Mirror preview' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });
  it('Checkbox is a native, labelled checkbox (clicking the label toggles it)', () => {
    render(<Checkbox label="Hand relaxed in the glove" size="lg" />);
    const box = screen.getByRole('checkbox', {
      name: 'Hand relaxed in the glove',
    }) as HTMLInputElement;
    fireEvent.click(screen.getByText('Hand relaxed in the glove'));
    expect(box.checked).toBe(true);
  });
  it('Pill exposes its selection with aria-pressed', () => {
    render(<Pill selected>Short session</Pill>);
    expect(
      screen
        .getByRole('button', { name: 'Short session' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });
});

describe('Dialog', () => {
  it('focuses the safe choice, closes on Escape and returns focus to the opener', () => {
    function Demo() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Delete…</Button>
          <ConfirmDialog
            open={open}
            title="Delete this session?"
            confirmLabel="Delete session"
            confirmVariant="danger"
            onConfirm={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </>
      );
    }
    render(<Demo />);
    const opener = screen.getByRole('button', { name: 'Delete…' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Delete this session?' });
    expect(document.activeElement?.textContent).toBe('Cancel');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByText('Delete session')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('feedback', () => {
  it('safety banner is an alert and moves focus to its action', () => {
    render(
      <Banner
        tone="safety"
        title="Stopped — I felt resistance in your index."
        action={<Button>Resume</Button>}
        details="512 mA"
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Stopped');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Resume' }),
    );
    expect(screen.getByText('What happened?')).toBeDefined();
  });
  it('info banners are polite status messages and do not steal focus', () => {
    render(
      <Banner tone="info" action={<Button>Undo</Button>}>
        Saved
      </Banner>,
    );
    expect(screen.getByRole('status').textContent).toContain('Saved');
    expect(document.activeElement).toBe(document.body);
  });
  it('toasts appear in a live region, auto-dismiss, and are suppressed in focus mode', () => {
    vi.useFakeTimers();
    function Trigger() {
      const { toast } = useToast();
      return (
        <>
          <button
            onClick={() =>
              toast({ title: 'Calibration saved', duration: 1000 })
            }
          >
            info
          </button>
          <button
            onClick={() => toast({ title: 'Camera lost', tone: 'danger' })}
          >
            error
          </button>
        </>
      );
    }
    const { rerender } = render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('info'));
    const region = screen.getByRole('list', { name: 'Notifications' });
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toContain('Calibration saved');
    act(() => vi.advanceTimersByTime(1100));
    expect(region.textContent).not.toContain('Calibration saved');
    rerender(
      <ToastProvider suppress>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('info'));
    fireEvent.click(screen.getByText('error'));
    expect(region.textContent).not.toContain('Calibration saved');
    expect(region.textContent).toContain('Camera lost');
  });
});

describe('data display', () => {
  it('Meter and ProgressRing expose values to assistive tech', () => {
    render(
      <>
        <Meter label="Index on your own" value={0.55} valueText="55%" />
        <ProgressRing value={0.4} label="Try now" />
        <ProgressRing label="Show me your hand" />
      </>,
    );
    const meter = screen.getByRole('meter', { name: 'Index on your own' });
    expect(meter.getAttribute('aria-valuetext')).toBe('55%');
    expect(
      screen
        .getByRole('progressbar', { name: 'Try now' })
        .getAttribute('aria-valuenow'),
    ).toBe('40');
    expect(
      screen
        .getByRole('progressbar', { name: 'Show me your hand' })
        .hasAttribute('aria-valuenow'),
    ).toBe(false);
  });
  it('KpiTile never shows a decline in red and says which way is better', () => {
    const { container } = render(
      <>
        <KpiTile label="On your own" value="55%" delta={-3} />
        <KpiTile label="Glove help" value="10%" delta={-6} better="down" />
      </>,
    );
    const deltas = container.querySelectorAll('.ds-kpi__delta');
    expect(deltas[0].className).toContain('ds-tone--muted');
    expect(deltas[1].className).toContain('ds-tone--reached');
    expect(deltas[1].textContent).toContain('(better)');
    expect(container.querySelector('.ds-tone--danger')).toBeNull();
  });
  it('StatusChip pairs the dot with words', () => {
    render(<StatusChip tone="assist" label="Glove" value="Helping" />);
    expect(screen.getByText('Glove:')).toBeDefined();
    expect(screen.getByText('Helping')).toBeDefined();
  });
});

describe('shell helpers', () => {
  it('ThemeToggle defaults to light and cycles light → dark → system on <html data-theme>', () => {
    render(<ThemeToggle />);
    const button = screen.getByRole('button');
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(button);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('rehab-hub.theme')).toBe('dark');
    fireEvent.click(button);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(window.localStorage.getItem('rehab-hub.theme')).toBe('system');
    fireEvent.click(button);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('rehab-hub.theme')).toBeNull();
  });
  it('PageErrorBoundary contains a crash and resets when the route changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Boom(): never {
      throw new Error('kaput');
    }
    const { rerender } = render(
      <PageErrorBoundary resetKey="/exercise">
        <Boom />
      </PageErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'Something went wrong',
    );
    rerender(
      <PageErrorBoundary resetKey="/">
        <p>Home</p>
      </PageErrorBoundary>,
    );
    expect(screen.getByText('Home')).toBeDefined();
  });
});
