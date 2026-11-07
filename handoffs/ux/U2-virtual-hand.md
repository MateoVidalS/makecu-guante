# U2 — Virtual hand legibility

Read `handoffs/ux/COMMON.md` first. Finding 2 in `docs/plan/14-ux-fixes.md`; spec `11-ux-design.md §5.1` and `08-frontend.md §3`.

**You own:** `frontend/src/hand3d/**` and `frontend/src/pages/DevHand/**`.
**Do not edit:** `pages/Exercise/**` (A4 now, U4 later) or `components/**`. Keep the `<VirtualHand>` props API unchanged; any new prop must
be optional with a default that matches the new look. If you need a token, use an existing one from `styles/tokens.ts`.

## Problem
On the live screen the target ghost and the patient's hand are both light grey and nearly the same size, so "where should I be vs.
where am I" doesn't read at 1 m. The per-finger state tint (blue on their own, orange glove helping, green reached) is weak or invisible.
The hand also fills only a small part of its canvas.

## Do
1. **Ghost vs. actual contrast.** Ghost: `--target` at ~35% opacity, slightly larger (1.03×), no shading detail, a soft outline or rim so
   it frames the real hand. Actual: the solid clay tone from the spec (`#D9CFC4`-equivalent token), proper shading. They must stay
   distinguishable in grayscale (check with a grayscale filter).
2. **State tint per finger** on the actual hand, strong enough to read at 1 m: idle neutral → `--active` → `--assist` → `--reached`, with
   the 400 ms reach pulse (instant under reduced motion). Tint all five fingers (the glove is five-finger now).
3. **Framing.** Fit the camera to the hand's bounding box for each pose family so the hand fills ~80% of the canvas height, palm-down
   view (`12-five-finger-update.md`), no dead margins. Stable across poses (no jumping when the pose changes).
4. **Hand not visible:** actual fades to 30% and the centered label + camera icon from the spec.
5. Update `/_dev/hand` so every pose × state combination can be viewed side by side, plus a grayscale toggle.
6. Keep ≥ 55 fps and no allocations in `useFrame`.

## Acceptance criteria
- [ ] `/_dev/hand` screenshots: each pose with ghost + actual in idle, active, assist and reached, color and grayscale, in `docs/design/screenshots/ux-u2/`.
- [ ] A test (vitest) covers the state → material mapping and the framing math (the hand bounds fit the viewport for every pose).
- [ ] A short side-by-side before/after of the live screen in the PR (taken from `make dev-mock`; you may run the page but not edit it).
- [ ] No props API break: existing `VirtualHand` tests pass unchanged. `make test` green.
