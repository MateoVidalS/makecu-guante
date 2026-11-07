# Rehab Hub demo

A six-minute walkthrough for one presenter and one helper. Start with the simulator;
use the physical glove only after the team records the hardware gate in
[HARDWARE_CHECKLIST.md](HARDWARE_CHECKLIST.md). The app estimates movement and
resistance; it does not provide a validated clinical measurement.

## Start from a clean checkout

Use Node 20+, pnpm, Python 3.11+ and uv. From the repository root:

```sh
make setup
make demo-seed
make dev-sim
```

Open **http://127.0.0.1:5173** in Chrome or Edge. Open Calibrate, choose
**Calibrate simulator**, then **Continue to practice**. This calibration is for
simulated sources only. The seed is stored in `backend/data/rehab.db` by default;
`make dev-sim` uses that same database. `make dev-mock` uses browser fixtures and
will not show the seed.

`make demo-seed` is opt-in and idempotent: existing demo sessions are left alone.
It generates eleven sessions (165 attempts) over three weeks and four evaluations
by running the real exercise/evaluation engines on SimWorld. Patient presets
improve from severe to moderate to mild. Traces, assistance and any genuine
simulator safety interruptions are retained. Every session/evaluation is flagged
`is_demo`; these are synthetic examples, not evidence of treatment benefit.

To replace **all flagged demo sessions and evaluations**, preserving real records:

```sh
make demo-seed DEMO_SEED_ARGS=--reset
```

For a separate event database, use the same absolute path for both commands:

```sh
REHAB_DB_PATH=/tmp/rehab-event.db make demo-seed
REHAB_DB_PATH=/tmp/rehab-event.db make dev-sim
```

For a built simulator demo, run `VITE_SIM=1 make demo` after seeding and open
**http://127.0.0.1:8000**. Calibrate the simulator before practice. Plain `make demo`
starts with physical sources; select both simulators in Setup for a hardware-free
run. Neither command seeds automatically.

## Pre-demo checklist (15 minutes before)

- [ ] Chrome/Edge, laptop plugged in, sleep disabled for the presentation.
- [ ] Open the local app; `/api/health` reports `ok: true`.
- [ ] Seed loaded: History shows demo labels, replay traces, and four evaluations.
- [ ] Both sources are simulated for rehearsal; **Demo recovery** is visible in the header.
- [ ] Camera/microphone permissions granted if using them. Web Serial requires
  Chrome/Edge, localhost, and a helper's click to pick the USB port.
- [ ] For Live coach and summaries, set `GEMINI_API_KEY` in `backend/.env` and
  restart the server. Check `/api/health` reports `gemini: true`, then rehearse an
  actual connection and summary. A configured key alone does not prove access.
  Keep the key off screen and out of exported recordings.
- [ ] Volume audible; click a control to unlock browser audio. Confirm the local
  safety phrase is audible even with Voice mode Off. Simple voice needs no key;
  browsers without an installed speech voice still show captions.
- [ ] Camera sees the whole affected hand, including fingertips. Use diffuse
  light, a steady background, and an angle that keeps tendons from hiding joints.
- [ ] If using hardware: recorded bench gate, accessible physical STOP and supply
  switch, helper present, fresh calibration for this hand and mounting. Seeded
  model ranges must never substitute for physical calibration.
- [ ] Rehearse source recovery: open **Demo recovery** → **Use simulated glove**
  or **Use simulated camera**. It ends/saves the current run and readies the source
  without reloading. Start a new practice afterward; mixed-source runs are demo.
- [ ] No unsaved real session. Keep the tab open until the header says **Saved**.

## Minute-by-minute script

| Time | Action | What to say / show |
| --- | --- | --- |
| 0:00–0:45 | Home → Exercise. Choose a single full fist, one repetition; Start practice. | “Try on your own first. The glove helps with the rest.” Explain ghost = target, solid = your hand. For a physical demo, the helper remains beside STOP. |
| 0:45–1:30 | Let the moderate simulated patient try halfway; watch blue movement, orange assistance, then green hold. | “The camera estimates how far each finger closes. Assistance fills the remaining movement.” Point to the labels as well as colors. |
| 1:30–2:30 | Start another full-fist repetition. Expand **Simulator controls**, check **Rigid index**, and wait for assistance. | “Here is resistance. The glove stops and releases on its own.” Show the safety banner, listen for “Stopping. I felt resistance in your index.” Uncheck Rigid index before Resume. Show the current trace later in replay, where technical units belong. Never deliberately stiffen or stall a person's finger. |
| 2:30–3:15 | Finish/end the run; wait for Saved. Open History → Sessions and a demo session → replay. | Show the attempt, assistance and current trace. “These examples are labeled demo data.” Use Show as table if the projector obscures a chart. |
| 3:15–4:00 | History → range/assistance trends, then resistance/evaluations. | “The synthetic patient improves over three weeks.” Evaluation resistance is an estimate inspired by clinical practice; total servo current cannot isolate a muscle or establish a diagnosis. |
| 4:00–5:00 | Doctor view → Generate summary (when available). | “The therapist can review trends and request a summary.” Read the actual generated text; do not promise a particular conclusion. Without a key/network, show the unavailable state and the underlying charts. |
| 5:00–6:00 | Doctor export JSON/CSV; optionally Print. Exit doctor view. | Show the read-only banner and demo labels in output. Explain that practice still works with simple voice and simulated sources. End any active run and release before removing hardware. |

The full default plan is fifteen attempts; do not run it during this six-minute
pitch. A single fist demonstrates the core behavior promptly. All deliberate
resistance/STOP/unplug demonstrations use the simulator or an empty bench fixture.

## Recover without a reload

Recovery controls stay in the header during practice and evaluation. Switching a
source ends and saves the current run, releases the old glove, and leaves movement
stopped. It does not automatically resume an interrupted exercise or sweep.

| Problem | Immediate action | Continue |
| --- | --- | --- |
| Camera permission denied, hand hidden, or tracking lost | Pause/release; **Demo recovery → Use simulated camera**. | Wait for simulator-ready message, then start a new practice. Simulated vision with a physical glove still commands a real mechanism: use a fixture or also switch the glove to simulation before continuing. |
| Glove disconnects or stops responding | Physical STOP / power off if release is uncertain. **Demo recovery → Use simulated glove**. | Source changes within five seconds without reload. Do not reconnect/restart physical motion during the pitch. Select simulated camera too for the rehearsed patient model. |
| Live coach fails / microphone unavailable | **Demo recovery → Use simple voice**, or Coach controls → Voice mode → Simple voice. | Practice and captions continue; use on-screen Pause/Skip/End session because voice commands require Live coach. Local safety speech remains armed. |
| Overcurrent / physical STOP | Stop, let the mechanism release; remove the cause. Release the physical STOP before Resume. | Never repeatedly Resume against resistance. If uncertain, switch to both simulators and leave hardware powered off. |
| Backend unavailable | End safely; keep this tab open. Restore/restart backend with the same DB path. | Header changes Offline → Saving… → Saved. Do not reload while saving is pending. History/AI summaries may remain unavailable until recovery. |
| Summary request unavailable | Leave the unavailable message visible. | Show trend charts and exports. Do not invent a Gemini response. |

## Rehearsal verification

```sh
make test
make e2e
```

Browser checks use an isolated temporary database, fake media, and an accelerated
simulator; they do not prove physical timing or comfort. The hardware team records
physical evidence separately. A first-time helper should rehearse the calibration
wizard with a teammate before presenting; record any confusing step rather than
claiming a hallway test happened automatically.
