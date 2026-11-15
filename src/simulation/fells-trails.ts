import type { CityArea, ParkPath, Point2 } from '../types';
import { pointInside } from './roads.ts';

export const isFellsArea = (area: CityArea) =>
  area.name === 'Middlesex Fells Reservation' || area.name === "Wright's Pond";

export interface ParkSurfaceRun { points: Point2[]; natural: boolean; }
const inside = (p: Point2, area: CityArea) => pointInside(p, area.rings[0]) && !area.rings.slice(1).some(r => pointInside(p, r));

/** Split at the actual woodland boundary, including holes. A path entering the
 * reservation changes finish there; urban walks and bridge decks retain paving. */
export function parkSurfaceRuns(path: ParkPath, woodland: CityArea[]): ParkSurfaceRun[] {
  if (path.bridge || !woodland.length) return [{ points: path.points, natural: false }];
  const runs: ParkSurfaceRun[] = [];
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i], dx = b[0] - a[0], dz = b[1] - a[1];
    if (Math.hypot(dx, dz) < .001) continue;
    const cuts = [0, 1];
    for (const area of woodland) for (const ring of area.rings) for (let j = 0; j < ring.length; j++) {
      const c = ring[j], d = ring[(j + 1) % ring.length], ex = d[0] - c[0], ez = d[1] - c[1];
      const cross = dx * ez - dz * ex;
      if (Math.abs(cross) < 1e-9) continue;
      const t = ((c[0] - a[0]) * ez - (c[1] - a[1]) * ex) / cross;
      const u = ((c[0] - a[0]) * dz - (c[1] - a[1]) * dx) / cross;
      if (t > 1e-8 && t < 1 - 1e-8 && u >= 0 && u <= 1) cuts.push(t);
    }
    cuts.sort((a, b) => a - b);
    const at = (t: number): Point2 => [a[0] + dx * t, a[1] + dz * t];
    for (let j = 1; j < cuts.length; j++) {
      if (cuts[j] - cuts[j - 1] < 1e-8) continue;
      const natural = woodland.some(area => inside(at((cuts[j - 1] + cuts[j]) / 2), area));
      const last = runs[runs.length - 1];
      if (last?.natural === natural) last.points.push(at(cuts[j]));
      else runs.push({ natural, points: [at(cuts[j - 1]), at(cuts[j])] });
    }
  }
  return runs;
}

/** Keep the mapped riding line intact, varying only the soil's soft edge.
 * World-coordinate variation gives adjoining tile fragments the same width. */
export function trailEdges(points: Point2[], width: number) {
  const stations: Point2[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2.5));
    if (i === 1) stations.push(a);
    for (let j = 1; j <= steps; j++) stations.push([a[0] + (b[0] - a[0]) * j / steps, a[1] + (b[1] - a[1]) * j / steps]);
  }
  const left: Point2[] = [], right: Point2[] = [];
  for (let i = 0; i < stations.length; i++) {
    const p = stations[i], a = stations[Math.max(0, i - 1)], b = stations[Math.min(stations.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz) || 1;
    const edge = width / 2 * (1 + .065 * Math.sin(p[0] * .93 + p[1] * .47) + .045 * Math.cos(p[1] * 1.21 - p[0] * .37));
    left.push([p[0] - dz / length * edge, p[1] + dx / length * edge]);
    right.push([p[0] + dz / length * edge, p[1] - dx / length * edge]);
  }
  return { left, right };
}
