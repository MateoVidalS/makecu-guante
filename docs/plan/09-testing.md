# 09 — Testing & definition of done

## 1. Layers
| Layer | Tool | Owner |
|---|---|---|
| Firmware core: protocol + safety | PlatformIO `native` + Unity | WP1 |
| Serial codec, SimGlove conformance (the firmware semantics in TS) | vitest | WP2 |
| Flexion math, One Euro, calibration stats, handedness | vitest + landmark fixtures | WP3 |
| Exercise + evaluation engines | vitest (scripted inputs, no timers) | WP4 |
| Backend repo, API, history, export, summaries (mocked Gemini) | pytest + httpx ASGI client, temp DB | WP5 |
| Hand rig math | vitest | WP6 |
| Pages (with the stub runtime + MSW) | vitest + Testing Library | WP7, WP9 |
| Voice cues, safety net, Live transport fake, token endpoint | vitest, pytest | WP8 |
| Runtime integration: SimWorld → engine → SimGlove → API (real backend, temp DB) | vitest/node + pytest fixture server | WP10 |
| E2E | Playwright, Chrome, `make dev-sim`, fake camera/mic flags | WP10 |
| Hardware bench | `firmware/BENCH.md` + `docs/HARDWARE_CHECKLIST.md` | WP1, WP11 + team |

**Shared contract fixtures:** `contracts/fixtures/serial_lines.txt` (one valid example of every message + malformed lines) is parsed by both the
firmware native tests and the TS codec tests. That's the cross-language protocol check.

## 2. README acceptance criteria → tests
| README §4.10 | Verified by |
|---|---|
| 1. Virtual hand < ~150 ms behind the real hand | WP3 latency log (camera → VisionFrame p95 ≤ 80 ms) + WP6 frame budget; manual check with a phone slow-mo video at the event |
| 2. `target` reaches the servo < 50 ms | WP1 bench: timestamp the send → `tel.md == target` echo; p95 logged in Setup |
| 3. Rigid index → overcurrent release + voice | WP1 native (overcurrent timing), WP2 sim conformance, WP4 engine (attribution), WP8 safety net, WP10 e2e with the sim "rigid index" |
| 4. STOP releases in any state | WP1 native + bench |
| 5. USB unplugged → release ≤ 1 s | WP1 native watchdog + bench |
| 6. Full session (5 poses × 3) recorded + Gemini summary | WP10 e2e (sim, summary mocked) + a manual run with a real key |

## 3. Determinism
SimWorld takes a seed and a `timeScale`; the engines are pure, driven by explicit `now`; e2e runs the sim at 3× speed with the voice in fallback-muted
mode. Playwright launches Chrome with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` and uses `VITE_SIM=1` (no Web Serial in e2e).

## 4. Definition of done (every WP)
1. The brief's acceptance criteria are met.
2. `make test` passes (`pio` tests are skipped with a notice if PlatformIO isn't installed, except in WP1, which must install it).
3. Lint and typecheck are clean.
4. Only owned paths were changed, or the exceptions are listed in the PR.
5. The PR uses the template in `AGENTS.md`.
6. No secrets committed.
