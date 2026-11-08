// Sanity checks run by `pnpm check`: VO lines fit their slots and the manifests match the timeline.
import { existsSync, readFileSync } from 'node:fs';
const vo = 'public/audio/vo/manifest.json';
if (existsSync(vo)) {
  const m = JSON.parse(readFileSync(vo, 'utf8'));
  const src = readFileSync('src/script.ts', 'utf8');
  let bad = 0;
  for (const l of m.lines) {
    const re = new RegExp(`id: '${l.id}'[^}]*maxFrames: (\\d+)`);
    const max = Number(src.match(re)?.[1]);
    if (!max) { console.error(`VO ${l.id}: not in script.ts`); bad++; continue; }
    if (l.durationFrames > max) { console.error(`VO ${l.id}: ${l.durationFrames} f > slot ${max} f`); bad++; }
  }
  if (bad) process.exit(1);
}
const music = 'public/audio/music/manifest.json';
if (existsSync(music)) {
  const m = JSON.parse(readFileSync(music, 'utf8'));
  if (m.bpm !== 100) { console.error(`music bpm ${m.bpm} != 100`); process.exit(1); }
}
console.log('timeline check ok');
