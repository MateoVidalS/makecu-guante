#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createContact } from './contact.mjs';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(studio, '../..');
const { chromium } = await import(pathToFileURL(path.join(root, 'frontend/node_modules/@playwright/test/index.mjs')).href);
const out = path.join(studio, 'public/recordings');
const evidence = path.join(studio, 'evidence/V1');
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7);
const probe = process.argv.includes('--probe');
const ids = ['session-main', 'session-resist', 'coach-panel', 'doctor-history', 'doctor-replay', 'doctor-summary', 'doctor-export'];
const selected = only ? only.split(',') : ids;
for (const id of selected) if (!ids.includes(id)) throw new Error(`Unknown clip: ${id}`);
const durations = { 'session-main': 45, 'session-resist': 20, 'coach-panel': 20, 'doctor-history': 15, 'doctor-replay': 12, 'doctor-summary': 15, 'doctor-export': 6 };
const origin = 'http://127.0.0.1:5273';
const api = 'http://127.0.0.1:8100';
const env = { ...process.env, REHAB_DB_PATH: '/tmp/memo-video.db', REHAB_PORT: '8100', REHAB_FRONTEND_PORT: '5273', VITE_SIM: '1', VITE_VISION: 'sim', GEMINI_API_KEY: '' };
const temp = await mkdtemp(path.join(tmpdir(), 'memo-capture-'));
await mkdir(out, { recursive: true });
await mkdir(evidence, { recursive: true });
const serverLog = createWriteStream(path.join(temp, 'stack.log'));
let stack;
let browser;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  await browser?.close();
  if (stack?.pid) { try { process.kill(-stack.pid, 'SIGTERM'); } catch {} }
  serverLog.end();
  process.exit(signal === 'SIGINT' ? 130 : 143);
});
async function command(cmd, args, cwd = root, options = {}) {
  const child = spawn(cmd, args, { cwd, env, stdio: 'inherit', ...options });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`${cmd} exited with ${code}`);
}
async function waitFor(url) {
  for (let n = 0; n < 200; n++) {
    if (stack.exitCode != null) throw new Error(`Stack exited. See ${temp}/stack.log`);
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
async function assertFree(url) {
  try { await fetch(url); } catch { return; }
  throw new Error(`${url} is already running. Stop the capture stack before starting another.`);
}
const box = async locator => {
  if (!await locator.count()) return undefined;
  const b = await locator.first().boundingBox();
  return b ? { x: b.x * 2, y: b.y * 2, w: b.width * 2, h: b.height * 2 } : undefined;
};
async function event(clip, page, frame, kind, label, locator, point) {
  clip.events.push({ frame, kind, label, ...(locator ? { box: await box(locator) } : {}), ...(point ? { point } : {}) });
}
async function settle(page) { await page.clock.runFor(34); }
async function prepare() {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'no-preference' });
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-11-08T17:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-08T17:00:00Z'));
  await page.addInitScript(() => {
    window.speechSynthesis.speak = utterance => queueMicrotask(() => utterance.onend?.(new SpeechSynthesisEvent('end', { utterance })));
  });
  // Only the Live device is scripted. Tools still use the real runtime/engine/audit.
  await page.route('**/api/voice/token', r => r.fulfill({ json: { token: 'scripted-not-a-secret', expires_at: '2099-01-01T00:00:00Z', model: 'scripted-live', voice: 'scripted', system_instruction: '', tools: [] } }));
  await page.route('**/api/health', r => r.fulfill({ json: { ok: true, version: 'video-capture', gemini: true } }));
  // No incidental patient recaps or summary POSTs can spend the Gemini quota.
  await page.route('**/api/summaries', r => r.request().method() === 'POST' ? r.fulfill({ status: 503, json: { error: { code: 'llm_unavailable', message: 'Capture uses stored summaries' } } }) : r.continue());
  await page.route('**/e2e/v1.html', async r => {
    const response = await r.fetch({ url: `${origin}/e2e/ai-therapist.html` });
    await r.fulfill({ response, body: (await response.text()).replace('/e2e/ai-therapist-harness.ts', '/e2e/v1-driver.js') });
  });
  await page.route('**/e2e/v1-driver.js', async r => r.fulfill({ contentType: 'text/javascript', body: await readFile(path.join(studio, 'capture/driver.mjs'), 'utf8') }));
  await page.goto(`${origin}/e2e/v1.html`);
  await page.waitForFunction(() => window.aiTherapist?.ready());
  await page.addStyleTag({ content: '* { cursor: none !important; } [data-testid="bench-mirror-status"], [data-capture-dev] { display: none !important; }' });
  // Hide developer entry points only; simulation labels and safety UI stay visible.
  await page.getByRole('button', { name: 'Demo tools', exact: true }).evaluateAll(nodes => nodes.forEach(n => n.setAttribute('data-capture-dev', '')));
  await page.getByRole('button', { name: 'Calibrate simulator', exact: true }).click();
  await page.getByRole('link', { name: 'Continue to practice' }).click();
  await page.getByRole('button', { name: 'Open only, 1 rep', exact: true }).click();
  await page.evaluate(() => window.aiTherapist.advance(200));
  await settle(page);
  return { page, context };
}
async function click(clip, page, frame, locator, label) {
  await event(clip, page, frame, 'click', `click:${label}`, locator);
  await locator.click();
  await settle(page);
}
async function tool(page, name, args) {
  const result = await page.evaluate(({ name, args }) => window.aiTherapist.tool(name, args), { name, args });
  if (!result.ok) throw new Error(`Scripted coach tool rejected: ${name}`);
}
async function start(page) {
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  for (let n = 0; n < 120; n++) {
    await settle(page);
    if (await page.evaluate(() => window.aiTherapist.snapshot().connected)) return;
  }
  throw new Error('Scripted coach did not connect');
}
function ease(value) {
  const x = Math.min(1, Math.max(0, value));
  // Match the brand's cubic-bezier(.2, 0, 0, 1), without overshoot.
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2;
    const bx = 0.6 * (1 - t) ** 2 * t + t ** 3;
    if (bx < x) lo = t; else hi = t;
  }
  const t = (lo + hi) / 2;
  return 3 * (1 - t) * t ** 2 + t ** 3;
}
async function record(id) {
  console.log(`Preparing ${id}`);
  const { page, context } = await prepare();
  const clip = { id, file: `recordings/${id}.mp4`, width: 3840, height: 2160, fps: 30, durationFrames: durations[id] * 30, simulated: true, demoData: true, events: [] };
  let scrollFrom = 0;
  let scrollTo = 0;
  let previousPhase;
  let seenEvents = 0;
  let rigid = false;
  if (id.startsWith('session-') || id === 'coach-panel') {
    await start(page);
    if (id === 'coach-panel') {
      await tool(page, 'adjust_help', { finger: 'index', direction: 'gentler', reason: 'Give your index slower, gentler help.' });
      await tool(page, 'highlight_finger', { finger: 'index' });
    }
  } else {
    if (id === 'doctor-summary') {
      await page.getByRole('link', { name: 'Home', exact: true }).first().click();
      await settle(page);
    } else {
      const route = id === 'doctor-history' ? '/history' : id === 'doctor-replay' ? `/history/sessions/${await replaySession()}` : '/doctor';
      // Reload preserves real REST-backed UI; recordings do not use fixture responses.
      await page.goto(origin + route);
      await page.addStyleTag({ content: '* { cursor: none !important; } [data-testid="bench-mirror-status"], [data-capture-dev] { display: none !important; }' });
      await page.getByRole('button', { name: 'Demo tools', exact: true }).evaluateAll(nodes => nodes.forEach(n => n.setAttribute('data-capture-dev', '')));
      await page.waitForLoadState('networkidle');
      await settle(page);
    }
    if (id === 'doctor-history') {
      await page.getByRole('heading', { name: 'First and latest sessions' }).waitFor();
      scrollFrom = await page.evaluate(() => scrollY);
      scrollTo = 360;
    }
    if (id === 'doctor-replay') {
      const select = page.getByLabel('Attempt', { exact: true });
      const options = await select.locator('option').allTextContents();
      const index = options.findIndex(s => s.includes('Open hand'));
      if (index >= 0) await select.selectOption(String(index));
      await page.getByRole('article', { name: 'Your attempt, moment by moment' }).waitFor();
      await page.waitForLoadState('networkidle');
      await page.getByRole('article', { name: 'Your attempt, moment by moment' }).locator('..').first().scrollIntoViewIfNeeded();
      await settle(page);
    }
  }
  const framesDir = path.join(temp, id);
  await mkdir(framesDir);
  const frameCount = probe ? Math.min(clip.durationFrames, 12) : clip.durationFrames;
  for (let f = 0; f < frameCount; f++) {
    if (id.startsWith('session-')) {
      // Main is slowed 2.5x for the editor; resistance stays at real simulator speed.
      const snapshot = await page.evaluate(ms => window.aiTherapist.advance(ms), id === 'session-main' ? 1000 / 75 : 1000 / 45);
      if (id === 'session-resist' && snapshot.view.phase === 'ASSIST' && !rigid) {
        await page.evaluate(() => window.aiTherapist.rigid('index', true));
        rigid = true;
        await event(clip, page, f, 'mark', 'mark:rigid-index-enabled', page.locator('.hand-view'));
      }
      if (snapshot.view.phase !== previousPhase) {
        await settle(page);
        await event(clip, page, f, 'phase', `phase:${snapshot.view.phase}`, page.locator('.exercise-live'));
        previousPhase = snapshot.view.phase;
        await event(clip, page, f, 'focus', 'focus:virtual-hand', page.locator('.hand-view canvas'));
        await event(clip, page, f, 'focus', 'focus:finger-meters', page.locator('.mx-gauges'));
        const hand = await box(page.locator('.hand-view canvas'));
        if (hand) for (const [finger, x, y] of [['thumb', .44, .65], ['index', .49, .39], ['middle', .55, .34], ['ring', .61, .40], ['pinky', .66, .48]]) {
          await event(clip, page, f, 'focus', `focus:${finger}-fingertip-approximate`, null, { x: hand.x + hand.w * x, y: hand.y + hand.h * y });
        }
      }
      for (const { event: e } of snapshot.events.slice(seenEvents)) {
        if (['resistance', 'reached', 'assist_started'].includes(e.kind)) {
          await settle(page);
          await event(clip, page, f, 'mark', `mark:${e.kind}${e.finger ? `:${e.finger}` : ''}`, page.locator('.instruction'));
          if (e.kind === 'resistance') await event(clip, page, f, 'focus', 'focus:resistance-coach-caption', page.locator('.coach-panel'));
        }
      }
      for (const { event: e } of snapshot.events.slice(seenEvents)) {
        if (e.kind === 'attempt_done' && e.result.reached_final) await event(clip, page, f, 'mark', 'mark:reached-final', page.locator('.instruction'));
      }
      seenEvents = snapshot.events.length;
      if (id === 'session-resist' && snapshot.firmware.mode === 'none' && rigid && !clip.events.some(e => e.label === 'mark:glove-released')) {
        await event(clip, page, f, 'mark', 'mark:glove-released', page.locator('.glove-motors'));
      }
    }
    if (id === 'coach-panel') {
      // Keep the simulated opening at PRESENT while showing the actual therapy tools.
      if (f === 0) {
        await event(clip, page, f, 'focus', 'focus:coach-adjustment', page.getByRole('region', { name: 'Coach decisions', exact: true }));
        await event(clip, page, f, 'mark', 'mark:scripted-live-device-real-runtime-tools', page.locator('.hand-view'));
      }
      if (f === 120) await click(clip, page, f, page.getByRole('button', { name: 'Undo', exact: true }), 'Undo');
      if (f === 210) {
        await tool(page, 'highlight_finger', { finger: 'index' });
        await event(clip, page, f, 'focus', 'focus:highlighted-index', page.locator('.hand-view'));
      }
      if (f === 300) await click(clip, page, f, page.getByRole('button', { name: 'Timeline', exact: true }), 'Timeline');
      if (f === 450) await click(clip, page, f, page.getByRole('dialog', { name: 'Coach decisions', exact: true }).getByRole('button', { name: 'Close', exact: true }), 'Close timeline');
    }
    if (id === 'doctor-history') {
      if (f < 300) await page.evaluate(y => scrollTo(0, y), scrollFrom + (scrollTo - scrollFrom) * ease((f - 60) / 240));
      if (f === 0 || f === 390) await event(clip, page, f, 'focus', 'focus:then-now-demo-data', page.getByRole('heading', { name: 'First and latest sessions' }).locator('..'));
      // The history route exposes then/now; the Doctor report contains trend charts.
      if (f === 300) {
        await click(clip, page, f, page.getByRole('link', { name: 'Doctor view', exact: true }), 'Doctor view trends');
        await page.waitForLoadState('networkidle');
        await page.getByText('Details', { exact: true }).click();
        await page.locator('[data-chat-section="range"]').scrollIntoViewIfNeeded();
        await event(clip, page, f, 'focus', 'focus:range-trends-demo-data', page.locator('[data-chat-section="range"]'));
      }
    }
    if (id === 'doctor-replay' && f === 0) {
      await event(clip, page, f, 'focus', 'focus:vision-servo-current-phase-bands', page.getByRole('article', { name: 'Your attempt, moment by moment' }).locator('..'));
    }
    if (id === 'doctor-summary' && f === 60) {
      await click(clip, page, f, page.getByRole('link', { name: 'Doctor view', exact: true }), 'Doctor view — stored therapist summary');
      await page.waitForLoadState('networkidle');
      await page.locator('.summary-copy').waitFor();
      await event(clip, page, f, 'mark', 'mark:stored-real-Gemini-summary-visible', page.locator('.therapist-summary'));
    }
    if (id === 'doctor-export' && f === 60) {
      const download = page.waitForEvent('download');
      await click(clip, page, f, page.getByRole('button', { name: 'Export CSV', exact: true }), 'Export CSV');
      await download;
      await event(clip, page, f, 'mark', 'mark:export-downloaded', page.getByRole('status').filter({ hasText: 'Export downloaded' }));
    }
    await settle(page);
    await page.screenshot({ path: path.join(framesDir, `${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 95 });
    if (f % 150 === 0) console.log(`${id}: ${f}/${frameCount}`);
  }
  await context.close();
  if (probe) { console.log(`Probe frames: ${framesDir}`); return; }
  await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-threads', '2', '-filter_threads', '1', '-framerate', '30', '-i', path.join(framesDir, '%05d.jpg'), '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(out, `${id}.mp4`)]);
  await writeFile(path.join(out, `${id}.events.json`), JSON.stringify(clip, null, 2) + '\n');
  await createContact(clip, framesDir);
  await rm(framesDir, { recursive: true });
  console.log(`Finished ${id}`);
}
async function replaySession() {
  const sessions = await (await fetch(`${api}/api/sessions?limit=100`)).json();
  return sessions.find(s => s.is_demo && s.assist_direction === 'open' && s.n_attempts > 1).id;
}
try {
  await assertFree(`${api}/api/health`);
  await assertFree(origin);
  await command('uv', ['run', 'python', '-m', 'tools.seed_demo', ...(only ? [] : ['--reset'])], path.join(root, 'backend'));
  stack = spawn('python3', ['scripts/dev.py'], { cwd: root, env, detached: true, stdio: ['ignore', serverLog, serverLog] });
  await Promise.all([waitFor(`${api}/api/health`), waitFor(origin)]);
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--disable-features=LocalNetworkAccessChecks'] });
  for (const id of selected) {
    if (id === 'doctor-summary') await command(path.join(root, 'backend/.venv/bin/python'), [path.join(studio, 'capture/summary.py')]);
    await record(id);
  }
  if (!probe) {
    const clips = [];
    for (const id of ids) {
      try { clips.push(JSON.parse(await readFile(path.join(out, `${id}.events.json`), 'utf8'))); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await writeFile(path.join(out, 'manifest.json'), JSON.stringify({ version: 1, clips }, null, 2) + '\n');
    const total = (await Promise.all(clips.map(c => stat(path.join(studio, 'public', c.file))))).reduce((n, s) => n + s.size, 0);
    if (total > 150 * 1024 * 1024) for (const clip of clips) {
      await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(studio, 'public', clip.file), '-vf', 'scale=1920:1080', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(out, `${clip.id}.proxy.mp4`)]);
    }
    console.log(`Manifest saved. 4K total: ${(total / 1024 / 1024).toFixed(1)} MiB`);
  }
} finally {
  await browser?.close();
  if (stack?.pid) { try { process.kill(-stack.pid, 'SIGTERM'); } catch {} }
  serverLog.end();
  console.log(`Capture logs: ${temp}`);
}
