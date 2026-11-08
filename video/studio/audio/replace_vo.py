"""Apply only owner revisions/additions, retaining every other WAV unchanged.

From backend/: uv run --with faster-whisper python ../video/studio/audio/replace_vo.py
Generate the three cached replacement takes first with generate.py replace.
"""
import hashlib
import json
import math
import subprocess

from faster_whisper import WhisperModel
from generate import CONFIG, ROOT, lines
from prepare_vo import normalized, silence, transcribe


def main():
    script = lines()
    ids = {id for group in CONFIG['replacementGroups'].values() for id in group}
    untouched = {line['id']: hashlib.sha256((ROOT / f'public/audio/vo/{line["id"]}.wav').read_bytes()).hexdigest()
                 for line in script if line['id'] not in ids}
    manifest_path = ROOT / 'public/audio/vo/manifest.json'
    manifest = json.loads(manifest_path.read_text())
    active_ids = {line['id'] for line in script}
    removed = [entry['id'] for entry in manifest['lines'] if entry['id'] not in active_ids]
    manifest['lines'] = [entry for entry in manifest['lines'] if entry['id'] in active_ids]
    qa_path = ROOT / 'audio/vo-edit.json'
    qa = {entry['id']: entry for entry in json.loads(qa_path.read_text())}
    model = WhisperModel('small.en', device='cpu', compute_type='int8', cpu_threads=2)
    for group, selected_ids in CONFIG['replacementGroups'].items():
        selected = [line for line in script if line['id'] in selected_ids]
        source = ROOT / f'audio/cache/replacement-{group}.wav'
        segments = transcribe(model, source, 'small.en')
        words = [word for segment in segments for word in segment['words']]
        tokens = [(token, word) for word in words for token in normalized(word['word'].lower().replace('mimo', 'memo'))]
        heard = [token for token, _ in tokens]
        expected = [token for line in selected for token in normalized(line['text'])]
        if heard != expected:
            raise SystemExit(f'{group}: review replacement transcript: ' + ' / '.join(s['text'] for s in segments))
        gaps, duration = silence(source)
        boundaries, cursor = [0.0], 0
        for line in selected[:-1]:
            cursor += len(normalized(line['text']))
            left, right = tokens[cursor - 1][1]['end'], tokens[cursor][1]['start']
            # Whisper can timestamp the last word into the following silence.
            # Require a long detected gap spanning that boundary, allowing its
            # start to precede the approximate word end by up to half a second.
            nearby = [(a, b) for a, b in gaps
                      if a >= left - .5 and b <= right + .2 and b >= left and b - a >= .25]
            if not nearby:
                raise SystemExit(f'{line["id"]}: no safe paragraph silence; inspect cached take')
            a, b = max(nearby, key=lambda pair: pair[1] - pair[0])
            boundaries.append((a + b) / 2)
        boundaries.append(duration)
        for i, line in enumerate(selected):
            start, end = boundaries[i:i + 2]
            for a, b in gaps:
                if a <= start + .02 and b > start:
                    start = max(start, b - .03)
                if a < end and b >= end - .02:
                    end = min(end, a + .03)
            output = ROOT / f'public/audio/vo/{line["id"]}.wav'
            pause_edits = []
            keep, segment_start = [], start
            if math.ceil((end - start) * 30) > line['maxFrames']:
                for a, b in gaps:
                    if a > start and b < end and b - a > .18:
                        keep.append((segment_start, a + .075))
                        segment_start = b - .075
                        pause_edits.append({'from': a + .075, 'to': segment_start})
            keep.append((segment_start, end))
            filters = [f'[0:a]atrim=start={a}:end={b},asetpts=PTS-STARTPTS[p{i}]'
                       for i, (a, b) in enumerate(keep)]
            filters.append(''.join(f'[p{i}]' for i in range(len(keep))) +
                           f'concat=n={len(keep)}:v=0:a=1,loudnorm=I=-16:TP=-2:LRA=7[out]')
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(source),
                '-filter_complex', ';'.join(filters), '-map', '[out]', '-ar', '48000',
                '-ac', '1', '-c:a', 'pcm_s16le', str(output)], check=True)
            seconds = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
                'format=duration', '-of', 'csv=p=0', str(output)]))
            frames = math.ceil(seconds * 30 - 1e-6)
            if frames > line['maxFrames']:
                raise SystemExit(f'{line["id"]}: {frames} frames exceeds {line["maxFrames"]}')
            entry = next((entry for entry in manifest['lines'] if entry['id'] == line['id']), None)
            if entry is None:
                manifest['lines'].append({'id': line['id'], 'file': f'audio/vo/{line["id"]}.wav', 'durationFrames': frames})
            else:
                entry['durationFrames'] = frames
            qa[line['id']] = {'id': line['id'], 'text': line['text'],
                'source': str(source.relative_to(ROOT)), 'retrySource': None, 'pauseEdits': pause_edits,
                'start': round(start, 4), 'end': round(end, 4),
                'durationFrames': frames, 'maxFrames': line['maxFrames']}
            print(f'{line["id"]}: {frames}/{line["maxFrames"]} frames, Sulafat', flush=True)
    for id, digest in untouched.items():
        assert hashlib.sha256((ROOT / f'public/audio/vo/{id}.wav').read_bytes()).hexdigest() == digest
    for line in script:
        qa[line['id']]['maxFrames'] = line['maxFrames']
    if '; owner replacements:' not in manifest['voice']['model']:
        manifest['voice']['model'] += '; owner replacements: ' + CONFIG['retryModel']
    manifest['lines'].sort(key=lambda entry: next(i for i, line in enumerate(script) if line['id'] == entry['id']))
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    qa_path.write_text(json.dumps([qa[line['id']] for line in script], indent=2) + '\n')
    (ROOT / 'audio/revision-report.json').write_text(json.dumps({
        'updatedIds': sorted(ids), 'removedIds': removed, 'unchangedWavSha256': untouched,
        'narrator': CONFIG['narrator'], 'requests': len(CONFIG['replacementGroups']),
    }, indent=2) + '\n')


if __name__ == '__main__':
    main()
