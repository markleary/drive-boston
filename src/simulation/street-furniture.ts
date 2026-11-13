import type { CityData, Point2, Road } from '../types';
import type { MetroCity } from './city-tiles.ts';
import { mallGroundTest } from './commonwealth-mall.ts';
import { canopyHitsDeck, STREET_CANOPY } from './deck-canopy.ts';
import { drawnStreets, STALL_REACH, type DrawnStreets, type StreetTile } from './drawn-streets.ts';
import { inGreenway } from './greenway.ts';
import { openStretches } from './motorway.ts';
import type { RoadCells } from './road-cells.ts';
import { roadMidpoint } from './road-tile-coverage.ts';
import { roadWidthAt } from './road-surfaces.ts';
import { planStreetSigns, type PlacedStreetSign } from './street-signs.ts';
import { tileKey } from './tile-format.ts';
import { sampleElevation } from './terrain.ts';
import { inTransitCorridor } from './transit-corridors.ts';
import { inTunnelApproach } from './tunnels.ts';

/** Street trees and lamps, and the rule that stands them (and the name signs and the sidewalk walkers) beside the
 * roadway as the tiles draw it.
 *
 * A street's width in city.json is one number, the median of the roadway measured between its curbs, and its
 * centre line seldom runs down the middle of that roadway: a square's roadway is more than twice its street's
 * median (Newmarket Square, 21 m against 9.2 m), an avenue's carriageway lies to one side of the line that stands
 * for it (Blue Hill Avenue, Commonwealth Avenue in Allston), a street widens for a bay (Back Street). Trees set at
 * half the median plus two metres from the centre line stood in the asphalt there, 1,504 of them, with 993 lamps
 * and 222 name signs. So the verge is found on the drawn pavement itself (drawn-streets.ts): along the perpendicular
 * through a station, the road's own roadway is the paved stretch the centre line lies in, and the place is VERGE
 * beyond where that stretch ends, or midway to the next roadway where a median is narrower than two verges. A place
 * keeps its room to every roadway of the tile and stands in no parking stall.
 *
 * A tile knows its own ground only, so each station and side is planned by the tile its roadway ends in (which is
 * the tile of the station itself, or the next one when the border runs along the roadway), and a place keeps its
 * room inside that tile's border, sliding along the street where the border leaves it none: what a tile cannot see
 * it does not plant on. scripts/audit-street-furniture.mjs holds every tile of the installed package to the result. */
export interface StreetFurniture {
  trees: Point2[]; lamps: Point2[];
  /** Every place found for a tree (those a draw or a deck overhead left empty too) and every lamp: the sidewalk walkers keep clear of them all. */
  posts: Point2[];
}
export interface FurnitureHooks {
  /** Ground nothing is stood on: a building, a rail corridor, a tunnel approach, a landmark's forecourt. */
  occupied(x: number, z: number): boolean;
  /** Ground that plants its own trees (the lawns of the Commonwealth Avenue Mall): no street tree, nor the lamp of its station. */
  reserved?(x: number, z: number): boolean;
  /** Whether a street tree's crown at (x, z) would reach into a deck overhead. */
  shaded?(x: number, z: number): boolean;
  /** Draws in [0, 1), in the tile's own sequence. */
  random(): number;
}
/** A tree or a lamp stands this far beyond the roadway's edge. */
export const VERGE = 2;
/** The room a place keeps to every roadway: a tree's grate is 1.7 m square, a lamp or a sign is a post. */
export const TREE_ROOM = 1.2, LAMP_ROOM = .6, SIGN_ROOM = .4;
/** No roadway is followed farther than this from its centre line: pavement that runs on is a street leading away. */
const REACH = 36;
/** Where the pavement reaches this far beyond a street's nominal edge, it is looked at for another street's line. */
const WIDE = 1.5;

type Ribbon = { a: Point2; b: Point2; radius: number; road?: Road; raised: boolean };
/** The lines of the roads and footbridges about a tile, by what they are to a planter. */
export interface StreetRibbons {
  /** In the line of a raised deck, a tunnel record's open stretch or a footbridge (with .8 m to spare): those are not part of the drawn pavement. */
  raised(x: number, z: number): boolean;
  /** In the ribbon of any road or footbridge, by its median width (with .8 m to spare): all a tile without compiled pavement can tell. */
  any(x: number, z: number): boolean;
  /** In the nominal roadway of a surface street other than `road`. */
  crossing(x: number, z: number, road: Road): boolean;
}
export function streetRibbons(city: Pick<CityData, 'footbridges'>, roads: readonly Road[], bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): StreetRibbons {
  const cells = new Map<string, Ribbon[]>();
  const add = (ribbon: Ribbon) => {
    const { a, b, radius } = ribbon;
    for (let x = Math.floor((Math.min(a[0], b[0]) - radius) / 64); x <= Math.floor((Math.max(a[0], b[0]) + radius) / 64); x++) for (let z = Math.floor((Math.min(a[1], b[1]) - radius) / 64); z <= Math.floor((Math.max(a[1], b[1]) + radius) / 64); z++) { const k = `${x},${z}`, list = cells.get(k); if (list) list.push(ribbon); else cells.set(k, [ribbon]); }
  };
  for (const road of roads) if (!road.tunnel) for (let i = 1; i < road.points.length; i++) {
    // (a highway deck on the ground with a surveyed roadway beside its lanes keeps that whole roadway clear: its wider edge, either side)
    const edges = Math.max(0, ...(road.roadway?.[i - 1] ?? []), ...(road.roadway?.[i] ?? []));
    add({ a: road.points[i - 1], b: road.points[i], radius: Math.max((road.pavedWidth ?? road.width) / 2, edges) + .8, road, raised: !!road.elevations });
  }
  // Nor in the open stretch of a tunnel record: a highway's walled cut, or a ramp that has left the ground on its way
  // to a viaduct, drawn by the tunnel builder and no street pavement either way. A cut is `occupied` besides
  // (inTunnelApproach); a ramp over the ground is not, and two lamps stood up through the Central Artery's.
  for (const road of roads) if (road.tunnel) for (const line of openStretches(road)) for (let i = 1; i < line.length; i++) {
    add({ a: line[i - 1], b: line[i], radius: Math.max(roadWidthAt(road, ...line[i - 1]), roadWidthAt(road, ...line[i])) / 2 + .8, raised: true });
  }
  // A footbridge's line is no street, but nothing is planted or posted in its deck either (a ramp comes down along the edge of a street's roadway).
  for (const deck of city.footbridges ?? []) for (let i = 1; i < deck.points.length; i++) {
    const a = deck.points[i - 1], b = deck.points[i];
    if (Math.max(a[0], b[0]) < bounds.minX - 64 || Math.min(a[0], b[0]) > bounds.maxX + 64 || Math.max(a[1], b[1]) < bounds.minZ - 64 || Math.min(a[1], b[1]) > bounds.maxZ + 64) continue;
    add({ a, b, radius: deck.width / 2 + .8, raised: true });
  }
  const hit = (x: number, z: number, test: (ribbon: Ribbon) => number) => (cells.get(`${Math.floor(x / 64)},${Math.floor(z / 64)}`) ?? []).some(ribbon => {
    const reach = test(ribbon); if (!(reach > 0)) return false;
    const { a, b } = ribbon, dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz) < reach;
  });
  return {
    raised: (x, z) => hit(x, z, r => r.raised ? r.radius : 0), any: (x, z) => hit(x, z, r => r.radius),
    crossing: (x, z, road) => hit(x, z, r => r.raised || r.road === road ? 0 : r.radius - .8),
  };
}

/** Where a street's own roadway ends beside the station `at`, on the side the unit normal (nx, nz) points to: the
 * distance from the centre line to the end of the paved stretch the line lies in (`edge`), and to where the next
 * pavement begins beyond it (`next`, Infinity when the tile draws none within reach). `half` is half the street's
 * nominal width. Undefined where this tile has no verge to give: the roadway runs on past REACH, or into the next
 * tile within the street's nominal edge and a metre (that tile plants the side), the station lies in another tile and
 * the perpendicular does not come in on the roadway, no pavement is drawn at the station, or the pavement beyond the
 * street's nominal edge is another street's (`crossing`: a junction mouth, or the second carriageway of one
 * roadway, which has stations of its own). 'border' where the roadway runs out of the tile farther from the centre
 * line than that: no tile can tell where it ends. */
export function roadwayEdge(streets: DrawnStreets, at: Point2, nx: number, nz: number, half: number, crossing?: (x: number, z: number) => boolean): { edge: number; next: number } | 'border' | undefined {
  const { spans, known: [from, to] } = streets.spans(at[0], at[1], nx, nz, -(half + 1), REACH + 2 * VERGE);
  if (!(to > from)) return undefined;
  let own = -1;
  // The station stands in this tile: the stretch its centre line lies in, or the nearest within half the nominal
  // width where the line itself is unpaved (a centre line drawn along a curb). Otherwise the perpendicular must
  // come into this tile on the roadway, no farther from the centre line than the nominal edge and a metre.
  if (from <= 0) { let best = half; if (to >= 0) for (let i = 0; i < spans.length; i += 2) { const d = Math.max(spans[i], -spans[i + 1], 0); if (d <= best) { own = i; best = d; } } }
  else if (from <= half + 1 && spans.length && spans[0] - from < 1e-6) own = 0;
  if (own < 0) return undefined;
  const edge = spans[own + 1]; if (edge >= to - 1e-6) return to < REACH + 2 * VERGE - 1e-6 && to > half + 1 ? 'border' : undefined;
  if (edge > REACH) return undefined;
  if (crossing && edge > half + WIDE) for (let t = half + 1; t < edge; t += 1.5) if (crossing(at[0] + t * nx, at[1] + t * nz)) return undefined;
  return { edge, next: own + 2 < spans.length ? spans[own + 2] : Infinity };
}
/** Whether a post may stand at (x, z) with `room` to the roadway, as far as this tile can tell: in the tile with
 * that room to its border, no street pavement within the room, in no parking stall (half the room to spare), and
 * not on lot asphalt where a stall of the next tile could reach. */
export function postClear(streets: DrawnStreets, x: number, z: number, room: number) {
  const inset = streets.inset(x, z);
  return inset >= room - 1e-6 && !streets.near(x, z, room) && !streets.stall(x, z, room / 2) && !(inset < STALL_REACH + room / 2 && streets.lot(x, z, room / 2 + .05));
}
/** A place the tile's border denies is looked for this far along the street instead, nearest first. */
const SLIDES = [0, 3, -3, 6, -6];
/** The place beside the roadway for a station and side (see roadwayEdge): VERGE beyond the roadway's edge, or
 * midway to the next roadway where that is nearer than two verges, with `room` to both. A tile plants only where it
 * sees the ground all round: where its border lies within the room of that place, or between it and the roadway,
 * the place slides along the street to where it does. Undefined where there is none. */
export function vergePlace(streets: DrawnStreets, at: Point2, nx: number, nz: number, half: number, room: number, crossing?: (x: number, z: number) => boolean): Point2 | undefined {
  for (const slide of SLIDES) {
    const sx = at[0] + nz * slide, sz = at[1] - nx * slide, found = roadwayEdge(streets, slide ? [sx, sz] : at, nx, nz, half, crossing);
    if (!found) { if (slide) continue; return undefined; }
    if (found === 'border') continue;
    const { edge, next } = found, want = next - edge >= 2 * VERGE ? edge + VERGE : (edge + next) / 2, [lo, hi] = streets.within(sx, sz, nx, nz, room), t = Math.max(lo, Math.min(hi, want)), x = sx + t * nx, z = sz + t * nz;
    if (t === want) {
      // The ground itself: room between the two roadways, and no roadway or stall of the tile within it.
      if (!(want - edge >= room && next - want >= room) || streets.near(x, z, room) || streets.stall(x, z, room / 2)) { if (slide) continue; return undefined; }
      if (!(streets.inset(x, z) < STALL_REACH + room / 2 && streets.lot(x, z, room / 2 + .05))) return [x, z];
    } else if (t - edge >= room && next - t >= room && postClear(streets, x, z, room)) return [x, z];
    // (the border stands in the way: it lies within the room of the place or between it and the roadway, or a stall of the next tile could reach the place)
  }
  return undefined;
}

/** The street trees and lamps of one tile: a tree every 25 m on both verges of each street at least 7 m wide, a
 * lamp 5 m before it on one side. `roads` are the roads about the tile (80 m beyond it at least). Pauses between
 * roads. A tile that lists no compiled pavement keeps the survey build's rule: its own roads, by their ribbons. */
export function* streetFurnitureSteps(city: Pick<CityData, 'footbridges'>, tile: StreetTile, roads: readonly Road[], hooks: FurnitureHooks, ribbons = streetRibbons(city, roads, tileBounds(tile))): Generator<void, StreetFurniture> {
  const trees: Point2[] = [], lamps: Point2[] = [], posts: Point2[] = [], taken = new Set<string>(), streets = tile.streetPavement ? drawnStreets(tile) : undefined;
  const { minX, maxX, minZ, maxZ } = tileBounds(tile), planted = (x: number, z: number) => hooks.occupied(x, z) || !!hooks.reserved?.(x, z);
  const plant = (road: Road, p: Point2) => { posts.push(p); if ((!/Boylston/.test(road.name) || hooks.random() > .5) && !hooks.shaded?.(p[0], p[1])) trees.push(p); };
  for (const road of roads) {
    if (road.elevations || road.width < 7 || /alley|unnamed/i.test(road.name)) continue;
    const half = (road.pavedWidth ?? road.width) / 2;
    if (!streets) { const m = roadMidpoint(road); if (!(m[0] >= minX && m[0] < maxX && m[1] >= minZ && m[1] < maxZ)) continue; }
    yield;
    const crossing = (x: number, z: number) => ribbons.crossing(x, z, road);
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz); if (length < .1) continue;
      const tx = dx / length, tz = dz / length;
      for (let d = 14; d < length - 8; d += 25) for (const side of [-1, 1]) {
        const at: Point2 = [a[0] + tx * d, a[1] + tz * d], nx = -tz * side, nz = tx * side;
        if (streets) {
          if (streets.inset(at[0], at[1]) < -(half + 1)) continue;
          const p = vergePlace(streets, at, nx, nz, half, TREE_ROOM, crossing); if (!p) continue;
          const k = `${Math.round(p[0] / 8)},${Math.round(p[1] / 8)}`; if (planted(p[0], p[1]) || ribbons.raised(p[0], p[1]) || taken.has(k)) continue; taken.add(k);
          plant(road, p);
          // The lamp of a station stands on the same verge 5 m before it, by its own perpendicular, and not beside the tree where either has slid.
          const q = side === 1 ? vergePlace(streets, [at[0] - tx * 5, at[1] - tz * 5], nx, nz, half, LAMP_ROOM, crossing) : undefined;
          if (q && Math.hypot(q[0] - p[0], q[1] - p[1]) >= 3 && !ribbons.raised(q[0], q[1]) && !hooks.occupied(q[0], q[1])) { lamps.push(q); posts.push(q); }
        } else {
          const verge = half + VERGE, x = at[0] + nx * verge, z = at[1] + nz * verge, k = `${Math.round(x / 8)},${Math.round(z / 8)}`;
          if (planted(x, z) || ribbons.any(x, z) || taken.has(k)) continue; taken.add(k);
          plant(road, [x, z]);
          if (side === 1 && !ribbons.any(x - tx * 5, z - tz * 5) && !hooks.occupied(x - tx * 5, z - tz * 5)) { lamps.push([x - tx * 5, z - tz * 5]); posts.push([x - tx * 5, z - tz * 5]); }
        }
      }
    }
  }
  return { trees, lamps, posts };
}
const tileBounds = (tile: Pick<StreetTile, 'tx' | 'tz' | 'size'>) => ({ minX: tile.tx * tile.size, maxX: (tile.tx + 1) * tile.size, minZ: tile.tz * tile.size, maxZ: (tile.tz + 1) * tile.size });

export interface TileFurniture extends StreetFurniture { signs: PlacedStreetSign[] }
/** A tile's own sequence of draws in [0, 1), from its key: which of Boylston Street's places stay empty is the same on every visit. */
function tileDraws(key: string) {
  let n = 0; for (const c of key) n = Math.imul(n, 31) + c.charCodeAt(0) | 0;
  let seed = 342 + Math.abs(n) % 1000;
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
}
const mallLawns = new WeakMap<object, (x: number, z: number) => boolean>();
/** Everything stood beside the streets of one tile, as the tile builder plans it, so that a test or an audit plans
 * the same: the trees and lamps (streetFurnitureSteps) on ground that no building, rail corridor, tunnel approach,
 * Greenway parcel or landmark forecourt takes, off the lawns the Commonwealth Avenue Mall plants itself and clear
 * of the decks overhead, then the name signs of the tile's corners (planStreetSigns), each pole where the tile sees
 * no roadway, deck or stall. `forecourt`: the ground a landmark model paves for itself. */
export function* tileFurnitureSteps(city: MetroCity, tile: StreetTile, roads: RoadCells, forecourt?: (x: number, z: number) => boolean): Generator<void, TileFurniture> {
  const bounds = tileBounds(tile), grow = (m: number) => ({ minX: bounds.minX - m, maxX: bounds.maxX + m, minZ: bounds.minZ - m, maxZ: bounds.maxZ + m });
  const about = roads.near(grow(80)), ribbons = streetRibbons(city, about, bounds), streets = tile.streetPavement ? drawnStreets(tile) : undefined, parks = city.parks ?? [];
  let reserved = mallLawns.get(parks); if (!reserved) mallLawns.set(parks, reserved = mallGroundTest(parks));
  const occupied = (x: number, z: number) => !!(forecourt?.(x, z) || inGreenway(x, z) || inTransitCorridor(city, x, z) || inTunnelApproach(city, x, z) || city.index.at(x, z));
  const furniture = yield* streetFurnitureSteps(city, tile, about, { occupied, reserved, shaded: (x, z) => canopyHitsDeck(city, x, z, sampleElevation(city, x, z), STREET_CANOPY), random: tileDraws(tileKey(tile.tx, tile.tz)) }, ribbons);
  const signs = planStreetSigns(roads.near(grow(160)), (x, z) => !occupied(x, z) && (streets ? !ribbons.raised(x, z) && postClear(streets, x, z, SIGN_ROOM) : !ribbons.any(x, z)), (x, z) => x >= bounds.minX && x < bounds.maxX && z >= bounds.minZ && z < bounds.maxZ);
  return { ...furniture, signs, posts: [...furniture.posts, ...signs.map(sign => sign.position)] };
}
