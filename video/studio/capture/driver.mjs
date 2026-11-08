// The existing integration harness mounts the real app and controls only its simulator,
// clock and Live audio device. Kept as a separate entry so frontend files stay untouched.
await import('/e2e/ai-therapist-harness.ts');
