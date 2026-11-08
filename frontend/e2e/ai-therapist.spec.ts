import { expect, test, type Page } from '@playwright/test';
import type { CoachDecision } from '../src/contracts/therapist';
import type { SessionDetail } from '../src/contracts/api';
import { pullFromClosure } from '../src/contracts/glove';
import { DEFAULT_EXERCISE_SETTINGS, POSES } from '../src/contracts/poses';
import type { TherapistSnapshot } from './ai-therapist-harness';
import { silenceCoach, askForHelpWhenOffered } from './helpers';

test.describe('scripted Live AI therapist through the production app', () => {
  // Keep transient focus/voice UI checks in one browser at a time, even when
  // the surrounding suite runs fully parallel on the shared development host.
  test.describe.configure({ mode: 'default' });
  test.setTimeout(90_000);
  test.use({ actionTimeout: 30_000 });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await silenceCoach(page);
    await askForHelpWhenOffered(page);
    // No external requests or sockets: the fake replaces only the Live device;
    // all session, decision, feeling and replay requests use the real backend.
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1') return route.continue();
      throw new Error(`Unexpected external request: ${url.origin}`);
    });
    await page.routeWebSocket(/generativelanguage|googleapis/, () => {
      throw new Error('A scripted Live test attempted a real Gemini socket.');
    });
    await page.route('**/api/health', (route) =>
      route.fulfill({ json: { ok: true, version: 'e2e', gemini: true } }),
    );
    await page.route('**/api/voice/token', (route) =>
      route.fulfill({
        json: {
          token: 'scripted-not-a-secret',
          expires_at: '2099-01-01T00:00:00Z',
          model: 'scripted-live',
          voice: 'scripted',
          system_instruction: '',
          tools: [],
        },
      }),
    );
    await page.route('**/api/summaries', (route) =>
      route.fulfill({
        status: 503,
        json: {
          error: { code: 'llm_unavailable', message: 'Scripted rehearsal' },
        },
      }),
    );
  });

  async function start(page: Page) {
    await page.goto('/e2e/ai-therapist.html');
    await page
      .getByRole('button', { name: 'Calibrate simulator', exact: true })
      .click();
    await expect(
      page.getByText('Simulator calibrated.', { exact: false }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Continue to practice' }).click();
    await page
      .getByRole('button', { name: 'Open only, 1 rep', exact: true })
      .click();
    // Deliver genuine simulated camera/telemetry before the first attempt.
    await page.evaluate(() => window.aiTherapist.advance(200));
    await page
      .getByRole('button', { name: 'Start practice', exact: true })
      .click();
    await expect
      .poll(
        () => page.evaluate(() => window.aiTherapist.snapshot().connected),
        { timeout: 15_000 },
      )
      .toBe(true);
    await expect
      .poll(
        () => page.evaluate(() => window.aiTherapist.snapshot().view.sessionId),
        { timeout: 15_000 },
      )
      .not.toBeNull();
    return page.evaluate(() => window.aiTherapist.snapshot());
  }

  async function tool(
    page: Page,
    name: string,
    args: Record<string, unknown>,
    label: string,
    result: CoachDecision['result'] = 'applied',
  ) {
    const response = await page.evaluate(
      ({ name, args }) => window.aiTherapist.tool(name, args),
      { name, args },
    );
    expect(response.ok, response.reason).toBe(result !== 'rejected');
    expect(response.decision?.result).toBe(result);
    await expect(
      page.getByRole('region', { name: 'Coach decisions', exact: true }),
    ).toContainText(label);
    await expect(page.locator('.therapy-live__copy p')).toContainText(result);
    return response.decision!;
  }

  async function auditAndReplay(page: Page) {
    const snapshot = await page.evaluate(() => window.aiTherapist.snapshot());
    await page.getByRole('button', { name: 'Timeline', exact: true }).click();
    const dialog = page.getByRole('dialog', {
      name: 'Coach decisions',
      exact: true,
    });
    const timeline = dialog.getByRole('list', {
      name: 'Coach decisions and feelings timeline',
    });
    // Read the actual rendered audit details, including automatically generated
    // brakes/reversions that can share a React render with the calling tool.
    await expect(timeline.locator(':scope > li')).toHaveCount(
      snapshot.decisions.length + snapshot.feelings.length,
    );
    for (const decision of snapshot.decisions) {
      const row = timeline
        .locator(':scope > li')
        .filter({
          has: page.locator('.therapy-audit > p', {
            hasText: ` · ${decision.tool}`,
          }),
        })
        .filter({ hasText: decision.reason });
      await expect(row.first()).toBeVisible();
    }
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page
      .getByRole('button', { name: 'End session', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'Finish for today?' })
      .getByRole('button', { name: 'End session', exact: true })
      .click();
    await expect(
      page.getByRole('status', { name: 'Session saving status' }),
    ).toHaveText('Saved');
    await page.evaluate(() => window.aiTherapist.flush());
    const id = snapshot.view.sessionId!;
    await expect
      .poll(async () => {
        const detail = await (
          await page.request.get(`/api/sessions/${id}`)
        ).json();
        return detail.coach_decisions?.length;
      })
      .toBe(snapshot.decisions.length);
    const stored = (await (
      await page.request.get(`/api/sessions/${id}`)
    ).json()) as SessionDetail & {
      coach_decisions: CoachDecision[];
      feelings: TherapistSnapshot['feelings'];
    };
    // Python serializes fractional seconds to six digits; compare the instant
    // while retaining strict equality for every audit field and payload.
    const canonical = <T extends { t: string }>(items: T[]) =>
      items.map((item) => ({ ...item, t: new Date(item.t).toISOString() }));
    expect(canonical(stored.coach_decisions)).toEqual(
      canonical(snapshot.decisions),
    );
    expect(canonical(stored.feelings)).toEqual(canonical(snapshot.feelings));
    expect(stored.is_demo).toBe(true);
    expect(stored.ended_at).not.toBeNull();
    // Reload from REST, rather than retaining the in-memory runtime audit.
    await page.goto(`/history/sessions/${id}`);
    await expect(
      page.getByRole('heading', { name: 'Session replay', exact: true }),
    ).toBeVisible();
    const replay = page.getByRole('list', {
      name: 'Coach decisions and feelings timeline',
    });
    await expect(replay.locator(':scope > li')).toHaveCount(
      snapshot.decisions.length + snapshot.feelings.length,
    );
    const decisionRows = replay.locator(':scope > li').filter({
      has: page.locator('.therapy-audit'),
    });
    for (const [index, decision] of snapshot.decisions.entries()) {
      const detail = decisionRows.nth(index);
      await expect(detail).toContainText(decision.reason);
      await expect(detail).toContainText(decision.result);
      await detail.getByText('Decision details', { exact: true }).click();
      // The backend canonicalizes JSON key order for idempotent uploads.
      const payloads = await detail.locator('pre').allTextContents();
      expect(payloads.map((text) => JSON.parse(text))).toEqual([
        decision.requested,
        decision.applied,
      ]);
    }
    return stored;
  }

  test('help timing, gentleness, immediate help, target shaping, rest, undo and finger focus survive replay', async ({
    page,
  }, testInfo) => {
    await start(page);
    await tool(
      page,
      'repeat_pose',
      { reason: 'Practice the same comfortable pose again.' },
      'Extra repetition queued',
    );
    await tool(
      page,
      'adjust_help',
      {
        finger: 'thumb',
        direction: 'more',
        reason: 'Your thumb will get help sooner.',
      },
      'Help starts sooner',
    );
    await tool(
      page,
      'adjust_help',
      {
        finger: 'index',
        direction: 'gentler',
        reason: 'Give your index slower help.',
      },
      'Gentler help',
    );
    await tool(
      page,
      'adjust_target',
      {
        finger: 'middle',
        direction: 'lower',
        reason: 'A smaller middle-finger reach is comfortable.',
      },
      'Target lowered',
    );
    await tool(
      page,
      'set_attempt_time',
      { seconds: 9, reason: 'Take more time.' },
      'Try time adjusted',
    );
    await tool(page, 'undo_last_adjustment', {}, 'Adjustment undone', 'undone');
    const rest = await tool(
      page,
      'add_rest',
      { seconds: 100, reason: 'Rest before the next repetition.' },
      'Rest added',
      'clamped',
    );
    expect(rest.applied?.seconds).toBe(20);
    await tool(page, 'highlight_finger', { finger: 'pinky' }, 'Coach focus');
    const hand = page.locator('.hand-view');
    await expect(hand).toHaveAccessibleName(/Focus on your pinky/);
    await expect(hand.locator('.hand-legend__focus')).toHaveText(
      'Focus on your pinky',
    );
    await expect(hand.locator('canvas')).toBeVisible();
    await hand.screenshot({
      path: testInfo.outputPath('coach-pinky-focus.png'),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight,
      ),
    ).toBe(true);

    const attempt = await page.evaluate(() =>
      window.aiTherapist.untilPhase('ATTEMPT', 0),
    );
    expect(attempt.view.phaseDuration).toBe(6);
    expect(attempt.state.adjustments.assist_delay_s.thumb).toBe(5);
    expect(attempt.state.adjustments.assist_speed.index).toBe(0.15);
    expect(
      attempt.state.fingers.find((f) => f.finger === 'middle')?.target,
    ).toBeCloseTo(1 - (1 - POSES.open.closure.middle!) * 0.9);
    // The glove never moves on the coach's say-so: help starts only when the patient asks.
    const unasked = await page.evaluate(() =>
      window.aiTherapist.tool('assist_finger_now', {
        finger: 'ring',
        reason: 'Help your ring finger now.',
      }),
    );
    expect(unasked.ok).toBe(false);
    expect(
      (await page.evaluate(() => window.aiTherapist.advance(200))).view.phase,
    ).toBe('ATTEMPT');
    const asked = await page.evaluate(() =>
      window.aiTherapist.patient('Help me open, please', true),
    );
    expect(asked.view.phase).toBe('ASSIST');
    const early = await page.evaluate(() => window.aiTherapist.advance(2000));
    expect(
      early.state.fingers.find((f) => f.finger === 'ring')?.glove_helping,
    ).toBe(true);
    const firstTarget = early.commands.find((c) => c.kind === 'target')!;
    expect(firstTarget.v).toBeLessThanOrEqual(0.2);
    const rested = await page.evaluate(() =>
      window.aiTherapist.untilPhase('REST', 0),
    );
    // The default rest plus the 20 s the coach added.
    expect(rested.view.phaseDuration).toBe(
      DEFAULT_EXERCISE_SETTINGS.rest_s + 20,
    );
    const normalTargets = rested.commands.filter((c) => c.kind === 'target');
    // Gentle speed and the lowered middle target hold for help the patient asked for.
    expect(
      normalTargets.every((c) => c.v! <= 0.2 && c.f!.every((f) => f <= 0.95)),
    ).toBe(true);
    expect(
      normalTargets.every(
        (c) =>
          c.f![2] <=
          pullFromClosure(1 - (1 - POSES.open.closure.middle!) * 0.9) + 1e-6,
      ),
    ).toBe(true);
    expect(
      (
        await page.evaluate(
          // Just short of the default rest plus the coach's 20 s.
          (ms) => window.aiTherapist.advance(ms),
          (DEFAULT_EXERCISE_SETTINGS.rest_s + 20) * 1000 - 600,
        )
      ).view.phase,
    ).toBe('REST');
    const next = await page.evaluate(() =>
      window.aiTherapist.untilPhase('ATTEMPT', 1),
    );
    expect(next.state.adjustments.assist_delay_s.thumb).toBe(5);
    expect(
      next.state.fingers.find((f) => f.finger === 'middle')?.target,
    ).toBeCloseTo(1 - (1 - POSES.open.closure.middle!) * 0.9);
    // Asking in Spanish works too, once per attempt.
    const again = await page.evaluate(() =>
      window.aiTherapist.patient('ayuda', true),
    );
    expect(again.view.phase).toBe('ASSIST');
    const shaped = await page.evaluate(() => window.aiTherapist.advance(2000));
    const shapedTargets = shaped.commands
      .slice(next.commands.length)
      .filter((c) => c.kind === 'target');
    expect(shapedTargets.length).toBeGreaterThan(0);
    expect(shapedTargets.every((c) => c.v! <= 0.2)).toBe(true);
    expect(
      shapedTargets.every(
        (c) =>
          c.f![2] <=
          pullFromClosure(1 - (1 - POSES.open.closure.middle!) * 0.9) + 1e-6,
      ),
    ).toBe(true);
    await tool(
      page,
      'brake',
      { reason: 'Rest after those changes.' },
      'Brake · glove released',
    );
    await auditAndReplay(page);
  });

  test('a scripted pain-five check-in releases and pauses before the tool response', async ({
    page,
  }) => {
    await start(page);
    await page.evaluate(() => window.aiTherapist.untilPhase('ASSIST'));
    const pulling = await page.evaluate(() =>
      window.aiTherapist.untilPulling(),
    );
    expect(pulling.firmware.mode).toBe('target');
    const response = await page.evaluate(() =>
      window.aiTherapist.tool('record_feeling', {
        pain: 5,
        fatigue: 6,
        note: 'My hand is sore.',
      }),
    );
    expect(response.ok).toBe(true);
    expect(response.beforeResponse).toEqual({
      phase: 'PAUSED',
      mode: 'none',
      responded: false,
    });
    await expect(page.locator('.therapy-live__copy p')).toContainText(
      'Feeling recorded',
    );
    const stopped = await page.evaluate(() => window.aiTherapist.snapshot());
    expect(stopped.view.phase).toBe('PAUSED');
    expect(stopped.firmware.mode).toBe('none');
    expect(stopped.decisions).toContainEqual(
      expect.objectContaining({
        tool: 'brake',
        source: 'local_rule',
        result: 'applied',
      }),
    );
    expect(stopped.feelings).toContainEqual(
      expect.objectContaining({
        pain: 5,
        fatigue: 6,
        source: 'voice',
        note: 'My hand is sore.',
      }),
    );
    const after = await page.evaluate(() => window.aiTherapist.advance(1000));
    expect(after.commands.filter((c) => c.kind === 'target')).toEqual(
      stopped.commands.filter((c) => c.kind === 'target'),
    );
    expect(after.firmware.attached.every((value) => !value)).toBe(true);
    await expect(
      page.getByRole('button', { name: 'Resume', exact: true }).first(),
    ).toBeVisible();
    await auditAndReplay(page);
    await expect(
      page.getByText('Pain 5/10 · Fatigue 6/10', { exact: true }),
    ).toBeVisible();
  });

  for (const word of ['stop', 'para']) {
    test(`patient says ${word}: partial transcription brakes locally while the model is silent`, async ({
      page,
    }) => {
      await start(page);
      await page.evaluate(() => window.aiTherapist.untilPhase('ATTEMPT'));
      // The patient asks; the glove starts helping.
      const asked = await page.evaluate(() =>
        window.aiTherapist.patient('help me', true),
      );
      expect(asked.view.phase).toBe('ASSIST');
      const pulling = await page.evaluate(() =>
        window.aiTherapist.advance(1000),
      );
      expect(pulling.firmware.mode).toBe('target');
      const stopped = await page.evaluate((word) => {
        const state = window.aiTherapist.patient(word, false);
        window.aiTherapist.modelAudio('stale-model-audio');
        return state;
      }, word);
      expect(stopped.coachTurns).toBe(0);
      expect(stopped.view.phase).toBe('PAUSED');
      expect(stopped.firmware.mode).toBe('none');
      expect(stopped.commands.length).toBeGreaterThan(pulling.commands.length);
      expect(stopped.commands.at(-1)?.kind).toBe('release');
      expect(stopped.decisions.at(-1)).toMatchObject({
        tool: 'brake',
        result: 'applied',
        source: 'local_rule',
      });
      await expect(page.locator('.therapy-live__copy p')).toContainText(
        'Brake · glove released',
      );
      // A delayed model reply cannot restart pulling after the patient's brake.
      const late = await page.evaluate(() =>
        window.aiTherapist.tool('assist_finger_now', {
          finger: 'ring',
          reason: 'Stale model request.',
        }),
      );
      expect(late.ok).toBe(false);
      expect(late.reason).toContain('Patient brake is active');
      await page.evaluate(() => {
        window.aiTherapist.patient('', true);
      });
      const after = await page.evaluate(() => window.aiTherapist.advance(1000));
      expect(after.view.phase).toBe('PAUSED');
      expect(after.commands.filter((c) => c.kind === 'target')).toEqual(
        pulling.commands.filter((c) => c.kind === 'target'),
      );
      expect(after.playedAudio).toEqual([]);
      expect(after.firmware.attached.every((value) => !value)).toBe(true);
      const stored = await auditAndReplay(page);
      expect(stored.transcript).toContainEqual(
        expect.objectContaining({ role: 'patient', text: word }),
      );
      expect(
        stored.transcript.some((line) =>
          line.text.includes('Patient brake is active'),
        ),
      ).toBe(true);
    });
  }

  test('intensity needs genuine recent yes, applies at the boundary, and resistance restores gentle practice', async ({
    page,
  }) => {
    // Exercise the soft resistance detector below the independent hard limit,
    // as in the existing rigid-finger harness; this remains a simulator run.
    await page.route('**/api/calibrations', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      return route.continue({
        postData: JSON.stringify({
          ...route.request().postDataJSON(),
          current_limit_ma: 2200,
        }),
      });
    });
    const initial = await start(page);
    await tool(
      page,
      'intensify',
      {
        finger: 'index',
        kind: 'faster',
        consent: 'accepted_offer',
        patient_quote: 'yes',
      },
      'Intensity request',
      'rejected',
    );
    expect(
      (await page.evaluate(() => window.aiTherapist.snapshot())).state
        .adjustments.intensified,
    ).toEqual([]);
    for (const [finger, kind, label] of [
      ['index', 'faster', 'Faster help requested'],
      ['middle', 'further', 'Further reach requested'],
      ['ring', 'hold_longer', 'Longer hold requested'],
    ]) {
      await page.evaluate(
        ({ finger, kind }) => {
          window.aiTherapist.coach(
            `Would you like to open ${kind} for your ${finger}?`,
          );
          window.aiTherapist.patient('yes');
        },
        { finger, kind },
      );
      await tool(
        page,
        'intensify',
        { finger, kind, consent: 'accepted_offer', patient_quote: 'yes' },
        label,
      );
    }
    const attempt = await page.evaluate(() =>
      window.aiTherapist.untilPhase('ATTEMPT'),
    );
    expect(attempt.state.adjustments.assist_speed.index).toBe(0.3);
    expect(attempt.state.adjustments.hold_extra_s).toBe(2);
    expect(
      attempt.state.fingers.find((f) => f.finger === 'middle')?.target,
    ).toBe(0);
    expect(attempt.state.adjustments.intensified).toEqual([
      'index',
      'middle',
      'ring',
    ]);
    await expect(
      page.getByRole('region', { name: 'Coach decisions', exact: true }),
    ).toContainText('Intensity: Index, Middle, Ring');
    await page.evaluate(() => window.aiTherapist.untilPhase('ASSIST'));
    await page.evaluate(() => window.aiTherapist.rigid('index', true));
    const resisted = await page.evaluate(() =>
      window.aiTherapist.untilEvent('resistance', 'index'),
    );
    expect(
      resisted.events.some(
        ({ event }) => event.kind === 'resistance' && event.finger === 'index',
      ),
    ).toBe(true);
    expect(resisted.state.adjustments.intensified).toEqual([]);
    expect(
      Object.values(resisted.state.adjustments.assist_speed).every(
        (v) => v <= 0.2,
      ),
    ).toBe(true);
    expect(resisted.state.adjustments.hold_extra_s).toBe(0);
    expect(resisted.firmware.limit).toBe(initial.firmware.limit);
    expect(resisted.decisions).toContainEqual(
      expect.objectContaining({
        tool: 'intensify',
        result: 'undone',
        source: 'local_rule',
        applied: expect.objectContaining({ auto_reverted: true }),
      }),
    );
    await expect(
      page.getByRole('region', { name: 'Coach decisions', exact: true }),
    ).toContainText('Gentle again: Index, Middle, Ring (automatic)');
    await expect(page.locator('.therapy-live__copy p')).toContainText(
      'Gentler help',
    );
    await page.evaluate(() => window.aiTherapist.rigid('index', false));
    await auditAndReplay(page);
    await expect(
      page.getByText('Patient said: “yes”', { exact: true }),
    ).toHaveCount(3);
    await expect(
      page.getByText('Requested quote: “yes”', { exact: true }),
    ).toBeVisible();
  });
});
