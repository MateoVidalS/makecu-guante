import { useStore } from 'zustand';
import { useGlove } from '../../glove';
import { Banner } from '../../design-system';

export const CURRENT_SENSOR_MISSING_MESSAGE =
  'Current sensor not detected. The glove can be calibrated, but it will not help during practice until the INA219 is connected.';

/** INA219 is probed at boot. A later boot starts a new sensor check. */
export function useCurrentSensorMissing() {
  const { store } = useGlove();
  return useStore(store, ({ events }) => {
    for (let index = events.length - 1; index >= 0; index--) {
      if (events[index].e === 'ina_missing') return true;
      if (events[index].e === 'boot') return false;
    }
    return false;
  });
}

export function CurrentSensorNotice({ missing }: { missing: boolean }) {
  return missing ? (
    <div aria-live="polite">
      <Banner tone="warning" title={CURRENT_SENSOR_MISSING_MESSAGE} />
    </div>
  ) : null;
}
