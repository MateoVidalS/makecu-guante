"""Local independent transcript and boundary checks; no Gemini requests.

From backend/: uv run --with faster-whisper python ../video/studio/audio/verify_vo.py
"""
import json
import subprocess

from faster_whisper import WhisperModel
from generate import ROOT, lines
from prepare_vo import normalized, transcribe


def main():
    model = WhisperModel('small.en', device='cpu', compute_type='int8', cpu_threads=2)
    edits = {entry['id']: entry for entry in json.loads((ROOT / 'audio/vo-edit.json').read_text())}
    results = []
    for line in lines():
        path = ROOT / f'public/audio/vo/{line["id"]}.wav'
        segments = transcribe(model, path, 'small.en')
        text = ' '.join(segment['text'].strip() for segment in segments)
        # ASR cannot reliably spell a short brand name from audio alone.
        canonical = text.lower().replace('mimo', 'memo')
        result = {'id': line['id'], 'expected': line['text'], 'recognized': text,
                  'matches': normalized(canonical) == normalized(line['text'])}
        expected = normalized(line['text'])
        if not result['matches'] and normalized(canonical)[1:] == expected:
            # Isolated short clips can cause an ASR leading-word hallucination.
            # Accept a context review only if whole-take ASR gives the exact
            # words AND the cut encloses those words with no adjacent words.
            edit = edits[line['id']]
            source = ROOT / (edit['retrySource'] or edit['source'])
            context = transcribe(model, source, 'small.en')
            words = [word for segment in context for word in segment['words']]
            tokens = [(token, word) for word in words for token in normalized(word['word'])]
            for i in range(len(tokens) - len(expected) + 1):
                if [token for token, _ in tokens[i:i + len(expected)]] != expected:
                    continue
                first, last = tokens[i][1], tokens[i + len(expected) - 1][1]
                before = tokens[i - 1][1]['end'] if i else 0
                after = tokens[i + len(expected)][1]['start'] if i + len(expected) < len(tokens) else float('inf')
                if before <= edit['start'] <= first['start'] and last['end'] <= edit['end'] <= after:
                    result['matches'] = True
                    result['contextReview'] = {
                        'note': 'Isolated ASR inserted a leading word; whole-take ASR matches exactly. '
                                'The edit contains the target words and no adjacent spoken words.',
                        'source': str(source.relative_to(ROOT)), 'firstWordStart': first['start'],
                        'lastWordEnd': last['end'], 'cutStart': edit['start'], 'cutEnd': edit['end'],
                    }
                    break
        stats = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(path), '-af',
            'silencedetect=n=-30dB:d=0.04', '-f', 'null', '-'], capture_output=True, text=True, check=True)
        # Store the silence report for checking edit boundaries without relying
        # on the duration manifest. Interior phrase pauses are intentionally kept.
        result['silenceReport'] = [entry.strip() for entry in stats.stderr.splitlines() if 'silence_' in entry]
        results.append(result)
        status = 'CONTEXT OK' if 'contextReview' in result else 'OK' if result['matches'] else 'REVIEW'
        print(line['id'], status, text, flush=True)
    (ROOT / 'audio/vo-transcripts.json').write_text(json.dumps(results, indent=2) + '\n')
    if any(not result['matches'] for result in results):
        raise SystemExit('Transcript discrepancies require review; see audio/vo-transcripts.json')


if __name__ == '__main__':
    main()
