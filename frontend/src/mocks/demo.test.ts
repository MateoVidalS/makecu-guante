import { describe, expect, it } from 'vitest';
import { isCurrentCameraCalibration } from '../vision/calibrationCompatibility';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createDemoState, demoOnDate, referenceDemo } from './demo';
import { historyAssist, historyRom, mockState } from './handlers';

describe('shared backend and MSW demo story', () => {
  it('keeps the generated artifact identical to the backend seed source', async () => {
    // Includes every per-finger measurement, trace, evaluation, and coach record.
    // Regenerate after an intentional generator/engine change; never hand-edit the JSON.
    const result = execFileSync(
      process.execPath,
      [resolve('../backend/tools/generate_demo.mjs'), referenceDemo.endDate],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
    expect(JSON.parse(result)).toEqual(referenceDemo.story);
  }, 60_000);

  it('moves visits together and maps complete, flagged REST records', () => {
    const date = '2026-12-11T10:00:00.000Z';
    const story = demoOnDate(date);
    const state = createDemoState(date);
    expect(isCurrentCameraCalibration(story.calibration.camera)).toBe(true);
    expect(isCurrentCameraCalibration(state.calibrations[0].camera)).toBe(true);
    expect(state.sessions).toHaveLength(14);
    expect(state.evaluations).toHaveLength(4);
    expect(state.sessions.every((s) => s.is_demo)).toBe(true);
    expect(state.evaluations.every((e) => e.is_demo)).toBe(true);
    expect(state.sessions[0].started_at.slice(0, 10)).toBe('2026-12-10');
    for (const [index, visit] of story.sessions.entries()) {
      const detail = state.details[index + 1];
      expect(detail.summary).toEqual({
        ...visit.summary,
        previous:
          index === 0
            ? null
            : {
                active_ratio_mean:
                  story.sessions[index - 1].summary.active_ratio_mean,
                per_finger: story.sessions[index - 1].summary.per_finger.map(
                  ({ finger, active_max_mean }) => ({
                    finger,
                    active_max_mean,
                  }),
                ),
              },
      });
      expect(detail.attempts).toHaveLength(visit.attempts.length);
      expect(
        detail.attempts.map((a) => ({
          ...a,
          trace: state.traces[a.id],
          id: undefined,
          session_id: undefined,
        })),
      ).toEqual(
        visit.attempts.map((a) => ({
          ...a,
          id: undefined,
          session_id: undefined,
        })),
      );
      expect(detail.coach_decisions).toEqual(
        visit.decisions
          .map((d) => ({ ...d, session_id: detail.id }))
          .sort((a, b) => a.t.localeCompare(b.t)),
      );
      expect(detail.feelings).toEqual(
        visit.feelings.map((f) => ({ ...f, session_id: detail.id })),
      );
    }
    expect(state.sessions.reduce((n, s) => n + s.n_attempts, 0)).toBe(160);
    expect(
      Object.values(state.details)
        .flatMap((s) => s.attempts)
        .flatMap((a) => a.safety_events),
    ).toMatchObject([{ source: 'resistance', finger: 'index' }]);
    expect(
      Object.values(state.details).flatMap((s) => s.feelings).length,
    ).toBeGreaterThan(0);
  });

  it('aggregates scored pose-specific range and per-finger assistance like SQLite', () => {
    const session = mockState.sessions[0];
    const attempts = mockState.details[session.id].attempts;
    for (const finger of [
      'thumb',
      'index',
      'middle',
      'ring',
      'pinky',
    ] as const) {
      const metrics = attempts
        .filter((a) => a.pose === 'full_fist')
        .flatMap((a) =>
          a.fingers.filter(
            (f) => f.finger === finger && f.scored && f.active_max !== null,
          ),
        );
      expect(
        historyRom(finger, 'full_fist').find((p) => p.session_id === session.id)
          ?.active_max_mean,
      ).toBeCloseTo(
        metrics.reduce((sum, f) => sum + f.active_max!, 0) / metrics.length,
      );
      const eligible = attempts.flatMap((a) =>
        a.fingers
          .filter(
            (f) => f.finger === finger && f.scored && f.assist_needed !== null,
          )
          .map((f) => (a.assisted && f.assist_needed! > 0 ? 1 : 0)),
      );
      expect(
        historyAssist().find(
          (p) => p.session_id === session.id && p.finger === finger,
        )?.assisted_rate,
      ).toBeCloseTo(
        eligible.reduce((sum: number, n) => sum + n, 0) / eligible.length,
      );
    }
    expect(historyRom('index', 'pinch')).toEqual([]);
    expect(historyRom('index', 'open')[0].active_max_mean).not.toBe(
      historyRom('index', 'full_fist')[0].active_max_mean,
    );
  });
});
