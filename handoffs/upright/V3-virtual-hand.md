# V3 — Virtual hand in the mirror view (owns `frontend/src/hand3d/**` and `frontend/src/pages/DevHand/**`)
- New default presentation for `front_upright`: the hand **upright, palm toward the viewer, mirrored** (like a mirror / the camera
  preview), framed to fill ~80% of the canvas for every pose family. Keep the legacy palm-down view behind a `view` prop
  (`view?: CameraView`, default `CURRENT_CAMERA_VIEW`).
- Keep everything U2 added (target ghost, state tints, highlight prop, reduced motion, fades).
- `/_dev/hand` gallery shows both views. Screenshots in `docs/design/screenshots/upright/`.
- Do NOT edit `pages/Exercise/**` (A4 owns it right now); the coordinator will update the Exercise copy after A4 merges.
