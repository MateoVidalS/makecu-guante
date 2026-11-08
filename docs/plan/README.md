# Rehab Hub — Plan index

A web app + firmware for the **robotic tendon glove** described in `/README.md`. A virtual hand shows the target pose, a
webcam measures how far each finger closes, the glove completes only what the patient can't (assist-as-needed), the servo current
measures resistance and acts as the safety cut-off, a Gemini Live voice coach guides the session, and history and the doctor view track
progress.

| Doc | What |
|---|---|
| [01-product.md](01-product.md) | Users, modes, stories, agreed decisions, copy, demo storyline |
| [02-architecture.md](02-architecture.md) | System shape, internals, **repo layout & file ownership**, commands |
| [03-contracts.md](03-contracts.md) | **Source of truth**: serial protocol, TS types, runtime API, REST, DB, config |
| [04-firmware.md](04-firmware.md) | ESP32 firmware, safety rules, native tests, bench guide |
| [05-vision-and-glove-link.md](05-vision-and-glove-link.md) | Web Serial client, SimWorld simulator, MediaPipe flexion → closure |
| [06-session.md](06-session.md) | Poses, exercise state machine, assist-as-needed, evaluation, metrics |
| [07-voice-and-ai.md](07-voice-and-ai.md) | Gemini Live coach, local safety net, fallback, Gemini summaries |
| [08-frontend.md](08-frontend.md) | Visual system, routes, virtual hand, every page |
| [09-testing.md](09-testing.md) | Test layers, README acceptance criteria mapping, definition of done |
| [11-ux-design.md](11-ux-design.md) | **UX/UI design**: users, principles, tokens, shell, wireframes, choreography, microcopy, accessibility, QA |
| [10-orchestration.md](10-orchestration.md) | **How the build runs**: Orca handoffs to Codex, waves, merges, hardware gate |
| [14-camera-front-upright.md](14-camera-front-upright.md) | **Camera in front: upright hand, palm to the laptop webcam** (mirror view, posture vs wrist module, fatigue, lighting, calibration per view) |
| [13-ai-therapist.md](13-ai-therapist.md) | **Live AI therapy assistant**: Gemini Live tool calling, safe limits, braking, decisions log |
| [14-ux-fixes.md](14-ux-fixes.md) | **UX fixes from the Nov 7 design review**: findings, U1–U4 waves around the AI-therapist wave |
| [15-open-assist.md](15-open-assist.md) | **Pivot: the glove helps the hand OPEN** (tendon pull on the wire, asymmetric ramps, open-only assist, load governor, O0–O7) |
| [12-five-finger-update.md](12-five-finger-update.md) | **Hardware changes analysis + plan to move to 5 fingers** (contract v2, power-aware assist, palm-down view, glove vision check) |
| [16-bare-hand.md](16-bare-hand.md) | **Nov 8: bare hand with BLACK dorsal guides and YELLOW fingertip anchors**, skin checks, recalibration, unhooked thread friction, vision evidence; supersedes H10/glove detection and C6 |
| [`/handoffs/`](../../handoffs/) | One self-contained brief per work package (WP0–WP11) + `STATUS.md` |
| [`/AGENTS.md`](../../AGENTS.md) | Rules every coding agent follows |
