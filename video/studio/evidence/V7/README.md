# V7 build montage review

All stills are 1920 × 1080 renders of `scene-build`, including its actual caption layer.
Nine stills cover all six callouts, the final hand, and three frames of the same leader during the orbit.

| Still | Scene frame | Review focus |
| --- | ---: | --- |
| [Servos, orbit A](servos-orbit-060.png) | 60 | Servo callout; first orbit angle |
| [Servos, orbit B](servos-orbit-078.png) | 78 | Same CAD anchor, next orbit angle |
| [Servos, orbit C](servos-orbit-096.png) | 96 | Same CAD anchor, third orbit angle |
| [Spools](spools-150.png) | 150 | Winding and release copy |
| [ESP32](esp32-195.png) | 195 | Board identification and safety rules |
| [INA219](sensor-213.png) | 213 | Current sensor; outgoing board label is fading |
| [Stop button](stop-231.png) | 231 | Stop latch; outgoing sensor label is fading |
| [Guides and anchors](guides-275.png) | 275 | Black dorsal guides, yellow fingertip anchors |
| [Final hand](final-hand-287.png) | 287 | Full-opacity, unfilled 3 px target outline; clear final hold |

## Verification

Run from `video/studio/`:

```sh
pnpm check
node src/components/hardware/verify-v7.mjs
node src/components/hardware/render-v7.mjs
```

All commands passed. The verifier checks all 288 scene frames for no more than two callouts,
non-overlapping pills, chapter/caption reserves, visible endpoints after their 6-frame arrival,
beat timing, and CAD-to-screen projection. It casts a ray back through the projected point and checks
that the ray passes through the independently transformed CAD anchor.

For frames 60 / 78 / 96, the settled servo anchor projects to these canvas pixels:
`(1150.207, 281.936)`, `(1147.877, 279.527)`, `(1145.511, 277.038)`.
The scene canvas starts at y = 64; the leader endpoint moves with the part while the pill stays readable.
Both the WebGL camera and leaders use `buildMotion.ts`, including every dolly and animated arrival.

Electronics arrive on distinct beats: ESP32 at 180, INA219 at 198, stop button at 216.
Wiring starts at 234, the lid at 246, and guides/anchors at 252. The scene remains 288 frames.
The final view fits the assembly bounds to 80% of the frame width, subject to the caption-safe height.
Pills draw their leaders for 6 frames, then fade and rise for 9 frames.

Reviewed every committed still for typography, leader contact, subtitle clearance, and final hand visibility.
No new dependencies, physical device access, or changes to coordinator-owned contracts.
