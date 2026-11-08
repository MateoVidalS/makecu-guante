# memo launch video (Remotion)

```sh
cd video/studio
pnpm install
pnpm studio          # preview: Main + one composition per scene (Scenes/scene-<id>)
pnpm check           # typecheck + VO slot / music grid checks
pnpm render          # out/memo.mp4 (1920x1080, 30 fps)
```

- `src/timeline.ts`: scene order and length (100 BPM grid, 1 bar = 72 frames). `src/script.ts`: VO and on-screen copy.
- `src/contracts.ts`: manifests between packages. `src/brand/tokens.ts`: colors come from the app's `frontend/src/styles/tokens.ts`.
- Team footage: drop `public/footage/<id>.mp4` (`team-intro`, `team-next`, `session-hand`, `coach-talk`) and it replaces the placeholder.
- Work packages and design direction: `handoffs/video/`.
