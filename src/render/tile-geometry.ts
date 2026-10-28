import * as THREE from 'three';
import type { Building } from '../types';
import type { TileBuildingGeometry } from '../simulation/tile-format.ts';
import { stabilizeFacadeUVs } from './materials.ts';

/** Flat copies of the survey's nonzero-area triangles. Collinear survey faces
 * have no surface, but can still rasterize a sample after GPU projection. Their
 * zero normals produce NaNs that bloom spreads over much of the view. */
export function expandTriangles(positions: Float32Array, indices: ArrayLike<number>): Float32Array {
  const out = new Float32Array(indices.length * 3);
  let count = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const abx = positions[b] - positions[a], aby = positions[b + 1] - positions[a + 1], abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a], acy = positions[c + 1] - positions[a + 1], acz = positions[c + 2] - positions[a + 2];
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    if (!(nx * nx + ny * ny + nz * nz > 0)) continue;
    for (let j = 0; j < 3; j++) { const k = indices[i + j] * 3; out[count++] = positions[k]; out[count++] = positions[k + 1]; out[count++] = positions[k + 2]; }
  }
  return out.subarray(0, count);
}

/** The renderable shell of one part of a surveyed tile building, in the form the
 * survey GLB build delivered: non-indexed with flat normals, roof UVs planar at
 * 6 m and facade UVs stabilized along the walls. Undefined without triangles. */
export function tileShellGeometry(data: TileBuildingGeometry, building: Building, roof: boolean): THREE.BufferGeometry | undefined {
  const flat = expandTriangles(data.positions, roof ? data.roof : data.facade); if (!flat.length) return undefined;
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(flat, 3));
  const uv = new Float32Array(flat.length / 3 * 2);
  if (roof) for (let i = 0; i < uv.length / 2; i++) { uv[i * 2] = flat[i * 3] / 6; uv[i * 2 + 1] = flat[i * 3 + 2] / 6; }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geometry.computeVertexNormals();
  if (!roof) stabilizeFacadeUVs(geometry, building);
  // Some landmark/park materials batch roofs and walls together. Keep their
  // attribute layouts identical even though roof shaders do not read this.
  else geometry.setAttribute('facadeTop',new THREE.BufferAttribute(new Float32Array(flat.length/3).fill(1e6),1));
  return geometry;
}

/** The indexed source walls (shared vertices, facade triangles) that the footing sampler reads. */
export function tileSourceGeometry(data: TileBuildingGeometry): THREE.BufferGeometry {
  const source = new THREE.BufferGeometry(); source.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  source.setIndex(new THREE.BufferAttribute(data.facade instanceof Uint32Array ? data.facade : Uint32Array.from(data.facade), 1));
  return source;
}

/** Every triangle of the shell as one index list, the exact-mesh collider input. */
export function tileCollisionIndices(data: TileBuildingGeometry): Uint32Array {
  const indices = new Uint32Array(data.facade.length + data.roof.length); indices.set(data.facade); indices.set(data.roof, data.facade.length); return indices;
}
