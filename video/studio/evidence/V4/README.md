# V4 review stills

Run commands from `video/studio/`. The reusable `HardwareTurntable` and `HardwareStill` exports contain no title, badge, or view labels. Text on the exploded and three-angle sheets belongs only to the isolated evidence entry point.

| Still | Composition | Frame |
| --- | --- | --- |
| `hardware-rest.png` | `hardware-motion` | 0 |
| `hardware-exploded.png` | `hardware-single` | 0 |
| `hardware-three-angles.png` | `hardware-angles` | 0 |
| `system-strip.png` | `scene-underHood` | 90 |
| `safety-layers.png` | `scene-underHood` | 228 |
| `numbers.png` | `scene-underHood` | 360 |

Hardware evidence uses a separate entry point:

```sh
pnpm exec remotion still src/components/hardware/evidence.tsx hardware-angles evidence/V4/hardware-three-angles.png --frame=0 --gl=angle --timeout=120000
pnpm exec remotion still src/components/hardware/evidence.tsx hardware-single evidence/V4/hardware-exploded.png --frame=0 --gl=angle
pnpm exec remotion still src/components/hardware/evidence.tsx hardware-motion evidence/V4/hardware-rest.png --frame=0 --gl=angle
pnpm exec remotion still scene-underHood evidence/V4/system-strip.png --frame=90
pnpm exec remotion still scene-underHood evidence/V4/safety-layers.png --frame=228
pnpm exec remotion still scene-underHood evidence/V4/numbers.png --frame=360
```

Coordinator notes applied: factual UnderHood content has no illustrative badge; the module is open with its lid parked beside it so all five spools remain visible; fittings form one evenly spaced row; warm off-white uses `c.surface3`; key and rim lights separate the edges from paper. Small fittings use a uniform display scale of 0.45 for the knolling overview. Explosion raises the parked lid and spools along their vertical axes. The camera fits the current part bounds deterministically at each angle.

Safety copy comes unchanged from `COPY.underHood`; balanced lines remove the orphaned release word. Number count-ups all settle at frame 360, a 72-frame bar boundary. The bottom 180 pixels remain clear of scene content while captions play.

`Reveal.tsx` remains the V3-owned placeholder on this branch. Import `HardwareTurntable` from `src/components/hardware/Hardware` when integrating V3; the fixed props API is unchanged. The evidence sheets exercise both full-frame and embedded canvas sizes.

Render benchmark on this shared macOS arm64 workstation: 24 animated 1920×1080 frames at concurrency 1 with `--gl=angle` took 21.649 s in the frame-rendering phase, or **0.902 s/frame** including initial canvas/STL setup. Remotion reported **75 ms/frame capture**; this excludes the 109.296 s bundle step. The default software-WebGL three-angle render timed out under concurrent workstation load; ANGLE completed.

```sh
pnpm exec remotion render src/components/hardware/evidence.tsx hardware-motion out/v4-hardware-angle.mp4 --frames=0-23 --concurrency=1 --gl=angle --log=verbose
```

For the coordinator: use `--gl=angle` for the integrated Main render, or configure `Config.setChromiumOpenGlRenderer('angle')` in the coordinator-owned Remotion config. No shared config or scene registration was changed here.
