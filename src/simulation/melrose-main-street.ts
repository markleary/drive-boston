import block from '../data/melrose-main-street.json' with { type: 'json' };
import type { Point2 } from '../types';

/** Local metres north from the intersection with Foster, then east toward the YMCA. */
const [ox, oz] = block.origin, [tx, tz] = block.north;
export const MAIN_STREET_HEADING = Math.atan2(tx, tz);
export const MAIN_STREET_CROSSING = 91.5;
export const MAIN_STREET_PARKLET = [65, 78] as const;
export function mainStreetPoint(station: number, east: number): Point2 {
  return [ox + tx * station - tz * east, oz + tz * station + tx * east];
}
export const mainStreetStation = (x: number, z: number) => (x - ox) * tx + (z - oz) * tz;
export const mainStreetEast = (x: number, z: number) => -(x - ox) * tz + (z - oz) * tx;
export const MAIN_STREET_TILE = block.tile;

function sidewalkPoints(east: readonly number[], west: readonly number[], beyondCurb: number) {
  return [east, west].flatMap((stations, i) => stations.map(s => mainStreetPoint(s, (i ? -1 : 1) * (block.curbOffset + beyondCurb))));
}

/** Fixtures between the side-street mouths and the two signalized corners. The tree grates need more clearance from the curb than the lampposts. */
export const mainStreetLamps = sidewalkPoints([12, 35, 61, 83, 109, 134, 154], [15, 39, 62, 84, 108, 132, 154], .78);
const streetTree = (station: number, side: 1 | -1, species: string, scale: number) => ({
  point: mainStreetPoint(station, side * (block.curbOffset + 1.36)), species, scale,
});
export const mainStreetPlantings = [
  streetTree(21, 1, 'October honey locust', .85), streetTree(43, 1, 'October elm', 1.04),
  streetTree(79, 1, 'October maple', .79), streetTree(119, 1, 'October honey locust', .71),
  streetTree(144, 1, 'October elm', 1.06), streetTree(24, -1, 'October elm', .93),
  streetTree(48, -1, 'October honey locust', .74), streetTree(75, -1, 'October maple', .9),
  streetTree(119, -1, 'October elm', 1.07), streetTree(146, -1, 'October maple', .95),
];
export const mainStreetTrees = mainStreetPlantings.map(tree => tree.point);
export const mainStreetCrossingPosts = [-1, 1].map(side => mainStreetPoint(MAIN_STREET_CROSSING - side * 1.6, 4.88 * side));
export function inMainStreetFurnishingArea([x, z]: Point2) {
  const station = mainStreetStation(x, z);
  return station > 7 && station < 158 && Math.abs(mainStreetEast(x, z)) < 9;
}
