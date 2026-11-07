import type { Point2, Road } from '../types';
import { tilesNear, type MetroCity } from './city-tiles.ts';
import { tileKey, tileOf } from './tile-format.ts';

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
type WantedTile = { tx: number; tz: number; key: string; distance: number };

/** The tile builder owns a whole road by its half-length point. */
export function roadMidpoint(road: Road): Point2 {
  let length = 0; const steps = [0];
  for (let i = 1; i < road.points.length; i++) { length += Math.hypot(road.points[i][0] - road.points[i - 1][0], road.points[i][1] - road.points[i - 1][1]); steps.push(length); }
  const half = length / 2; let i = 1; while (i < steps.length - 1 && steps[i] < half) i++;
  const a = road.points[i - 1], b = road.points[i], span = steps[i] - steps[i - 1] || 1, t = (half - steps[i - 1]) / span;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** How far (x, z) lies outside a road's pavement. */
function pavementDistance(road: Road, x: number, z: number) {
  let distance = Infinity;
  for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    distance = Math.min(distance, Math.max(0, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) - road.width / 2));
  }
  return distance;
}

/** Include owner tiles for road surfaces/decks that reach the view even when
 * their owner tile's boundary is farther away. Reuse the builder's spatial
 * lookup; cache ownership so the per-frame query only checks nearby segments.
 * A survey trace (`city.surveyRoads`) is drawn by no tile: what stands under
 * it is its survey mesh, so a trace that reaches the view brings the mesh's
 * owner, the tile under its centre (the Charlestown end of the Zakim lies
 * 1.1 km from it, beyond a phone's unload radius). */
export class RoadTileCoverage {
  private owners = new WeakMap<Road, Omit<WantedTile, 'distance'>>();
  private keys: Set<string>;
  private city: MetroCity;
  private roadsNear: (bounds: Bounds) => Road[];
  private pavementMargin = 0;
  private surveys: { road: Road; owner: Omit<WantedTile, 'distance'>; bounds: Bounds }[] = [];
  constructor(city: MetroCity, roadsNear: (bounds: Bounds) => Road[]) {
    this.city = city; this.roadsNear = roadsNear; this.keys = new Set(city.tiles.keys);
    for (const road of city.roads) this.pavementMargin = Math.max(this.pavementMargin, road.width / 2);
    for (const road of city.surveyRoads ?? []) {
      const mesh = city.landmarkBuildings?.find(b => b.id === road.surveyDeck); if (!mesh || road.points.length < 2) continue;
      const [tx, tz] = tileOf(mesh.center[0], mesh.center[1], city.tiles.size), key = tileKey(tx, tz); if (!this.keys.has(key)) continue;
      const xs = road.points.map(p => p[0]), zs = road.points.map(p => p[1]), half = road.width / 2;
      this.surveys.push({ road, owner: { tx, tz, key }, bounds: { minX: Math.min(...xs) - half, maxX: Math.max(...xs) + half, minZ: Math.min(...zs) - half, maxZ: Math.max(...zs) + half } });
    }
  }
  tilesNear(x: number, z: number, radius: number): WantedTile[] {
    const wanted = new Map(tilesNear(this.city, x, z, radius).map(tile => [tile.key, tile]));
    const want = (owner: Omit<WantedTile, 'distance'>, distance: number) => { const previous = wanted.get(owner.key); if (!previous || distance < previous.distance) wanted.set(owner.key, { ...owner, distance }); };
    // Include centerlines just outside the radius whose pavement reaches it.
    const margin = radius + this.pavementMargin;
    for (const road of this.roadsNear({ minX: x - margin, maxX: x + margin, minZ: z - margin, maxZ: z + margin })) {
      if (road.points.length < 2) continue;
      const distance = pavementDistance(road, x, z);
      if (distance > radius) continue;
      let owner = this.owners.get(road);
      if (!owner) { const [tx, tz] = tileOf(...roadMidpoint(road), this.city.tiles.size); owner = { tx, tz, key: tileKey(tx, tz) }; this.owners.set(road, owner); }
      if (!this.keys.has(owner.key)) continue;
      want(owner, distance);
    }
    for (const { road, owner, bounds } of this.surveys) {
      if (x < bounds.minX - radius || x > bounds.maxX + radius || z < bounds.minZ - radius || z > bounds.maxZ + radius) continue;
      const distance = pavementDistance(road, x, z); if (distance <= radius) want(owner, distance);
    }
    return [...wanted.values()].sort((a, b) => a.distance - b.distance);
  }
}
