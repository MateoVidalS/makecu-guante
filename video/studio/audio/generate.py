"""Quota-conscious Gemini generation. Run from video/studio; never logs credentials.

python3 audio/generate.py audition Sulafat
python3 audio/generate.py scene reveal
python3 audio/generate.py music 1
Responses (including failures) are cached before processing. No automatic retries.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / 'audio/config.json').read_text())
CACHE = ROOT / 'audio/cache'
CACHE.mkdir(exist_ok=True)


def lines():
    code = """import ts from 'typescript'; import fs from 'node:fs';
const js = ts.transpileModule(fs.readFileSync('src/script.ts', 'utf8'),
  {compilerOptions: {module: ts.ModuleKind.ESNext}}).outputText;
const script = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
console.log(JSON.stringify(script.VO));"""
    return json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code], cwd=ROOT))


def timeline():
    code = """import ts from 'typescript'; import fs from 'node:fs';
const js = ts.transpileModule(fs.readFileSync('src/timeline.ts', 'utf8'),
  {compilerOptions: {module: ts.ModuleKind.ESNext}}).outputText;
const t = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
console.log(JSON.stringify({fps:t.FPS, frames:t.TOTAL_FRAMES, starts:t.SCENE_START}));"""
    return json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code], cwd=ROOT))


def request(payload, label):
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]
    path = CACHE / f'{label}-{digest}.json'
    if path.exists():
        result = json.loads(path.read_text())
        print(f'{label}: cached response', flush=True)
    else:
        key = next(line.split('=', 1)[1].strip().strip('\"\'')
                   for line in Path(CONFIG['keyFile']).read_text().splitlines()
                   if line.startswith('GEMINI_API_KEY='))
        req = urllib.request.Request(
            'https://generativelanguage.googleapis.com/v1beta/interactions',
            data=json.dumps(payload).encode(),
            headers={'Content-Type': 'application/json', 'x-goog-api-key': key,
                     'Api-Revision': '2026-05-20'})
        print(f'{label}: requesting {payload["model"]}', flush=True)
        try:
            with urllib.request.urlopen(req, timeout=480) as response:
                result = json.load(response)
            status = 200
        except urllib.error.HTTPError as error:
            status = error.code
            result = json.loads(error.read())
        path.write_text(json.dumps(result))
        with (CACHE / 'requests.jsonl').open('a') as log:
            log.write(json.dumps({'label': label, 'model': payload['model'],
                                  'status': status, 'cache': path.name}) + '\n')
        print(f'{label}: HTTP {status}; response cached', flush=True)
    if 'error' in result:
        # Do not print server error strings, which might contain request details.
        raise SystemExit(f'{label}: API error {result["error"].get("code", "unknown")}')
    return result


def audio_blocks(value):
    if isinstance(value, dict):
        if value.get('type') == 'audio' and value.get('data'):
            yield value
        else:
            for child in value.values():
                yield from audio_blocks(child)
    elif isinstance(value, list):
        for child in value:
            yield from audio_blocks(child)


def save_audio(result, output):
    blocks = list(audio_blocks(result))
    if not blocks:
        raise SystemExit('No inline audio returned; inspect cached response locally.')
    output = ROOT / output
    output.parent.mkdir(parents=True, exist_ok=True)
    raw = CACHE / (output.stem + '.generated')
    raw.write_bytes(base64.b64decode(blocks[-1]['data']))
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(raw),
                    '-ar', '48000', '-c:a', 'pcm_s16le', str(output)], check=True)
    print(f'Saved {output.relative_to(ROOT)}', flush=True)


def tts(selected, voice, label, output, model=None):
    text = '\n\n'.join(line['text'] for line in selected)
    style = ('Warm, calm, confident American English narrator. Human, conversational, '
             'clear, neither salesy nor whispery. Mid pace, crisp consonants. '
             'Read each paragraph verbatim. Leave exactly 0.8 seconds of silence '
             'between paragraphs so the editor can split them. Never speak labels. '
             'Pronounce memo as mem-oh. ')
    if label == 'retry-coach-1':
        style += ('Read this entire line in under 3.9 seconds at a brisk 230 words per minute. '
                  'Keep flowing through the full stop with only a tiny pause. '
                  'Precise, fast launch-film narration, clear and natural. ')
    elif label == 'retry-session-1':
        style += ('Recite exactly these eight words, with no additions: memo shows the goal. You try first. '
                  'Do not add the word "the" before memo. Pronounce memo as the everyday English '
                  'word memo, MEH-moh, first vowel like memory, never MEE-moh. ')
    elif label == 'retry-reveal-1':
        style += ('Pronounce memo exactly like the everyday English word memo: MEH-moh, '
                  'with the first vowel of memory, never MEE-moh. A warm small smile. ')
    elif label == 'scene-coach':
        style += ('This short opening narration must finish in 4.1 seconds: '
                  'use a brisk, articulate 205 words per minute. ')
    else:
        style += 'Aim for 170 words per minute, keep natural sentence pauses short. '
    if voice == CONFIG['coach']:
        style += 'Kind, steady coach. Calm reassurance when stopping for resistance. '
    result = request({'model': model or CONFIG['ttsModel'], 'input': [{'type': 'user_input',
        'content': [{'type': 'text', 'text': text, 'annotations': [
            {'type': 'speech_metadata', 'style': style}]}]}],
        'response_format': {'type': 'audio'},
        'generation_config': {'speech_config': [{'voice': voice}]}}, label)
    save_audio(result, output)


def music(candidate):
    # Preserve the original requests so the cached free-tier rejections are
    # reused. The licensed fallback builder follows the current timeline.
    prompt = ('Create a 172.8-second instrumental launch film score, no singing, no vocals. '
              'Exactly 100 BPM, 4/4, D major, 72 bars. Felt piano, warm airy analog pad, '
              'muted wooden plucks, rounded bass, soft kick and fine shaker. Modern, human, '
              'intimate and hopeful. Restrained premium product film sound, no corporate '
              'ukulele, no EDM, no trailer drums, no dramatic risers. Leave the midrange '
              'open for a spoken narrator. Structure: 0–28.8 sparse felt piano and warm '
              'pad; at 28.8 introduce optimistic gentle pulse and bass; 40.8–139.2 steady '
              'light spacious groove; at 70.8 nearly silent pause for 2.5 seconds, rebuild '
              'at 79.2; at 139.2 slightly more drive; 153.6 pull back to piano for founders; '
              '163.2 resolve to D major, final chord rings out by 172.8. ')
    prompt += {1: 'A small rising three-note piano motif, tender but quietly determined.',
               2: 'A simple two-note motif, tactile muted plucks, more rhythmic forward motion.',
               3: 'A delicate descending piano answer, especially spacious and warm.'}[candidate]
    result = request({'model': CONFIG['musicModel'], 'input': prompt}, f'music-{candidate}')
    save_audio(result, f'public/audio/auditions/music-{candidate}.wav')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=['audition', 'scene', 'music', 'retry'])
    parser.add_argument('id')
    args = parser.parse_args()
    if args.kind == 'music':
        music(int(args.id))
    elif args.kind == 'audition':
        tts([line for line in lines() if line['scene'] == 'problem'], args.id,
            f'audition-{args.id}', f'public/audio/auditions/vo-{args.id.lower()}.wav')
    elif args.kind == 'retry':
        selected = [line for line in lines() if line['id'] == args.id]
        tts(selected, CONFIG['narrator'], f'retry-{args.id}', f'audio/cache/retry-{args.id}.wav', CONFIG['retryModel'])
    else:
        selected = [line for line in lines() if line['scene'] == args.id]
        # A separate request for Puck keeps the narrator voice consistent and avoids
        # multi-speaker metadata being read out by models with different API shapes.
        if args.id == 'session-coach':
            selected = [line for line in lines() if line['id'] == args.id]
        else:
            selected = [line for line in selected if line['voice'] == 'narrator']
        if not selected:
            raise SystemExit('Unknown scene or no VO')
        voice = CONFIG['coach'] if args.id == 'session-coach' else CONFIG['narrator']
        tts(selected, voice, f'scene-{args.id}', f'audio/cache/scene-{args.id}.wav',
            CONFIG.get('sceneModels', {}).get(args.id))
