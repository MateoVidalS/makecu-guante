"""Embed the STLs (positions only, float32) into the HTML viewer.

Usage: python3 -I build.py <stl_dir> <template.html> <output.html>
"""
import base64
import json
import struct
import sys
from pathlib import Path

stl_dir, template, out = map(Path, sys.argv[1:4])
parts = {}
for f in sorted(p for p in stl_dir.glob("*.stl") if not p.stem.startswith("placa")):
    b = f.read_bytes()
    (n,) = struct.unpack_from("<I", b, 80)
    pos = bytearray()
    for i in range(n):
        off = 84 + 50 * i + 12  # skip the normal
        pos += b[off:off + 36]
    parts[f.stem] = base64.b64encode(bytes(pos)).decode()
html = template.read_text().replace("/*__PARTS__*/null", json.dumps(parts))
out.write_text(html)
print(out, f"{len(html) / 1e6:.2f} MB", {k: len(v) for k, v in parts.items()})
