import { describe, expect, it } from 'vitest';
import { GLOVE_FINGERS, type GloveEvent } from '../contracts/glove';
import { DEFAULT_EXERCISE_SETTINGS } from '../contracts/poses';
import { SimWorld } from '../glove/sim/simWorld';
import { createExerciseEngine } from './exercise';
import { calibration } from './test/fakeWorld';
import type { Output } from './types';

describe('five-finger assist with the glove simulator', () => {
  it.each(['mild', 'moderate', 'severe'] as const)(
    'keeps %s patient assists below 2.2 A with no more than three moving servos',
    async (preset) => {
      const world = new SimWorld({ autoStart: false, preset, seed: 42 });
      const engine = createExerciseEngine();
      const pending: GloveEvent[] = [];
      const assisted = new Set<string>();
      const starts: number[] = [];
      let peakMoving = 0;
      let peakMa = 0;
      let attempts = 0;
      let priorTarget: number[] | null = null;
      const accept = (out: Output) => {
        for (const cmd of out.commands) {
          if (cmd.t === 'target') {
            cmd.f.forEach((value, i) => {
              if (
                Math.abs(value - world.firmware.position[i]) > 0.05 &&
                (!priorTarget || value !== priorTarget[i])
              ) {
                assisted.add(GLOVE_FINGERS[i]);
                starts.push(world.now);
              }
            });
            priorTarget = [...cmd.f];
            world.glove.target(cmd.f, cmd.v);
          } else if (cmd.t === 'follow') world.glove.follow(cmd.f);
          else if (cmd.t === 'release') world.glove.release();
          else world.glove.limit(cmd.ma);
        }
        for (const event of out.events) {
          expect(event.kind).not.toBe('safety');
          expect(event.kind).not.toBe('resistance');
          if (event.kind === 'phase') world.setIntent(event.pose, event.phase);
          if (event.kind === 'attempt_done') {
            attempts++;
            expect(event.result.fingers.every((finger) => finger.scored)).toBe(
              true,
            );
          }
        }
      };
      // Observe every 200 Hz control step, including peaks between engine ticks.
      const unsubscribe = world.ticks.subscribe(() => {
        if (engine.state().phase !== 'ASSIST') return;
        // F2 exposes pre-filter supply demand; F0 exposes filtered telemetry only.
        const power =
          'power' in world ? (world.power as { demandMa: number }) : null;
        peakMa = Math.max(peakMa, power?.demandMa ?? world.firmware.currentMa);
        const moving = world.firmware.position.filter(
          (v, i) => Math.abs(v - world.firmware.goal[i]) > 1e-6,
        ).length;
        peakMoving = Math.max(peakMoving, moving);
        expect(moving).toBeLessThanOrEqual(3);
      });
      try {
        await world.glove.connect();
        for (const [i, servo] of calibration.servo.entries())
          world.glove.calib(
            i as 0 | 1 | 2 | 3 | 4,
            servo.min_deg,
            servo.max_deg,
          );
        world.glove.limit(2200);
        world.vision.setCalibration({
          ...calibration.camera,
          closed_flex: {
            thumb: 100,
            index: 270,
            middle: 270,
            ring: 270,
            pinky: 270,
          },
        });
        await world.vision.start({ affectedHand: 'right' });
        world.glove.onEvent((event) => pending.push(event));
        accept(
          engine.start(
            [{ pose: 'full_fist', reps: 1 }],
            {
              ...DEFAULT_EXERCISE_SETTINGS,
              present_s: 0,
              attempt_s: 1,
              assist_max_s: 15,
              hold_s: 0.2,
              rest_s: 0,
            },
            calibration,
            world.timestamp(),
          ),
        );
        for (let i = 0; i < 1500 && engine.state().phase !== 'DONE'; i++) {
          world.advance(20);
          accept(
            engine.tick({
              now: world.timestamp(),
              vision: world.vision.latest(),
              tel: world.glove.latest(),
              gloveConnected: true,
              gloveEvents: pending.splice(0),
            }),
          );
        }
        expect(engine.state().phase).toBe('DONE');
        expect(attempts).toBe(1);
        expect(assisted.size).toBeGreaterThanOrEqual(4);
        if (preset === 'severe') expect(assisted.size).toBe(5);
        expect(peakMoving).toBe(3);
        expect(peakMa).toBeGreaterThan(100);
        expect(peakMa).toBeLessThan(2200);
        for (let i = 1; i < starts.length; i++)
          expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(150);
      } finally {
        unsubscribe();
        world.stop();
      }
    },
  );
});
