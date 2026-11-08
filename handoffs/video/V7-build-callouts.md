# V7: component callouts in the 3D build montage

Read `handoffs/video/README.md` first (design direction; **never say "glove"**). You own `src/scenes/Build.tsx` and
`src/components/hardware/**`. The Build scene (288 f) now plays **right after the reveal** (33.6 s): it is the product reveal
and the owner's favourite shot. Make it impressive and precise.

## 1. Component callouts
App style: white pill (radius pill, 1 px `c.border`, overlay shadow), ink `h3` label + small muted sub, a thin ink leader line
to the part, **projected through the 3D camera** so it sticks to the part while the camera orbits (project the part's world
position to screen space each frame). Enter: line draws 6 f, pill fades up 9 f. At most 2 callouts on screen at once. Never in
the top 64 px (chapter label) or the bottom 200 px (captions). Each callout appears on the beat its part arrives.

| Part | Label | Sub |
|---|---|---|
| Servos | 5 micro servos | SG92R · MG90S · S51 |
| Spools | Spools and threads | Wind to open, unwind to release |
| ESP32 board | ESP32-WROOM-32 | Runs the safety rules |
| INA219 | INA219 current sensor | Feels every pull, cuts at the limit |
| Stop button | Stop button | Latches until a person releases it |
| Guides/anchors | Black guides · yellow anchors | On the back of each finger |

Facts: `hardware/BANCO.md`, `hardware/ARREGLOS.md`, `firmware/README.md`. No LED ring exists; never draw one.

## 2. Polish
- The ghost hand in the last step is too faint: `c.target`, 3 px, full-opacity outline, no fill; dolly so module + hand fill ~80% of the width.
- Step titles at h2; keep the per-step dolly so each new part is big.

## Acceptance
- [ ] `pnpm check` green; stills in `evidence/V7/` (one per callout + the final hand frame); callouts stay locked to parts mid-orbit
      (prove with 3 frames).
- [ ] PR `V7: build montage callouts` into `MateoVidalS/video`; do not merge.
