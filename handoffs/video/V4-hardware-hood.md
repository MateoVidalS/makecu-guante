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
