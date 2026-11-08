# 14 — Camera in front: upright hand, palm to the laptop webcam

**Change (owner, Nov 7, with a reference picture):** the camera is the **laptop's front webcam**. The patient sits in front of the
laptop, **raises the hand upright with the palm facing the screen** (like waving in a video call), elbow resting on the table, and
opens/closes the fingers toward the camera. Until now everything assumed **palm down at the table edge** with a separate webcam in
front on the thumb side, diagonal, above the hand (`12-five-finger-update.md` H8–H9, F4, F7).

## 1. What changes and why

| # | Area | Before (palm down, side webcam) | Now (upright hand, palm to laptop webcam) | Impact |
|---|---|---|---|---|
| C1 | **Detection quality** | Dorsal/side view, fingers partly hidden in a fist | **Palm facing a front webcam is MediaPipe's home case**; wrist visible | Better detection; re-tune thresholds on this view |
| C2 | **Image orientation** | Diagonal | Upright selfie image, **no rotation needed** | Remove the diagonal-view assumptions; keep a mirror toggle |
| C3 | **Handedness** | Configured hand wins | Standard **selfie (mirrored) handedness** is reliable here | Use MediaPipe handedness again as a cross-check, configured hand still wins |
| C4 | **Flexion math** | World landmarks | Fingers curl **toward the lens**: strong 2D foreshortening | World landmarks (already used); validate with fixtures in this view; MCP against the palm plane for robustness |
| C5 | **Lighting** | Room light | **Window behind the patient = backlight** | Setup low-light/backlight warning with guidance |
| C6 | **Superseded (Nov 8, [16-bare-hand.md](16-bare-hand.md)): Glove on camera** | Camera saw the back | Camera sees the **palm side with threads, guides and anchors** | Day-1 glove detection check; thin light thread |
| C7 | **Posture & hardware** | Palm down, wrist module resting on the table edge, forearm on a towel | Hand **upright**, forearm vertical, **elbow on the table**; the wrist module hangs on the forearm, no table support | **Hardware team decision** (README §3 "Table setup"): strap fit, module weight, thread exit angle with the wrist vertical; elastics/servo pull no longer helped or opposed by gravity the same way |
| C8 | **Fatigue** | Arm supported | Holding the hand up tires a post-stroke patient | Recommend **elbow support** (table or armrest); shorter default sets; coach checks fatigue (AI therapist `record_feeling`, `add_rest`) |
| C9 | **What the patient sees** | Virtual hand palm-down from a diagonal view | The patient watches the screen with the hand in front of it | **Mirror metaphor**: virtual hand **upright, palm toward the viewer, mirrored**, matching the mirrored camera preview |
| C10 | **Framing** | 30–40 cm diagonal | Hand ~40–60 cm from the laptop, inside the frame next to the face | New placement guide ("raise your hand beside your face, palm to the screen, elbow on the table") and the hand-in-frame check |
| C11 | **Calibration** | Captures in the old posture | Same captures (open / glove-closed or own fist), but a calibration taken in the old posture is invalid | Add `camera_view` to `CameraCalibration`; an old-view calibration counts as "calibration needed" |
| C12 | **Docs/demo** | Palm down at the table edge | Upright hand, elbow on the table, laptop webcam | README §3, HARDWARE_CHECKLIST, DEMO |

## 2. Contract changes (coordinator)
```ts
type CameraView = 'front_upright' | 'front_diagonal';
interface CameraCalibration { /* existing fields */ camera_view: CameraView }
// VisionSource.start options gain { view: CameraView }
```
Default for new calibrations: `front_upright`. Calibrations without `camera_view` are treated as `front_diagonal` (invalid while the
app is set to `front_upright`).

## 3. Work packages
| WP | Owns | What |
|---|---|---|
| **V1 Vision** | `frontend/src/vision/**` | Front-upright mode (selfie handedness cross-check, no rotation); MCP vs palm plane; backlight/exposure metric in the robustness stats; synthetic `front_upright` fixtures for every pose with closure-ordering tests |
| **V2 Setup + Calibrate** | `frontend/src/pages/{Setup,Calibrate}/**` | Placement guide (upright hand, palm to the screen, elbow on the table, distance); backlight warning; calibration stores `camera_view`; old posture → "calibration needed"; copy no longer says "palm down / table edge" |
| **V3 Live presentation** | `frontend/src/pages/Exercise/**`, `frontend/src/hand3d/**` (coordinate with U4 and A4) | Virtual hand upright, palm toward the viewer, mirrored; pose instructions without "palm down"; camera preview mirrored to match |
| **V4 Docs + hardware note** | `README.md` §3, `docs/HARDWARE_CHECKLIST.md`, `docs/DEMO.md` | New posture, elbow support, lighting; flag C7 to the hardware team |

## 4. Risks
- **Posture vs the wrist module (C7)** is the biggest open item: confirm with the hardware team before the event.
- Fatigue from holding the hand up; keep sessions short and the elbow supported.
- Backlight from a window behind the patient.
