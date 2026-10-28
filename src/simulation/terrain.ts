import type { Building, CityData } from '../types';

/** Samples are row-major: z rows, x columns; all coordinates/elevations are world metres. */
export interface ElevationGrid {
  width: number; height: number; cellSize: number; originX: number; originZ: number; heights: ArrayLike<number>;
}
type TerrainCity = Pick<CityData, 'bounds'> & { elevation?: ElevationGrid };
type TerrainBuilding = Pick<Building, 'center' | 'footprint'> & { baseElevation?: number };
interface GridCache { min: number; max: number; mesh?: { vertices: Float32Array; indices: Uint32Array }; }
const grids = new WeakMap<ElevationGrid, GridCache>();
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export function terrainGrid(city: TerrainCity) {
  const grid = city.elevation;
  if (!grid) return undefined;
  if (!grids.has(grid)) {
    if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 2 || grid.height < 2 ||
      !Number.isFinite(grid.cellSize) || grid.cellSize <= 0 || !Number.isFinite(grid.originX + grid.originZ) ||
      grid.heights.length !== grid.width * grid.height) throw new Error('Invalid elevation grid dimensions.');
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < grid.heights.length; i++) {
      const height = grid.heights[i];
      if (!Number.isFinite(height)) throw new Error('Elevation grid contains a missing height.');
      min = Math.min(min, height); max = Math.max(max, height);
    }
    grids.set(grid, { min, max });
  }
  return grid;
}

function cell(grid: ElevationGrid, x: number, z: number) {
  const fx = clamp((x - grid.originX) / grid.cellSize, 0, grid.width - 1);
  const fz = clamp((z - grid.originZ) / grid.cellSize, 0, grid.height - 1);
  const i = Math.min(grid.width - 2, Math.floor(fx)), j = Math.min(grid.height - 2, Math.floor(fz));
  const offset = j * grid.width + i;
  return { tx: fx - i, tz: fz - j, a: grid.heights[offset], b: grid.heights[offset + 1],
    c: grid.heights[offset + grid.width], d: grid.heights[offset + grid.width + 1] };
}

/** Exact height of the rendered/Rapier triangles, with their NE-to-SW diagonal. */
export function sampleElevation(city: TerrainCity, x: number, z: number) {
  const grid = terrainGrid(city); if (!grid) return 0;
  const { tx, tz, a, b, c, d } = cell(grid, x, z);
  return tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
}
export const sampleSurfaceElevation = sampleElevation;

/** Only for data inspection; actors/roads should use the exact surface query above. */
export function sampleBilinearElevation(city: TerrainCity, x: number, z: number) {
  const grid = terrainGrid(city); if (!grid) return 0;
  const { tx, tz, a, b, c, d } = cell(grid, x, z);
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

export function sampleTerrainNormal(city: TerrainCity, x: number, z: number) {
  const grid = terrainGrid(city); if (!grid) return { x: 0, y: 1, z: 0 };
  const { tx, tz, a, b, c, d } = cell(grid, x, z);
  let gx = (tx + tz <= 1 ? b - a : d - c) / grid.cellSize;
  let gz = (tx + tz <= 1 ? c - a : d - b) / grid.cellSize;
  if (x < grid.originX || x > grid.originX + (grid.width - 1) * grid.cellSize) gx = 0;
  if (z < grid.originZ || z > grid.originZ + (grid.height - 1) * grid.cellSize) gz = 0;
  const length = Math.hypot(gx, 1, gz);
  return { x: -gx / length, y: 1 / length, z: -gz / length };
}

/** Heading preserved in x/z; local +Y follows the support plane. No Three/DOM dependency. */
export function terrainRotation(city: TerrainCity, x: number, z: number, yaw: number) {
  return rotationFromNormal(sampleTerrainNormal(city, x, z),yaw);
}

export function rotationFromNormal(up:{x:number;y:number;z:number},yaw:number) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw), fy = -(up.x * fx + up.z * fz) / Math.max(.001, up.y);
  const fl = Math.hypot(fx, fy, fz), forward = { x: fx / fl, y: fy / fl, z: fz / fl };
  const right = { x: up.y * forward.z - up.z * forward.y, y: up.z * forward.x - up.x * forward.z, z: up.x * forward.y - up.y * forward.x };
  const m00 = right.x, m01 = up.x, m02 = forward.x, m10 = right.y, m11 = up.y, m12 = forward.y, m20 = right.z, m21 = up.z, m22 = forward.z;
  const trace = m00 + m11 + m22;
  if (trace > 0) { const s = 2 * Math.sqrt(trace + 1); return { x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s, w: s / 4 }; }
  if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); return { x: s / 4, y: (m01 + m10) / s, z: (m02 + m20) / s, w: (m21 - m12) / s }; }
  if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); return { x: (m01 + m10) / s, y: s / 4, z: (m12 + m21) / s, w: (m02 - m20) / s }; }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11); return { x: (m02 + m20) / s, y: (m12 + m21) / s, z: s / 4, w: (m10 - m01) / s };
}

export function terrainRange(city: TerrainCity) {
  const grid = terrainGrid(city); const range = grid ? grids.get(grid)! : { min: 0, max: 0 };
  return { min: range.min, max: range.max };
}

export function buildingBaseElevation(city: TerrainCity, building: TerrainBuilding) {
  if (Number.isFinite(building.baseElevation)) return building.baseElevation!;
  return building.footprint.length ? Math.min(...building.footprint.map(([x, z]) => sampleElevation(city, x, z))) : sampleElevation(city, ...building.center);
}

/** Share these vertex/triangle arrays with rendering and collision. Treat them as immutable. */
export function buildTerrainGeometryData(city: TerrainCity) {
  const grid = terrainGrid(city);
  if (!grid) {
    const { minX, maxX, minZ, maxZ } = city.bounds;
    return { vertices: new Float32Array([minX - 40, 0, minZ - 40, maxX + 40, 0, minZ - 40, minX - 40, 0, maxZ + 40, maxX + 40, 0, maxZ + 40]), indices: new Uint32Array([0, 2, 1, 1, 2, 3]) };
  }
  const cache = grids.get(grid)!; if (cache.mesh) return cache.mesh;
  const vertices = new Float32Array(grid.width * grid.height * 3);
  const indices = new Uint32Array((grid.width - 1) * (grid.height - 1) * 6);
  for (let j = 0; j < grid.height; j++) for (let i = 0; i < grid.width; i++) {
    const offset = j * grid.width + i;
    vertices[offset * 3] = grid.originX + i * grid.cellSize; vertices[offset * 3 + 1] = grid.heights[offset]; vertices[offset * 3 + 2] = grid.originZ + j * grid.cellSize;
  }
  let offset = 0;
  for (let j = 0; j < grid.height - 1; j++) for (let i = 0; i < grid.width - 1; i++) {
    const a = j * grid.width + i, b = a + 1, c = a + grid.width, d = c + 1;
    indices.set([a, c, b, b, c, d], offset); offset += 6;
  }
  return cache.mesh = { vertices, indices };
}
