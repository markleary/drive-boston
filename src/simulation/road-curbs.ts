import type { CityData, Road } from '../types';
import { sampleElevation } from './terrain.ts';
import { sampleRoadElevation } from './road-surfaces.ts';
import { junctionIndex } from './crosswalks.ts';

/** Survey and municipal curb layers can cap a street where another source
 * continues it. Remove only transverse pieces inside a same-level roadbed;
 * parallel edges, dead-end caps and curbs below an overpass remain. */
export function curbRoadClearance(city: CityData, roads: Road[]) {
  const index = junctionIndex(roads, []);
  const size = 32, cells = new Map<string, { road: Road; x: number; z: number; dx: number; dz: number; length: number; halfA: number; halfB: number; start: boolean; end: boolean }[]>();
  for (const road of roads) {
    if (road.tunnel) continue;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < .05) continue;
      const dx = (b[0] - a[0]) / length, dz = (b[1] - a[1]) / length;
      const halfA = (road.deckWidths?.[i - 1] ?? road.width) / 2 - .35, halfB = (road.deckWidths?.[i] ?? road.width) / 2 - .35, half = Math.max(halfA, halfB);
      const start = i > 1 || index.legsAt(a).some(l => l.road !== road && l.tx * dx + l.tz * dz < -.5);
      const end = i < road.points.length - 1 || index.legsAt(b).some(l => l.road !== road && l.tx * dx + l.tz * dz > .5);
      const segment = { road, x: a[0], z: a[1], dx, dz, length, halfA, halfB, start, end };
      for (let x = Math.floor((Math.min(a[0], b[0]) - half) / size); x <= Math.floor((Math.max(a[0], b[0]) + half) / size); x++)
        for (let z = Math.floor((Math.min(a[1], b[1]) - half) / size); z <= Math.floor((Math.max(a[1], b[1]) + half) / size); z++) {
          const key = `${x},${z}`, list = cells.get(key) ?? []; list.push(segment); cells.set(key, list);
        }
    }
  }
  return (x: number, z: number, tx: number, tz: number) => {
    for (const s of cells.get(`${Math.floor(x / size)},${Math.floor(z / size)}`) ?? []) {
      if (Math.abs(tx * s.dx + tz * s.dz) > .65) continue;
      const dx = x - s.x, dz = z - s.z, along = dx * s.dx + dz * s.dz;
      const half = s.halfA + (s.halfB - s.halfA) * Math.max(0, Math.min(1, along / s.length));
      if (along < (s.start ? -.6 : .1) || along > s.length + (s.end ? .6 : -.1) || Math.abs(dx * s.dz - dz * s.dx) >= half) continue;
      if (Math.abs(sampleRoadElevation(city, s.road, x, z) - sampleElevation(city, x, z)) < .3) return true;
    }
    return false;
  };
}
