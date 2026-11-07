import { test, expect } from '@playwright/test';
import { GLOVE_FINGERS } from '../src/contracts/glove';
import { calibration as fixture } from '../src/contracts/fixtures.check';
import type { probeRigidFinger } from './f9-rigid-harness';

test.describe('five-finger rigid safety with clean simulator calibration', () => {
  for (const finger of GLOVE_FINGERS) {
    test(`${finger} stops in every full-fist repetition, including a preloaded baseline`, async ({
      page,
    }) => {
      const calibration = structuredClone(fixture);
      calibration.servo = GLOVE_FINGERS.map((finger) => ({
        finger,
        min_deg: 20,
        max_deg: 150,
      }));
      calibration.camera.closed_flex = {
        thumb: 100,
        index: 270,
        middle: 270,
        ring: 270,
        pinky: 270,
      };
      await page.route('**/api/calibrations/latest', (route) =>
        route.fulfill({ json: calibration }),
      );
      await page.goto('/e2e/f9-rigid-harness.html');
      for (const preset of ['moderate', 'mild'] as const) {
        const result = (await page.evaluate(
          async ({ finger, preset }) => {
            const path = '/e2e/f9-rigid-harness.ts';
            const { probeRigidFinger } = (await import(
              /* @vite-ignore */ path
            )) as {
              probeRigidFinger: typeof import('./f9-rigid-harness').probeRigidFinger;
            };
            return probeRigidFinger(finger, preset);
          },
          { finger, preset },
        )) as Awaited<ReturnType<typeof probeRigidFinger>>;
        expect(result.calibration).toEqual(
          Array.from({ length: 5 }, () => [20, 150]),
        );
        expect(result.events).toContainEqual(
          expect.objectContaining({ kind: 'resistance', finger }),
        );
        expect(result.results).toHaveLength(3);
        for (const attempt of result.results) {
          expect(attempt.safety).toContainEqual(
            expect.objectContaining({ source: 'resistance', finger }),
          );
          expect(attempt.scored).toEqual(GLOVE_FINGERS);
        }
        expect(result.phase).toBe('DONE');
        expect(result.released).toBe(true);
      }
    });
  }
});
