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
| `build-module.png` | `scene-build` | 15 |
| `build-servos.png` | `scene-build` | 106 |
| `build-spools.png` | `scene-build` | 196 |
| `build-electronics.png` | `scene-build` | 215 |
| `build-cables.png` | `scene-build` | 233 |
| `build-lid.png` | `scene-build` | 251 |
| `build-threads.png` | `scene-build` | 287 |

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

## Build montage

The 288-frame build scene uses the same STL cache, material palette and studio lights as the turntable. Servo bodies are 23×12×22 mm with mounting tabs, shafts and horns. ESP32 has 30 pin positions, a silver module can and USB socket; INA219 and the tactile stop button use neutral procedural geometry. There is no LED ring.

| Frames | Action |
| --- | --- |
| 0–15 | Module settles |
| 18, 36, 54, 72, 90 | One servo drops per beat |
| 108, 126, 144, 162, 180 | One spool seats per beat |
| 198–218 | ESP32, INA219, stop button and separate servo rail arrive |
| 216–233 | Brown, red and orange leads grow along CatmullRom tube paths |
| 234–249 | Lid closes onto the module |
| 240–252 | Outline-only ghost hand, dorsal guides and fingertip anchors appear |
| 252–275 | Five thin threads grow through the guides to their anchors |
| 275–287 | Completed assembly holds |

The electronics layout follows `hardware/BANCO.md` and `hardware/ARREGLOS.md`: red/brown servo leads terminate at a separate power rail, red power passes through INA219, common ground connects to ESP32, and orange signals terminate at ESP32 headers. Wire insulation colors are centralized in `wirePalette.ts`; these depict real wires rather than UI states. This is an illustrative mechanical/electrical layout, not a pin-by-pin wiring guide.

Render every build step with one bundle and one reused ANGLE browser:

```sh
node src/components/hardware/render-build.mjs
node src/components/hardware/render-build.mjs --video-only  # out/v4-build.mp4, all 288 frames
```

Each build still can also be rendered with `pnpm exec remotion still scene-build evidence/V4/build-threads.png --frame=287 --gl=angle` using the table's frame values.

Full montage verification: all **288 frames at 1920×1080, 30 fps** rendered with ANGLE, concurrency 1. The renderer call including canvas setup and encoding took **18.374 s**, or **63.8 ms/frame** (bundle excluded). All seven build stills were rendered separately as PNGs and visually reviewed. The full clip and beat-by-beat contact sheet are local QA outputs under ignored `out/`.
