import { describe, expect, it, vi } from 'vitest';
import * as flex from '../flex';
import { atClosure, NOISE, PATIENTS } from './handModel';
import { hold, stream } from './harness';

describe('independent geometry oracle', () => {
  it.each(Object.values(PATIENTS))(
    'keeps $name truth independent of production joint math',
    (patient) => {
      const production = vi
        .spyOn(flex, 'jointAngles')
        .mockReturnValue(
          flex.fingerMap(() => ({ mcp: 999, pip: 999, dip: 999 })),
        );
      for (const closure of [0, 0.1, 0.5, 1]) {
        const samples = stream(
          patient,
          {
            view: 'front_upright',
            hand: 'right',
            noise: NOISE.ideal,
          },
          hold(
            atClosure(
              patient,
              flex.fingerMap(() => closure),
            ),
          ),
          100,
        );
        for (const sample of samples)
          for (const finger of flex.FINGERS)
            expect(sample.truth.closure[finger]).toBeCloseTo(closure, 6);
      }
      expect(production).not.toHaveBeenCalled();
    },
  );
});
