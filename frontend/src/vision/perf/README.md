# Hand-position performance suite

How well does memo recognize the hand position, and does the engine
**acknowledge** a pose (`reached`) when the patient makes it, and only then?
This folder measures that end to end, with numbers, in two layers:

| Layer                                       | Runs in                                              | What is real                                                                                                         | What is simulated                                                                              |
| ------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Pipeline suite** (`*.test.ts`)            | `make test` (vitest, ~20 s)                          | `FrameProcessor`, `jointAngles`, One Euro filters, `captureStats` calibration, `ExerciseEngine` reach rule and dwell | MediaPipe: a forward-kinematic hand projected into the camera plus a landmark-error model      |
| **MediaPipe bench** (`mediapipe-bench.mjs`) | `pnpm --dir frontend bench:vision` (opt-in, minutes) | The bundled MediaPipe Hand Landmarker (CPU, headless Chromium) and the production joint math                         | The hand: a skin-toned capsule model on the virtual hand's rig, rendered at known joint angles |

Neither layer replaces recordings of a real bare hand with points (see
"Limits" below). Everything is seeded and deterministic.

```sh
pnpm --dir frontend test:vision-perf     # pipeline suite with every result table printed
pnpm --dir frontend bench:vision         # real MediaPipe bench -> mediapipe-bench.result.json
REHAB_BENCH_QUICK=1 pnpm --dir frontend bench:vision   # ~1 min smoke run
```

## Files

| File                                                               | Purpose                                                                                                                                                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handModel.ts`                                                     | Synthetic hand (same bones as `fixtures/generateFixtures.py`), two patients, both camera views (`front_upright` laptop webcam, legacy `front_diagonal`), posture tilt, noise model, minimum-jerk motion |
| `harness.ts`                                                       | Streams frames through the **production** `FrameProcessor`, calibrates with the production `captureStats`, and drives the **production** `ExerciseEngine` (observation only) to get `reached` times     |
| `scenarios.ts`                                                     | Shared attempt scenarios (rest 1 s, reach in 1.5 s, hold) and summaries                                                                                                                                 |
| `accuracy.test.ts`                                                 | Static accuracy: bias, jitter, p95 error per pose/finger/view/patient; size, tilt, depth-flattening, linearity, calibration success                                                                     |
| `acknowledgment.test.ts`                                           | Hit rate and latency for every pose × view × hand × patient; psychometric curve; false acknowledgments; confusion matrix; known gaps                                                                    |
| `timing.test.ts`                                                   | Tracking lag and settling, frame rate (30/20/15 fps), detection dropouts, occlusion, per-frame CPU cost                                                                                                 |
| `mediapipe-bench.html`, `mediapipeBench.ts`, `mediapipe-bench.mjs` | Real-MediaPipe bench page and its Playwright driver (starts its own Vite server on a free port)                                                                                                         |
| `mediapipe-bench.result.json`                                      | Last full bench run (evidence)                                                                                                                                                                          |

## Noise model and where it comes from

> **Update after P1/P4:** the `bench` level was calibrated against flex-sum
> jitter measured with the old _unsigned_ angles, which fold noise into a bias
> and under-report it. With signed angles, real MediaPipe on the bench hand
> shows ~12–13° raw jitter at the open hand (`mediapipe-bench.result.json`),
> so treat **`poor light (2x)` as the realistic level** until real bare-hand-with-points recordings
> replace the model. The bench now renders anatomically correct hands
> (`anatomical: true`); the legacy hand3d rig is geometrically mirrored.

The bench measured real MediaPipe on a still rendered hand with webcam-like
sensor noise: landmark jitter ≈ 1.2 mm (x/y) and 2.2 mm (depth), giving a raw
per-finger flex-sum jitter of 2.5–12°. MediaPipe's error is correlated across
landmarks, so independent synthetic noise needs smaller sigmas for the same
angle jitter: **`bench` = 0.6 mm x/y, 1.2 mm depth** reproduces it. `poorLight`
(2×, labeled `poor light (2x)`) and `severe` (3.5×) stand for poor light or a far camera.
Their noise values and all acceptance thresholds are unchanged; points are rendered
separately in the MediaPipe bench, not modeled as extra landmark noise.
Replace these with numbers from real recordings when the team has them.

## Patients and the opening glove

Two synthetic patients: **full range** (open = straight, own fist = full fist) and
**flexor tone, limited own fist** (the relaxed hand as opened by the glove keeps
some flexion; the own fist reaches ~70% of a full fist). This matches calibration
after the open-assist pivot (`docs/plan/15-open-assist.md`): `open_flex` is the
relaxed hand opened by the glove and `closed_flex` is the patient's own fist. The
suite runs the engine observation-only (`assist_enabled: false`), so it measures
recognition and acknowledgment, which do not depend on the glove's direction.

## Anatomical chirality (P1 rework)

`handLandmarks` returns an anatomically right hand (+Y distal × +Z palmar points to
its +X thumb); `observe` mirrors it for the left hand; the thumb curls toward the
pinky with a palmar component. `fixtures/generateFixtures.py` follows the same
convention, and the bench renders anatomically correct hands (`anatomical: true`;
the legacy hand3d rig is geometrically mirrored). Ground truth in `harness.ts` uses
independent unsigned `acos` angles on exact geometry (`oracle.test.ts` proves it never
calls production joint math).

Production math (`vision/flex.ts`): long fingers use signed flexion with the palm
normal oriented by the configured affected hand; the thumb uses its full 3D bend on
smoothed landmarks, signed against palmar normal + the direction to the pinky MCP.
Calibrations carry `flex_model: 2` (P4); older ones ask to redo the camera step.

## Status after the fixes (P1–P4, releases #68 and #80)

| Finding                                  | Fixed by          | Now                                                    |
| ---------------------------------------- | ----------------- | ------------------------------------------------------ |
| 1. Low closures read low (thumb most)    | P1 signed flexion | linearity error ≤ 0.02 even at 2× noise                |
| 2. Effective tolerance tighter than 0.10 | P1                | 0.05-short poses acknowledged 100%                     |
| 3. One missed frame restarted the dwell  | P2 (#64)          | gaps ≤ 200 ms tolerated; 10% misses: 100% acknowledged |
| 4. Pinch slow to acknowledge             | P1 pinch filter   | p95 ≤ 1.2 s                                            |
| 5. Pinch render missed its own target    | P3 (#63)          | the on-screen pinch is acknowledged                    |
| Calibrations made with the old math      | P4 `flex_model`   | they ask to redo the camera step                       |
| 6. Smoothing tail, 7. shape not checked  | not changed       | documented; shape check is a stretch goal              |

Real MediaPipe on anatomically correct hands (upright view, last run in
`mediapipe-bench.result.json`): flexion is positive and increases open → half → fist
for every finger of the right hand and every long finger of the left. MediaPipe
misreads the rendered proxy's left thumb (its IP joint reported bending away from
the palm), so the left thumb must be confirmed with real bare-hand-with-points recordings.

The sections below are the original #62 measurements that motivated the fixes.

## Baseline results (#62, `bench` noise unless stated)

**What works**

- Noise-free, the math is exact (< 0.005) in both views, both hands, both
  patients, hand sizes 0.75–1.25×, and with the hand turned ±30° after calibration.
- Every library pose made correctly is acknowledged: **100% of 384 attempts**
  (6 poses × 2 views × 2 hands × 2 patients × 8 seeds). Latency from "the real
  hand satisfies the rule" to `reached`: **p50 ≈ 0.65–0.8 s, p95 < 1 s** for
  the tendon glides (the 0.5 s dwell + ~0.15–0.3 s smoothing).
- No false acknowledgments: holding every finger 0.2 or 0.3 short is never
  accepted; one finger 0.25 short blocks the pose; an almost-closed pinch is refused.
- Works at 15 fps. Per-frame CPU cost is ~10 µs (`FrameProcessor`) and ~3 µs
  (`ExerciseEngine.tick`), negligible next to MediaPipe inference.
- A 150 ms occlusion during the hold costs ~40 ms and never loses the pose.

**What to know (findings)**

1. **Low closures read low; the thumb most.** Joint angles are `acos` of noisy
   bone vectors, which is never negative, so near-zero angles read high. That
   inflates the open-hand calibration and compresses the low range:
   at closure 0.1–0.3 the long fingers read **−0.05** and the thumb **−0.11**
   (upright view; −0.10 / −0.19 at 2× noise). The thumb has only two short
   bones and ~100° of range, so it suffers most.
2. **The effective tolerance is not the nominal 0.10.** Because of (1), a
   thumb exactly on its straight-fist target (0.50) reads ~0.42, only 0.02
   above the 0.40 acceptance line. A straight fist or full fist held 0.05 short
   (inside the tolerance) is **never** acknowledged in the upright view
   (psychometric table). `open` is the opposite: 0.12 still-closed is accepted.
3. **One missed detection restarts the 0.5 s dwell.** 1–2% misses push p95
   latency from 0.77 s to 1.3 s; 5% to 2.1 s; **10% loses 12% of correct
   hooks; 20% loses 75%** of correct poses. MediaPipe miss rates with small points on a
   bare hand are unknown; this is the most important number to measure on day 1.
4. **Pinch is slow to acknowledge:** p50 ≈ 1.0 s, p95 up to 2.2 s. The pinch
   ratio has its own One Euro filter and the fingertips approach slowly at
   the end of the reach.
5. **The pinch render misses its own target.** `POSES.pinch.render` index =
   50/50/20 = 120° of flexion = 0.44 of a full-fist calibration, but the index
   target is 0.55 (accepted from 0.45). A patient who copies the virtual hand
   exactly is never acknowledged (with a full-range calibration).
6. **Smoothing tail.** The closure is within 0.05 of the hand ~0.35 s after
   the hand stops, but the last 2% takes ~0.7–0.8 s (One Euro `minCutoff`
   0.3 Hz once the hand is still).
7. **Shape is not checked** (documented in `06-session.md §2`): a hook is
   accepted as a tabletop and any fuller pose satisfies a lighter one.
8. **Calibration capture** succeeds at 1× and 2× noise (≥ 90%) and refuses
   at 3.5× ("Too much movement"), which is the intended behavior.

Re-measured after V1 (#61, palm-plane MCP in the upright view): findings 1–5
are unchanged (V1 keeps `Math.abs`, so near-zero angles still rectify), and two
small upright regressions appeared: tabletop long-finger bias 0.033 (was < 0.03)
and spastic-hand calibration capture at 2× noise 70% (was 90%).

Known gaps 2, 3 and 5 and both V1 regressions are written as `it.fails` tests in
`accuracy.test.ts`, `acknowledgment.test.ts` and `timing.test.ts`: they pass while
the gap exists and start failing once it is fixed; then change `it.fails` to `it`.

### Directions for the owners of `vision/` and `engine/` (not done here)

- (1, 2) Measure flexion as a **signed** angle in the finger's flexion plane
  (against the palm normal from wrist / index MCP / pinky MCP), so noise
  averages out instead of rectifying; or subtract the noise floor; or give the
  thumb its own tolerance. The V1 brief already plans "MCP against the palm plane".
- (3) Let the dwell survive short gaps (e.g. hold the last valid frame for up
  to ~150–200 ms, like `FrameProcessor` already does for its filters) instead of
  resetting on a single missing frame.
- (4) Tune the pinch filter (or score pinch on the joint filter's timeline).
- (5) Make the pinch render and target agree (render ≈ 0.55 of the range, or
  lower the index target).

## Bare hand with points comparison

The device is still called the glove, but the hand has no covering. Small black
thread-guide points and yellow fingertip anchors are taped directly to the back
of the fingers. The camera sees an upright bare palm, with a few points at finger
edges and tips; keep the palm-side joint creases clear.

`BenchShot.inpaint` paints over the device before inference with a
`deviceInpaint.ts` variant; the driver also runs both point conditions with
`inpaint: 'points'` and reports `inpaintMs`. Quick run (Nov 8): with points, right
hand detection 0.8 → 0.9 and calibration failed → closure MAE 0.12 / p95 0.35;
left hand 0.8 → 1.0, MAE 0.15 / p95 0.73 (bare: 0.10 / 0.30 and 0.20 / 0.94).
Without points it paints nothing, so results are identical to bare.

`BenchShot.points` toggles two small black dorsal guides per finger (proximal and
middle phalanges; proximal/distal on the thumb) and a yellow dorsal fingertip
anchor. Points move with the bones and are naturally hidden by the palm when
occluded. The driver writes a `points` section with `points: false` and
`points: true` for anatomically correct **right and left hands in the upright
view**, including quick mode. Each condition uses the same poses, seeds and
sensor noise, with its own open/closed calibration. It reports sweep detection
rate, calibration detection/ranges, per-pose and overall calibrated closure MAE
and p95 absolute error. Errors use individual detected shots; missing detections
are reported in the detection rate, and unavailable calibration gives null errors.

First run (quick mode, 2 seeds per pose, Nov 8; rendered capsule hand, so a
warning sign rather than a measurement of real hands):

| Upright view                          | Without points | With points                               |
| ------------------------------------- | -------------- | ----------------------------------------- |
| Right hand: sweep detection           | 100%           | **60%**                                   |
| Right hand: closure error, mean / p95 | 0.12 / 0.39    | 0.15 / 0.62                               |
| Left hand: calibration                | ok             | **fist not detected; calibration failed** |

The points hurt MediaPipe on the proxy, mostly in a fist, where the backs of the
fingers (and their points) turn toward the camera. On a real hand the effect may
be smaller, but it makes the day-1 checks essential: the Setup hand-detection
check with the points on, and a real upright recording (`bare-hand-points`). If
detection drops in a fist, try smaller or skin-coloured guides and keep the yellow
anchors on the very tip, then record again.

## Results (real MediaPipe bench)

Last full run (`mediapipe-bench.result.json` has every row; CPU delegate,
SwiftShader, so inference is slower than a laptop GPU):

| Measure                                              | front_upright                 | front_diagonal                              |
| ---------------------------------------------------- | ----------------------------- | ------------------------------------------- |
| Detection over the closure sweep (right / left hand) | 100% / 91%                    | open pose not detected (right) / 46% (left) |
| Calibrated closure error, mean / p95 (right hand)    | 0.13 / 0.32                   | –                                           |
| Landmark jitter, still open hand (x / y / depth)     | 0.9 / 0.7 / 2.0 mm            | 1.3 / 1.2 / 4.1 mm                          |
| Raw flex-sum jitter per finger, half-closed          | 2.4–12 °                      | 2–4 °                                       |
| Detection of a still fist in VIDEO mode              | 19%                           | 70%                                         |
| Inference time p50 / p95                             | 69 / 80 ms (CPU, SwiftShader) |                                             |

How to read it: the upright (laptop webcam) view is the better view for
detection, which matches the plan in `docs/plan/14`. The rendered fist is hard
for MediaPipe (a proxy artefact as much as a real risk), and calibrated
closure errors of 0.1–0.3 on this proxy are larger than in the pipeline
suite. The hook read low in 4 of 4 right-hand upright shots (fingers curl
toward the lens), and tilting the hand ±25° after calibration produced errors
up to 1.0 on single shots. Treat these as the reasons to record a real bare hand with points
soon, not as measured accuracy on a person. The previous GPU measurement on a real
photo (`fixtures/browser-benchmark.json`) gave 24.5 ms p50 inference.

## Limits

- The pipeline suite's hand is ideal geometry and its noise is a model. Real
  failure modes (skin-mounted points and tape, motion blur, backlight) are not
  simulated beyond "more noise" and "missed frames" in the pipeline suite.
  The MediaPipe bench adds dorsal points but does not model tape or threads.
- The bench hand is a rendered capsule model, not a human hand: MediaPipe
  detects it less reliably than a real hand (especially a fist), so its
  detection rates are pessimistic and its accuracy is indicative only.
- Neither layer measures the physical camera-to-screen delay.
- **Day-1 check:** run a bare-hand-with-points detection check and make a real recording with
  `vision/recorder.ts` (see `vision/README.md`), in the upright posture, and
  add those recordings here as a third layer.
