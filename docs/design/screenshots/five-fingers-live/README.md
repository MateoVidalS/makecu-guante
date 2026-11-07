# Five-finger live UI evidence

Captured with the shared glove/camera simulator and mock API, in light and dark,
at 1280×720 and 1440×900. No hardware was connected.

- `home`, `setup`, `calibrate`, `evaluate`: helper and preflight screens.
- `setup-full`: full-page view including the placement diagram and rolling
  glove-detection check. Simulator statistics are explicitly labeled estimates.
- `exercise-live`: paused practice with all five meters and a palm-down hand.
- `exercise-feedback`: in-flow attempt feedback, including all five fingers.

Viewport captures use the exact dimensions in each filename. `setup-full` extends
vertically to show all content; helper pages may scroll. Live exercise does not
scroll at either size, including while feedback is visible. Browser assertions
check five meters, 48 px instructions, 28 px phase text, 24 px percentages,
64 px controls, and viewport bounds.

Reproduce from `frontend/`:

```sh
pnpm exec playwright test --config src/components/common/playwright.config.ts five.browser.spec.ts
```

The same browser check verifies a ring/pinky-only evaluation has four sweeps.
Unit tests cover the mirrored left-hand view, independent state colors for ring
and pinky, and contrast of the new ring/pinky palette on both themes.

The real glove/camera robustness and servo current limits still need the team's
hardware checks. These screenshots do not represent hardware validation.
