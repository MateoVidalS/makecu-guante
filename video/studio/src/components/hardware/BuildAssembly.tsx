import { useThree } from '@react-three/fiber';
import { ThreeCanvas } from '@remotion/three';
import React, { useEffect, useLayoutEffect, useMemo } from 'react';
import { interpolate } from 'remotion';
import { Box3, BufferGeometry, CatmullRomCurve3, OrthographicCamera, TubeGeometry, Vector3 } from 'three';
import { c, ease } from '../../brand/tokens';
import { HardwareLighting, hardwarePlastic, servoShafts, useHardwareGeometry } from './Hardware';
import { wirePalette } from './wirePalette';

type Point = [number, number, number];
const ramp = (frame: number, from: number, duration = 12) => interpolate(frame, [from, from + duration], [0, 1], {
  extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
});

const Plastic: React.FC<{ color?: string; opacity?: number; metal?: boolean }> = ({ color = c.chrome, opacity = 1, metal = false }) => (
  <meshStandardMaterial color={color} roughness={metal ? 0.45 : 0.82} metalness={metal ? 0.4 : 0} transparent={opacity < 1} opacity={opacity} />
);

const Block: React.FC<{ at: Point; size: Point; color?: string; metal?: boolean }> = ({ at, size, color, metal }) => (
  <mesh position={at} castShadow receiveShadow><boxGeometry args={size} /><Plastic color={color} metal={metal} /></mesh>
);

/** Only the visible curve length grows. There is no draw-range jump or clock-driven animation. */
const Tube: React.FC<{ points: Point[]; progress?: number; radius?: number; color?: string; opacity?: number; closed?: boolean; unlit?: boolean }> = ({
  points, progress = 1, radius = 0.4, color = c.text, opacity = 1, closed = false, unlit = false,
}) => {
  const geometry = useMemo(() => {
    const path = new CatmullRomCurve3(points.map((p) => new Vector3(...p)), closed, 'centripetal');
    const samples = Array.from({ length: 65 }, (_, i) => path.getPointAt(Math.max(0.001, progress) * i / 64));
    return new TubeGeometry(new CatmullRomCurve3(samples, false, 'centripetal'), 64, radius, 6, false);
  }, [points, progress, radius, closed]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (progress <= 0 || opacity <= 0) return null;
  return <mesh geometry={geometry} castShadow={!unlit && opacity === 1}>
    {unlit ? <meshBasicMaterial color={color} transparent={opacity < 1} opacity={opacity} toneMapped={false} /> : <Plastic color={color} opacity={opacity} />}
  </mesh>;
};

const Stl: React.FC<{ geometry: BufferGeometry; at?: Point; color: string; opacity?: number; angle?: number }> = ({
  geometry, at = [0, 0, 0], color, opacity = 1, angle = 0,
}) => <mesh geometry={geometry} position={at} rotation={[0, 0, angle]} castShadow receiveShadow><Plastic color={color} opacity={opacity} /></mesh>;

const Servo: React.FC<{ index: number }> = ({ index }) => (
  <>
    <Block at={[-5.5, 0, 14]} size={[23, 12, 22]} color={index === 2 ? c.borderStrong : index === 0 ? c.text : c.chrome} />
    <Block at={[-5.5, 0, 18.9]} size={[32.3, 12.4, 2.5]} color={c.text} />
    <Block at={[-2, 0, 25.6]} size={[15, 11.6, 3.2]} color={c.chrome} />
    <mesh position={[0, 0, 28.7]} rotation={[Math.PI / 2, 0, 0]} castShadow>
      <cylinderGeometry args={[2.4, 2.4, 4.5, 20]} /><Plastic color={c.borderControl} metal />
    </mesh>
    <Block at={[0, 0, 30.45]} size={[22, 4.5, 1.5]} color={c.surface3} />
    <Block at={[0, 0, 30.45]} size={[4.5, 22, 1.5]} color={c.surface3} />
  </>
);

const Esp32: React.FC = () => <>
  <Block at={[0, 0, 2]} size={[51, 28, 2]} color={c.text} />
  <Block at={[8, 0, 4.1]} size={[20, 16, 2.2]} color={c.borderControl} metal />
  <Block at={[-9, 0, 3.8]} size={[7, 7, 1.6]} color={c.chrome} />
  <Block at={[-24, 0, 4.8]} size={[7, 8, 4.2]} color={c.borderStrong} metal />
  <Block at={[-27.6, 0, 4.9]} size={[0.5, 5.6, 2]} color={c.text} />
  {[-1, 1].flatMap((side) => Array.from({ length: 15 }, (_, pin) => (
    <React.Fragment key={`${side}-${pin}`}>
      <Block at={[-18 + pin * 2.54, side * 12.7, 3.8]} size={[1.8, 2.2, 2]} color={c.chrome} />
      <Block at={[-18 + pin * 2.54, side * 12.7, 5.4]} size={[0.6, 0.6, 1.8]} color={c.borderStrong} metal />
    </React.Fragment>
  )))}
</>;

const Ina219: React.FC = () => <>
  <Block at={[0, 0, 1.5]} size={[22, 18, 1.6]} color={c.chrome} />
  <Block at={[-2, 0, 3.1]} size={[5, 5, 1.6]} color={c.text} />
  <Block at={[7, 0, 4]} size={[6, 14, 4]} color={c.borderStrong} />
  <Block at={[-6, 4, 3]} size={[6, 2.2, 1.5]} color={c.borderControl} metal />
  {[-4, 4].map((y) => <mesh key={y} position={[7, y, 6.2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
    <cylinderGeometry args={[1.5, 1.5, 0.7, 16]} /><Plastic color={c.borderControl} metal />
  </mesh>)}
</>;

const StopButton: React.FC = () => <>
  <Block at={[0, 0, 2]} size={[12, 12, 3]} color={c.borderStrong} metal />
  <mesh position={[0, 0, 5.2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
    <cylinderGeometry args={[3.8, 3.8, 4, 24]} /><Plastic color={c.text} />
  </mesh>
  {[-1, 1].flatMap((x) => [-1, 1].map((y) => <Block key={`${x}-${y}`} at={[x * 7, y * 4, 1]} size={[3, 1, 1]} color={c.borderControl} metal />))}
</>;

const ghostOutline: Point[] = [
  [-35, -30, 50], [10, -31, 50], [40, -42, 50], [80, -45, 50], [111, -43, 50], [120, -37, 50], [119, -31, 50],
  [84, -28, 50], [123, -25, 50], [141, -22, 50], [145, -16, 50], [141, -10, 50], [92, -8, 50],
  [142, -4, 50], [154, 2, 50], [155, 9, 50], [149, 16, 50], [92, 18, 50], [127, 22, 50], [136, 28, 50],
  [135, 36, 50], [128, 42, 50], [76, 38, 50], [59, 38, 50], [67, 52, 50], [88, 66, 50], [88, 73, 50],
  [82, 78, 50], [72, 76, 50], [40, 60, 50], [20, 39, 50], [-35, 31, 50],
];
const fingertips: Point[] = [[81, 70, 50], [128, 31, 50], [147, 7, 50], [136, -17, 50], [112, -37, 50]];
const guides: [Point, Point][] = fingertips.map(([x, y, z], i) => i === 0
  ? [[42, 44, z], [63, 60, z]]
  : [[58 + (x - 58) * 0.25, y, z], [58 + (x - 58) * 0.65, y, z]]);

const servoLeads = servoShafts.flatMap(([x, y], i) => [wirePalette.ground, wirePalette.power, wirePalette.signal].map((color, wire) => {
  const spread = (wire - 1) * 1.2;
  // Orange signals terminate at DevKit headers. Red/brown terminate on the
  // separate servo rail, supplied through INA219; never from the ESP32 GPIOs.
  const end: Point = wire === 2 ? [-92 + i * 5, -73, 5.4] : [-49 + i * 7, -61 + spread, 4];
  return { color, points: [
    [x - 16, y + spread, 12], [-83, y + spread, 10], [-95 - wire * 2, -43 - i * 2, 5],
    [-76, -65 - wire * 2, 4], end,
  ] as Point[] };
}));
const boardWires: { color: string; points: Point[] }[] = [
  { color: wirePalette.power, points: [[-18, -86, 6], [-13, -74, 7], [-21, -61, 4]] },
  { color: wirePalette.power, points: [[13, -86, 3], [7, -99, 4], [-18, -91, 6]] },
  { color: wirePalette.ground, points: [[13, -90, 3], [2, -72, 3], [-49, -62, 4], [-85, -73, 5.4]] },
  { color: c.text, points: [[-34, -86, 3], [-43, -94, 3], [-65, -99, 5.4]] },
  { color: c.text, points: [[-34, -82, 3], [-44, -88, 4], [-70, -99, 5.4]] },
  { color: wirePalette.power, points: [[-34, -90, 3], [-42, -102, 3], [-60, -99, 5.4]] },
  { color: wirePalette.ground, points: [[-34, -94, 3], [-46, -86, 3], [-49, -62, 4]] },
  { color: c.text, points: [[2, -82, 2], [-7, -74, 3], [-80, -73, 5.4]] },
  { color: c.text, points: [[-10, -90, 1], [-15, -97, 3], [-44, -78, 4], [-49, -62, 4]] },
];

type SubjectBox = [Point, Point];
type View = { center: Vector3; offset: Vector3; zoom: number };
const moduleBox: SubjectBox = [[-80.5, 0, -40], [0, 41, 40]];
const lidBox: SubjectBox = [[-80.5, 0, -51], [0, 47, 51]];
const electronicsBox: SubjectBox = [[-105, 0, 55], [22, 16, 106]];
const harnessBox: SubjectBox = [[-102, 0, -40], [-13, 42, 106]];
const handBox: SubjectBox = [[-35, 50, -80], [158, 56, 45]];

// Fit the current subject in screen space, then blend those views on the beats.
// Background parts may pass out of view during a close-up; the subject stays
// inside the canvas, which itself ends above the caption reserve.
const subjectView = (boxes: SubjectBox[], offset: Point, fraction: number, width: number, height: number): View => {
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
  return { center, offset: new Vector3(...offset), zoom: Math.min(width * fraction / size.x, height * 0.93 / size.y) };
};
const blendView = (a: View, b: View, progress: number): View => ({
  center: a.center.clone().lerp(b.center, progress), offset: a.offset.clone().lerp(b.offset, progress),
  zoom: a.zoom + (b.zoom - a.zoom) * progress,
});
const buildView = (frame: number, width: number, height: number): View => {
  const orbit: Point = [190 - frame * 0.1, 220, 330];
  let view = subjectView([moduleBox], orbit, 0.52, width, height);
  view = blendView(view, subjectView([electronicsBox], [25, 300, 330], 0.78, width, height), ramp(frame, 192, 12));
  view = blendView(view, subjectView([moduleBox, electronicsBox, harnessBox], [260, 240, 330], 0.82, width, height), ramp(frame, 216, 9));
  view = blendView(view, subjectView([lidBox], orbit, 0.52, width, height), ramp(frame, 234, 9));
  return blendView(view, subjectView([lidBox, electronicsBox, harnessBox, handBox], [30, 210, 350], 0.82, width, height), ramp(frame, 248, 18));
};

const BuildCamera: React.FC<{ view: View }> = ({ view }) => {
  const camera = useThree((state) => state.camera);
  useLayoutEffect(() => {
    if (!(camera instanceof OrthographicCamera)) return;
    camera.position.copy(view.center).add(view.offset);
    camera.lookAt(view.center);
    camera.zoom = view.zoom;
    camera.updateProjectionMatrix();
  }, [camera, view]);
  return null;
};

export const BuildAssembly: React.FC<{ frame: number; width?: number; height?: number }> = ({ frame, width = 1920, height = 1080 }) => {
  const geometry = useHardwareGeometry();
  if (!geometry) return null;
  const module = ramp(frame, 0, 15);
  const ghost = ramp(frame, 252, 9);
  const view = buildView(frame, width, height);
  return (
    <ThreeCanvas width={width} height={height} orthographic shadows dpr={1} camera={{ near: 1, far: 1200, position: [65, 280, 320] }} gl={{ antialias: true }}>
      <HardwareLighting />
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <Stl geometry={geometry.module} color={hardwarePlastic.module} at={[0, 0, (1 - module) * 14]} opacity={module} />
        {servoShafts.map(([x, y], i) => frame >= 18 + i * 18 ? <group key={`servo-${i}`} position={[x, y, (1 - ramp(frame, 18 + i * 18)) * 70]}>
          <Servo index={i} />
        </group> : null)}
        {servoShafts.map(([x, y], i) => frame >= 108 + i * 18 ? <Stl key={`spool-${i}`} geometry={geometry.spools} color={hardwarePlastic.spools}
          at={[x, y, 31.2 + (1 - ramp(frame, 108 + i * 18)) * 40]} /> : null)}
        {frame >= 198 && <group position={[-74, -86, (1 - ramp(frame, 198)) * 35]}><Esp32 /></group>}
        {frame >= 202 && <group position={[-25, -86, (1 - ramp(frame, 202)) * 35]}><Ina219 /></group>}
        {frame >= 206 && <group position={[-3, -86, (1 - ramp(frame, 206)) * 35]}><StopButton /></group>}
        {frame >= 210 && <>
          <Block at={[-35, -61, 2.5]} size={[44, 5, 4]} color={c.chrome} />
          <Block at={[13, -88, 2.5]} size={[7, 12, 4]} color={c.borderStrong} />
          <mesh position={[-9, -62, 7]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[3.5, 3.5, 12, 24]} /><Plastic /></mesh>
        </>}
        {frame >= 216 && <>
          {servoLeads.map((wire, i) => <Tube key={`lead-${i}`} points={wire.points} progress={ramp(frame, 216 + Math.floor(i / 3), 10)} color={wire.color} radius={0.42} />)}
          {boardWires.map((wire, i) => <Tube key={`board-wire-${i}`} points={wire.points} progress={ramp(frame, 218, 12)} color={wire.color} radius={0.42} />)}
        </>}
        {frame >= 234 && <Stl geometry={geometry.lid} color={hardwarePlastic.lid} at={[0, 0, 41 + (1 - ramp(frame, 234, 15)) * 70]} />}
        {frame >= 252 && <>
          <Tube points={ghostOutline} closed color={c.target} radius={1.5 / view.zoom} opacity={ghost} unlit />
          {guides.map((pair, i) => <React.Fragment key={`finger-${i}`}>
            {pair.map((point, j) => <Stl key={j} geometry={geometry.guides} color={hardwarePlastic.guides} at={point} opacity={ghost} angle={i === 0 ? 0.65 : 0} />)}
            <Stl geometry={geometry.anchors} color={hardwarePlastic.anchors} at={fingertips[i]} opacity={ghost} angle={i === 0 ? 0.65 : 0} />
          </React.Fragment>)}
          {servoShafts.map(([x, y], i) => <Tube key={`thread-${i}`} radius={0.32} progress={ramp(frame, 252 + i * 2, 15)} points={[
            [x, y + 10, 35.3], [-3, y + 10, 35.3], [6, y + 10, 49],
            [25, guides[i][0][1] * 0.7, 53.2], ...guides[i].map(([gx, gy]) => [gx, gy, 53.2] as Point),
            [fingertips[i][0], fingertips[i][1], 53.2],
          ]} />)}
        </>}
      </group>
      <BuildCamera view={view} />
    </ThreeCanvas>
  );
};
