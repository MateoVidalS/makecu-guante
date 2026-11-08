import { Banner, Button } from '../../design-system';

export function RelaxedHandSafetyStrip({
  release,
  emptyGlove = false,
}: {
  release: () => void;
  emptyGlove?: boolean;
}) {
  return (
    <Banner
      tone="warning"
      title={
        emptyGlove
          ? 'Keep the glove empty and hanging freely.'
          : 'Keep your hand relaxed.'
      }
      action={
        <Button size="sm" onClick={release}>
          Release glove now
        </Button>
      }
    >
      Press STOP anytime. Stop if it hurts.
    </Banner>
  );
}
