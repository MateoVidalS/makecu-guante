/* global process, console, window, setInterval, clearInterval, performance, speechSynthesis, atob */
/** Run against make dev-sim: node src/voice/browser-check.mjs http://127.0.0.1:5174 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const url = process.argv[2] ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({
  ...(process.env.CHROME === '1' ? { channel: 'chrome' } : {}),
  headless: process.env.HEADED !== '1',
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    permissions: ['microphone'],
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${url}/exercise`);
  await page.locator('main').waitFor();
  // Exercise the real modules with scripted engine events; no physical device.
  await page.evaluate(async () => {
    const { mountCheck } = await import('/src/voice/check.browser.tsx');
    window.check = mountCheck();
  });
  await page.getByRole('button', { name: 'Start voice browser check' }).click();
  await page.waitForFunction(() => window.check.voice?.mode === 'simple');
  await page
    .getByText('Live coach unavailable — using simple voice', { exact: true })
    .waitFor();
  const fallback = await page.evaluate(() => ({
    mode: window.check.voice.mode,
    unavailable: window.check.voice.unavailable,
  }));
  assert.deepEqual(fallback, { mode: 'simple', unavailable: true });
  const audio = await page.evaluate(async () => {
    const check = window.check;
    await check.audio.open((data) => check.capture.push(data));
    return await new Promise((resolve) => {
      const timer = setInterval(() => {
        if (!check.capture.length) return;
        clearInterval(timer);
        check.audio.play(check.capture[0]);
        check.audio.flush();
        check.audio.setMuted(true);
        const result = {
          chunks: check.capture.length,
          bytes: atob(check.capture[0]).length,
        };
        check.audio.close();
        resolve(result);
      }, 20);
    });
  });
  assert.equal(audio.bytes, 640);
  // Let the browser initialize its platform voice inventory.
  await page
    .waitForFunction(() => speechSynthesis.getVoices().length > 0, null, {
      timeout: 3000,
    })
    .catch(() => {});
  await page.context().setOffline(true);
  // Observe actual WebAudio oscillator start and speechSynthesis enqueue, without mocks.
  const timing = await page.evaluate(async () => {
    const check = window.check;
    check.local.cancel();
    const originalTone = check.local.tone.bind(check.local);
    const originalSpeak = check.local.speak.bind(check.local);
    const originalEnqueue = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = (utterance) => {
      utterance.addEventListener('start', () => {
        check.timings.phraseStarted = performance.now() - started;
      });
      originalEnqueue(utterance);
    };
    let started;
    check.local.tone = (kind) => {
      originalTone(kind);
      check.timings.earconScheduled = performance.now() - started;
    };
    check.local.speak = (text, done) => {
      originalSpeak(text, done);
      check.timings.phraseQueued = performance.now() - started;
    };
    started = performance.now();
    check.emit({
      kind: 'safety',
      source: 'overcurrent',
      finger: 'index',
      ma: 950,
    });
    check.emit({
      kind: 'phase',
      phase: 'PAUSED',
      pose: 'hook',
      rep: 1,
      index: 0,
    });
    return {
      ...check.timings,
      caption: check.voice.lastCoachLine,
      context: check.local.context.state,
      baseLatency: check.local.context.baseLatency,
      voices: speechSynthesis.getVoices().length,
    };
  });
  assert.ok(timing.earconScheduled < 50);
  assert.ok(timing.phraseQueued < 300);
  assert.equal(timing.context, 'running');
  await page
    .getByText('Stopping. I felt resistance in your index.', {
      exact: true,
    })
    .waitFor();
  await page
    .waitForFunction(
      () => window.check.timings.phraseStarted !== undefined,
      null,
      {
        timeout: 3000,
      },
    )
    .catch(() => {});
  timing.phraseStarted = await page.evaluate(
    () => window.check.timings.phraseStarted ?? null,
  );
  if (process.env.CHROME === '1')
    assert.ok(timing.phraseStarted !== null && timing.phraseStarted < 300);
  timing.caption = await page.evaluate(() => window.check.voice.lastCoachLine);
  const patientBrake = await page.evaluate(() => {
    const check = window.check;
    const started = performance.now();
    check.patient('me duele');
    return { elapsed: performance.now() - started, brakes: check.brakes() };
  });
  assert.equal(patientBrake.brakes, 1);
  assert.ok(patientBrake.elapsed < 50);
  await page
    .getByText('Stopped. The glove has released. Tell me how you feel.', {
      exact: true,
    })
    .waitFor();
  await page
    .getByRole('complementary', { name: 'Voice coach' })
    .first()
    .screenshot({ path: '/tmp/wp8-browser-check.png' });
  console.log(
    JSON.stringify(
      {
        fallback,
        audio,
        timing,
        patientBrake,
        errors,
        screenshot: '/tmp/wp8-browser-check.png',
      },
      null,
      2,
    ),
  );
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.check.dispose());
} finally {
  await browser.close();
}
