import * as THREE from 'three';
import fenway from '../data/fenway-detail.json' with { type: 'json' };
import type { Building, Point2 } from '../types';

export const isFenwayStadium = (building: Building) => building.id === 'BOS-73AP7-T4BL0-O4QDM';
export const fenwayFieldElevation = (stadium: Building) => (stadium.baseElevation ?? 3.048) + .112;
export const fenwayGrassBoundary = fenway.features.find(f => f.role === 'field')!.points as Point2[];

/** One upward-facing finish for the level field, optionally cut around the adjoining finish. */
export function fenwayFieldPatch(points: Point2[], y: number, hole?: Point2[]) {
  const project = (ring: Point2[]) => ring.map(([x, z]) => new THREE.Vector2(x, -z));
  const shape = new THREE.Shape(project(points));
  if (hole) shape.holes.push(new THREE.Path(project(hole)));
  const geometry = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, y, 0);
  // All grass patches share the same twelve-metre mowing pattern across their edges.
  const position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, position.getX(i) / 12, position.getZ(i) / 12);
  return geometry;
}

/** The warning track carries every field finish and provides their shared collision surface. */
export function fenwayPlayingSurface(stadium: Building) {
  const boundary: Point2[] = fenwayGrassBoundary.map(([x, z]) => {
    const dx = x + 1845, dz = z - 395, length = Math.hypot(dx, dz);
    return [x + dx / length * 4.5, z + dz / length * 4.5];
  });
  const y = fenwayFieldElevation(stadium), geometry = fenwayFieldPatch(boundary, y);
  const vertices = geometry.getAttribute('position').array as Float32Array;
  const indices = Uint32Array.from(geometry.index!.array);
  return { y, boundary, geometry, vertices, indices };
}
