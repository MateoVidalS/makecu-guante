import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import type { GloveEvent } from '../contracts/glove';
import { decode } from '../glove/codec';
import { BROWNOUT_MESSAGE, boardRestartMessage } from './boardRestart';
import { RuntimeBrownoutNotice } from './RuntimeStatus';

const glove = vi.hoisted(() => ({ events: [] as GloveEvent[] }));
vi.mock('../glove', () => ({ useGlove: () => glove }));
afterEach(() => {
  cleanup();
  glove.events = [];
});
const line = readFileSync(
  '../contracts/fixtures/serial_boot_brownout.txt',
  'utf8',
).trim();

describe('board reset cause', () => {
  it('preserves the shared brown-out boot fixture through the codec', () => {
    expect(decode(line, 42)).toEqual({ t: 42, e: 'boot', reset_reason: 9 });
  });
  it.each([0, 1, 3, 9, 16])(
    'retains numeric reset reason %i',
    (reset_reason) => {
      expect(
        decode(JSON.stringify({ t: 'evt', e: 'boot', reset_reason }), 42),
      ).toEqual({ t: 42, e: 'boot', reset_reason });
    },
  );
  it.each(['9', null, -1, 9.5])(
    'keeps boot but ignores an invalid optional reason %s',
    (reset_reason) => {
      expect(
        decode(JSON.stringify({ t: 'evt', e: 'boot', reset_reason }), 42),
      ).toEqual({ t: 42, e: 'boot' });
    },
  );
  it('does not infer a brown-out from an unknown boot cause or another event', () => {
    expect(
      decode('{"t":"evt","e":"overcurrent","ma":1600,"reset_reason":9}', 42),
    ).toEqual({ t: 42, e: 'overcurrent', ma: 1600 });
    expect(boardRestartMessage([{ t: 1, e: 'boot' }])).toBeNull();
    expect(
      boardRestartMessage([{ t: 1, e: 'overcurrent', reset_reason: 9 }]),
    ).toBeNull();
  });
  it.each([false, true])(
    'shows the exact supply guidance in Setup/runtime status (inline=%s)',
    (inline) => {
      glove.events = [decode(line, 42) as GloveEvent];
      render(<RuntimeBrownoutNotice inline={inline} />);
      expect(screen.getByText(BROWNOUT_MESSAGE)).toBeVisible();
      if (inline)
        expect(
          screen.getByRole('alert', { name: 'Glove board status' }),
        ).toHaveTextContent(BROWNOUT_MESSAGE);
    },
  );
  it('retains the warning across telemetry/events and clears it on a normal reboot or source replacement', () => {
    glove.events = [
      { t: 1, e: 'boot', reset_reason: 9 },
      { t: 2, e: 'calib_ok' },
    ];
    const view = render(<RuntimeBrownoutNotice inline />);
    expect(screen.getByText(BROWNOUT_MESSAGE)).toBeVisible();
    glove.events.push({ t: 3, e: 'boot', reset_reason: 1 });
    view.rerender(<RuntimeBrownoutNotice inline />);
    expect(screen.queryByText(BROWNOUT_MESSAGE)).not.toBeInTheDocument();
    glove.events = [];
    view.rerender(<RuntimeBrownoutNotice inline />);
    expect(screen.queryByText(BROWNOUT_MESSAGE)).not.toBeInTheDocument();
  });
});
