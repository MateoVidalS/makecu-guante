import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CoachPanel } from './CoachPanel';

const voice = vi.hoisted(() => ({
  mode: 'live',
  status: 'listening',
  muted: false,
  unavailable: false,
  setMuted: vi.fn(),
  setMode: vi.fn(),
}));
vi.mock('./VoiceProvider', () => ({ useVoice: () => voice }));
afterEach(cleanup);

it.each([
  ['live', false, true, false],
  ['live', true, false, false],
  ['simple', false, false, true],
  ['off', false, false, true],
])(
  'microphone state agrees with %s mode and muted=%s',
  (mode, muted, checked, disabled) => {
    Object.assign(voice, { mode, muted });
    render(<CoachPanel />);
    const microphone = screen.getByRole('switch', {
      name: 'Microphone',
    });
    expect(microphone.getAttribute('aria-checked')).toBe(String(checked));
    expect((microphone as HTMLButtonElement).disabled).toBe(disabled);
    expect(screen.queryByText('Mic on')).toBeNull();
    if (!disabled) {
      fireEvent.click(microphone);
      expect(voice.setMuted).toHaveBeenLastCalledWith(checked);
    }
  },
);
