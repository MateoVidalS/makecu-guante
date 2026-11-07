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
recognized from their angles for the accessible name. The camera shows the back
of the palm-down hand from a front diagonal on the thumb side, mirrored for
the left hand (`view.ts`).
Framing fits the canvas to 80% of the projected motion envelope for the pose
family. It includes open-to-target intermediate positions, both actual and ghost
mesh bounds, and the outline. A family keeps one center and scale across poses;
closed poses therefore naturally occupy less height than an open hand. Width
limits the fit in narrow canvases. Resizing reframes outside the animation loop.
Existing `zoom` callers remain valid; automatic fitting takes precedence unless
`fit={false}` selects manual zoom. `keepTargetOnReach` defaults to false and lets
the developer comparison retain the ghost beside reached fingers.

Custom targets receive a generic accessible name; their framing uses the tendon
family envelope. Custom poses beyond that envelope can use manual zoom. `reducedMotion` can additionally
disable animation; it cannot override an OS reduced-motion preference.
`onFps` receives a rolling one-second frame-rate measurement for diagnostics.

`createHandRig` builds transforms without GPU resources. `applyJoints` accepts
that rig, a joint map in degrees, and an optional interpolation alpha (default 1).
Live rendering uses a frame-rate-independent smoother and quaternion slerp. +Y points toward fingertips;
+Z is the palm side. Left hands reflect X at the root, preserving joint axes.
The thumb has a metacarpal opposition transform, MCP, and IP; the contract's
`thumb.pip` drives IP and `thumb.dip` is ignored. Palm and segment dimensions live
in `HAND_PROPORTIONS`.

`jointsFromClosure` clamps scalar input to 0–1. When a pose hint has a nonzero
scored target, its render angles are scaled to reproduce that shape at the target
closure. Free fingers and open targets use the generic closing shape. This is a
visual estimate, not measured per-joint motion or an actuator command.

The target is a 1.03× unlit shell at 35% opacity with a soft contour; the
actual hand is shaded clay. Target meshes draw first, so overlapping ghost
fill never washes out actual state colors (90% tint). All five fingers receive individual state tint. Entering reached
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
`docs/design/screenshots/ux-u2/performance.json`. It does not run MediaPipe inference. A physical
camera check on the integration laptop remains necessary; the software-rendered
browser environment is not a substitute for that hardware check.

## U2 review gallery

At `/_dev/hand`, enable **Compare states** to see idle, active, assist and
reached side by side for any of the six pose buttons. **Grayscale** applies to
the hand views, leaving readable state labels. Only four comparison canvases are
mounted at once to avoid exhausting browser WebGL contexts. Reached previews
retain their targets for comparison; the live view still fades the target on hold.

U2 color/grayscale screenshots at 1280×720 and 1440×900, live before/after,
and the latest performance report are in `docs/design/screenshots/ux-u2/`.
Use `REHAB_FRONTEND_PORT=5192` with the gallery Playwright config when another
worker is using port 5173. Performance evidence uses a synthetic camera;
physical camera + MediaPipe verification remains an integration check.

## Coach finger focus

`highlight?: FingerId | null` defaults to null. A selected finger receives a
steady high-contrast contour using the existing text token, plus full state tint
when moving, assisted, or reached. Other fingers keep their normal state colors.
The contour has no pulse or interpolation, including under reduced motion; it
follows the actual hand's tracking-loss opacity. A visible “Focus on your …”
legend and the hand's accessible name identify the selected finger. Clearing the
prop removes the contour immediately. A4 can pass coach state directly without
changing the actual/target getters or finger state callback.
