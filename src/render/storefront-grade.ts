import type { CityData } from '../types';
import { sampleElevation } from '../simulation/terrain.ts';

/** Local +X runs along the shopfront, with the entrance at the right end.
 * A cut through a hillside can leave the surveyed floor several metres above
 * the street. Each shop has a level threshold at its door and a plinth that
 * continues below grade across the display window. */
export function storefrontGrade(city: CityData, x: number, z: number, nx: number, nz: number, width: number) {
  const ground = (along: number, depth: number) =>
    sampleElevation(city, x + nz * along + nx * depth, z - nx * along + nz * depth);
  const door = width / 2 - .69;
  const threshold = Math.max(ground(door - .525, .43), ground(door, .43), ground(door + .525, .43)) + .04;
  let bottom = threshold;
  for (let i = 0; i <= 6; i++) {
    const along = width * (i / 6 - .5);
    bottom = Math.min(bottom, ground(along, 0), ground(along, .55));
  }
  return { threshold, bottom: bottom - .15 };
}
