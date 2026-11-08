#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(studio, 'public/recordings/manifest.json');
const manifest = JSON.parse(await readFile(file, 'utf8'));
const required = ['session-main', 'session-resist', 'coach-panel', 'doctor-history', 'doctor-replay', 'doctor-summary', 'doctor-export'];
assert.equal(manifest.version, 1);
assert.deepEqual(manifest.clips.map(c => c.id).sort(), required.sort());
const temp = await mkdtemp(path.join(tmpdir(), 'memo-manifest-'));
try {
  // Compile literal JSON against the frozen interface, with no type assertion bypass.
  const check = path.join(temp, 'check.ts');
  await writeFile(check, `import type {RecordingManifest} from ${JSON.stringify(path.join(studio, 'src/contracts.ts'))};\nexport default ${JSON.stringify(manifest)} satisfies RecordingManifest;\n`);
  execFileSync(process.execPath, [path.join(studio, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--allowImportingTsExtensions', check], { stdio: 'inherit' });
  for (const clip of manifest.clips) {
    assert.equal(clip.width, 3840);
    assert.equal(clip.height, 2160);
    assert.equal(clip.fps, 30);
    assert.equal(clip.simulated, true);
    assert.equal(clip.demoData, true);
    assert.equal(clip.file, `recordings/${clip.id}.mp4`);
    const media = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames,pix_fmt', '-of', 'json', path.join(studio, 'public', clip.file)], { encoding: 'utf8' })).streams[0];
    assert.equal(media.codec_name, 'h264');
    assert.equal(media.pix_fmt, 'yuv420p');
    assert.equal(media.width, clip.width);
    assert.equal(media.height, clip.height);
    assert.equal(media.r_frame_rate, '30/1');
    assert.equal(media.avg_frame_rate, '30/1');
    assert.equal(Number(media.nb_frames), clip.durationFrames);
    assert(clip.events.length > 0, `${clip.id}: missing events`);
    let previous = -1;
    for (const event of clip.events) {
      assert(Number.isInteger(event.frame) && event.frame >= previous && event.frame < clip.durationFrames, `${clip.id}: invalid event frame`);
      previous = event.frame;
      if (event.box) {
        const { x, y, w, h } = event.box;
        assert([x, y, w, h].every(Number.isFinite));
        assert(w > 0 && h > 0);
        // Scrollable sections may extend outside the viewport; anchors must be visible.
        assert(x < clip.width && y < clip.height && x + w > 0 && y + h > 0, `${clip.id}: invisible box at ${event.frame}`);
      }
      if (event.point) assert(event.point.x >= 0 && event.point.x <= clip.width && event.point.y >= 0 && event.point.y <= clip.height);
    }
    assert((await stat(path.join(studio, 'evidence/V1', `${clip.id}.png`))).size > 1000);
    console.log(`${clip.id}: ${clip.durationFrames} frames, 3840×2160 H.264, events valid`);
  }
  const main = manifest.clips.find(c => c.id === 'session-main');
  for (const phase of ['PRESENT', 'ATTEMPT', 'ASSIST', 'ASSIST_HOLD']) assert(main.events.some(e => e.label === `phase:${phase}`));
  const resist = manifest.clips.find(c => c.id === 'session-resist');
  for (const label of ['mark:rigid-index-enabled', 'mark:resistance:index', 'mark:glove-released']) assert(resist.events.some(e => e.label === label), `Missing ${label}`);
  const coach = manifest.clips.find(c => c.id === 'coach-panel');
  assert(coach.events.some(e => e.label === 'click:Undo'));
  console.log('Recording manifest satisfies RecordingManifest and all seven media files match.');
} finally { await rm(temp, { recursive: true }); }
