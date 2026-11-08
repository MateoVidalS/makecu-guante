import { Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import { FINGERS, HAND_PROPORTIONS, type HandRig } from '../../hand3d/rig';

const guide = new MeshStandardMaterial({ color: '#080808', roughness: 0.9 });
const anchor = new MeshStandardMaterial({ color: '#ffdc00', roughness: 0.9 });
const dot = new SphereGeometry(0.065, 12, 8);

/** Small skin-mounted points; local -Z is dorsal, so the palm stays uncovered.
 * Attach to bones rather than the scene so points curl and mirror with the hand.
 */
export function addHandPoints(rig: HandRig) {
  const points: Mesh<SphereGeometry, MeshStandardMaterial>[] = [];
  for (const finger of FINGERS) {
    const dimensions = HAND_PROPORTIONS[finger];
    // The thumb has proximal/distal phalanges, with no middle phalanx.
    const segments = finger === 'thumb' ? [1, 2] : [0, 1];
    for (const i of segments) {
      const point = new Mesh(dot, guide);
      point.name = `${finger}-guide-${i}`;
      point.scale.z = 0.45;
      point.position.set(
        0,
        dimensions.lengths[i] / 2,
        -dimensions.radius * 1.55 * (1 - i * 0.08),
      );
      rig.fingers[finger].joints[i].add(point);
      points.push(point);
    }
    const point = new Mesh(dot, anchor);
    point.name = `${finger}-anchor`;
    point.scale.z = 0.45;
    point.position.z = -dimensions.radius * 1.55 * (1 - 2 * 0.08);
    rig.fingers[finger].tip.add(point);
    points.push(point);
  }
  return points;
}
