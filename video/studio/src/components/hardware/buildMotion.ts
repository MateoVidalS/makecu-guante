import { interpolate } from 'remotion';
import { Box3, OrthographicCamera, Vector3 } from 'three';
import { ease } from '../../brand/tokens';

export type Point = [number, number, number];
export const buildTiming = { servos: 18, spools: 108, esp32: 180, sensor: 198, stop: 216, wiring: 234, lid: 246, hand: 252 } as const;
export const ramp = (frame: number, from: number, duration = 12) => interpolate(frame, [from, from + duration], [0, 1], {
  extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
});

type SubjectBox = [Point, Point];
export type View = { center: Vector3; offset: Vector3; zoom: number };
const moduleBox: SubjectBox = [[-80.5, 0, -40], [0, 41, 40]];
const lidBox: SubjectBox = [[-80.5, 0, -51], [0, 47, 51]];
const electronicsBox: SubjectBox = [[-105, 0, 55], [22, 16, 106]];
const harnessBox: SubjectBox = [[-102, 0, -40], [-13, 42, 106]];
const handBox: SubjectBox = [[-35, 50, -80], [158, 56, 45]];

// Fit the current subject in screen space, then blend those views on the beats.
// Background parts may pass out of view during a close-up; the subject stays
// inside the canvas, which itself ends above the caption reserve.
const subjectView = (boxes: SubjectBox[], offset: Point, fraction: number, width: number, height: number, top = 0): View => {
  const camera = new OrthographicCamera();
  camera.position.set(...offset);
  camera.lookAt(0, 0, 0);
  const inverse = camera.quaternion.clone().invert();
  const projected = new Box3();
  for (const [min, max] of boxes) {
    for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
      projected.expandByPoint(new Vector3(x, y, z).applyQuaternion(inverse));
    }
  }
  const size = projected.getSize(new Vector3());
  const center = projected.getCenter(new Vector3());
  center.z = 0;
  center.applyQuaternion(camera.quaternion);
  const zoom = Math.min(width * fraction / size.x, (height - top) * 0.93 / size.y);
  center.add(new Vector3(0, top / (2 * zoom), 0).applyQuaternion(camera.quaternion));
  return { center, offset: new Vector3(...offset), zoom };
};
const blendView = (a: View, b: View, progress: number): View => ({
  center: a.center.clone().lerp(b.center, progress), offset: a.offset.clone().lerp(b.offset, progress),
  zoom: a.zoom + (b.zoom - a.zoom) * progress,
});
export const buildView = (frame: number, width: number, height: number): View => {
  const orbit: Point = [190 - frame * 0.45, 220, 330];
  let view = subjectView([moduleBox], orbit, 0.52, width, height);
  // Frame the background module as well as the new boards below the title band.
  const electronicsArrivalBox: SubjectBox = [[-105, 0, 55], [22, 42, 106]];
  const moduleArrivalBox: SubjectBox = [moduleBox[0], [0, Math.max(41, 36 + (1 - ramp(frame, 180)) * 40), 40]];
  view = blendView(view, subjectView([moduleArrivalBox, electronicsArrivalBox], [25 + (frame - 180) * 0.4, 300, 330], 0.78, width, height, 96), ramp(frame, 168, 12));
  view = blendView(view, subjectView([moduleBox, electronicsBox, harnessBox], [260, 240, 330], 0.82, width, height), ramp(frame, buildTiming.wiring, 9));
  view = blendView(view, subjectView([lidBox], orbit, 0.52, width, height), ramp(frame, buildTiming.lid, 9));
  return blendView(view, subjectView([lidBox, electronicsBox, harnessBox, handBox], [30, 160, 380], 0.80, width, height), ramp(frame, 248, 18));
};

// Both WebGL and the DOM leaders use this exact camera, including the current dolly/orbit.
export const aimCamera = (camera: OrthographicCamera, view: View) => {
  camera.position.copy(view.center).add(view.offset);
  camera.lookAt(view.center);
  camera.zoom = view.zoom;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
};

export const projectBuildPoint = (frame: number, width: number, height: number, [x, y, z]: Point) => {
  const camera = new OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 1, 1200);
  aimCamera(camera, buildView(frame, width, height));
  // The assembly's -PI/2 X rotation converts CAD (Z up) to Three world (Y up).
  const point = new Vector3(x, z, -y).project(camera);
  return { x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2 };
};

