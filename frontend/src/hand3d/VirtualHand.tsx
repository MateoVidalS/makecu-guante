import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { DirectionalLight } from 'three';
import { tokens } from '../styles/tokens';
import { POSES } from '../contracts/poses';
import type { FingerId, Handedness } from '../contracts/vision';
import type { PoseId } from '../contracts/poses';
import { applyJoints, FINGERS, type JointMap } from './rig';
import { createHandScene, type FingerState, type HandTheme } from './scene';
import { useHandPreferences } from './preferences';
import { createHandAnimator } from './animation';
import './hand.css';
export type { JointMap } from './rig';
export interface VirtualHandProps {
  target: JointMap | null;
  actual: () => JointMap | null;
  state: (finger: FingerId) => FingerState;
  handedness?: Handedness;
  /** Orthographic zoom for the page viewport; preserves the gallery default. */
  zoom?: number;
  /** Optional metadata: existing three-prop callers retain pose inference. */
  pose?: PoseId;
  reducedMotion?: boolean;
  onFps?: (fps: number) => void;
}

function inferPose(target: JointMap | null): PoseId | undefined {
  if (!target) return undefined;
  return Object.values(POSES).find((p) =>
    FINGERS.every(
      (f) =>
        p.render[f].mcp === target[f].mcp &&
        p.render[f].pip === target[f].pip &&
        p.render[f].dip === target[f].dip,
    ),
  )?.id;
}

function HandScene({
  target,
  actual,
  state,
  handedness = 'right',
  zoom = 85,
  reducedMotion,
  pose,
  palette,
  onVisibility,
  onFps,
}: VirtualHandProps & {
  palette: HandTheme;
  onVisibility: (visible: boolean) => void;
}) {
  const scene = useMemo(
    () => createHandScene(handedness, palette),
    [handedness, palette],
  );
  const animator = useMemo(
    () => createHandAnimator(scene, palette),
    [scene, palette],
  );
  const rim = useRef<DirectionalLight>(null);
  const camera = useThree((s) => s.camera);
  const tracking = useRef({
    frames: 0,
    elapsed: 0,
  });
  useEffect(() => () => scene.dispose(), [scene]);
  useEffect(() => {
    if (target) applyJoints(scene.target, target);
    scene.target.visible = target !== null;
    animator.resetReach();
  }, [scene, target, animator]);
  useEffect(() => {
    camera.position.set(pose === 'pinch' ? -5.2 : -4.2, 3.3, 7.5);
    camera.lookAt(0, 0.8, 0.4);
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
  }, [camera, pose, zoom]);

  useFrame((_frame, delta) => {
    const live = tracking.current;
    animator.tick(
      actual(),
      state,
      target !== null,
      Boolean(reducedMotion),
      delta,
    );
    if (animator.visibilityChanged) onVisibility(animator.visible);
    if (rim.current) rim.current.intensity = animator.rimIntensity;
    live.frames++;
    live.elapsed += delta;
    if (live.elapsed >= 1) {
      onFps?.(live.frames / live.elapsed);
      live.frames = 0;
      live.elapsed = 0;
    }
  });
  return (
    <>
      <ambientLight intensity={1.1} />
      <directionalLight
        position={[-3, 5, 6]}
        intensity={2.2}
        color={tokens.light.surface}
      />
      <directionalLight
        position={[4, 1, -2]}
        intensity={1}
        color={palette.hand}
      />
      <directionalLight
        ref={rim}
        position={[0, 3, -4]}
        color={palette.reached}
        intensity={0}
      />
      <group>
        <primitive object={scene.target} />
        <primitive object={scene.actual} />
      </group>
    </>
  );
}

class HandFallback extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p className="hand-message">
        3D view unavailable. Follow the pose instruction.
      </p>
    ) : (
      this.props.children
    );
  }
}

export function VirtualHand(props: VirtualHandProps) {
  const preferences = useHandPreferences();
  const [visible, setVisible] = useState(true);
  const onVisibility = useCallback((value: boolean) => setVisible(value), []);
  const pose = props.pose ?? inferPose(props.target);
  const label = props.target
    ? `Target pose: ${pose ? POSES[pose].name : 'custom hand pose'}. Ghost outline is your target; solid hand is you.`
    : 'Your hand. No target pose.';
  const palette = preferences.dark ? tokens.dark : tokens.light;
  return (
    <div
      className="hand-view"
      role="img"
      aria-label={label}
      data-visible={visible}
    >
      <HandFallback>
        <Canvas
          orthographic
          camera={{ position: [-4.2, 3.3, 7.5], zoom: 85, near: 0.1, far: 50 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true }}
          resize={{ debounce: 0 }}
        >
          <HandScene
            {...props}
            pose={pose}
            reducedMotion={preferences.reducedMotion || props.reducedMotion}
            palette={palette}
            onVisibility={onVisibility}
          />
        </Canvas>
      </HandFallback>
      {!visible && (
        <p className="hand-message" role="status">
          <span aria-hidden="true">▣ </span>I can't see your hand — move it into
          view
        </p>
      )}
      <div className="hand-legend" aria-hidden="true">
        <span>◌ Target</span>
        <span>● Your hand</span>
      </div>
    </div>
  );
}
export default VirtualHand;
