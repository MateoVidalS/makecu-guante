import { test, expect } from '@playwright/test';
import { GLOVE_FINGERS } from '../src/contracts/glove';
import {
  CURRENT_CAMERA_VIEW,
  CURRENT_FLEX_MODEL,
} from '../src/contracts/calibration';
import { calibration as fixture } from '../src/contracts/fixtures.check';
import type { probeRigidFinger } from './f9-rigid-harness';

test.describe('five-finger rigid safety with clean simulator calibration', () => {
  for (const finger of GLOVE_FINGERS) {
    test(`${finger} stops in every opening repetition, including a preloaded baseline`, async ({
      page,
    }) => {
      const calibration = {
        ...structuredClone(fixture),
        assist_direction: 'open',
        camera: {
          ...fixture.camera,
          camera_view: CURRENT_CAMERA_VIEW,
          flex_model: CURRENT_FLEX_MODEL,
        },
      };
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

test('five-finger assist staggers starts and caps moving motors and supply demand', async ({
  page,
}) => {
  const calibration = {
    ...structuredClone(fixture),
    assist_direction: 'open',
    camera: {
      ...fixture.camera,
      camera_view: CURRENT_CAMERA_VIEW,
      flex_model: CURRENT_FLEX_MODEL,
    },
  };
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
  const result = await page.evaluate(async () => {
    const path = '/e2e/f9-rigid-harness.ts';
    const module = (await import(/* @vite-ignore */ path)) as {
      probeRigidFinger: typeof import('./f9-rigid-harness').probeRigidFinger;
    };
    return module.probeRigidFinger(null, 'moderate');
  });
  expect(
    result.events.filter((e) => e.kind === 'safety' || e.kind === 'resistance'),
  ).toEqual([]);
  expect(result.results[0].scored).toEqual(GLOVE_FINGERS);
  expect(new Set(result.starts.map((s) => s.finger))).toEqual(
    new Set(GLOVE_FINGERS),
  );
  for (let i = 1; i < result.starts.length; i++)
    expect(
      result.starts[i].at - result.starts[i - 1].at,
    ).toBeGreaterThanOrEqual(150);
  expect(result.peakMoving).toBe(3);
  expect(result.peakMa).toBeLessThan(2200);
  expect(result.targets.every((t) => t.f.every((v) => v <= 0.95))).toBe(true);
  expect(result.released).toBe(true);
});
