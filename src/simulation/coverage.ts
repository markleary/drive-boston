import type { CityData, Point2 } from '../types';
import { pointInside } from './roads.ts';

const testers = new WeakMap<CityData, (x: number, z: number) => boolean>();
/** Point-in-coverage with a 64 m cell classification, so the metro's
 * multi-thousand-vertex outlines are only walked for points near an edge. */
export function coverageTester(city: CityData) {
  const cached = testers.get(city); if (cached) return cached;
  const polygons = city.coverage ?? [];
  if (!polygons.length) { const always = () => true; testers.set(city, always); return always; }
  const cell = 64, boundary = new Set<number>(), interior = new Map<number, boolean>();
  const key = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);
  for (const polygon of polygons) for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const x0 = Math.floor(Math.min(a[0], b[0]) / cell), x1 = Math.floor(Math.max(a[0], b[0]) / cell), z0 = Math.floor(Math.min(a[1], b[1]) / cell), z1 = Math.floor(Math.max(a[1], b[1]) / cell);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) boundary.add(key(cx, cz));
  }
  const exact = (p: Point2) => polygons.some(polygon => pointInside(p, polygon));
  const tester = (x: number, z: number) => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell), k = key(cx, cz);
    if (boundary.has(k)) return exact([x, z]);
    let inside = interior.get(k); if (inside === undefined) { inside = exact([(cx + .5) * cell, (cz + .5) * cell]); interior.set(k, inside); }
    return inside;
  };
  testers.set(city, tester); return tester;
}
