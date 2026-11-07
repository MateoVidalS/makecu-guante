import { tokens } from '../styles/tokens';
import type { FingerId, JointAngles } from '../contracts/vision';
export type JointMap = Record<FingerId, JointAngles>;
export interface VirtualHandProps {
  target: JointMap | null;
  actual: () => JointMap | null;
  state: (finger: FingerId) => 'idle' | 'active' | 'assist' | 'reached';
}
// WP6 replaces the grey box with a procedural hand. No WebGL is needed for WP0.
export function VirtualHand(_props: VirtualHandProps) {
  return (
    <div
      className="virtual-hand"
      role="img"
      aria-label="Virtual hand placeholder"
      style={{ background: tokens.light.target }}
    >
      Virtual hand · Coming in WP6
    </div>
  );
}
export default VirtualHand;
