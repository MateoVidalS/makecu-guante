"""Split cached scene takes at silence and verify words locally (no API requests).

From backend/: uv run --with faster-whisper python ../video/studio/audio/prepare_vo.py
Uses ffmpeg, numpy, faster-whisper; does not add project dependencies.
"""
import difflib
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys

import numpy as np
from faster_whisper import WhisperModel

sys.path.insert(0, str(Path(__file__).parent))
from generate import CONFIG, ROOT, lines


def normalized(text):
    text = text.lower().replace('cut-off', 'cutoff').replace('watchdog', 'watch dog')
    text = re.sub(r'\b20\b', 'twenty', text)
    return re.findall(r"[a-z0-9]+", text.lower())


def transcribe(model, path, cache_tag='base.en'):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
    cache = ROOT / 'audio/cache' / f'{path.stem}-{cache_tag}-{digest}-transcript.json'
    if cache.exists():
        return json.loads(cache.read_text())
    data = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path),
                                   '-f', 'f32le', '-ar', '16000', '-ac', '1', '-'])
    segments, _ = model.transcribe(np.frombuffer(data, dtype=np.float32),
                                  word_timestamps=True, language='en', beam_size=5)
    result = [{'start': float(s.start), 'end': float(s.end), 'text': s.text,
               'words': [{'start': float(w.start), 'end': float(w.end), 'word': w.word}
                         for w in s.words]} for s in segments]
    cache.write_text(json.dumps(result, indent=2))
    return result


def silence(path):
    result = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(path), '-af',
                             'silencedetect=n=-30dB:d=0.12', '-f', 'null', '-'],
                            capture_output=True, text=True, check=True)
    starts = re.findall(r'silence_start: ([\d.]+)', result.stderr)
    ends = re.findall(r'silence_end: ([\d.]+)', result.stderr)
    duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
        'format=duration', '-of', 'csv=p=0', str(path)]))
    if len(ends) < len(starts):
        ends.append(str(duration))
    return [(float(a), float(b)) for a, b in zip(starts, ends)], duration


def main():
    edits = ROOT / 'audio/vo-edit.json'
    if edits.exists() and any('replacement-' in entry['source'] for entry in json.loads(edits.read_text())):
        raise SystemExit('Owner revisions are installed. Use replace_vo.py; the initial scene takes predate current copy.')
    script = lines()
    model = WhisperModel('base.en', device='cpu', compute_type='int8')
    output, qa = [], []
    for scene in dict.fromkeys(line['scene'] for line in script):
        for voice in ['narrator', 'coach']:
            selected = [line for line in script if line['scene'] == scene and line['voice'] == voice]
            if not selected:
                continue
            path = ROOT / ('public/audio/auditions/vo-' + CONFIG['narrator'].lower() + '.wav'
                           if scene == 'problem' else f'audio/cache/scene-{scene if voice == "narrator" else "session-coach"}.wav')
            segments = transcribe(model, path)
            words = [word for segment in segments for word in segment['words']]
            heard = [token for word in words for token in normalized(word['word'])]
            word_times = [word for word in words for _ in normalized(word['word'])]
            expected = [token for line in selected for token in normalized(line['text'])]
            matcher = difflib.SequenceMatcher(None, expected, heard, autojunk=False)
            mapping = {a + i: b + i for a, b, length in matcher.get_matching_blocks() for i in range(length)}
            # ASR spells the brand as "MIMO" in some takes. A one-word
            # substitution still has a valid timing anchor; preserve the script.
            for tag, a, b, c, d in matcher.get_opcodes():
                if tag == 'replace' and b - a == d - c:
                    mapping.update({a + i: c + i for i in range(b - a)})
            print(scene, voice, ' / '.join(s['text'].strip() for s in segments), flush=True)
            if matcher.ratio() < 0.9:
                raise SystemExit(f'{scene}: transcript differs; inspect cached transcript before splitting')
            gaps, duration = silence(path)
            boundaries = [0.0]
            cursor = 0
            for line in selected[:-1]:
                cursor += len(normalized(line['text']))
                left = word_times[mapping[cursor - 1]]['end']
                right = word_times[mapping[cursor]]['start']
                nearby = [(a, b) for a, b in gaps if a >= left - 0.2 and b <= right + 0.2]
                boundary = sum(max(nearby, key=lambda pair: pair[1] - pair[0])) / 2 if nearby else (left + right) / 2
                # A reviewed 77 ms gap preserves the final consonants in
                # "attempt" where ASR timestamps put the boundary too early.
                boundaries.append(CONFIG.get('splitOverrides', {}).get(line['id'], boundary))
            boundaries.append(duration)
            for index, line in enumerate(selected):
                start, end = boundaries[index:index + 2]
                # Retain 30 ms of room around the first/last non-silent sample.
                for a, b in gaps:
                    if a <= start + 0.02 and b > start:
                        start = max(start, b - 0.03)
                    if a < end and b >= end - 0.02:
                        end = min(end, a + 0.03)
                out = ROOT / f'public/audio/vo/{line["id"]}.wav'
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(start), '-to', str(end),
                    '-i', str(path), '-af', 'loudnorm=I=-16:TP=-2:LRA=7', '-ar', '48000',
                    '-ac', '1', '-c:a', 'pcm_s16le', str(out)], check=True)
                retry = ROOT / f'audio/cache/retry-{line["id"]}.wav'
                pause_edits = []
                if retry.exists():
                    retry_gaps, retry_duration = silence(retry)
                    start, end = 0, retry_duration
                    for a, b in retry_gaps:
                        if a == 0:
                            start = max(0, b - .03)
                        if b >= retry_duration - .02:
                            end = min(end, a + .03)
                    # The faster take still exceeds 4.2 s because of two long
                    # silent pauses. Tighten those to 150 ms without speeding up
                    # or removing any spoken audio.
                    keep, cursor = [], start
                    for a, b in retry_gaps:
                        if line['id'] == 'coach-1' and a > start and b < end and b - a > .18:
                            keep.append((cursor, a + .075))
                            cursor = b - .075
                            pause_edits.append({'from': a + .075, 'to': cursor})
                    keep.append((cursor, end))
                    filters = [f'[0:a]atrim=start={a}:end={b},asetpts=PTS-STARTPTS[p{i}]'
                               for i, (a, b) in enumerate(keep)]
                    filters.append(''.join(f'[p{i}]' for i in range(len(keep))) +
                                   f'concat=n={len(keep)}:v=0:a=1,loudnorm=I=-16:TP=-2:LRA=7[out]')
                    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(retry),
                        '-filter_complex', ';'.join(filters), '-map', '[out]', '-ar', '48000',
                        '-ac', '1', '-c:a', 'pcm_s16le', str(out)], check=True)
                seconds = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
                    'format=duration', '-of', 'csv=p=0', str(out)]))
                frames = math.ceil(seconds * 30 - 1e-6)
                output.append({'id': line['id'], 'file': f'audio/vo/{line["id"]}.wav', 'durationFrames': frames})
                qa.append({'id': line['id'], 'text': line['text'], 'source': str(path.relative_to(ROOT)),
                           'retrySource': str(retry.relative_to(ROOT)) if retry.exists() else None,
                           'pauseEdits': pause_edits,
                           'start': round(start, 4), 'end': round(end, 4), 'durationFrames': frames,
                           'maxFrames': line['maxFrames']})
                print(line['id'], frames, '/', line['maxFrames'], flush=True)
    (ROOT / 'public/audio/vo/manifest.json').write_text(json.dumps({
        'version': 1, 'voice': {'narrator': CONFIG['narrator'], 'coach': CONFIG['coach'],
                               'model': CONFIG['ttsModel'] + '; coach-1, session-1, reveal-1, build-1: ' + CONFIG['retryModel']}, 'lines': output}, indent=2) + '\n')
    (ROOT / 'audio/vo-edit.json').write_text(json.dumps(qa, indent=2) + '\n')


if __name__ == '__main__':
    main()
