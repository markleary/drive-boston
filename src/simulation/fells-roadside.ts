import type { CityData, Point2, Road } from '../types';
import { pointInside } from './roads.ts';
import { sampleElevation } from './terrain.ts';

export interface FellsBounds { minX: number; maxX: number; minZ: number; maxZ: number; }
export interface FellsRoadsideSpan {
  a: Point2; b: Point2; outward: Point2; road: Road; edge: number;
  kind: 'rail' | 'rock';
}
export interface FellsRockCut {
  center: Point2; along: Point2; outward: Point2; halfLength: number; halfDepth: number; rise: number; seed: number;
}

/** Restrict an exposure to the steepest part of a bank. Rounded, overlapping
 * bedrock lobes leave soil between outcrops instead of paving a whole slope. */
export function fellsRockCutPlan(city: CityData, span: FellsRoadsideSpan): FellsRockCut | undefined {
  const dx = span.b[0] - span.a[0], dz = span.b[1] - span.a[1], length = Math.hypot(dx, dz);
  const along: Point2 = [dx / length, dz / length], x = (span.a[0] + span.b[0]) / 2, z = (span.a[1] + span.b[1]) / 2;
  let steepest = .36, depth = -1;
  for (let d = 2.5; d <= 12.5; d += 1.25) {
    const lo = sampleElevation(city, x + span.outward[0] * (d - 1.25), z + span.outward[1] * (d - 1.25));
    const hi = sampleElevation(city, x + span.outward[0] * (d + 1.25), z + span.outward[1] * (d + 1.25));
    if ((hi - lo) / 2.5 > steepest) { steepest = (hi - lo) / 2.5; depth = d; }
  }
  if (depth < 0) return;
  const seed = Math.sin(x * .173 + z * .231), halfDepth = Math.min(depth - .7, 14.8 - depth, 2.6 + Math.min(2.4, steepest * 2.2));
  return {
    center: [x + span.outward[0] * depth, z + span.outward[1] * depth], along, outward: span.outward,
    halfLength: length * (.48 + .08 * seed), halfDepth, rise: .48 + Math.min(.7, steepest * .4), seed,
  };
}

const rockPlans = new WeakMap<CityData, FellsRockCut[]>();
/** Trunks must not root through a raised bedrock face. Crowns may overhang it. */
export function fellsRoadsideRockAt(city: CityData, x: number, z: number, margin = .55) {
  let cuts = rockPlans.get(city);
  if (!cuts) {
    cuts = [];
    for (const span of fellsRoadsideSpans(city)) if (span.kind === 'rock') { const cut = fellsRockCutPlan(city, span); if (cut) cuts.push(cut); }
    rockPlans.set(city, cuts);
  }
  return cuts.some(cut => {
    const dx = x - cut.center[0], dz = z - cut.center[1];
    return ((dx * cut.along[0] + dz * cut.along[1]) / (cut.halfLength + margin)) ** 2
      + ((dx * cut.outward[0] + dz * cut.outward[1]) / (cut.halfDepth + margin)) ** 2 < 1;
  });
}

/** The pull-off north of Gate 53, beside the mapped Cross Fells access path
 * (OSM 415298819). The wood kiosk is set behind its northern end, facing east.
 * Reference: Tufts Rock Circuit self-guide, map RC-1, stop 0 (May 2025). */
export const FELLS_TRAILHEAD = { x: -435.1, z: -10296.8, yaw: Math.PI / 2 };
export const FELLS_PULLOFF = { minX: -442, maxX: -419, minZ: -10298, maxZ: -10212 };

const inBounds = (p: Point2, b: FellsBounds) => p[0] >= b.minX && p[0] < b.maxX && p[1] >= b.minZ && p[1] < b.maxZ;
function distance(p: Point2, a: Point2, b: Point2) {
  const dx = b[0] - a[0], dz = b[1] - a[1], d = dx * dx + dz * dz;
  const t = d ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / d)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}
const within = (p: Point2, b: FellsBounds, reach = 0) => p[0] >= b.minX - reach && p[0] <= b.maxX + reach && p[1] >= b.minZ - reach && p[1] <= b.maxZ + reach;

/** Trees and undergrowth leave the pull-off and the map board's approach open. */
export function fellsRoadsideReserved(_city: CityData, x: number, z: number, reach = 0) {
  return within([x, z], FELLS_PULLOFF, Math.min(reach, 2)) || Math.hypot(x - FELLS_TRAILHEAD.x, z - FELLS_TRAILHEAD.z) < reach + 3;
}

/** Interpret the existing DEM beside Fellsway East: rail only on a falling
 * bank, exposed rock only on an uphill bank. Never obstruct a trail entrance.
 * The road samples and tile ownership are independent of the loaded neighbors. */
export function* fellsRoadsideSpans(city: CityData, bounds?: FellsBounds): Generator<FellsRoadsideSpan> {
  const woods = (city.parks ?? []).filter(p => p.name === 'Middlesex Fells Reservation');
  if (!woods.length) return;
  const roads = city.roads.filter(road => road.name === 'Fellsway East' && !road.tunnel && !road.bridge);
  if (!roads.length) return;
  const points = roads.flatMap(r => r.points), extent = {
    minX: Math.min(...points.map(p => p[0])) - 45, maxX: Math.max(...points.map(p => p[0])) + 45,
    minZ: Math.min(...points.map(p => p[1])) - 45, maxZ: Math.max(...points.map(p => p[1])) + 45,
  };
  const woodlandBounds = woods.map(w => ({ minX: Math.min(...w.rings[0].map(p => p[0])), maxX: Math.max(...w.rings[0].map(p => p[0])), minZ: Math.min(...w.rings[0].map(p => p[1])), maxZ: Math.max(...w.rings[0].map(p => p[1])) }));
  const woodland = (p: Point2) => woods.some((w, i) => within(p, woodlandBounds[i]) && pointInside(p, w.rings[0]) && !w.rings.slice(1).some(r => pointInside(p, r)));
  // Nearby path and road segments share a small clearance grid. In the legacy
  // whole-city build this avoids scanning every city road for each guardrail.
  const cells = new Map<string, { a: Point2; b: Point2; width: number }[]>(), cell = 40;
  const add = (a: Point2, b: Point2, width: number) => {
    const pad = width / 2 + 12;
    if (Math.max(a[0], b[0]) < extent.minX - pad || Math.min(a[0], b[0]) > extent.maxX + pad || Math.max(a[1], b[1]) < extent.minZ - pad || Math.min(a[1], b[1]) > extent.maxZ + pad) return;
    for (let ix = Math.floor((Math.min(a[0], b[0]) - pad) / cell); ix <= Math.floor((Math.max(a[0], b[0]) + pad) / cell); ix++) for (let iz = Math.floor((Math.min(a[1], b[1]) - pad) / cell); iz <= Math.floor((Math.max(a[1], b[1]) + pad) / cell); iz++) {
      const key = `${ix},${iz}`, list = cells.get(key) ?? []; list.push({ a, b, width }); cells.set(key, list);
    }
  };
  for (const path of city.parkPaths ?? []) for (let i = 1; i < path.points.length; i++) add(path.points[i - 1], path.points[i], path.width);
  for (const road of city.roads) if (road.name !== 'Fellsway East' && !road.tunnel) for (let i = 1; i < road.points.length; i++) add(road.points[i - 1], road.points[i], road.width);
  const clear = (p: Point2, radius: number) => !within(p, FELLS_PULLOFF, radius)
    && !(cells.get(`${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`) ?? []).some(segment => distance(p, segment.a, segment.b) < segment.width / 2 + radius);
  for (const road of roads) {
    const half = (road.pavedWidth ?? road.width) / 2;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      if (length < .1) continue;
      if (bounds && (Math.max(a[0], b[0]) < bounds.minX - 35 || Math.min(a[0], b[0]) > bounds.maxX + 35 || Math.max(a[1], b[1]) < bounds.minZ - 35 || Math.min(a[1], b[1]) > bounds.maxZ + 35)) continue;
      const pieces = Math.ceil(length / 6), tx = dx / length, tz = dz / length;
      for (let k = 0; k < pieces; k++) for (const side of [-1, 1]) {
        const outward: Point2 = [-tz * side, tx * side], edge = half + .8;
        const at = (t: number, off: number): Point2 => [a[0] + dx * t + outward[0] * off, a[1] + dz * t + outward[1] * off];
        const middle = at((k + .5) / pieces, edge);
        if (bounds && !inBounds(middle, bounds)) continue;
        if (!woodland(at((k + .5) / pieces, edge + 7))) continue;
        const start = at(k / pieces, edge), end = at((k + 1) / pieces, edge);
        if (![start, middle, end].every(p => clear(p, 1.8))) continue;
        const base = sampleElevation(city, ...middle);
        const near = sampleElevation(city, ...at((k + .5) / pieces, half + 12));
        const far = sampleElevation(city, ...at((k + .5) / pieces, half + 22));
        if (base - near > 1.3 || base - far > 3) {
          yield { a: start, b: end, outward, road, edge, kind: 'rail' };
        } else if (Math.max(near, far) - base > 3.1) {
          // A broad, steep bank rather than a single isolated high DEM cell.
          const inner = half + 4.5, outer = half + 20;
          const p = at((k + .5) / pieces, inner + (outer - inner) / 2);
          if (clear(p, (outer - inner) / 2 + 1.5) && [at(k / pieces, inner), at((k + 1) / pieces, inner), at(k / pieces, outer), at((k + 1) / pieces, outer)].every(woodland)) {
            yield { a: at(k / pieces, inner), b: at((k + 1) / pieces, inner), outward, road, edge: inner, kind: 'rock' };
          }
        }
      }
    }
  }
}
