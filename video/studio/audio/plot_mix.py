"""Generate review evidence from actual audio and timeline data.

From backend/: uv run --with numpy --with matplotlib python ../video/studio/audio/plot_mix.py
"""
import json
from pathlib import Path
import wave

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

from generate import ROOT, lines, timeline


def main():
    manifest = json.loads((ROOT / 'public/audio/vo/manifest.json').read_text())
    music = json.loads((ROOT / 'public/audio/music/manifest.json').read_text())
    cut = timeline()
    starts = {name: frame / cut['fps'] for name, frame in cut['starts'].items()}
    frames = np.arange(cut['frames'])
    seconds = frames / cut['fps']
    base = np.interp(frames, [cue['frame'] for cue in music['cues']],
                     [cue['gain'] for cue in music['cues']])
    duck = np.ones(len(frames))
    intervals = []
    for line in lines():
        duration = next(entry['durationFrames'] for entry in manifest['lines'] if entry['id'] == line['id'])
        start = starts[line['scene']] * 30 + line['at']
        end = start + duration
        duck = np.minimum(duck, np.interp(frames, [start - 6, start, end, end + 6],
                                         [1, 10 ** (-10 / 20), 10 ** (-10 / 20), 1]))
        intervals.append((start / 30, duration / 30, line['voice']))
    with wave.open(str(ROOT / 'public/audio/music/bed.wav')) as source:
        samples = np.frombuffer(source.readframes(source.getnframes()), dtype='<i2').reshape(-1, 2) / 32768
    peaks = np.max(np.abs(samples.reshape(cut['frames'], 48000 // cut['fps'], 2)), axis=(1, 2))
    fig, axes = plt.subplots(3, 1, figsize=(19.2, 10.8), sharex=True,
                             gridspec_kw={'height_ratios': [2, 2, 1]})
    fig.patch.set_facecolor('#F7F8FA')
    fig.suptitle('memo · V2 audio review', x=.07, ha='left', fontsize=28, weight='semibold')
    axes[0].fill_between(seconds, -peaks, peaks, color='#2155CD', linewidth=0)
    axes[0].set_ylabel('Bed waveform\n48 kHz stereo')
    axes[0].set_ylim(-1, 1)
    axes[1].plot(seconds, base, color='#667085', label='Scene arc', linewidth=2)
    axes[1].plot(seconds, base * duck, color='#2155CD', label='After VO ducking', linewidth=1.5)
    axes[1].set_ylabel('Music gain')
    axes[1].set_ylim(0, 1)
    axes[1].legend(loc='upper left', frameon=False)
    for start, duration, voice in intervals:
        axes[2].broken_barh([(start, duration)], (1 if voice == 'narrator' else 0, .65),
                            facecolors='#2155CD' if voice == 'narrator' else '#667085')
    axes[2].set_yticks([.325, 1.325], ['Puck', 'Sulafat'])
    axes[2].set_ylim(-.2, 2)
    axes[2].set_xlabel('Timeline (seconds)')
    for name, start in starts.items():
        for axis in axes:
            axis.axvline(start, color='#D0D5DD', linewidth=.7, zorder=0)
        axes[0].text(start + .5, .86, name, rotation=90, fontsize=10, va='top', color='#344054')
    for axis in axes:
        axis.set_facecolor('white')
        axis.spines[['top', 'right']].set_visible(False)
        axis.set_xlim(0, cut['frames'] / cut['fps'])
        axis.grid(axis='x', alpha=.12)
    fig.text(.07, .035, f'100 BPM · {cut["frames"] / cut["fps"]} s · {len(manifest["lines"])} VO lines · −10 dB ducking · 200 ms ramps\n'
             'Resistance: 70.8 s drop / 79.2 s return. Master the final render to −14 LUFS, ≤ −1 dBTP.', fontsize=14)
    fig.subplots_adjust(left=.09, right=.97, top=.88, bottom=.15, hspace=.28)
    destination = ROOT / 'evidence/V2/mix-map.png'
    destination.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(destination, dpi=100, facecolor=fig.get_facecolor())
    print(destination)


if __name__ == '__main__':
    main()
