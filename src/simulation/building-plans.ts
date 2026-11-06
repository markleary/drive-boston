import type { Building, CityData } from '../types';
import type { TileBuildingGeometry } from './tile-format.ts';
import { isMetroCity, ownFarHulls } from './city-tiles.ts';

/** Top-down outlines for the loaded buildings a convex footprint misdraws on the map: exact-mesh
 * complexes and buildings whose hull crosses a street. The Prudential complex's hull, for one,
 * spans Huntington Avenue and Belvidere Street. An outline is the shell's roof triangles projected
 * to the ground, all wound one way so a nonzero fill draws their union. The tile builder adds them
 * as a tile's buildings go in and drops them when the tile goes. */
export interface BuildingPlan {
  building: Building; triangles: Float32Array; minX: number; maxX: number; minZ: number; maxZ: number;
  /** Index numbers (`IndexedBuilding.n`) of the hulls the outline replaces on the map. */ hulls: number[];
  landmark: boolean;
}
const plans = new WeakMap<CityData, Map<Building, BuildingPlan>>();

/** Ground-plane triangles (x,z per corner) of a shell's roof, or of its walls if it has no roof, all wound the same way. */
export function planTriangles(data: TileBuildingGeometry): Float32Array {
  const p = data.positions, source = data.roof.length ? data.roof : data.facade, out = new Float32Array(source.length * 2); let n = 0;
  for (let i = 0; i + 2 < source.length; i += 3) {
    const a = source[i] * 3, b = source[i + 1] * 3, c = source[i + 2] * 3;
    const ax = p[a], az = p[a + 2], bx = p[b], bz = p[b + 2], cx = p[c], cz = p[c + 2], cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (Math.abs(cross) < .02) continue; // edge-on faces add nothing to the outline
    out[n++] = ax; out[n++] = az;
    if (cross > 0) { out[n++] = bx; out[n++] = bz; out[n++] = cx; out[n++] = cz; } else { out[n++] = cx; out[n++] = cz; out[n++] = bx; out[n++] = bz; }
  }
  return out.slice(0, n);
}
export function addBuildingPlan(city: CityData, building: Building, data: TileBuildingGeometry) {
  const triangles = planTriangles(data); if (!triangles.length) return;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < triangles.length; i += 2) { minX = Math.min(minX, triangles[i]); maxX = Math.max(maxX, triangles[i]); minZ = Math.min(minZ, triangles[i + 1]); maxZ = Math.max(maxZ, triangles[i + 1]); }
  const hulls = isMetroCity(city) ? ownFarHulls(city, building) : [];
  let list = plans.get(city); if (!list) plans.set(city, list = new Map());
  list.set(building, { building, triangles, minX, maxX, minZ, maxZ, hulls: hulls.map(h => h.n), landmark: hulls.length ? hulls[0].landmark : !!building.landmark });
}
export function removeBuildingPlans(city: CityData, buildings: Iterable<Building>) { const list = plans.get(city); if (list) for (const b of buildings) list.delete(b); }
export const buildingPlans = (city: CityData): Iterable<BuildingPlan> => plans.get(city)?.values() ?? [];
