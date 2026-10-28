import * as THREE from 'three';
import type { CityData } from '../types';
import type { MetroCity } from '../simulation/city-tiles.ts';
import type { FarBuilding } from '../simulation/far-format.ts';
import { terrainGrid } from '../simulation/terrain.ts';
import { FACADE_STYLES } from './materials';

/** Distant representation of the whole metro: one flat-shaded box per hull
 * (its minimum-area oriented rectangle) and a coarse terrain sheet, both per
 * 1 km chunk. The streamer hides a chunk's pair while its detailed tile is
 * built, and nothing here depends on which tiles are loaded. */
export interface FarCityView { group: THREE.Group; setChunkDetailed(key: string, detailed: boolean): void; update(position: THREE.Vector3, altitude: number): void; chunkCount: number; buildingCount: number; }

const FAR_STEP = 5; // grid cells per coarse terrain vertex (30 m at 6 m cells)

/** Rotating-calipers rectangle: the hull edge direction giving the least area. */
export function orientedBox(points: readonly [number, number][]) {
  let best = { area: Infinity, cx: 0, cz: 0, ux: 1, uz: 0, half: 0, halfPerp: 0 };
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz); if (length < .05) continue;
    const ux = dx / length, uz = dz / length; let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, z] of points) { const u = x * ux + z * uz, v = -x * uz + z * ux; minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area) { const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2; best = { area, cx: cu * ux - cv * uz, cz: cu * uz + cv * ux, ux, uz, half: (maxU - minU) / 2, halfPerp: (maxV - minV) / 2 }; }
  }
  return best;
}

function styleColor(style: number) {
  const base = new THREE.Color(FACADE_STYLES[Math.min(style, FACADE_STYLES.length - 1)]?.base ?? '#8a8278');
  // Slightly lifted and desaturated: haze between the camera and a distant block.
  return base.lerp(new THREE.Color('#b9bcb8'), .22);
}

export function createFarCity(scene: THREE.Scene, city: CityData): FarCityView | undefined {
  const metro = city as MetroCity; if (!metro.far || !metro.tiles) return undefined;
  const group = new THREE.Group(); group.name = 'Distant metro'; scene.add(group);
  const chunks = new Map<string, { buildings?: THREE.Mesh; ground?: THREE.Mesh; detailed: boolean; center: THREE.Vector3 }>();
  const size = metro.tiles.size, buildingMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  const groundMaterial = new THREE.MeshLambertMaterial({ color: '#b9bea8' });
  let buildingCount = 0;
  const colors = FACADE_STYLES.map((_, i) => styleColor(i)), roofColor = new THREE.Color('#7d7a72');
  for (const tile of metro.far.tiles.values()) {
    const list = tile.buildings.filter(b => !b.hidden && b.height >= 3 && b.footprint.length >= 3);
    if (!list.length) continue;
    // Five faces per box (no floor), flat normals from a non-indexed layout: 30 vertices.
    const count = list.length, positions = new Float32Array(count * 30 * 3), normals = new Float32Array(count * 30 * 3), color = new Uint8Array(count * 30 * 3);
    let v = 0;
    const put = (x: number, y: number, z: number, nx: number, ny: number, nz: number, c: THREE.Color) => {
      positions[v * 3] = x; positions[v * 3 + 1] = y; positions[v * 3 + 2] = z; normals[v * 3] = nx; normals[v * 3 + 1] = ny; normals[v * 3 + 2] = nz;
      color[v * 3] = c.r * 255; color[v * 3 + 1] = c.g * 255; color[v * 3 + 2] = c.b * 255; v++;
    };
    for (const b of list) {
      const box = orientedBox(b.footprint), y0 = b.base - 1, y1 = b.base + b.height, wall = colors[Math.min(b.style, colors.length - 1)] ?? colors[0];
      const corner = (su: number, sv: number, y: number) => [box.cx + box.ux * box.half * su - box.uz * box.halfPerp * sv, y, box.cz + box.uz * box.half * su + box.ux * box.halfPerp * sv] as const;
      const faces: [number, number, number, number, number, number][] = [[1, -1, 1, 1, 1, 0], [-1, 1, -1, -1, -1, 0], [-1, -1, 1, -1, 0, -1], [1, 1, -1, 1, 0, 1]];
      for (const [su0, sv0, su1, sv1, nu, nv] of faces) {
        const nx = box.ux * nu - box.uz * nv, nz = box.uz * nu + box.ux * nv, a = corner(su0, sv0, y0), bb = corner(su1, sv1, y0), c = corner(su1, sv1, y1), d = corner(su0, sv0, y1);
        for (const p of [a, bb, c, a, c, d]) put(p[0], p[1], p[2], nx, 0, nz, wall);
      }
      const r = [corner(-1, -1, y1), corner(1, -1, y1), corner(1, 1, y1), corner(-1, 1, y1)];
      for (const p of [r[0], r[2], r[1], r[0], r[3], r[2]]) put(p[0], p[1], p[2], 0, 1, 0, roofColor);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(color, 3, true)); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, buildingMaterial); mesh.name = `Distant blocks ${tile.key}`; mesh.userData.noAO = true; mesh.receiveShadow = false; mesh.castShadow = false;
    group.add(mesh); buildingCount += count;
    chunks.set(tile.key, { buildings: mesh, detailed: false, center: new THREE.Vector3((tile.tx + .5) * size, 0, (tile.tz + .5) * size) });
  }
  // Coarse ground sheet per chunk, sampled every FAR_STEP cells with the
  // chunk's edge rows included so neighbouring sheets meet.
  const grid = terrainGrid(city);
  if (grid) {
    const step = grid.cellSize * FAR_STEP;
    const cellsX = Math.ceil(size / step), cellsZ = cellsX;
    for (const key of metro.tiles.keys) {
      const [tx, tz] = key.split('_').map(Number), x0 = tx * size, z0 = tz * size;
      const w = cellsX + 1, h = cellsZ + 1, positions = new Float32Array(w * h * 3), uv = new Float32Array(w * h * 2), indices = new Uint16Array(cellsX * cellsZ * 6);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const x = Math.min(x0 + i * step, x0 + size), z = Math.min(z0 + j * step, z0 + size), n = j * w + i;
        positions[n * 3] = x; positions[n * 3 + 1] = sampleGrid(grid, x, z) - .35; positions[n * 3 + 2] = z; uv[n * 2] = x / 4; uv[n * 2 + 1] = z / 4;
      }
      let o = 0;
      for (let j = 0; j < cellsZ; j++) for (let i = 0; i < cellsX; i++) { const a = j * w + i, b = a + 1, c = a + w, d = c + 1; indices.set([a, c, b, b, c, d], o); o += 6; }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1)); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, groundMaterial); mesh.name = `Distant ground ${key}`; mesh.renderOrder = -4; mesh.userData.noAO = true; group.add(mesh);
      const chunk = chunks.get(key) ?? { detailed: false, center: new THREE.Vector3((tx + .5) * size, 0, (tz + .5) * size) }; chunk.ground = mesh; chunks.set(key, chunk);
    }
  }
  function setChunkDetailed(key: string, detailed: boolean) { const chunk = chunks.get(key); if (!chunk) return; chunk.detailed = detailed; if (chunk.buildings) chunk.buildings.visible = !detailed; if (chunk.ground) chunk.ground.visible = !detailed; }
  function update(position: THREE.Vector3, altitude: number) {
    // Chunks beyond the far plane cost draw calls for nothing; hide them.
    const reach = 2300 + altitude * 1.5;
    for (const chunk of chunks.values()) { const visible = !chunk.detailed && Math.hypot(chunk.center.x - position.x, chunk.center.z - position.z) < reach; if (chunk.buildings) chunk.buildings.visible = visible; if (chunk.ground) chunk.ground.visible = visible; }
  }
  return { group, setChunkDetailed, update, chunkCount: chunks.size, buildingCount };
}

function sampleGrid(grid: NonNullable<ReturnType<typeof terrainGrid>>, x: number, z: number) {
  const fx = Math.max(0, Math.min(grid.width - 1, (x - grid.originX) / grid.cellSize)), fz = Math.max(0, Math.min(grid.height - 1, (z - grid.originZ) / grid.cellSize));
  const i = Math.min(grid.width - 2, Math.floor(fx)), j = Math.min(grid.height - 2, Math.floor(fz)), tx = fx - i, tz = fz - j, k = j * grid.width + i;
  const a = grid.heights[k], b = grid.heights[k + 1], c = grid.heights[k + grid.width], d = grid.heights[k + grid.width + 1];
  return tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
}
export type { FarBuilding };
