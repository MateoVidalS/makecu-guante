# Local vision assets

All inference assets are served by Vite (or the built app) from `/models/`.
No CDN, model service, or network request outside the app is required at runtime.

- `hand_landmarker.task`: Google MediaPipe Hand Landmarker, float16, model version **1**.
  Downloaded from [the versioned Google model URL](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task).
  SHA-256: `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1`.
- `wasm/*`: JavaScript loaders and WASM binaries copied from the already locked
  `@mediapipe/tasks-vision` **1.2.2** package. Both classic and ES module loaders
  are included because the resolver selects the runtime supported by the browser.
  The only loader modification is an ESLint-disable header for vendored code.
  When updating the dependency, copy all four files again and restore that header.
- MediaPipe is licensed under Apache 2.0; see `LICENSE` and the upstream
  [MediaPipe repository](https://github.com/google-ai-edge/mediapipe).
  [Google's Hand Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker?tab=Web)
  describes the model, VIDEO mode, and GPU/CPU delegates.

To download the model again, run from the repository root:

```sh
curl -fL --retry 3 \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task \
  -o frontend/public/models/hand_landmarker.task
```
