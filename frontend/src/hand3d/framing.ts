import { Box3, Group, Mesh, OrthographicCamera, Vector3 } from 'three';
import { POSES, type PoseDef } from '../contracts/poses';
import type { Handedness } from '../contracts/vision';
import { tokens } from '../styles/tokens';
import { applyJoints, FINGERS, JOINTS } from './rig';
import { createHandScene } from './scene';
import { handPresentation } from './view';
import { CURRENT_CAMERA_VIEW, type CameraView } from '../contracts/calibration';

export const HAND_VIEW_FILL = 0.8;
type Family = PoseDef['family'];
const cache = new Map<string, Box3>();

/** Camera-space mesh bounds, including the ghost rim. Setup/resize only. */
export function projectedHandBounds(root: Group, camera: OrthographicCamera) {
  root.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const bounds = new Box3();
  const point = new Vector3();
  root.traverse((object) => {
    if (!(object instanceof Mesh) || !object.visible) return;
    object.geometry.computeBoundingBox();
    const box = object.geometry.boundingBox!;
    for (let corner = 0; corner < 8; corner++) {
      point.set(
        corner & 1 ? box.max.x : box.min.x,
        corner & 2 ? box.max.y : box.min.y,
        corner & 4 ? box.max.z : box.min.z,
      );
      point
        .applyMatrix4(object.matrixWorld)
        .applyMatrix4(camera.matrixWorldInverse);
      bounds.expandByPoint(point);
    }
  });
  return bounds;
}

/** One envelope per family includes open → closed motion. Pose updates cannot
 * zoom or recenter the hand; only a viewport or family change can reframe it.
 */
export function handFamilyBounds(
  hand: Handedness,
  family: Family,
  view: CameraView = CURRENT_CAMERA_VIEW,
) {
  const key = `${view}:${hand}:${family}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const scene = createHandScene(hand, tokens.light);
  const root = new Group();
  const presentation = handPresentation(hand, view, family === 'pinch');
  root.rotation.set(...presentation.rotation);
  root.add(scene.actual, scene.target);
  const camera = new OrthographicCamera();
  camera.position.set(...presentation.camera);
  camera.lookAt(...presentation.lookAt);
  const bounds = new Box3();
  const sample = structuredClone(POSES.open.render);
  for (const pose of Object.values(POSES)) {
    if (pose.family !== family) continue;
    // Include the path, not just endpoints: fingertips sweep past pose bounds.
    for (let step = 0; step <= 20; step++) {
      for (const finger of FINGERS)
        for (const joint of JOINTS)
          sample[finger][joint] = (pose.render[finger][joint] * step) / 20;
      applyJoints(scene.actual, sample);
      applyJoints(scene.target, sample);
      bounds.union(projectedHandBounds(root, camera));
    }
  }
  scene.dispose();
  cache.set(key, bounds);
  return bounds;
}

export function fitHandViewport(bounds: Box3, width: number, height: number) {
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  return {
    zoom: HAND_VIEW_FILL * Math.min(width / size.x, height / size.y),
    centerX: center.x,
    centerY: center.y,
  };
}
