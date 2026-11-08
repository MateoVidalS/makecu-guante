# 14 — Camera below the hand (palm view)

**Change (owner, Nov 7):** the webcam moves **below the hand, looking up at the palm**. The patient keeps the hand in the air,
palm down over the camera (fingers beyond the table edge, wrist module on the table), so the camera sees the **palm side**.
Until now everything assumed a camera **in front, on the thumb side, diagonal, above the hand** (`12-five-finger-update.md` H9, F4).

## 1. What changes and why

| # | Area | Today (front-diagonal, above) | With the camera below (palm view) | Impact |
|---|---|---|---|---|
| C1 | **Detection quality** | Dorsal/side view, fingers partly hidden in a fist | **Palm view is MediaPipe's best case** (its training data is mostly palms/backs facing the camera); fingertips stay visible while they curl toward the lens | Better detection, but re-tune thresholds |
| C2 | **Image orientation** | Upright | Camera looks **up**: the image can be rotated 90/180° and is seen "from below"; fingers may point down or sideways in the frame | Add a **rotation setting** (0/90/180/270) applied before MediaPipe, and auto-suggest it in Setup |
| C3 | **Handedness** | Uses the configured affected hand (F4) | From below, MediaPipe's left/right label is **inverted** relative to the selfie assumption | Keep "configured hand wins"; add `camera_view` to calibration so the mirror logic is right per view |
| C4 | **Flexion math** | MCP angle from wrist→MCP vs MCP→PIP | **The wrist (landmark 0) can be hidden** by the wrist module/table edge; MediaPipe will guess it | Compute MCP flexion against the **palm plane** (landmarks 5, 9, 13, 17 + palm normal) instead of the wrist vector; PIP/DIP unchanged |
| C5 | **Depth** | Fingers curl sideways to the camera | Fingers curl **toward** the lens: strong foreshortening in 2D | Use **world landmarks** only (already the case) and validate with fixtures in this view |
| C6 | **Lighting** | Room light on the back of the hand | Camera looks at the **ceiling lights**: backlight, dark palm, glare | Setup check for under-exposure; guidance (diffuse light, avoid ceiling spots), keep the light glove |
| C7 | **The glove itself** | Camera sees the back (elastics) | Camera sees the **palm side: threads, guides and anchors** sewn on the palm | Re-run the glove detection check; thin light thread; guides centered so they don't look like joints |
| C8 | **What the patient sees** | Virtual hand palm-down from a front-diagonal view (F7) | The patient looks at their **back** of the hand from above; the camera preview shows the **palm from below** | Keep the virtual hand from the **patient's** viewpoint (back of the hand); show the camera preview **flipped to match the patient's view** with a small "seen from below" label |
| C9 | **Distance/framing** | 30–40 cm, diagonal | ~20–30 cm straight below, whole hand + wrist in frame | New placement guide and the "hand inside the guide box" check |
| C10 | **Calibration** | Open / glove-closed (or own fist) captures | Same captures, but stored per **camera view** (a calibration from the old view is invalid for the new one) | Add `camera_view` + `rotation` to `CameraCalibration`; an old-view calibration counts as "calibration needed" (same pattern as the 3→5-finger fix) |
| C11 | **Docs/demo** | README "Puesta en la mesa", HARDWARE_CHECKLIST, DEMO | Camera below, how to mount it (small tripod or a box with a hole), lighting | Update docs and the demo script |

## 2. Contract changes (coordinator)
```ts
type CameraView = 'front_diagonal' | 'below_palm';
interface CameraCalibration { /* existing fields */ camera_view: CameraView; rotation: 0 | 90 | 180 | 270 }
// VisionSource.start options gain { view: CameraView; rotation: 0 | 90 | 180 | 270 }
```
Default for new calibrations: `below_palm`. Calibrations without `camera_view` are treated as `front_diagonal` (and therefore invalid while the app is set to `below_palm`).

## 3. Work packages
| WP | Owns | What |
|---|---|---|
| **V1 Vision** | `frontend/src/vision/**` | Rotation before inference; view-aware handedness; **palm-plane MCP flexion** (robust to a hidden wrist); exposure/backlight metric in the robustness stats; synthetic `below_palm` fixtures (open, hook, tabletop, straight fist, full fist) with closure-ordering tests; a recorder note for real fixtures |
| **V2 Setup + Calibrate** | `frontend/src/pages/{Setup,Calibrate}/**` | New placement guide (camera below, palm view, distance, lighting); rotation picker with an auto-suggestion; low-light warning; calibration stores `camera_view` + `rotation`; old-view calibration → "calibration needed" |
| **V3 Live presentation** | `frontend/src/pages/Exercise/**`, `frontend/src/hand3d/**` (coordinate with U4) | Virtual hand stays in the patient's viewpoint (back of the hand); camera preview flipped to match, labeled "seen from below" |
| **V4 Docs** | `README.md` §3 "Puesta en la mesa", `docs/HARDWARE_CHECKLIST.md`, `docs/DEMO.md` | Camera below, mount, light, the glove check on day 1 |

## 4. Open questions for the owner
1. Is the hand **palm down over the camera** (camera on/under the table looking up), or held **upright with the palm facing a camera in front**? The plan assumes the first; the second only changes C2/C8.
2. Does the **wrist module** stay on the table under the wrist (then the wrist may be hidden, C4 matters), or is the forearm lifted?
3. How is the camera mounted (tripod upside down, a box with a hole, a phone)? It sets the rotation default.

## 5. Risks
- Backlight from ceiling lights is the most likely failure; test it on day 1 at the venue.
- Thread and guides on the palm may confuse MediaPipe; keep them thin and light.
- Old calibrations become invalid when switching views (by design).
