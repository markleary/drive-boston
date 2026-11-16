import type { CityData, Point2 } from '../types.ts';
import { buildingAt, pointInPolygon } from './city-tiles.ts';
import { roadProjection } from './road-surfaces.ts';
import { sampleElevation } from './terrain.ts';

/** Source hydro quay, extended west by the published 1,275-foot Berth 10.
 * Crane parking and individual cargo stacks are an interpretation, not a live
 * inventory. Massport's 2023 equipment schedule identifies seven active STSs:
 * pale 5–7 at Berth 10; dark-blue 3/4 and pale 1/2 at Berths 11/12.
 * Sources and modelling limits are recorded in docs/waterfront-research.md. */
export const CONLEY_QUAY: readonly [Point2, Point2] = [[3710.48, 909.17], [4998.557, 873.007]];
export const CONLEY_BERTH_10_LENGTH = 388.62;
const dx = CONLEY_QUAY[1][0] - CONLEY_QUAY[0][0], dz = CONLEY_QUAY[1][1] - CONLEY_QUAY[0][1];
export const CONLEY_QUAY_LENGTH = Math.hypot(dx, dz);
const tx = dx / CONLEY_QUAY_LENGTH, tz = dz / CONLEY_QUAY_LENGTH;
export const CONLEY_YAW = -Math.atan2(tz, tx);
export function conleyPoint(along: number, inland: number): Point2 {
  return [CONLEY_QUAY[0][0] + tx * along - tz * inland, CONLEY_QUAY[0][1] + tz * along + tx * inland];
}
export const CONLEY_EXTENSION: Point2[] = [conleyPoint(0, 0), conleyPoint(CONLEY_BERTH_10_LENGTH + 3, 0), conleyPoint(CONLEY_BERTH_10_LENGTH + 3, 78), conleyPoint(0, 78)];
export const CONLEY_CRANES = [
  { number: 7, along: 78, height: 62.5, outreach: 57, color: 'pale' },
  { number: 6, along: 205, height: 62.5, outreach: 57, color: 'pale' },
  { number: 5, along: 322, height: 44.2, outreach: 57, color: 'pale' },
  { number: 4, along: 490, height: 41.1, outreach: 47, color: 'blue' },
  { number: 3, along: 625, height: 41.1, outreach: 47, color: 'blue' },
  { number: 2, along: 790, height: 41.1, outreach: 47, color: 'pale' },
  { number: 1, along: 925, height: 41.1, outreach: 47, color: 'pale' },
] as const;

export interface ConleyStack { along: number; inland: number; x: number; z: number; base: number; tiers: number; color: number; }
const paletteSize = 8;
const hash = (a: number, b: number, c: number) => (((a + 11) * 73856093 ^ (b + 7) * 19349663 ^ (c + 2) * 83492791) >>> 0);

/** Keep the working yard on land, out of surveyed structures, and clear of
 * the Butler freight corridor and all other drivable source centerlines. */
export function conleyStacks(city: CityData): ConleyStack[] {
  const roads = city.roads.filter(road => road.points.some(p => p[0] > 3680 && p[0] < 5050 && p[1] > 850 && p[1] < 1260));
  const stacks: ConleyStack[] = [];
  for (let row = 0; row < 6; row++) for (let col = 0; col < 70; col++) for (let lane = 0; lane < 2; lane++) {
    const seed = hash(row, col, lane);
    // Regular open cross-aisles break up the stacks for yard vehicles/RTGs.
    if (col % 14 === 0 || col % 14 === 13 || seed % 11 < 2) continue;
    const along = 35 + col * 16.4, inland = 99 + row * 29 + lane * 2.7;
    const [x, z] = conleyPoint(along, inland);
    const corners = [-6.4, 0, 6.4].flatMap(a => [-1.5, 0, 1.5].map(b => conleyPoint(along + a, inland + b)));
    if (corners.some(p => buildingAt(city, ...p))) continue;
    if (corners.some(p => (city.water ?? []).some(area => pointInPolygon(p[0], p[1], area.rings[0]) && !area.rings.slice(1).some(ring => pointInPolygon(p[0], p[1], ring))))) continue;
    if (corners.some(p => roads.some(road => roadProjection(road, ...p).distance < road.width / 2 + 3))) continue;
    const heights = corners.map(p => sampleElevation(city, ...p));
    if (Math.max(...heights) - Math.min(...heights) > .75) continue;
    stacks.push({ along, inland, x, z, base: Math.max(...heights) + .045, tiers: 1 + seed % 4, color: seed % paletteSize });
  }
  return stacks;
}
