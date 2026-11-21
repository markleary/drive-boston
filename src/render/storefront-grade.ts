import type { CityData, Road } from '../types';
import { deckEdge, deckEdgeElevation, deckEdgeGrounded, deckPlaneAt, roadProjection } from '../simulation/road-surfaces.ts';
import { sampleElevation } from '../simulation/terrain.ts';

/** The approach from a bridge must either stay on its deck or cross an edge
 * that meets the terrain. Use the same deck edges and drop test as its parapets. */
function frontageHeight(city: CityData, road: Road, x: number, z: number, door: boolean) {
  const ground = sampleElevation(city, x, z);
  if (!road.elevations) return ground;
  const deck = deckPlaneAt(road, x, z);
  if (deck && deck.outside < 1e-7) return Math.max(ground, deck.height);
  if (!door) return ground;
  const hit = roadProjection(road, x, z), i = hit.index;
  const a = road.points[i], b = road.points[i + 1];
  const side = (b[0] - a[0]) * (z - hit.z) - (b[1] - a[1]) * (x - hit.x) >= 0 ? 1 : -1;
  const start = deckEdge(road, i, side), end = deckEdge(road, i + 1, side);
  const edge = roadProjection({points: [start, end]}, x, z);
  const dx = end[0] - start[0], dz = end[1] - start[1], length = Math.hypot(dx, dz) || 1;
  const ox = -side * dz / length, oz = side * dx / length;
  const ya = deckEdgeElevation(road, i, side), yb = deckEdgeElevation(road, i + 1, side);
  if (!deckEdgeGrounded(city, edge.x, edge.z, ya + (yb - ya) * edge.t, ox, oz)) return undefined;
  return ground;
}

/** Local +X runs along the shopfront, with the entrance at the right end.
 * A cut through a hillside can leave the surveyed floor several metres above
 * the street. Each shop has a level threshold at its door and a plinth that
 * continues below grade across the display window. */
export function storefrontGrade(city: CityData, road: Road, x: number, z: number, nx: number, nz: number, width: number) {
  const height = (along: number, depth: number, door = false) =>
    frontageHeight(city, road, x + nz * along + nx * depth, z - nx * along + nz * depth, door);
  const door = width / 2 - .69;
  let threshold = -Infinity;
  for (const along of [door - .525, door, door + .525]) {
    const support = height(along, .43, true);
    if (support === undefined) return undefined;
    threshold = Math.max(threshold, support + .04);
  }
  let bottom = threshold;
  for (let i = 0; i <= 6; i++) {
    const along = width * (i / 6 - .5);
    bottom = Math.min(bottom, height(along, 0)!, height(along, .55)!);
  }
  return { threshold, bottom: bottom - .15 };
}
