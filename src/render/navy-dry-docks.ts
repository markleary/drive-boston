import * as THREE from 'three';
import data from '../data/waterfront.json' with { type: 'json' };
import type { CityData, Point2 } from '../types.ts';
import { pointInside } from '../simulation/roads.ts';
import { sampleElevation } from '../simulation/terrain.ts';
import { waterfrontHeight, waterfrontOverlaps } from '../simulation/waterfront.ts';
import { TriangleWriter } from './geometry-writer.ts';
import { parkSurfaceSteps } from './area-surfaces.ts';
import type { ParkOptions } from './city-parks.ts';
import { due } from './pacing.ts';

type Vertex = [number, number, number];
interface DryDock { id: string; name: string; rings: Point2[][]; mouth?: [Point2, Point2]; }
export const navyDryDocks: DryDock[] = data.dryDocks.map(dock => ({ ...dock,
  rings: dock.rings.map(ring => ring.map(([x, z]): Point2 => [x, z])),
  mouth: dock.mouth.map(([x, z]): Point2 => [x, z]) as [Point2, Point2],
}));
const distance = (p: Point2, a: Point2, b: Point2) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
};
const edges = navyDryDocks.flatMap(dock => dock.rings[0].map((a, i, ring) => [a, ring[(i + 1) % ring.length]] as [Point2, Point2]));

/** The ordinary wharf generator yields these edges to stepped masonry, rather
 * than placing a full-height quay face across the terraces. */
export function isNavyDryDockEdge(a: Point2, b: Point2) {
  const points: Point2[] = [a, b, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]];
  return points.every(p => edges.some(([c, d]) => distance(p, c, d) < 1.5));
}

const materials = {
  granite: new THREE.MeshStandardMaterial({ color: '#aba99a', roughness: .96 }),
  cap: new THREE.MeshStandardMaterial({ color: '#c5c1b0', roughness: .94 }),
  floor: new THREE.MeshStandardMaterial({ color: '#686e68', roughness: 1 }),
  iron: new THREE.MeshStandardMaterial({ color: '#34413c', roughness: .7, metalness: .3 }),
  gate: new THREE.MeshStandardMaterial({ color: '#666f66', roughness: .8, metalness: .2 }),
};

/** NPS documents granite stepped basins, Dock 1's steel caisson, and Dock 2's
 * permanent flooding after its caisson was removed in 1976. The current source
 * DEM already contains Dock 1's depression: the model seats its masonry over
 * that depression, and preserves the package's harbor water and mapped outlines.
 * Course spacing is interpreted for this scale; no vessel is included. */
export function* navyDryDockSteps(city: CityData, group: THREE.Group, options: ParkOptions): Generator<void, { docks: number; terraces: number; caissons: number }> {
  const { bounds, pace } = options, batches = new Map<THREE.Material, TriangleWriter>(), collision = new TriangleWriter();
  const stats = { docks: 0, terraces: 0, caissons: 0 };
  const batch = (material: THREE.Material) => {
    let value = batches.get(material); if (!value) { value = new TriangleWriter(); batches.set(material, value); } return value;
  };
  // Clip every triangle-bearing surface in world coordinates. The halves of a
  // basin that straddle a tile boundary therefore have no double-owned geometry.
  const clip = (input: Vertex[], axis: 0 | 2, sign: number, limit: number) => {
    const out: Vertex[] = []; if (!input.length) return out;
    let a = input.at(-1)!, da = a[axis] * sign - limit;
    for (const b of input) {
      const db = b[axis] * sign - limit;
      if ((da <= 0) !== (db <= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
      if (db <= 0) out.push(b); a = b; da = db;
    }
    return out;
  };
  const face = (material: THREE.Material | undefined, points: Vertex[], solid = false) => {
    if (bounds) {
      points = clip(points, 0, -1, -bounds.minX); points = clip(points, 0, 1, bounds.maxX);
      points = clip(points, 2, -1, -bounds.minZ); points = clip(points, 2, 1, bounds.maxZ);
    }
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[0], b = points[i], c = points[i + 1];
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-6) continue;
      if (material) batch(material).triangle(...a, ...b, ...c, a[0] / 2, a[2] / 2, b[0] / 2, b[2] / 2, c[0] / 2, c[2] / 2);
      if (solid) collision.triangle(...a, ...b, ...c);
    }
  };
  const box = (material: THREE.Material | undefined, x: number, y: number, z: number, w: number, h: number, length: number, yaw = 0, solid = false) => {
    const c = Math.cos(yaw), s = Math.sin(yaw), vertices: Vertex[] = [];
    for (const dy of [-h / 2, h / 2]) for (const [dx, dz] of [[-w / 2, -length / 2], [w / 2, -length / 2], [w / 2, length / 2], [-w / 2, length / 2]]) {
      vertices.push([x + dx * c + dz * s, y + dy, z - dx * s + dz * c]);
    }
    for (const indices of [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]) face(material, indices.map(i => vertices[i]), solid);
  };
  const owns = (p: Point2) => !bounds || p[0] >= bounds.minX && p[0] < bounds.maxX && p[1] >= bounds.minZ && p[1] < bounds.maxZ;

  for (const dock of navyDryDocks) {
    const ring = dock.rings[0], extent = { minX: Math.min(...ring.map(p => p[0])) - 2, maxX: Math.max(...ring.map(p => p[0])) + 2,
      minZ: Math.min(...ring.map(p => p[1])) - 2, maxZ: Math.max(...ring.map(p => p[1])) + 2 };
    if (bounds && !waterfrontOverlaps(extent, bounds)) continue;
    stats.docks++;
    // Dock 1's mapped mouth is the first side. Dock 2 supplies the perpendicular
    // mouth cut in the data, and must remain open to harbor water.
    const mouth = dock.mouth ?? (dock.id.endsWith('-1') ? [ring[0], ring[1]] : [ring.at(-2)!, ring.at(-1)!]);
    const isMouth = (a: Point2, b: Point2) => distance(a, mouth[0], mouth[1]) < .15 && distance(b, mouth[0], mouth[1]) < .15;
    const courses = dock.id.endsWith('-1') ? 8 : 4;
    for (let edge = 0; edge < ring.length; edge++) {
      const a = ring[edge], b = ring[(edge + 1) % ring.length]; if (isMouth(a, b)) continue;
      const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz); if (length < .4) continue;
      const tx = dx / length, tz = dz / length; let nx = -tz, nz = tx;
      if (!pointInside([(a[0] + b[0]) / 2 + nx * .15, (a[1] + b[1]) / 2 + nz * .15], ring)) { nx = -nx; nz = -nz; }
      const count = Math.ceil(length / 2.4), yaw = Math.atan2(tx, tz);
      for (let i = 0; i < count; i++) {
        if (due(pace)) yield;
        const d0 = length * i / count, d1 = length * (i + 1) / count, x0 = a[0] + tx * d0, z0 = a[1] + tz * d0,
          x1 = a[0] + tx * d1, z1 = a[1] + tz * d1, x = (x0 + x1) / 2, z = (z0 + z1) / 2;
        const rim = Math.max(waterfrontHeight(city, x, z), sampleElevation(city, x - nx * 3, z - nz * 3) + .035);
        box(materials.cap, x - nx * .22, rim + .07, z - nz * .22, .78, .22, length / count + .025, yaw, true);
        for (let k = 0; k < courses; k++) {
          const near = k * .68, far = (k + 1) * .68;
          const corners: Point2[] = [[x0 + nx * near, z0 + nz * near], [x1 + nx * near, z1 + nz * near], [x1 + nx * far, z1 + nz * far], [x0 + nx * far, z0 + nz * far]];
          if (!pointInside([x + nx * (near + far) / 2, z + nz * (near + far) / 2], ring)) continue;
          const high = Math.max(rim - k * .8, ...corners.map(p => sampleElevation(city, ...p) + .045));
          // Separate caps and risers retain the staircase silhouette above the
          // tide. Source terrain remains below every cap and no excavation leaks.
          const [p, q, r, s] = corners;
          const up: Vertex[] = [[p[0], high, p[1]], [q[0], high, q[1]], [r[0], high, r[1]], [s[0], high, s[1]]];
          const cross = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
          face(materials.granite, cross > 0 ? up.reverse() : up, true);
          const riser: Vertex[] = [[s[0], high - .82, s[1]], [r[0], high - .82, r[1]], [r[0], high, r[1]], [s[0], high, s[1]]];
          face(materials.granite, cross > 0 ? riser : riser.reverse(), true);
          stats.terraces++;
        }
        // Black iron handrails at the brink, with large capstan-style mooring
        // posts at intervals. The thin rails share a simple solid barrier box.
        const rx = x - nx * .43, rz = z - nz * .43;
        box(materials.iron, rx, rim + 1.1, rz, .065, .065, length / count + .03, yaw);
        box(materials.iron, rx, rim + .55, rz, .045, .045, length / count + .03, yaw);
        box(materials.iron, rx, rim + .57, rz, .075, 1.1, .075);
        // Collider follows the same physical rail even when split at tile seams.
        box(undefined, rx, rim + .6, rz, .13, 1.2, length / count + .025, yaw, true);
        if (i % 6 === 0 && owns([rx, rz])) {
          box(materials.iron, x - nx * 1.3, rim + .34, z - nz * 1.3, .46, .65, .46);
          box(materials.iron, x - nx * 1.3, rim + .61, z - nz * 1.3, .73, .14, .43, yaw);
        }
      }
    }
    if (dock.id.endsWith('-1')) {
      const [a, b] = mouth, dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz), x = (a[0] + b[0]) / 2, z = (a[1] + b[1]) / 2;
      const top = Math.max(waterfrontHeight(city, ...a), waterfrontHeight(city, ...b)) + .22;
      box(materials.gate, x, top - 3.7, z, 1.3, 7.4, length, yaw, true);
      box(materials.cap, x, top + .03, z, 1.5, .18, length + .4, yaw, true);
      for (let d = .8; d < length; d += 1.9) {
        const px = a[0] + dx * d / length, pz = a[1] + dz * d / length;
        box(materials.iron, px, top - 2.6, pz, 1.44, 5.2, .16, yaw);
        box(materials.iron, px, top + .59, pz, .075, 1.1, .075);
      }
      box(materials.iron, x, top + 1.13, z, .06, .065, length, yaw);
      stats.caissons++;
      const floor = yield* parkSurfaceSteps(city, dock.rings, { bounds, pace, heightAt: p => sampleElevation(city, ...p) + .038 });
      if (floor.attributes.position.count) {
        const mesh = new THREE.Mesh(floor, materials.floor); mesh.name = `${dock.name} basin floor`; mesh.receiveShadow = true; group.add(mesh);
      } else floor.dispose();
    }
  }
  for (const [material, writer] of batches) {
    if (!writer.count) continue;
    const mesh = new THREE.Mesh(writer.geometry(), material); mesh.name = 'Navy Yard dry dock masonry and caisson'; mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
  }
  if (collision.count) options.onShore?.(collision.position.slice(0, collision.count * 3), Uint32Array.from({ length: collision.count }, (_, i) => i));
  return stats;
}
