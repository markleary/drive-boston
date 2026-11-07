import type { Building, CityData, Point2, Road } from '../types';
import { closestRoad } from '../simulation/roads.ts';
import { buildingAt, isMetroCity, ownFarHulls } from '../simulation/city-tiles.ts';
import { isReligiousBuilding } from '../simulation/building-identities.ts';
import { architectureFor } from './neighborhood-profiles.ts';
import { inTownCentre } from '../simulation/town-centres.ts';
export { inTownCentre };

/** The fallback sidewalk band outside each curb (street_meshes.py WALK). */
const WALK = 2.9;
/** The forecourt starts this far inside the band, so the two share an edge. */
const OVERLAP = .3;
/** Deeper forecourts are lawns, plazas or parking, not a shopfront's pavement. */
const FORECOURT = 7.5;
const NOT_SHOP = /^(garages?|shed|roof|carport|canopy|church|chapel|religious|house|detached|semidetached_house|bungalow|apartments|residential)$/;
const street = (road: Road) => !road.elevations && !road.tunnel && road.width >= 6 && !/alley|public|unnamed|driveway|parking/i.test(road.name);

/** Paved forecourts between the sidewalk band and the shopfronts of the town
 * centres. Town streets carry a width from their lane count, not a survey of
 * the curbs (Main Street in downtown Melrose is modelled 7.6 m), so the 2.9 m
 * band stops short of buildings that stand at the back of a wide real
 * sidewalk. Each street-facing wall of a commercial or civic building gets a
 * quadrilateral from the wall to just inside the band, projected square to the
 * street at both ends. Houses, churches, garages, walls that do not face and
 * run along a street, forecourts deeper than 7.5 m and any whose middle lies
 * in another building's hull are left as they are. Returns single-ring
 * polygons for the tile builder to drape with the sidewalk material. */
export function townFrontages(city: CityData, buildings: Building[]): Point2[][][] {
  const out: Point2[][][] = [];
  for (const b of buildings) {
    if (!inTownCentre(b.center) || b.houseStyle || architectureFor(b) || isReligiousBuilding(b) || NOT_SHOP.test(b.kind ?? '') || b.height < 3) continue;
    const p = b.footprint, n = p.length; if (n < 3) continue;
    const sign = p.reduce((s, a, i) => { const c = p[(i + 1) % n]; return s + a[0] * c[1] - c[0] * a[1]; }, 0) > 0 ? 1 : -1;
    let own: object[] | undefined;
    for (let i = 0; i < n; i++) {
      const a = p[i], c = p[(i + 1) % n], dx = c[0] - a[0], dz = c[1] - a[1], length = Math.hypot(dx, dz); if (length < 3) continue;
      const nx = sign * dz / length, nz = -sign * dx / length, mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      const road = closestRoad(city, mx, mz, false, { maxDistance: 30, accept: q => street(q.road) });
      if (!Number.isFinite(road.distance)) continue;
      const band = (road.road.pavedWidth ?? road.road.width) / 2 + WALK;
      if (road.distance - band > FORECOURT || road.distance < band + .25) continue;
      if (((road.x - mx) * nx + (road.z - mz) * nz) / road.distance < .8) continue;
      if (Math.abs(Math.sin(road.yaw) * dx / length + Math.cos(road.yaw) * dz / length) < .86) continue;
      // Each corner moves square to the same street (its nearest record of that name) to just inside the band.
      const same = (q: { road: Road }) => q.road === road.road || q.road.name === road.road.name && street(q.road);
      const corner = (v: Point2): Point2 | undefined => {
        const q = closestRoad(city, v[0], v[1], false, { maxDistance: 40, accept: same }); if (!Number.isFinite(q.distance)) return undefined;
        const reach = (q.road.pavedWidth ?? q.road.width) / 2 + WALK - OVERLAP; if (q.distance <= reach) return [v[0], v[1]];
        const t = reach / q.distance; return [q.x + (v[0] - q.x) * t, q.z + (v[1] - q.z) * t];
      };
      const a2 = corner(a), c2 = corner(c); if (!a2 || !c2) continue;
      // The outer edge must run the same way as the wall (no twisted quad at a bend).
      if ((c2[0] - a2[0]) * dx + (c2[1] - a2[1]) * dz <= 0) continue;
      if (isMetroCity(city)) {
        const middle: Point2 = [(a[0] + c[0] + a2[0] + c2[0]) / 4, (a[1] + c[1] + a2[1] + c2[1]) / 4], hull = buildingAt(city, middle[0], middle[1]);
        if (hull) { own ??= ownFarHulls(city, b); if (!own.includes(hull)) continue; }
      }
      out.push([[a, c, c2, a2]]);
    }
  }
  return out;
}
