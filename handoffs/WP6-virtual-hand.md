# WP6 — Virtual hand (three.js procedural rig)

**Goal:** the centerpiece visual: a calm, legible 3D hand that shows the **target pose as a ghost** and the **patient's real hand** overlaid, smoothly and
in real time.

**Read:** `AGENTS.md`, `docs/plan/03-contracts.md §3` (JointAngles, PoseDef, VisionFrame), **`docs/plan/08-frontend.md §3`**,
**`docs/plan/11-ux-design.md §5.1` (virtual hand visual language)**, `docs/plan/06-session.md §2` (pose render angles).

**You own:** `frontend/src/hand3d/**`, `frontend/src/pages/DevHand/**` and their tests.

## Deliverables
- [ ] `rig.ts`: hand proportions, joint hierarchy, left/right mirroring, `applyJoints(rig, JointMap)`, `jointsFromClosure(closure, pose?)`.
- [ ] `VirtualHand.tsx` with the props in `08-frontend.md §3`: target ghost + actual hand, per-finger state tint, fade when not visible, a fixed 3/4 camera,
      materials/lighting/colors from `tokens.ts` and `11-ux-design.md §5.1`, a reduced-motion mode, `aria-label` describing the target pose.
- [ ] Reach feedback: on the `reached` state, a soft green pulse (rim light) on the actual hand, 400 ms (disabled with reduced motion).
- [ ] `/_dev/hand` gallery: every pose as a target, sliders per joint for the actual hand, a left/right toggle, state toggles, an fps meter.
- [ ] Tests: joint transform math, mirroring, `jointsFromClosure` monotonicity.

## Acceptance criteria
- [ ] ≥ 55 fps with the camera running (with a stub vision at 30 Hz), no per-frame allocations (checked with a heap snapshot or a code review note).
- [ ] The target and actual hands are distinguishable in grayscale (shape + opacity, not only hue): verify with a grayscale screenshot in the PR.
- [ ] All six poses read correctly at a glance; include screenshots of each in the PR.
