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
| [`/handoffs/`](../../handoffs/) | One self-contained brief per work package (WP0–WP11) + `STATUS.md` |
| [`/AGENTS.md`](../../AGENTS.md) | Rules every coding agent follows |
