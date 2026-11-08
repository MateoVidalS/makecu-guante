# 16 — Bare hand with points

Owner decision, **Nov 8, 2026**. Supersedes the fabric-glove decision and detection
risk in [12-five-finger-update.md](12-five-finger-update.md) H10 and its glove-detection
rows, and [14-camera-front-upright.md](14-camera-front-upright.md) C6.

No fabric glove. Small **BLACK guide points** sit on the backs of the proximal and
middle phalanges; **YELLOW anchors** sit on the backs of each fingertip. Attach them
directly to skin with skin-safe tape; the hardware team must confirm the attachment
method. Threads run over the backs of the fingers and open the hand as specified
in [15-open-assist.md](15-open-assist.md). The app keeps the device name **glove**.

The webcam now sees a bare palm, MediaPipe's best case. The old “biggest vision
risk: gloved hand” is **superseded**. Point/tape interference still needs measurement.

| Area | Impact |
| --- | --- |
| Vision | Day-1 bare-hand-with-points detection check in Setup plus a real landmark recording using `frontend/src/vision/recorder.ts`, covering `bare-hand-points`. The recorder's covering option `bare-hand-points` and the real-MediaPipe bench's **points** section (rendered hand with and without black/yellow points) come with B1. Real recordings remain the evidence that matters. |
| Setup | Upright bare palm toward front webcam, good front light, sleeve up, no rings/watch; points and tape must not cover palm-side joint creases. Re-attach a guide or anchor → redo glove (servo) calibration before practice. Full pull is set at straight fingers; a moved anchor can over-straighten a finger. |
| Evaluate | Label **Thread friction (unhooked)**. Measure with each thread unhooked from its YELLOW fingertip anchor and the hand relaxed; alternative: a hand-shaped fixture with guides attached the same way. Re-hook every thread before evaluating. Retain completeness/freshness and safety gates. |
| Coach prompt | Keep “glove” as the device name; describe bare skin, dorsal guides/anchors and opening help. Never ask the patient to force through pain; pause for skin concerns and involve the helper. Implemented in B3 (`backend/app/voice/prompt.py`). |
| Docs | README §3, hardware checklist, DEV, DEMO and TEAM_PLAN describe the new mounting, evidence and friction procedure; older plan entries are marked superseded. No protocol/API change is made here. |
| Hardware | Test on a hand-shaped fixture before anything is attached to a person; retain all bench and independent firmware gates. Check skin before and after every session for redness, marks or pain: post-stroke patients may not feel rubbing. Hardware team confirms skin-safe attachment and records the decision before person-mounted use. |

Open questions for the hardware team:

- Confirm the attachment method and suitable skin-safe tape.
- Confirm exact point positions and sizes, including fingertip anchor placement.
- Do the points/tape disturb tracking? Compare real recordings and Setup detection
  in the bench's new **points** section; adjust placement/light and repeat as needed.

Implementation: B1 vision (guidance, recorder, bench points), B2 Setup/Evaluate (hand-detection check, re-attach → recalibrate, skin checks, unhooked friction), B3 coach prompt, B4 these docs. Hardware evidence (attachment method, real recordings) remains with the hardware team.
