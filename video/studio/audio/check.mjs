// Run from video/studio: node audio/check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const moduleUrl = (source) => 'data:text/javascript;base64,' + Buffer.from(
  ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText,
).toString('base64');
const timelineUrl = moduleUrl(readFileSync('src/timeline.ts', 'utf8'));
const { TOTAL_FRAMES, FPS, SCENE_START } = await import(timelineUrl);
const { VO } = await import(moduleUrl(readFileSync('src/script.ts', 'utf8')));
const mixSource = readFileSync('src/audio/mix.ts', 'utf8').replace("'../timeline'", JSON.stringify(timelineUrl));
const { DUCK_GAIN, DUCK_RAMP_FRAMES, cueGain, duckGain, musicGain } = await import(moduleUrl(mixSource));
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const vo = json('public/audio/vo/manifest.json');
const music = json('public/audio/music/manifest.json');
const sfx = json('public/audio/sfx/manifest.json');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const probe = (file) => jsonProbe(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', `public/${file}`]));
const jsonProbe = (value) => JSON.parse(value.toString());

assert.equal(DUCK_RAMP_FRAMES, 6, '200 ms at 30 fps');
close(DUCK_GAIN, 0.31622776601683794);
close(duckGain(94, [[100, 130]]), 1);
close(duckGain(97, [[100, 130]]), (1 + DUCK_GAIN) / 2);
close(duckGain(100, [[100, 130]]), DUCK_GAIN);
close(duckGain(130, [[100, 130]]), DUCK_GAIN);
close(duckGain(133, [[100, 130]]), (1 + DUCK_GAIN) / 2);
close(duckGain(136, [[100, 130]]), 1);
close(duckGain(127, [[100, 130], [125, 150]]), DUCK_GAIN); // Overlaps do not compound.
close(duckGain(0, []), 1);
const cues = [{ frame: 10, gain: .2 }, { frame: 20, gain: .8 }];
close(cueGain(0, cues), .2);
close(cueGain(15, cues), .5);
close(cueGain(99, cues), .8);
close(musicGain(15, cues, [[12, 18]]), .5 * DUCK_GAIN);

assert.equal(vo.lines.length, VO.length, 'Every VO id is present');
assert.equal(new Set(vo.lines.map((line) => line.id)).size, VO.length, 'No duplicate ids');
assert.equal(vo.voice.coach, 'Puck');
assert.equal(vo.voice.narrator, 'Sulafat');
for (const line of VO) {
  const entry = vo.lines.find((item) => item.id === line.id);
  assert.ok(entry, line.id);
  const audio = probe(entry.file);
  assert.equal(audio.streams[0].sample_rate, '48000', line.id);
  const frames = Math.ceil(Number(audio.format.duration) * FPS - 1e-6);
  assert.equal(entry.durationFrames, frames, `${line.id}: manifest matches samples`);
  assert.ok(frames <= line.maxFrames, `${line.id}: ${frames} > ${line.maxFrames}`);
  assert.ok(SCENE_START[line.scene] + line.at + frames <= TOTAL_FRAMES);
}
const bed = probe(music.file);
assert.equal(music.bpm, 100);
assert.equal(bed.streams[0].sample_rate, '48000');
assert.equal(Number(bed.streams[0].duration_ts), Math.round(TOTAL_FRAMES / FPS * 48000), 'Exact music sample count');
assert.ok(music.source.includes('CC BY 4.0'));
assert.ok(music.credit);
assert.ok(music.cues.every((cue, i, all) => cue.gain >= 0 && cue.gain <= 1 && (!i || cue.frame > all[i - 1].frame)));
assert.equal(cueGain(SCENE_START.hook - 1, music.cues), 0, 'Silent founders opening');
assert.ok(cueGain(SCENE_START.hook, music.cues) > .5, 'Piano enters on the hook cut');
const wav = readFileSync(`public/${music.file}`);
let pcm;
for (let offset = 12; offset + 8 <= wav.length;) {
  const size = wav.readUInt32LE(offset + 4);
  if (wav.toString('ascii', offset, offset + 4) === 'data') {
    pcm = wav.subarray(offset + 8, offset + 8 + size);
    break;
  }
  offset += 8 + size + (size % 2);
}
assert.ok(pcm, 'WAV has PCM data');
const hookByte = Math.round(SCENE_START.hook / FPS * 48000) * 4; // stereo PCM16
assert.ok(pcm.subarray(0, hookByte).every((byte) => byte === 0), 'Bed is exactly silent before 7.2 s');
assert.ok(pcm.subarray(hookByte, hookByte + 1600 * 4).some((byte) => byte !== 0), 'Piano sounds in the first hook frame');
assert.ok(cueGain(SCENE_START.session + 900, music.cues) < .05, 'Resistance drop');
assert.ok(cueGain(SCENE_START.session + 1152, music.cues) > .6, 'Release return');
assert.ok(cueGain(SCENE_START.build, music.cues) > cueGain(SCENE_START.build - 12, music.cues), 'Build lift');
assert.ok(cueGain(SCENE_START.underHood, music.cues) > cueGain(SCENE_START.underHood - 12, music.cues), 'Board lift');
assert.equal(cueGain(TOTAL_FRAMES - 1, music.cues), 0, 'Fade to silence');
assert.ok(sfx.sounds.length <= 6);
for (const sound of sfx.sounds) {
  assert.ok(sound.source.includes('CC0'));
  assert.ok(Number(probe(sound.file).format.duration) < .5, sound.id);
}
console.log(`Audio checks passed: ${VO.length} VO slots, exact ${TOTAL_FRAMES / FPS} s bed, 3 SFX, duck/cue boundaries.`);
