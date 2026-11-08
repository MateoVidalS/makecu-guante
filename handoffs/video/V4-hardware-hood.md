# V4: hardware turntable + under the hood

Read `handoffs/video/README.md` first. You own `src/components/hardware/**` and `src/scenes/UnderHood.tsx`. Add deps
(`@remotion/three@4.0.541`, `three`, `@react-three/fiber`) with pnpm and list them in the PR.

## 1. `<HardwareTurntable/>` (`src/components/hardware/Hardware.tsx`)
Fixed API (V3 imports it in the Reveal scene):
```ts
export const HardwareTurntable: React.FC<{
  parts?: Array<'module' | 'lid' | 'spools' | 'guides' | 'anchors'>; // default all
  explode?: number;   // 0..1, lid lifts and spools rise out of the module
  turn?: number;      // radians of rotation, the scene animates it
  width?: number; height?: number; // px, default 1920x1080
}>
```
- STLs are in `public/hardware/` (`modulo_muneca.stl` wrist module, `tapa.stl` lid, `carrete.stl` spool, `guia_tendon.stl` guide,
  `anclaje_punta.stl` fingertip anchor, plus print plates). Use `@remotion/three` `<ThreeCanvas>` + three's `STLLoader`, loaded with
  `delayRender`. 5 spools, 5 anchors, some guides.
- Look: **soft studio light on paper** (`c.bg` background, a faint contact shadow), matte plastic. Module and lid in warm white;
  guides black and anchors yellow (their real colors, `16-bare-hand.md`); spools neutral grey. No memo blue on the hardware, no dark void,
  no bloom.
- Motion: slow turn (the caller drives `turn`), `explode` eases parts apart along their mount axes.
- Export also a `HardwareStill` usable in UnderHood.

## 2. Under the hood scene (`src/scenes/UnderHood.tsx`, 432 f)
VO: `hood-1` at f 12 ("The board decides, not the browser."), `hood-2` at f 144 (the four layers). Copy in `COPY.underHood`.
- f 0–132: title `COPY.underHood.title` (h1). Under it a compact system strip of 5 nodes, app-card style (white, 1px border, radius
  card): **Webcam → MediaPipe → Session engine (browser) → Web Serial → ESP32**, and below the ESP32, **5 micro servos · current sensor
  · stop button**; Gemini (coach, summaries) hangs off the browser side. The ESP32 node gets a memo-blue 3 px outline ("safety lives
  here"). Lines draw in sequence with `@remotion/paths` evolvePath, 4 f per segment.
- f 144–330: the four safety layers as numbered app cards, one per beat, synced to the words of `hood-2`. The number chips are ink,
  not red (red is only for an actual safety event).
- f 330–432: three numbers at hero size, counting up, labels under (`COPY.underHood.numbers`). Clean paper, nothing else.
Leave the bottom 180 px free while VO plays (captions).

## Acceptance
- [ ] `HardwareTurntable` renders all parts, deterministic per frame (no `Math.random`, no wall-clock), works inside `scene-reveal`.
- [ ] `scene-underHood` renders; stills in `evidence/V4/` (turntable at 3 angles + exploded, system strip, layers, numbers).
- [ ] `pnpm check` green; render time per frame for the turntable reported in the PR.

## 3. Build montage (added): `src/scenes/Build.tsx`, 288 f (4 bars), placed right before UnderHood
The owner loves the 3D assembly. Show the glove being built, one part per beat (18 f), camera slowly orbiting, on paper.
VO `build-1` at f 18: "Five micro servos wind thin threads over the back of each finger. A current sensor feels every pull."
Only the **real** build (hardware/BANCO.md, hardware/ARREGLOS.md). **There is no LED ring. Do not draw one.**
1. Wrist module (`modulo_muneca.stl`) settles in.
2. Five micro servos drop into their slots, one per beat (procedural: SG90-style body 23×12×22 mm with mounting tabs, output
   shaft, a dark blue-grey/black plastic; slight model variety is fine, real ones are mixed SG92R, MG90S, Smraza S51).
3. Spools (`carrete.stl`) seat on the horns.
4. Electronics beside the module: ESP32 DevKit 30-pin (board ~51×28 mm, the silver can and pin headers), the INA219 breakout (small
   purple/blue board, keep it neutral dark), a tactile STOP push button. Procedural boxes with simple detail are enough.
5. Cables route: each servo's 3-wire lead (brown, red, orange) draws along a smooth tube path to the board (TubeGeometry on a
   CatmullRom curve, growing with the frame). Keep wire colors true; they are not state colors.
6. Lid (`tapa.stl`) closes.
7. Threads: five thin dark lines run out of the module over a **ghost hand** (target style, c.target outline, no fill), through the
   black guides on the backs of the phalanges to the yellow fingertip anchors. End on that frame.
Deterministic per frame; reuse the turntable's lights/materials. Stills in `evidence/V4/` at each step.
