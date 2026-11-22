import block from '../data/melrose-main-street.json' with { type: 'json' };
import { MAIN_STREET_CROSSING, MAIN_STREET_HEADING, mainStreetPoint } from './melrose-main-street.ts';
import type { Point2 } from '../types';
import type { Stall } from './parking-lots.ts';

/** Both the T marks and the centers of the cars follow the full-width part of each pocket. */
export function mainStreetParking() {
  const stalls: Stall[] = [], white: Point2[][] = [], yellow: Point2[][] = [];
  for (const bay of block.bays) {
    if (!bay.stalls) continue; // Curbside dining at Rising Eagle.
    const start = bay.start + block.taper, end = bay.end - block.taper;
    const step = (end - start) / bay.stalls;
    const outerLine = bay.east * (block.curbOffset - 2.16);
    for (let i = 0; i <= bay.stalls; i++) {
      const station = start + i * step;
      white.push([mainStreetPoint(station, outerLine), mainStreetPoint(station, bay.east * (block.curbOffset - .22))]);
      white.push([mainStreetPoint(Math.max(start, station - .55), outerLine), mainStreetPoint(Math.min(end, station + .55), outerLine)]);
      if (i === bay.stalls) continue;
      const [x, z] = mainStreetPoint(station + step / 2, bay.east * (block.curbOffset - 1.08));
      stalls.push({ x, z, yaw: MAIN_STREET_HEADING + (bay.east > 0 ? 0 : Math.PI), parallel: true });
    }
  }
  for (const offset of [-.13, .13]) {
    for (const [a, b] of [[10, MAIN_STREET_CROSSING - 2.1], [MAIN_STREET_CROSSING + 2.1, 157]]) {
      yellow.push([mainStreetPoint(a, offset), mainStreetPoint(b, offset)]);
    }
  }
  return { stalls, white, yellow };
}
