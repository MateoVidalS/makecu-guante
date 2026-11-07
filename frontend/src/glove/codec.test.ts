import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const lines = readFileSync('../contracts/fixtures/serial_lines.txt', 'utf8');
import expected from '../../../contracts/fixtures/serial_lines.expected.json';
import { codecStats, decode, encode } from './codec';
import type { SerialCommand } from '../contracts/glove';

describe('serial fixtures', () => {
  const fixtures = lines.trimEnd().split('\n');
  for (const row of expected) {
    it(`line ${row.line}: ${row.direction} ${row.type ?? row.why}`, () => {
      const line = fixtures[row.line - 1];
      if (row.valid && row.direction === 'host_to_device') {
        expect(JSON.parse(encode(JSON.parse(line) as SerialCommand))).toEqual(
          JSON.parse(line),
        );
      } else if (row.direction === 'device_to_host') {
        const decoded = decode(line, 42);
        const { t: _type, ...wire } = JSON.parse(line);
        expect(decoded).toEqual({
          ...wire,
          ...(row.type === 'info' ? {} : { t: 42 }),
        });
      } else {
        const count = codecStats.malformedLines;
        expect(decode(line)).toBeNull();
        expect(codecStats.malformedLines).toBe(count + 1);
      }
    });
  }
  it('rounds numbers and terminates each command', () => {
    expect(encode({ t: 'target', f: [0.123456, 1, 0, 0, 0], v: 0.33333 })).toBe(
      '{"t":"target","f":[0.123,1,0,0,0],"v":0.333}\n',
    );
    expect(() => encode({ t: 'limit', ma: NaN })).toThrow('finite');
  });
  it.each([0, 3, 4, 6])(
    'rejects info for %i fingers with a clear compatibility error',
    (fingers) => {
      const errors: Error[] = [];
      expect(
        decode(
          JSON.stringify({
            t: 'info',
            fw: 'old',
            fingers,
            limit: 900,
            calib: Array(fingers).fill(null),
          }),
          42,
          (error) => errors.push(error),
        ),
      ).toBeNull();
      expect(errors[0]?.message).toContain(`reports ${fingers} fingers`);
      expect(errors[0]?.message).toContain('requires 5-finger firmware');
    },
  );
  it('accepts only five telemetry values and keeps a full two-decimal tel under 200 bytes', () => {
    const tel = {
      t: 'tel',
      ms: 4294967295,
      a: [0.12, 0.34, 0.56, 0.78, 1],
      ma: 2500,
      st: 'run',
      md: 'target',
      tg: [1, 0.98, 0.76, 0.54, 0.32],
    };
    const line = JSON.stringify(tel);
    expect(new TextEncoder().encode(line + '\n').length).toBeLessThanOrEqual(
      200,
    );
    expect(decode(line, 42)).toMatchObject({ a: tel.a, tg: tel.tg });
    expect(decode(JSON.stringify({ ...tel, a: [0, 0, 0] }))).toBeNull();
    expect(decode(JSON.stringify({ ...tel, tg: [0, 0, 0] }))).toBeNull();
  });
  it.each([
    'null',
    '{"t":"tel"}',
    '{"t":"evt","e":"unknown"}',
    '{"t":"info","calib":[]}',
    ' '.repeat(201),
  ])('counts malformed input: %s', (line) => {
    const before = codecStats.malformedLines;
    expect(decode(line)).toBeNull();
    expect(codecStats.malformedLines).toBe(before + 1);
  });
});
