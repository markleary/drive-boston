import type { Point2, Road } from '../types';
import { pavementSpan, polylineLength, roadwaySpan, stationAlong } from './tile-format.ts';

/** Where tile-builder.ts stripes crosswalks.
 *
 * A crosswalk belongs to a junction: the end of a road where other streets meet it, placed just beyond the roadway
 * of the streets it crosses. Striping every road end a fixed 8 m along the line (the survey build) put stripes at
 * dead ends, at the splits inside a street (OpenStreetMap ways change attributes mid-block; a twin carriageway
 * splits at each side street of its own side) and, where a side street meets a 28 m roadway, inside that roadway,
 * where they read as a crosswalk lying along the main street (Broadway Place at Broadway in Somerville).
 *
 * Rules: the station sits `CROSSWALK_SETBACK` beyond the farthest crossing roadway edge the road leaves at the
 * node (measured from the crossing street's pavement record where this tile has it, its median width otherwise).
 * A road that ends at the node (the stem of a T, a side street's mouth) is striped across; a road that continues
 * through the node is striped only where a comparable street (`COMPARABLE` of its nominal width, the class guess)
 * meets it or a traffic signal stands within `SIGNAL_REACH`. Alleys, unnamed ways and ramps never justify a
 * crosswalk and are never striped. Crosswalks on one roadway closer than `MIN_SPACING` keep the one at the signal,
 * then the stem, then the wider cross street: the two carriageways of a divided street split at different nodes and
 * would stripe the shared asphalt twice; the two sides of one junction are never thinned against each other. */
export const CROSSWALK_SETBACK = 1, STRIPE_LENGTH = 3, MIN_SPACING = 12, COMPARABLE = .75, SIGNAL_REACH = 25, MIN_ROAD = 18, MIN_WIDTH = 7;
export const NO_CROSSWALK = /alley|unnamed/i;

export interface Leg { road: Road; tx: number; tz: number }
export interface JunctionIndex { legsAt(p: Point2): Leg[]; signalNear(p: Point2): boolean }
export interface Edges { left: Point2[]; right: Point2[] }
export interface Crosswalk { road: Road; /** The junction vertex the crosswalk belongs to. */ node: Point2; at: Point2; tx: number; tz: number; span: [number, number]; priority: number }

const cell = (x: number, z: number) => `${Math.round(x)}:${Math.round(z)}`;
/** The unit direction from vertex `i` toward the vertex 4 m along the line (or the line's end) in direction `step`. */
function bearing(points: Point2[], i: number, step: 1 | -1): [number, number] | undefined {
  const [x0, z0] = points[i]; let j = i + step, walked = 0;
  while (j >= 0 && j < points.length) { walked += Math.hypot(points[j][0] - points[j - step][0], points[j][1] - points[j - step][1]); if (walked >= 4) break; j += step; }
  j = Math.max(0, Math.min(points.length - 1, j)); const l = Math.hypot(points[j][0] - x0, points[j][1] - z0);
  return l < .5 ? undefined : [(points[j][0] - x0) / l, (points[j][1] - z0) / l];
}

/** Whether `p` lies between a record's edges at the station of `line` nearest to it. */
function insideRecord(edges: Edges, line: Point2[], p: Point2): boolean {
  let best = Infinity, at: Point2 = line[0], tx = 1, tz = 0;
  for (let i = 1; i < line.length; i++) {
    const [x0, z0] = line[i - 1], dx = line[i][0] - x0, dz = line[i][1] - z0, l2 = dx * dx + dz * dz; if (!l2) continue;
    const u = Math.max(0, Math.min(1, ((p[0] - x0) * dx + (p[1] - z0) * dz) / l2)), x = x0 + dx * u, z = z0 + dz * u, d = Math.hypot(p[0] - x, p[1] - z);
    if (d < best) { best = d; at = [x, z]; const l = Math.sqrt(l2); tx = dx / l; tz = dz / l; }
  }
  let span = pavementSpan(edges, at, tx, tz);
  if (!span) {
    // At an end of the line the edges may begin a little in: take the station 1.5 m inside the nearer end.
    const s = [stationAlong(line, 1.5), stationAlong([...line].reverse(), 1.5)].filter(s => s !== undefined).sort((a, b) => Math.hypot(a.at[0] - p[0], a.at[1] - p[1]) - Math.hypot(b.at[0] - p[0], b.at[1] - p[1]))[0];
    if (!s) return false; ({ at, tx, tz } = s); span = pavementSpan(edges, at, tx, tz); if (!span) return false;
  }
  const off = (p[1] - at[1]) * tx - (p[0] - at[0]) * tz; return off > span[0] - .3 && off < span[1] + .3;
}

/** Every road vertex, so a street that ends on another's mid-vertex (half the T junctions are not split) still finds it.
 * Built in steps (a yield every 400 roads) so the first tile build can pace the whole metro's 20k roads across frames. */
export function* junctionIndexSteps(roads: Road[], signals: Point2[]): Generator<void, JunctionIndex> {
  const legs = new Map<string, { p: Point2; legs: Leg[] }[]>(), lights = new Map<string, Point2[]>();
  const put = (p: Point2, leg: Leg) => { const k = cell(p[0], p[1]); let list = legs.get(k); if (!list) legs.set(k, list = []); let node = list.find(n => Math.hypot(n.p[0] - p[0], n.p[1] - p[1]) < .5); if (!node) list.push(node = { p, legs: [] }); node.legs.push(leg); };
  for (const [i, road] of roads.entries()) {
    if (i % 400 === 399) yield;
    for (let j = 0; j < road.points.length; j++) for (const step of [1, -1] as const) { const t = bearing(road.points, j, step); if (t) put(road.points[j], { road, tx: t[0], tz: t[1] }); }
  }
  for (const s of signals) { const k = cell(s[0] / SIGNAL_REACH, s[1] / SIGNAL_REACH); let list = lights.get(k); if (!list) lights.set(k, list = []); list.push(s); }
  return {
    legsAt(p) { const out: Leg[] = []; for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const n of legs.get(cell(p[0] + dx, p[1] + dz)) ?? []) if (Math.hypot(n.p[0] - p[0], n.p[1] - p[1]) < 1) out.push(...n.legs); return out; },
    signalNear(p) { for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const s of lights.get(cell(p[0] / SIGNAL_REACH + dx, p[1] / SIGNAL_REACH + dz)) ?? []) if (Math.hypot(s[0] - p[0], s[1] - p[1]) <= SIGNAL_REACH) return true; return false; },
  };
}

/** The whole index at once, for tests and tools. */
export function junctionIndex(roads: Road[], signals: Point2[]): JunctionIndex {
  const steps = junctionIndexSteps(roads, signals); let r = steps.next(); while (!r.done) r = steps.next(); return r.value;
}

/** A road leaving a junction vertex in one direction, seen from the node: how far along it the crossing roadways reach,
 * and whether to stripe there. `points` starts at the node. */
function roadEnd(road: Road, points: Point2[], index: JunctionIndex, edgesOf: (road: Road) => Edges | undefined) {
  const n = points[0], t = bearing(points, 0, 1); if (!t) return undefined;
  const legs = index.legsAt(n).filter(l => !(l.road === road && l.tx * t[0] + l.tz * t[1] > .9));
  if (!legs.length) return undefined;
  const dots = legs.map(l => l.tx * t[0] + l.tz * t[1]);
  let through = legs.filter((_, i) => dots[i] < -.866);
  if (!through.length) { const i = dots.indexOf(Math.min(...dots)); if (dots[i] < -.5 && legs.length > 1) through = [legs[i]]; }
  const crossing = legs.filter(l => !through.includes(l)); if (!crossing.length) return undefined;
  let reach = 0;
  for (const b of crossing) {
    // A connector shorter than a block (the stub joining twin carriageways) measures its width to the roadway it lies in.
    const edges = polylineLength(b.road.points) >= MIN_ROAD ? edgesOf(b.road) : undefined;
    if (edges) {
      // Walk out along the road until it has left the crossing record: a fork's asphalt widens past the node
      // (Washington Street splitting at Marginal Road), so the span at the node alone would stop short.
      let d = 0, outside = 0;
      for (let s = .5; s < 30 && outside < 3; s += 1) { const st = stationAlong(points, s); if (!st) break; if (insideRecord(edges, b.road.points, st.at)) { d = s + .5; outside = 0; } else outside++; }
      reach = Math.max(reach, d);
    } else {
      const c = -t[0] * b.tz + t[1] * b.tx; if (Math.abs(c) < .1) continue;
      reach = Math.max(reach, Math.min(30, (b.road.pavedWidth ?? b.road.width) / 2 / Math.abs(c)));
    }
  }
  const streets = crossing.filter(b => !NO_CROSSWALK.test(b.road.name) && !b.road.elevations && b.road.width >= 5);
  const signal = index.signalNear(n), widest = Math.max(0, ...streets.map(b => b.road.width));
  const stripe = streets.length > 0 && (!through.length || signal || widest >= COMPARABLE * road.width);
  return { reach, offset: reach + CROSSWALK_SETBACK, stripe, priority: (signal ? 100 : 0) + (through.length ? 0 : 10) + widest };
}

/** The crosswalks of `roads`, thinned along each roadway. `edgesOf` gives a road's pavement record edges where the tile
 * holds them (own or border); `others` are every record's edges for `roadwaySpan`. Deterministic for a given road order. */
export function planCrosswalks(roads: Road[], index: JunctionIndex, edgesOf: (road: Road) => Edges | undefined, others: Edges[]): Crosswalk[] {
  const candidates: Crosswalk[] = [];
  for (const road of roads) {
    if (road.elevations || road.width < MIN_WIDTH || NO_CROSSWALK.test(road.name)) continue;
    const points = road.points, last = points.length - 1; if (polylineLength(points) < MIN_ROAD) continue;
    // Junction vertices: both ends, and every mid-vertex another road reaches (OpenStreetMap ways are not split at every T).
    const junctions = [0, ...points.slice(1, last).map((p, i) => i + 1).filter(i => index.legsAt(points[i]).some(l => l.road !== road)), last];
    const ends = junctions.map(i => ({ i, forward: i < last ? roadEnd(road, points.slice(i), index, edgesOf) : undefined, back: i > 0 ? roadEnd(road, points.slice(0, i + 1).reverse(), index, edgesOf) : undefined }));
    for (let j = 0; j < ends.length; j++) for (const dir of ['forward', 'back'] as const) {
      const end = ends[j][dir]; if (!end?.stripe) continue;
      const next = ends[dir === 'forward' ? j + 1 : j - 1], seq = dir === 'forward' ? points.slice(ends[j].i, next.i + 1) : points.slice(next.i, ends[j].i + 1).reverse();
      // The stripes must end before the next junction's crossing roadway along the block.
      const far = next[dir === 'forward' ? 'back' : 'forward']?.reach ?? 0, block = polylineLength(seq);
      if (end.offset + STRIPE_LENGTH + far > block) continue;
      const station = stationAlong(seq, end.offset); if (!station) continue;
      const { at, tx, tz } = station, edges = edgesOf(road), width = road.pavedWidth ?? road.width;
      const span = roadwaySpan((edges && pavementSpan(edges, at, tx, tz)) ?? [-width / 2, width / 2], others, at, tx, tz);
      candidates.push({ road, node: points[ends[j].i], at, tx, tz, span, priority: end.priority });
    }
  }
  candidates.sort((a, b) => b.priority - a.priority || (b.span[1] - b.span[0]) - (a.span[1] - a.span[0]));
  const kept: Crosswalk[] = [];
  const center = (c: Crosswalk): Point2 => [c.at[0] + c.tx * STRIPE_LENGTH / 2, c.at[1] + c.tz * STRIPE_LENGTH / 2];
  for (const c of candidates) {
    const cc = center(c), crowded = kept.some(k => {
      // The two sides of one junction are both wanted however narrow the cross street (a signal at a 5 m lane).
      if (Math.hypot(k.node[0] - c.node[0], k.node[1] - c.node[1]) < 1) return false;
      const dot = k.tx * c.tx + k.tz * c.tz; if (Math.abs(dot) < .8) return false;
      const kc = center(k), dx = kc[0] - cc[0], dz = kc[1] - cc[1]; if (Math.abs(dx * c.tx + dz * c.tz) >= MIN_SPACING) return false;
      const n = -dx * c.tz + dz * c.tx, lo = dot > 0 ? n + k.span[0] : n - k.span[1], hi = dot > 0 ? n + k.span[1] : n - k.span[0];
      return Math.min(hi, c.span[1]) - Math.max(lo, c.span[0]) > 2;
    });
    if (!crowded) kept.push(c);
  }
  return kept;
}
