#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(studio, 'public');
const evidence = path.join(studio, 'evidence/V1');
export function sampleFrames(clip) {
  const at = label => clip.events.find(e => e.label === label)?.frame;
  if (clip.id === 'session-main') return [0, at('phase:ATTEMPT') + 30, at('phase:ASSIST') + 30,
    Math.floor((at('phase:ASSIST') + at('phase:ASSIST_HOLD')) / 2),
    at('phase:ASSIST_HOLD') + 30, at('phase:REST') + 30];
  if (clip.id === 'session-resist') return [0, at('phase:ATTEMPT') + 30, at('phase:ASSIST') + 15,
    at('mark:resistance:index') + 5, at('mark:glove-released') + 15, clip.durationFrames - 1];
  if (clip.id === 'doctor-chat') return [90, 156, 168, 195, 244, 330];
  if (clip.id === 'coach-panel') return [0, 121, 211, 301, 451, 599];
  return Array.from({ length: 6 }, (_, i) => Math.floor((i + 0.5) * clip.durationFrames / 6));
}
export async function createContact(clip, framesDir) {
  const temp = await mkdtemp(path.join(tmpdir(), 'memo-contact-'));
  const ffmpeg = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-threads', '2', '-filter_threads', '1', ...args], { stdio: 'inherit' });
  try {
    const sources = [];
    for (const [i, frame] of sampleFrames(clip).entries()) {
      if (!Number.isInteger(frame) || frame < 0 || frame >= clip.durationFrames) throw new Error(`${clip.id}: missing contact-sheet event`);
      if (framesDir) sources.push(path.join(framesDir, `${String(frame).padStart(5, '0')}.jpg`));
      else {
        const target = path.join(temp, `${i}.jpg`);
        ffmpeg(['-ss', String(frame / clip.fps), '-i', path.join(publicDir, clip.file), '-frames:v', '1', '-vf', 'scale=960:540', target]);
        sources.push(target);
      }
    }
    const list = path.join(temp, 'contact.txt');
    await writeFile(list, sources.map(file => `file '${file.replaceAll("'", "'\\''")}'`).join('\n') + '\n');
    const targetEvidence = clip.id === 'doctor-chat' ? path.join(studio, 'evidence/V1c') : evidence;
    await mkdir(targetEvidence, { recursive: true });
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', 'scale=960:540,tile=3x2', '-frames:v', '1', path.join(targetEvidence, `${clip.id}.png`)]);
    console.log(`${clip.id}: contact frames ${sampleFrames(clip).join(', ')}`);
  } finally { await rm(temp, { recursive: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ids = process.argv.slice(2);
  const clips = ids.length ? await Promise.all(ids.map(async id => JSON.parse(await readFile(path.join(publicDir, `recordings/${id}.events.json`), 'utf8'))))
    : JSON.parse(await readFile(path.join(publicDir, 'recordings/manifest.json'), 'utf8')).clips;
  for (const clip of clips) await createContact(clip);
}
