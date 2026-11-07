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
  if (roof && building.roofShape && building.roofShape !== 'flat') slopeRoofUVs(flat, uv, building);
  else if (roof) for (let i = 0; i < uv.length / 2; i++) { uv[i * 2] = flat[i * 3] / 6; uv[i * 2 + 1] = flat[i * 3 + 2] / 6; }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geometry.computeVertexNormals();
  if (!roof) stabilizeFacadeUVs(geometry, building);
  // Some landmark/park materials batch roofs and walls together. Keep their
  // attribute layouts identical even though roof shaders do not read this.
  else geometry.setAttribute('facadeTop',new THREE.BufferAttribute(new Float32Array(flat.length/3).fill(1e6),1));
  return geometry;
}

/** Roof UVs of a generated house at the same six-metre repeat, aligned with each
 * plane: u along the eave, v up the slope, so shingle and slate courses run
 * level. Near-flat and downward faces (decks, soffits) keep the planar map. */
export function slopeRoofUVs(flat: ArrayLike<number>, uv: Float32Array, building: Building) {
  const [cx, cz] = building.center, base = building.baseElevation ?? 0;
  for (let i = 0; i + 8 < flat.length; i += 9) {
    const ax = flat[i], ay = flat[i + 1], az = flat[i + 2], abx = flat[i + 3] - ax, aby = flat[i + 4] - ay, abz = flat[i + 5] - az, acx = flat[i + 6] - ax, acy = flat[i + 7] - ay, acz = flat[i + 8] - az;
    let nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx; const length = Math.hypot(nx, ny, nz) || 1; nx /= length; ny /= length; nz /= length;
    const h = Math.hypot(nx, nz), sloped = ny > .2 && ny < .97 && h > 1e-6;
    const tx = sloped ? nz / h : 1, tz = sloped ? -nx / h : 0, sx = sloped ? ny * tz : 0, sy = sloped ? nz * tx - nx * tz : 0, sz = sloped ? -ny * tx : 1;
    for (let k = 0; k < 3; k++) {
      const x = flat[i + k * 3] - cx, y = flat[i + k * 3 + 1] - base, z = flat[i + k * 3 + 2] - cz, j = (i / 3 + k) * 2;
      uv[j] = (x * tx + z * tz) / 6; uv[j + 1] = (x * sx + y * sy + z * sz) / 6;
    }
  }
}

/** A generated house roof split into the covering and its painted trim: fascia
 * boards and the soffits under the eaves and rakes (faces not looking up). */
export function splitHouseRoof(geometry: THREE.BufferGeometry): { roof: THREE.BufferGeometry; trim: THREE.BufferGeometry } {
  const normal = geometry.getAttribute('normal'), names = Object.keys(geometry.attributes), keep: number[] = [], trim: number[] = [];
  for (let i = 0; i < normal.count; i += 3) ((normal.getY(i) + normal.getY(i + 1) + normal.getY(i + 2)) / 3 > .25 ? keep : trim).push(i);
  const pick = (triangles: number[]) => {
    const g = new THREE.BufferGeometry();
    for (const name of names) {
      const source = geometry.getAttribute(name) as THREE.BufferAttribute, size = source.itemSize, out = new Float32Array(triangles.length * 3 * size);
      triangles.forEach((t, n) => out.set((source.array as Float32Array).subarray(t * size, (t + 3) * size), n * 3 * size));
      g.setAttribute(name, new THREE.BufferAttribute(out, size));
    }
    return g;
  };
  return { roof: pick(keep), trim: pick(trim) };
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
