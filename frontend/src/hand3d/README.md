# Virtual hand

`VirtualHand` keeps the WP0 three-prop API. `actual()` reads the latest joint map
on every animation frame; callers should return `null` when tracking is absent
or unreliable. Do not put vision frames in React state for this component.

```tsx
<VirtualHand
  target={pose.render}
  actual={() => latestVision.current?.joints ?? null}
  state={(finger) => fingerStates.current[finger]}
  handedness="left"
  pose={pose.id}
/>
```

`handedness` defaults to `right`. `pose` is optional: the six library targets are
recognized from their angles for the accessible name and fixed camera view.
Custom targets receive a generic accessible name. `reducedMotion` can additionally
disable animation; it cannot override an OS reduced-motion preference.
`onFps` receives a rolling one-second frame-rate measurement for diagnostics.

`createHandRig` builds transforms without GPU resources. `applyJoints` accepts
that rig, a joint map in degrees, and an optional interpolation alpha (default 1).
Live rendering uses quaternion slerp with alpha 0.5. +Y points toward fingertips;
+Z is the palm side. Left hands reflect X at the root, preserving joint axes.
The thumb has a metacarpal opposition transform, MCP, and IP; the contract's
`thumb.pip` drives IP and `thumb.dip` is ignored. Palm and segment dimensions live
in `HAND_PROPORTIONS`.

`jointsFromClosure` clamps scalar input to 0–1. When a pose hint has a nonzero
scored target, its render angles are scaled to reproduce that shape at the target
closure. Free fingers and open targets use the generic closing shape. This is a
visual estimate, not measured per-joint motion or an actuator command.

The target is a 1.03× translucent matte shell with a contour; the actual hand is
solid clay. Only thumb, index, and middle receive state tint. Entering reached
starts one 400 ms rim-light pulse and fades the ghost for the hold. Returning to a
non-reached state restores the ghost. Missing tracking retains the last joint
pose and fades the actual hand to 30%. OS reduced motion makes all state and
joint changes immediate and suppresses the pulse. Colors and UI dimensions use
the shared tokens, including automatic theme changes.

## Allocation review

The steady-state application frame path is `HandScene.useFrame` →
`animator.tick` → `applyJoints`. These loops reuse the rig's desired quaternions,
materials, colors, and scalar counters. There are no `new`, array/object literals,
clones, maps, or closures in that frame path. The gallery's 30 Hz stub likewise
mutates one retained sample. Geometry/material creation occurs at scene setup;
resources are shared by the actual and ghost meshes and disposed on cleanup.
React updates happen on visibility transitions and at most once per second for
an optional FPS callback, rather than for each vision/render frame. Three.js and
React internals and caller-supplied getters are outside this allocation review.

## Verification

- `pnpm test --run src/hand3d src/pages/DevHand`
- `pnpm exec playwright test --config src/pages/DevHand/playwright.config.ts`
- `WP6_PERFORMANCE=1 pnpm exec playwright test --config src/pages/DevHand/playwright.config.ts`

The opt-in performance test uses a live synthetic Chromium camera capture and a
30 Hz stub, a fixed 10-second warm-up, then ten one-second FPS samples. It records
its renderer, capture settings, actual stub rate, and samples in the gallery's
`evidence/performance.json`. It does not run MediaPipe inference. A physical
camera check on the integration laptop remains necessary; the software-rendered
browser environment is not a substitute for that hardware check.
