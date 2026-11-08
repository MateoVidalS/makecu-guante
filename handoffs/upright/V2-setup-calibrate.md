# V2 — Setup, Calibrate, Evaluate copy and view-aware calibration
Owns `frontend/src/pages/{Setup,Calibrate,Evaluate,Home}/**` and `frontend/src/runtime/calibrationValidation.ts` (+ its test).
- Setup placement guide (`pages/Setup/CameraPlacement.tsx`): "Raise your hand beside your face, palm to the screen, elbow resting on
  the table, about 40–60 cm from the laptop"; a small diagram; backlight warning using V1's stats (stub until V1 merges).
- All "palm down / table edge / towel / wrist module at the table edge" copy in Setup, Calibrate, Evaluate and Home replaced by the
  upright posture (elbow supported, hand relaxed).
- Calibration saves `camera_view: CURRENT_CAMERA_VIEW`; `calibrationValidation` marks a calibration whose `camera_view` is not the
  current view (or missing) as "calibration needed" with the message "Your camera range was captured in the old position. Recapture
  it with your hand raised." (only the camera step needs redoing; servo ranges stay valid).
- Tests for the validation rule and the new copy.
