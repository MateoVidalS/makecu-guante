#!/usr/bin/env bash
# Measure: audio/loudness.sh out/v2-mix.mp4
# Master: audio/loudness.sh --normalize input.mp4 output.mp4 [measured_gain_db]
set -euo pipefail
if [[ "${1:-}" == "--normalize" ]]; then
  input="${2:?input render required}"
  output="${3:?output path required (must differ from input)}"
  master_gain="${4:-0}"
  [[ "$master_gain" =~ ^-?[0-9]+([.][0-9]+)?$ ]] || { echo 'Gain must be a number in dB.' >&2; exit 1; }
  [[ "$input" != "$output" ]] || { echo 'Use a separate output path.' >&2; exit 1; }
  measurements="$(mktemp -t memo-loudness.XXXXXX)"
  trap 'rm -f "$measurements"' EXIT
  ffmpeg -hide_banner -nostats -i "$input" -map 0:a:0 \
    -af 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json' -f null - 2> "$measurements"
  filter="$(python3 - "$measurements" <<'PY'
import json,sys
text=open(sys.argv[1]).read()
m=json.loads(text[text.rfind('{'):text.rfind('}')+1])
print('loudnorm=I=-14:TP=-1:LRA=11:linear=true:measured_I={input_i}:measured_TP={input_tp}:measured_LRA={input_lra}:measured_thresh={input_thresh}:offset={target_offset}'.format(**m))
PY
)"
  # Leave 0.2 dB of headroom for AAC intersample peaks.
  ffmpeg -hide_banner -loglevel error -y -i "$input" -map 0:v:0 -map 0:a:0 \
    -c:v copy -af "$filter,volume=${master_gain}dB,alimiter=limit=0.870964:level=false:latency=true" \
    -c:a aac -b:a 320k -ar 48000 "$output"
  input="$output"
else
  input="${1:?usage: audio/loudness.sh [--normalize] input.mp4 [output.mp4] [measured_gain_db]}"
fi
ffmpeg -hide_banner -nostats -i "$input" -map 0:a:0 \
  -af 'ebur128=peak=true' -f null - 2>&1 | tail -n 18
