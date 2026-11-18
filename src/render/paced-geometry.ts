import * as THREE from 'three';
import { due, type Pace } from './pacing.ts';

/** Per-vertex passes over district-sized surfaces (a tile's street pavement, a
 * harbour basin) that pause once the frame's deadline has passed. Each gives
 * the result of the three.js call it replaces. */

/** computeVertexNormals for a non-indexed geometry: every vertex takes its
 * triangle's (c - b) x (a - b), stored and then normalized as three.js does. */
export function* flatNormalSteps(geometry: THREE.BufferGeometry, pace?: Pace): Generator<void, void> {
  const p = geometry.getAttribute('position').array as Float32Array, n = new Float32Array(p.length);
  for (let i = 0; i + 8 < p.length; i += 9) {
    if (i % 36864 === 0 && due(pace)) yield;
    const bx = p[i + 3], by = p[i + 4], bz = p[i + 5], cbx = p[i + 6] - bx, cby = p[i + 7] - by, cbz = p[i + 8] - bz, abx = p[i] - bx, aby = p[i + 1] - by, abz = p[i + 2] - bz;
    const x = cby * abz - cbz * aby, y = cbz * abx - cbx * abz, z = cbx * aby - cby * abx;
    n[i] = n[i + 3] = n[i + 6] = x; n[i + 1] = n[i + 4] = n[i + 7] = y; n[i + 2] = n[i + 5] = n[i + 8] = z;
  }
  for (let i = 0; i < n.length; i += 3) {
    if (i % 36864 === 0 && due(pace)) yield;
    const x = n[i], y = n[i + 1], z = n[i + 2], scale = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    n[i] = x * scale; n[i + 1] = y * scale; n[i + 2] = z * scale;
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(n, 3));
}

/** Area-weighted normals for a triangle list with coincident corners. Shore
 * banks contain independently clipped fragments; flat normals expose every
 * diagonal as a bright tooth along a steep waterline. Weld only for shading,
 * keeping the original render/collision triangles and metre UVs untouched. */
export function* smoothNormalSteps(geometry: THREE.BufferGeometry, pace?: Pace): Generator<void, void> {
  const p = geometry.getAttribute('position').array as Float32Array;
  const ids = new Uint32Array(p.length / 3), shared = new Map<string, number>(), sums: number[] = [];
  for (let i = 0; i < p.length; i += 3) {
    if (i % 12288 === 0 && due(pace)) yield;
    const key = `${Math.round(p[i] * 1000)},${Math.round(p[i + 1] * 1000)},${Math.round(p[i + 2] * 1000)}`;
    let id = shared.get(key);
    if (id === undefined) { id = sums.length; shared.set(key, id); sums.push(0, 0, 0); }
    ids[i / 3] = id;
  }
  for (let i = 0; i + 8 < p.length; i += 9) {
    if (i % 36864 === 0 && due(pace)) yield;
    const ax = p[i] - p[i + 3], ay = p[i + 1] - p[i + 4], az = p[i + 2] - p[i + 5];
    const bx = p[i + 6] - p[i + 3], by = p[i + 7] - p[i + 4], bz = p[i + 8] - p[i + 5];
    const nx = by * az - bz * ay, ny = bz * ax - bx * az, nz = bx * ay - by * ax;
    for (let k = 0; k < 3; k++) { const id = ids[i / 3 + k]; sums[id] += nx; sums[id + 1] += ny; sums[id + 2] += nz; }
  }
  const normals = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    if (i % 36864 === 0 && due(pace)) yield;
    const id = ids[i / 3], x = sums[id], y = sums[id + 1], z = sums[id + 2], length = Math.hypot(x, y, z) || 1;
    normals[i] = x / length; normals[i + 1] = y / length; normals[i + 2] = z / length;
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
}

/** computeBoundingSphere: centred on the position bounds, radius to the farthest vertex. */
export function* boundingSphereSteps(geometry: THREE.BufferGeometry, pace?: Pace): Generator<void, void> {
  const p = geometry.getAttribute('position').array as Float32Array;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    if (i % 98304 === 0 && due(pace)) yield;
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z; if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
  }
  const center = p.length ? new THREE.Vector3(minX, minY, minZ).add(new THREE.Vector3(maxX, maxY, maxZ)).multiplyScalar(.5) : new THREE.Vector3();
  let farthest = 0;
  for (let i = 0; i < p.length; i += 3) {
    if (i % 98304 === 0 && due(pace)) yield;
    const dx = center.x - p[i], dy = center.y - p[i + 1], dz = center.z - p[i + 2];
    farthest = Math.max(farthest, dx * dx + dy * dy + dz * dz);
  }
  geometry.boundingSphere = new THREE.Sphere(center, Math.sqrt(farthest));
}
