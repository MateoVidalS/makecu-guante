# Upright-hand camera — common rules (V1–V4)
- Read `AGENTS.md` and **`docs/plan/14-camera-front-upright.md` (all)**. The setup: the patient sits at the laptop, raises the hand
  upright with the **palm facing the laptop's front webcam** (like waving in a video call), elbow resting on the table.
- Contract (already committed by the coordinator): `CameraView = 'front_upright' | 'front_diagonal'`, `CURRENT_CAMERA_VIEW =
  'front_upright'`, optional `CameraCalibration.camera_view` (absent = legacy `front_diagonal`), `VisionSource.start({ view? })`.
- Other workers run in parallel (A1 runtime/engine, A2 voice, A4 live therapy UI). Stay strictly in your owned paths.
- `make test` green (and `make e2e` if you change a flow; the recovery/doctor tests are load-flaky: rerun alone once). Commit often
  (trailer `Co-Authored-By: Codex <noreply@openai.com>`). Before the PR: `git merge origin/MateoVidalS/rehab-hub`. PR into
  `MateoVidalS/rehab-hub` titled `Vn: ...`. Do not merge.
