import { ThreeCanvas } from '@remotion/three';
import { useThree } from '@react-three/fiber';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';
import { Box3, BufferGeometry, Group, OrthographicCamera, Vector3 } from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { c, ease } from '../../brand/tokens';

type Part = 'module' | 'lid' | 'spools' | 'guides' | 'anchors';
export type HardwareProps = {
  parts?: Part[];
  explode?: number;
  turn?: number;
  width?: number;
  height?: number;
};

const files: Record<Part, string> = {
  module: 'modulo_muneca', lid: 'tapa', spools: 'carrete', guides: 'guia_tendon', anchors: 'anclaje_punta',
};
const allParts = Object.keys(files) as Part[];
// Physical plastic colors; yellow identifies the real fingertip anchors, not a UI state.
const plastic: Record<Part, string> = {
  module: c.surface3, lid: c.surface3, spools: c.borderStrong, guides: c.text, anchors: c.caution,
};
const geometryCache = new Map<Part, Promise<BufferGeometry>>();
const loadPart = (part: Part) => {
  if (!geometryCache.has(part)) {
    geometryCache.set(part, new STLLoader().loadAsync(staticFile(`hardware/${files[part]}.stl`)));
  }
  return geometryCache.get(part)!;
};

// Millimetres, copied from hardware/cad/piezas.py: all shafts share the same mounting height.
const shafts = [[-20, 25], [-54, 2.5], [-20, 0], [-54, -22.5], [-20, -25]] as const;
// A knolling display, rather than a hand-mounted assembly. Park the lid beside
// the module so all five working spools remain visible even at explode=0.
const smallParts: Part[] = [...Array<Part>(10).fill('guides'), ...Array<Part>(5).fill('anchors')];

const CameraAim: React.FC<{
  assembly: React.RefObject<Group>; width: number; height: number; separation: number; turn: number;
}> = ({ assembly, width, height, separation, turn }) => {
  const camera = useThree((state) => state.camera);
  useLayoutEffect(() => {
    if (!assembly.current || !(camera instanceof OrthographicCamera)) return;
    assembly.current.updateWorldMatrix(true, true);
    const bounds = new Box3().setFromObject(assembly.current, true);
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new Vector3());
    camera.position.copy(center).add(new Vector3(0, 180, 290));
    camera.lookAt(center);
    // Fit the caller's exact view, including every turn/explosion position. No
    // history-dependent camera state and no clipped lid or small-part row.
    const inverse = camera.quaternion.clone().invert();
    const projected = new Box3();
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          projected.expandByPoint(new Vector3(x, y, z).sub(center).applyQuaternion(inverse));
        }
      }
    }
    const size = projected.getSize(new Vector3());
    camera.zoom = Math.min(width / (size.x * 1.12), height / (size.y * 1.12));
    camera.updateProjectionMatrix();
  }, [camera, assembly, width, height, separation, turn]);
  return null;
};

export const HardwareTurntable: React.FC<HardwareProps> = ({
  parts = allParts, explode = 0, turn = 0, width = 1920, height = 1080,
}) => {
  const [hold] = useState(() => delayRender('Loading hardware STL geometry'));
  const assembly = useRef<Group>(null);
  const [geometry, setGeometry] = useState<Record<Part, BufferGeometry> | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all(allParts.map(async (part) => [part, await loadPart(part)] as const))
      .then((entries) => { if (active) setGeometry(Object.fromEntries(entries) as Record<Part, BufferGeometry>); })
      .catch(cancelRender);
    return () => { active = false; continueRender(hold); };
  }, [hold]);
  useEffect(() => { if (geometry) continueRender(hold); }, [geometry, hold]);
  if (!geometry) return null;

  const separation = ease(Math.min(1, Math.max(0, explode)));
  const mesh = (part: Part, key: string, position: [number, number, number], scale = 1) => (
    <mesh key={key} geometry={geometry[part]} position={position} scale={scale} castShadow receiveShadow>
      <meshStandardMaterial color={plastic[part]} roughness={0.82} metalness={0} />
    </mesh>
  );
  return (
    <ThreeCanvas
      width={width} height={height} orthographic shadows dpr={1}
      camera={{ position: [0, 180, 290], near: 1, far: 1000 }}
      gl={{ antialias: true, alpha: false }}
    >
      <color attach="background" args={[c.bg]} />
      <ambientLight intensity={0.7} />
      <hemisphereLight args={[c.surface, c.border, 0.8]} />
      <directionalLight position={[-120, 240, 140]} intensity={2.2} castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005} shadow-normalBias={0.12}
        shadow-camera-left={-180} shadow-camera-right={180}
        shadow-camera-top={180} shadow-camera-bottom={-180} shadow-camera-far={500}
        shadow-radius={8} />
      <directionalLight position={[130, 110, -90]} intensity={1.8} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
        <planeGeometry args={[2000, 2000]} />
        <shadowMaterial transparent opacity={0.08} />
      </mesh>
      <group ref={assembly} rotation={[0, turn, 0]}>
        <group rotation={[-Math.PI / 2, 0, 0]}>
          {parts.includes('module') && mesh('module', 'module', [0, 0, 0])}
          {parts.includes('lid') && mesh('lid', 'lid', [84, 0, separation * 56])}
          {parts.includes('spools') && shafts.map(([x, y], i) => mesh('spools', `spool-${i}`, [x, y, 31.2 + separation * 25]))}
          {smallParts.map((part, i) => parts.includes(part) && mesh(part, `${part}-${i}`, [-89.25 + i * 7, -61, 0], 0.45))}
        </group>
      </group>
      <CameraAim assembly={assembly} width={width} height={height} separation={separation} turn={turn} />
    </ThreeCanvas>
  );
};

/** A caller can hold one view without introducing a frame or clock dependency. */
export const HardwareStill: React.FC<HardwareProps> = (props) => <HardwareTurntable turn={-0.35} {...props} />;
