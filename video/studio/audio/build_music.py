"""Reproduce the CC BY fallback edit, two audition excerpts, and original SFX.

uv run --with numpy python ../video/studio/audio/build_music.py (from backend/)
"""
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request
import wave
from generate import timeline

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RATE = 48000
TIMELINE = timeline()
SECONDS = TIMELINE['frames'] / TIMELINE['fps']
N = round(RATE * SECONDS)
STARTS = {name: frame / TIMELINE['fps'] for name, frame in TIMELINE['starts'].items()}
RESIST = STARTS['session'] + 900 / TIMELINE['fps']
RELEASE = STARTS['session'] + 1152 / TIMELINE['fps']
CACHE = ROOT / 'audio/cache'
URL = 'https://www.scottbuckley.com.au/library/wp-content/uploads/2022/10/AKindOfHope.mp3'


def write(path, samples):
    path.parent.mkdir(parents=True, exist_ok=True)
    samples = np.clip(samples, -1, 1)
    with wave.open(str(path), 'wb') as out:
        out.setnchannels(1 if samples.ndim == 1 else samples.shape[1])
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes((samples * 32767).astype('<i2').tobytes())


def pulse():
    bus = np.zeros((N, 2), dtype=np.float32)
    rng = np.random.default_rng(100)
    for beat in range(round(STARTS['reveal'] / .6), round(STARTS['next'] / .6)):
        at = beat * 0.6
        if RESIST <= at < RELEASE:
            continue
        t = np.arange(round(0.18 * RATE)) / RATE
        # A rounded kick, with no hard attack or cinematic transient.
        kick = np.sin(2 * np.pi * (48 * t + 2.2 * (1 - np.exp(-t * 30))))
        kick *= (1 - np.exp(-t * 180)) * np.exp(-t * 28) * (0.047 if at >= STARTS['underHood'] else 0.038)
        i = round(at * RATE)
        bus[i:i + len(t)] += kick[:, None]
        mechanical = STARTS['build'] <= at < STARTS['underHood']
        for off in ([0, .15, .3, .45] if mechanical else [0, .3]):
            j = round((at + off) * RATE)
            t = np.arange(round(0.07 * RATE)) / RATE
            noise = rng.normal(0, 1, len(t))
            noise = np.concatenate(([0], np.diff(noise)))
            shaker = noise * (1 - np.exp(-t * 400)) * np.exp(-t * 65) * 0.0025
            bus[j:j + len(t), 0] += shaker * 0.8
            bus[j:j + len(t), 1] += shaker
            if mechanical and off in [0, .3]:
                knock = np.sin(2 * np.pi * 760 * t) * np.exp(-t * 110)
                knock *= .014 * np.minimum(t / .003, 1)
                bus[j:j + len(t)] += knock[:, None]
    return bus


def main():
    CACHE.mkdir(exist_ok=True)
    source = CACHE / 'a-kind-of-hope.mp3'
    if not source.exists():
        with urllib.request.urlopen(URL) as response:
            source.write_bytes(response.read())
    data = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(source),
        '-f', 'f32le', '-ar', str(RATE), '-ac', '2', '-'])
    original = np.frombuffer(data, dtype='<f4').reshape(-1, 2)
    # Bar-length segments; 120 ms overlaps centered on each edit preserve the
    # exact timeline duration. The ending uses the recording's own cadence.
    # Founders' dialogue opens on silence. The first piano attack begins at the
    # hook's hard cut, without a crossfade leaking into the founders' shot.
    edits = [(STARTS['hook'], STARTS['reveal'], 6.164943),
             (STARTS['reveal'], STARTS['build'], 82.8),
             (STARTS['build'], STARTS['underHood'], 236.4),
             (STARTS['underHood'], STARTS['next'], 250.8),
             (STARTS['next'], STARTS['close'], 25.2), (STARTS['close'], SECONDS, 328.2)]
    bed = np.zeros((N, 2), dtype=np.float32)
    half = round(0.06 * RATE)
    for index, (start, end, offset) in enumerate(edits):
        a, b = round(start * RATE), round(end * RATE)
        left = half if index else 0
        right = half if index < len(edits) - 1 else 0
        piece = original[round(offset * RATE) - left:round(offset * RATE) + b - a + right].copy()
        envelope = np.ones(len(piece), dtype=np.float32)
        if left:
            envelope[:2 * half] = np.linspace(0, 1, 2 * half)
        if right:
            envelope[-2 * half:] = np.linspace(1, 0, 2 * half)
        bed[a - left:b + right] += piece * envelope[:, None]
    # Give the original piano room to ring; remove only subsonic energy and
    # normalize the bed before automation, so gain values remain predictable.
    rhythm = pulse()
    for candidate, mix in [(1, bed), (2, bed + rhythm)]:
        temp = CACHE / f'music-{candidate}.wav'
        write(temp, mix)
        normalized = CACHE / f'music-{candidate}-normalized.wav'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(temp), '-af',
            f'highpass=f=35,loudnorm=I=-18:TP=-3:LRA=11,afade=t=in:st={STARTS["hook"]}:d=0.005,afade=t=out:st={SECONDS - 1.8}:d=1.8',
            '-ar', str(RATE), '-c:a', 'pcm_s16le', str(normalized)], check=True)
        # A 48 s audition includes the sparse opening and the reveal's lift.
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(normalized), '-t', '48',
            '-c:a', 'pcm_s16le', str(ROOT / f'public/audio/auditions/music-{candidate}.wav')], check=True)
        if candidate == 2:
            (ROOT / 'public/audio/music/bed.wav').write_bytes(normalized.read_bytes())
    f = TIMELINE['starts']
    resist, release = round(RESIST * TIMELINE['fps']), round(RELEASE * TIMELINE['fps'])
    cues = [(0, 0), (f['hook'] - 1, 0), (f['hook'], .52),
            (f['reveal'] - 18, .52), (f['reveal'], .78), (f['session'], .68),
            (resist - 18, .68), (resist, .035), (resist + 75, .035),
            (release - 12, .12), (release, .68), (f['build'] - 6, .68), (f['build'], .72),
            (f['underHood'] - 6, .72), (f['underHood'], .82),
            (f['next'] - 12, .82), (f['next'], .34),
            (f['close'] - 12, .34), (f['close'], .72),
            (TIMELINE['frames'] - 72, .6), (TIMELINE['frames'] - 1, 0)]
    manifest = {'version': 1, 'file': 'audio/music/bed.wav', 'bpm': 100,
        'source': 'A Kind Of Hope by Scott Buckley (2022), CC BY 4.0. '
                  'https://www.scottbuckley.com.au/library/a-kind-of-hope/ '
                  'Edited, crossfaded, with original synthesized 100 BPM percussion.',
        'credit': 'A Kind Of Hope · Scott Buckley · CC BY 4.0 · scottbuckley.com.au · Edited',
        'cues': [{'frame': frame, 'gain': gain} for frame, gain in cues]}
    (ROOT / 'public/audio/music/manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (ROOT / 'audio/music-edit.json').write_text(json.dumps({
        'sourceUrl': URL, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'license': 'https://creativecommons.org/licenses/by/4.0/',
        'chosenCandidate': 2, 'candidateExcerptSeconds': 48,
        'sampleRate': RATE, 'samples': N,
        'edits': [{'fromSeconds': a, 'toSeconds': b, 'sourceSeconds': c} for a, b, c in edits],
        'crossfadeSeconds': .12, 'percussionSeed': 100,
        'silentOpeningSeconds': STARTS['hook'],
        'pianoEntersAtFrame': f['hook'],
    }, indent=2) + '\n')

    sounds = []
    for name, seconds in [('click', .065), ('reached', .16), ('release', .45)]:
        t = np.arange(round(seconds * RATE)) / RATE
        if name == 'click':
            samples = (np.sin(2 * np.pi * 640 * t) + .2 * np.sin(2 * np.pi * 1280 * t)) * np.exp(-t * 90)
        elif name == 'reached':
            samples = (np.sin(2 * np.pi * 880 * t) + .25 * np.sin(2 * np.pi * 1320 * t)) * np.exp(-t * 28)
        else:
            samples = np.sin(2 * np.pi * 196 * t) * np.exp(-t * 7)
        samples *= .18 * np.minimum(t / .008, 1) * np.minimum((seconds - t) / .02, 1)
        write(ROOT / f'public/audio/sfx/{name}.wav', samples)
        sounds.append({'id': name, 'file': f'audio/sfx/{name}.wav',
                       'source': 'Original mathematical synthesis by the memo team, CC0 1.0. '
                                 'https://creativecommons.org/publicdomain/zero/1.0/'})
    (ROOT / 'public/audio/sfx/manifest.json').write_text(json.dumps({'version': 1, 'sounds': sounds}, indent=2) + '\n')
    print(f'Music: 2 candidates, chosen bed {SECONDS} s / 100 BPM. SFX: 3 original CC0 sounds.')


if __name__ == '__main__':
    main()
