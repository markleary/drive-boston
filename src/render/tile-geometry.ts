import * as THREE from 'three';
import type { Building } from '../types';
import type { TileBuildingGeometry } from '../simulation/tile-format.ts';
import { stabilizeFacadeUVs } from './materials.ts';

/** Flat (non-indexed) copies of indexed tile triangles. */
export function expandTriangles(positions: Float32Array, indices: ArrayLike<number>): Float32Array {
  const out = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) { const k = indices[i] * 3; out[i * 3] = positions[k]; out[i * 3 + 1] = positions[k + 1]; out[i * 3 + 2] = positions[k + 2]; }
  return out;
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
