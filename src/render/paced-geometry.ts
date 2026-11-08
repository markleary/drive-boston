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
