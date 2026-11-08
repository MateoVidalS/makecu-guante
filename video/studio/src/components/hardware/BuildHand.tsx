import React, { useEffect, useMemo } from 'react';
import { Color, Vector2 } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { c } from '../../brand/tokens';
import { buildTiming, type Point } from './buildMotion';

export const handFingertips: Point[] = [[81, 70, 50], [128, 31, 50], [147, 7, 50], [136, -17, 50], [112, -37, 50]];
export const handGuides: [Point, Point][] = handFingertips.map(([x, y, z], i) => i === 0
  ? [[42, 44, z], [63, 60, z]]
  : [[58 + (x - 58) * 0.25, y, z], [58 + (x - 58) * 0.65, y, z]]);

// CAD-space dorsal silhouette. Every guide and anchor lies within its finger's edges.
// Explicit web spaces keep all five fingers distinct even in the shallow final view.
const outline: Point[] = [
  [5, -29, 50], [28, -30, 50], [50, -43, 50], [65, -45, 50],
  [112, -45, 50], [122, -41, 50], [124, -36, 50], [120, -30, 50],
  [68, -29, 50], [60, -27, 50],
  [136, -26, 50], [147, -22, 50], [149, -17, 50], [146, -10, 50],
  [69, -8, 50], [61, -6, 50],
  [148, -2, 50], [160, 1, 50], [163, 7, 50], [160, 15, 50],
  [70, 18, 50], [62, 20, 50],
  [128, 21, 50], [140, 25, 50], [142, 32, 50], [138, 40, 50],
  [72, 42, 50], [58, 40, 50],
  [68, 53, 50], [91, 65, 50], [98, 73, 50], [94, 81, 50],
  [84, 84, 50], [73, 78, 50], [40, 59, 50], [25, 41, 50], [5, 30, 50],
];
// Corner cutting rounds the fingertips without spline overshoot closing the web spaces.
export const handSilhouette = Array.from({ length: 4 }).reduce<Point[]>((points) => points.flatMap((a, index) => {
  const b = points[(index + 1) % points.length];
  return [
    [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, 50] as Point,
    [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, 50] as Point,
  ];
}), outline);

export const BuildHand: React.FC<{ frame: number; width: number; height: number }> = ({ frame, width, height }) => {
  const line = useMemo(() => {
    const geometry = new LineGeometry();
    geometry.setPositions([...handSilhouette, handSilhouette[0]].flat());
    const material = new LineMaterial({ color: new Color(c.target).getHex(), linewidth: 3,
      resolution: new Vector2(width, height), worldUnits: false, opacity: 1,
      transparent: false, toneMapped: false, depthTest: true, depthWrite: false });
    return new Line2(geometry, material);
  }, [width, height]);
  useEffect(() => () => { line.geometry.dispose(); line.material.dispose(); }, [line]);
  if (frame < buildTiming.hand) return null;
  return <primitive object={line} />;
};
