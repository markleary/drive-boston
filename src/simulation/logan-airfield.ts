import type { Building, Point2 } from '../types';

/** Logan International Airport's airfield, as `airfield.json` ships it (scripts/logan_airfield.py): the runways by
 * the FAA's record of their ends, widths, displaced thresholds and marking classes, and the taxiways, aprons, stands,
 * jet bridges and parked aircraft from OpenStreetMap. Pavement comes compiled, in four layers that do not overlap,
 * per 1 km tile in centimetres from the tile's origin. Everything painted on it is planned here, from the runway
 * records, by the dimensions of FAA Advisory Circular 150/5340-1 (feet there, metres here): nothing in this file
 * draws, so node tests hold the plan. */
export type AirfieldLayer = 'runway' | 'taxiway' | 'apron' | 'shoulder';
export const AIRFIELD_LAYERS: AirfieldLayer[] = ['shoulder', 'apron', 'taxiway', 'runway'];
export type AircraftKind = 'wide' | 'narrow' | 'regional' | 'business';
export interface AirfieldRunwayEnd { name: string; /** The end of the pavement. */ point: Point2; /** Metres from that end to the landing threshold. */ displaced: number; marking: 'precision' | 'basic'; }
export interface AirfieldRunway { id: string; width: number; shoulder: number; grooved: boolean; ends: [AirfieldRunwayEnd, AirfieldRunwayEnd]; }
export interface AirfieldAircraft { stand: string; kind: AircraftKind; nose: Point2; /** Unit vector from tail to nose. */ heading: Point2; livery: number; }
export interface AirfieldBridge { ref: string; /** Flat x, z from the terminal to the head. */ line: number[]; docked: boolean; }
export interface AirfieldData {
  version: 1; name: string; icao: string; tileSize: number;
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  runways: AirfieldRunway[]; stopways: { line: number[]; width: number; bed: boolean }[];
  taxiLines: number[][]; standLines: number[][]; holds: { point: Point2; toward: Point2 }[];
  aircraft: AirfieldAircraft[]; jetBridges: AirfieldBridge[]; windsocks: Point2[];
  /** The airport's outline, and each passenger terminal's by name: flat x, z. */ outline: number[]; terminals: { name: string; ring: number[] }[];
  area: Record<AirfieldLayer, number>;
  tiles: Record<string, Partial<Record<AirfieldLayer, number[][][]>>>;
}
export function isAirfieldData(value: unknown): value is AirfieldData {
  const v = value as AirfieldData | undefined;
  return !!v && v.version === 1 && Array.isArray(v.runways) && typeof v.tiles === 'object' && typeof v.tileSize === 'number' && Array.isArray(v.aircraft);
}

const FT = .3048;
/** One tile's polygons of a layer in world metres: [polygon: [ring: [x, z]]], the outline first. */
export function airfieldPolygons(data: AirfieldData, key: string, layer: AirfieldLayer): Point2[][][] {
  const [tx, tz] = key.split('_').map(Number), x0 = tx * data.tileSize, z0 = tz * data.tileSize;
  return (data.tiles[key]?.[layer] ?? []).map(rings => rings.map(flat => { const ring: Point2[] = []; for (let i = 0; i < flat.length; i += 2) ring.push([x0 + flat[i] / 100, z0 + flat[i + 1] / 100]); return ring; }));
}

const inside = (ring: Point2[], x: number, z: number) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit; }
  return hit;
};
const pavers = new WeakMap<AirfieldData, (x: number, z: number) => AirfieldLayer | undefined>();
/** Which layer of the airfield's pavement, if any, lies under a point. Polygons are indexed by 50 m cell on first use. */
export function airfieldPaved(data: AirfieldData) {
  const cached = pavers.get(data); if (cached) return cached;
  const CELL = 50, cells = new Map<number, { layer: AirfieldLayer; rings: Point2[][] }[]>(), id = (cx: number, cz: number) => (cx + 4096) * 8192 + cz + 4096;
  for (const key of Object.keys(data.tiles)) for (const layer of AIRFIELD_LAYERS) for (const rings of airfieldPolygons(data, key, layer)) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of rings[0]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) { const k = id(cx, cz); let list = cells.get(k); if (!list) cells.set(k, list = []); list.push({ layer, rings }); }
  }
  const b = data.bounds;
  const test = (x: number, z: number) => {
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return undefined;
    for (const entry of cells.get(id(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) if (inside(entry.rings[0], x, z) && !entry.rings.slice(1).some(hole => inside(hole, x, z))) return entry.layer;
    return undefined;
  };
  pavers.set(data, test); return test;
}

/** A runway seen from one end: `u` runs down the runway from that end, `r` is to the pilot's right (x east, z south). */
export interface RunwayFrame { origin: Point2; u: Point2; r: Point2; length: number; }
export function runwayFrame(runway: AirfieldRunway, end: 0 | 1): RunwayFrame {
  const a = runway.ends[end].point, b = runway.ends[1 - end].point, length = Math.hypot(b[0] - a[0], b[1] - a[1]), u: Point2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  return { origin: a, u, r: [-u[1], u[0]], length };
}
const at = (f: RunwayFrame, along: number, across: number): Point2 => [f.origin[0] + f.u[0] * along + f.r[0] * across, f.origin[1] + f.u[1] * along + f.r[1] * across];
/** A rectangle in a runway's frame: from `a0` to `a1` along it, `c0` to `c1` across. */
const rect = (f: RunwayFrame, a0: number, a1: number, c0: number, c1: number): Point2[] => [at(f, a0, c0), at(f, a1, c0), at(f, a1, c1), at(f, a0, c1)];

// Strokes of the designation characters in a unit box: x across (the pilot's right), y up the runway.
const GLYPHS: Record<string, Point2[][]> = {
  '0': [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
  '1': [[[.5, 0], [.5, 1], [.18, .72]]],
  '2': [[[0, .78], [0, 1], [1, 1], [1, .58], [0, 0], [1, 0]]],
  '3': [[[0, 1], [1, 1], [1, 0], [0, 0]], [[.32, .53], [1, .53]]],
  '4': [[[.78, 0], [.78, 1], [0, .34], [1, .34]]],
  '5': [[[1, 1], [0, 1], [0, .56], [1, .56], [1, 0], [0, 0]]],
  '6': [[[1, 1], [0, 1], [0, 0], [1, 0], [1, .53], [0, .53]]],
  '7': [[[0, 1], [1, 1], [.34, 0]]],
  '8': [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], [[0, .53], [1, .53]]],
  '9': [[[1, .47], [0, .47], [0, 1], [1, 1], [1, 0], [0, 0]]],
  L: [[[0, 1], [0, 0], [1, 0]]], R: [[[0, 0], [0, 1], [1, 1], [1, .5], [0, .5]], [[.45, .5], [1, 0]]], C: [[[1, 1], [0, 1], [0, 0], [1, 0]]],
};
export const MARKING = {
  /** Threshold stripes: set back, length, width (also the gap between two). */ stripeSetback: 20 * FT, stripeLength: 150 * FT, stripe: 5.75 * FT,
  /** Designation: gap before it, character height, width, gap between two, stroke. */ numberGap: 40 * FT, numberHeight: 60 * FT, numberWidth: 20 * FT, numberSpace: 15 * FT, stroke: 4 * FT,
  /** Centre line: stripe, gap, width. */ dash: 120 * FT, dashGap: 80 * FT, centre: 3 * FT,
  /** Aiming point: from the threshold, length, width (30 ft on a 150 ft runway, 20 ft on a narrower one), half the clear width between the two. */ aim: 1020 * FT, aimLength: 150 * FT, aimWide: 30 * FT, aimNarrow: 20 * FT, inner: 36 * FT,
  /** Touchdown zone: spacing of the groups, bar length, width, gap. */ zone: 500 * FT, bar: 75 * FT, barWidth: 6 * FT, barGap: 5 * FT,
  /** Side stripes and the bar across a displaced threshold. */ side: 3 * FT, thresholdBar: 10 * FT,
  /** Arrows up to a displaced threshold: shaft, head, spacing. */ arrowShaft: 80 * FT, arrowHead: 40 * FT, arrowSpace: 200 * FT, arrowWidth: 1.5 * FT, headWidth: 15 * FT,
};
const strokeQuads = (f: RunwayFrame, along: number, across: number, w: number, h: number, char: string): Point2[][] => {
  const out: Point2[][] = [], t = MARKING.stroke / 2;
  for (const stroke of GLYPHS[char] ?? []) for (let i = 1; i < stroke.length; i++) {
    const ax = across + stroke[i - 1][0] * w, ay = along + stroke[i - 1][1] * h, bx = across + stroke[i][0] * w, by = along + stroke[i][1] * h, len = Math.hypot(bx - ax, by - ay); if (len < .01) continue;
    // Each stroke runs half its width past both ends, so corners close square.
    const dx = (bx - ax) / len, dy = (by - ay) / len, x0 = ax - dx * t, y0 = ay - dy * t, x1 = bx + dx * t, y1 = by + dy * t;
    out.push([at(f, y0 + dx * t, x0 - dy * t), at(f, y1 + dx * t, x1 - dy * t), at(f, y1 - dx * t, x1 + dy * t), at(f, y0 - dx * t, x0 + dy * t)]);
  }
  return out;
};

export interface AirfieldPaint { white: Point2[][]; yellow: Point2[][]; }
/** What stands in the middle of a marking decides whether another runway's pavement interrupts it. */
const centroid = (q: Point2[]): Point2 => [q.reduce((s, p) => s + p[0], 0) / q.length, q.reduce((s, p) => s + p[1], 0) / q.length];
const onRunway = (runway: AirfieldRunway, p: Point2, margin = 0) => {
  const f = runwayFrame(runway, 0), dx = p[0] - f.origin[0], dz = p[1] - f.origin[1], along = dx * f.u[0] + dz * f.u[1], across = dx * f.r[0] + dz * f.r[1];
  return along > -margin && along < f.length + margin && Math.abs(across) < runway.width / 2 + margin;
};
/** A runway's rank where two cross: the markings of the higher one run through, the other's stop at its edge
 * (precision before basic, then the longer). */
export const runwayRank = (runway: AirfieldRunway) => (runway.ends.some(e => e.marking === 'precision') ? 1e6 : 0) + runwayFrame(runway, 0).length;

/** One runway's paint, both ends, with nothing left out for the runways it crosses (see `airfieldPaint`). */
export function runwayMarkings(runway: AirfieldRunway): Point2[][] {
  const M = MARKING, quads: Point2[][] = [], half = runway.width / 2, wide = runway.width > 40, far: number[] = [];
  for (const end of [0, 1] as const) {
    const f = runwayFrame(runway, end), e = runway.ends[end], t = e.displaced;
    if (t > 0) {
      // A displaced threshold: a bar across the runway, arrowheads before it, arrows up the centre line to them.
      quads.push(rect(f, t - M.thresholdBar, t, -half, half));
      const heads = wide ? 4 : 3, pitch = runway.width / heads;
      for (let i = 0; i < heads; i++) { const c = -half + pitch * (i + .5), base = t - M.thresholdBar - 1.5; quads.push([at(f, base, c), at(f, base - M.arrowHead, c - M.headWidth / 2), at(f, base - M.arrowHead + 2.2, c), at(f, base - M.arrowHead, c + M.headWidth / 2)]); }
      for (let a = t - M.thresholdBar - M.arrowHead - 12; a - M.arrowShaft - M.arrowHead > 8; a -= M.arrowSpace) {
        quads.push(rect(f, a - M.arrowHead - M.arrowShaft, a - M.arrowHead + 1, -M.arrowWidth / 2, M.arrowWidth / 2));
        quads.push([at(f, a, 0), at(f, a - M.arrowHead, -M.headWidth / 2), at(f, a - M.arrowHead + 2.2, 0), at(f, a - M.arrowHead, M.headWidth / 2)]);
      }
    }
    // Threshold stripes: twelve on a 150 ft runway, eight on a 100 ft one, the middle left clear.
    const perSide = wide ? 6 : 4, s0 = t + M.stripeSetback, s1 = s0 + M.stripeLength;
    for (const side of [-1, 1]) for (let i = 0; i < perSide; i++) { const c0 = M.stripe + i * 2 * M.stripe; quads.push(rect(f, s0, s1, side * c0, side * (c0 + M.stripe))); }
    // The designation, read from the approach: the letter nearer the threshold, the number beyond it.
    const digits = e.name.replace(/[LRC]$/, ''), letter = e.name.slice(digits.length); let along = s1 + M.numberGap;
    if (letter) { quads.push(...strokeQuads(f, along, -M.numberWidth / 2, M.numberWidth, M.numberHeight, letter)); along += M.numberHeight + M.numberGap / 2; }
    const total = digits.length * M.numberWidth + (digits.length - 1) * M.numberSpace;
    [...digits].forEach((d, i) => quads.push(...strokeQuads(f, along, -total / 2 + i * (M.numberWidth + M.numberSpace), M.numberWidth, M.numberHeight, d)));
    along += M.numberHeight; far.push(along + M.numberGap);
    // Aiming point, and on a precision runway the touchdown zone's groups of three, two and one bars.
    const room = f.length - t - runway.ends[1 - end].displaced;
    if (room >= 4200 * FT) { const w = wide ? M.aimWide : M.aimNarrow; for (const side of [-1, 1]) quads.push(rect(f, t + M.aim, t + M.aim + M.aimLength, side * M.inner, side * (M.inner + w))); }
    if (e.marking === 'precision') [3, 0, 2, 2, 1, 1].forEach((bars, i) => {
      const a = t + M.zone * (i + 1); if (!bars || a + M.bar > t + room / 2 - 900 * FT / 2) return;
      for (const side of [-1, 1]) for (let b = 0; b < bars; b++) { const c0 = M.inner + b * (M.barWidth + M.barGap); quads.push(rect(f, a, a + M.bar, side * c0, side * (c0 + M.barWidth))); }
    });
  }
  // Centre line between the two designations, and a stripe down each side for the runway's whole length.
  const f = runwayFrame(runway, 0), from = far[0], to = f.length - far[1], pitch = M.dash + M.dashGap, count = Math.max(1, Math.floor((to - from + M.dashGap) / pitch)), start = (from + to) / 2 - (count * pitch - M.dashGap) / 2;
  for (let i = 0; i < count; i++) quads.push(rect(f, start + i * pitch, start + i * pitch + M.dash, -M.centre / 2, M.centre / 2));
  for (const side of [-1, 1]) for (let a = 0; a < f.length; a += 60) quads.push(rect(f, a, Math.min(f.length, a + 60), side * (half - M.side), side * half));
  return quads;
}

/** Yellow chevrons on a blast pad or stopway: each a V across the pavement with its point toward the runway. */
export function stopwayChevrons(line: number[], width: number, runways: AirfieldRunway[]): Point2[][] {
  let a: Point2 = [line[0], line[1]], b: Point2 = [line[2], line[3]];
  const near = (p: Point2) => Math.min(...runways.flatMap(r => r.ends.map(e => Math.hypot(e.point[0] - p[0], e.point[1] - p[1]))));
  if (near(b) < near(a)) [a, b] = [b, a];
  // `a` is the runway's end of the pad: chevrons point at it.
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]); if (length < 20) return [];
  const f: RunwayFrame = { origin: a, u: [(b[0] - a[0]) / length, (b[1] - a[1]) / length], r: [-(b[1] - a[1]) / length, (b[0] - a[0]) / length], length }, half = width / 2, w = 3 * FT, out: Point2[][] = [];
  for (let s = 15; s + half * .6 < length; s += 30) for (const side of [-1, 1]) out.push([at(f, s, 0), at(f, s + w * 1.4, 0), at(f, s + half * .6 + w * 1.4, side * half), at(f, s + half * .6, side * half)]);
  return out;
}

/** A line of constant width as quads, one a segment, cut into pieces of `piece` metres at most. */
export function lineQuads(flat: number[], width: number, piece = 40): Point2[][] {
  const out: Point2[][] = [], h = width / 2;
  for (let i = 2; i < flat.length; i += 2) {
    const ax = flat[i - 2], az = flat[i - 1], bx = flat[i], bz = flat[i + 1], len = Math.hypot(bx - ax, bz - az); if (len < .05) continue;
    const tx = (bx - ax) / len, tz = (bz - az) / len, n = Math.max(1, Math.ceil(len / piece));
    for (let k = 0; k < n; k++) {
      // Segments overlap by the half width so a bend leaves no notch.
      const s0 = len * k / n - (k === 0 ? h : 0), s1 = len * (k + 1) / n + (k === n - 1 ? h : 0);
      out.push([[ax + tx * s0 - tz * h, az + tz * s0 + tx * h], [ax + tx * s1 - tz * h, az + tz * s1 + tx * h], [ax + tx * s1 + tz * h, az + tz * s1 - tx * h], [ax + tx * s0 + tz * h, az + tz * s0 - tx * h]]);
    }
  }
  return out;
}

export const TAXI_LINE = .3, HOLD_WIDTH = 22.86, HOLD_LINE = .45;
/** A runway holding position across a taxiway: two solid lines on the side aircraft wait on, two dashed ones toward the runway. */
export function holdMarking(point: Point2, toward: Point2): Point2[][] {
  const f: RunwayFrame = { origin: point, u: toward, r: [-toward[1], toward[0]], length: 0 }, half = HOLD_WIDTH / 2, out: Point2[][] = [];
  for (let i = 0; i < 4; i++) {
    const a0 = -1.6 + i * HOLD_LINE * 2;
    if (i < 2) out.push(rect(f, a0, a0 + HOLD_LINE, -half, half));
    else for (let c = -half; c < half - .1; c += 1.8) out.push(rect(f, a0, a0 + HOLD_LINE, c, Math.min(half, c + .9)));
  }
  return out;
}

/** Tyre rubber on a runway's touchdown zones, as two nested patches an end (the inner one drawn over the outer): the
 * dark streaks that mark where aircraft land. A basic end, where few land, has the outer patch alone. */
export function rubberPatches(runway: AirfieldRunway): [Point2[][], Point2[][]] {
  const outer: Point2[][] = [], inner: Point2[][] = [];
  for (const end of [0, 1] as const) {
    const f = runwayFrame(runway, end), t = runway.ends[end].displaced, room = f.length - t - runway.ends[1 - end].displaced; if (room < 1500) continue;
    const w = runway.width > 40 ? 8.5 : 6;
    outer.push(rect(f, t + 130, t + 880, -w, w)); if (runway.ends[end].marking === 'precision') inner.push(rect(f, t + 260, t + 640, -w * .62, w * .62));
  }
  return [outer, inner];
}

const paints = new WeakMap<AirfieldData, Map<string, AirfieldPaint>>();
/** All the airfield's paint, filed by the tile each mark's middle lies in. Where two runways cross, the lower ranked
 * one's marks stop at the other's edge, and no runway's side stripe crosses another runway. */
export function airfieldPaint(data: AirfieldData): Map<string, AirfieldPaint> {
  const cached = paints.get(data); if (cached) return cached;
  const tiles = new Map<string, AirfieldPaint>(), size = data.tileSize, paved = airfieldPaved(data);
  const file = (kind: keyof AirfieldPaint, quad: Point2[]) => {
    const c = centroid(quad), key = `${Math.floor(c[0] / size)}_${Math.floor(c[1] / size)}`; let tile = tiles.get(key); if (!tile) tiles.set(key, tile = { white: [], yellow: [] });
    tile[kind].push(quad);
  };
  for (const runway of data.runways) {
    const rank = runwayRank(runway), over = data.runways.filter(o => o !== runway && runwayRank(o) > rank), others = data.runways.filter(o => o !== runway), half = runway.width / 2, f = runwayFrame(runway, 0);
    for (const quad of runwayMarkings(runway)) {
      const c = centroid(quad), across = Math.abs((c[0] - f.origin[0]) * f.r[0] + (c[1] - f.origin[1]) * f.r[1]), side = across > half - MARKING.side - .05;
      if ((side ? others : over).some(o => onRunway(o, c, side ? 0 : 2)) || quad.some(p => !paved(p[0], p[1]))) continue;
      file('white', quad);
    }
  }
  for (const pad of data.stopways) if (!pad.bed) for (const quad of stopwayChevrons(pad.line, pad.width, data.runways)) if (quad.every(p => paved(p[0], p[1])) && !data.runways.some(r => onRunway(r, centroid(quad)))) file('yellow', quad);
  for (const line of [...data.taxiLines, ...data.standLines]) for (const quad of lineQuads(line, TAXI_LINE)) if (paved(...centroid(quad))) file('yellow', quad);
  for (const hold of data.holds) for (const quad of holdMarking(hold.point, hold.toward)) if (paved(...centroid(quad)) && !data.runways.some(r => onRunway(r, centroid(quad)))) file('yellow', quad);
  paints.set(data, tiles); return tiles;
}

/** The generic aircraft types parked on the field (metres; no airline's markings): fuselage length and diameter,
 * wing span, the tail's height over the ground, and the height of the fuselage's centre line. */
export const AIRCRAFT: Record<AircraftKind, { length: number; span: number; body: number; tail: number; axis: number; engines: 'wing' | 'tail'; sweep: number }> = {
  wide: { length: 63.7, span: 60.3, body: 5.64, tail: 16.9, axis: 5.2, engines: 'wing', sweep: .56 },
  narrow: { length: 37.6, span: 35.8, body: 3.95, tail: 11.8, axis: 3.7, engines: 'wing', sweep: .47 },
  regional: { length: 31.7, span: 28.7, body: 3.0, tail: 9.9, axis: 3.0, engines: 'wing', sweep: .42 },
  business: { length: 20.9, span: 19.5, body: 2.2, tail: 6.2, axis: 2.1, engines: 'tail', sweep: .5 },
};
/** Tail schemes: [tail and engine colour, cheat line or belly colour]. Fictional: no carrier's livery is reproduced. */
export const LIVERIES: [string, string][] = [['#1d3f7a', '#c9342c'], ['#b3262b', '#2a2f3a'], ['#1f6f8f', '#e8e6df'], ['#243a5e', '#c9a13a'], ['#2e7d4f', '#e8e6df'], ['#6a2c70', '#d98c2b'], ['#d4692a', '#2a2f3a'], ['#3b4a57', '#8fb3c9'], ['#0f5e5a', '#d94f3d']];

/** Boxes that stand in for a parked aircraft in collision: [centre along the fuselage from the nose, centre height, length, height, width]. */
export function aircraftSolids(kind: AircraftKind): { along: number; y: number; length: number; height: number; width: number }[] {
  const a = AIRCRAFT[kind];
  return [
    { along: a.length / 2, y: a.axis, length: a.length * .96, height: a.body, width: a.body },
    { along: a.length * .47, y: a.axis - a.body * .28, length: a.length * .13, height: a.body * .3, width: a.span * .94 },
    { along: a.length * .93, y: (a.axis + a.tail) / 2, length: a.length * .12, height: a.tail - a.axis, width: .6 },
  ];
}

// The surveyed buildings on the airport, by how they are finished (src/render/logan-terminals.ts paints them).
export const LOGAN_COMPLEX = 'BOS-4WO5X-6OJI5-G5S26', LOGAN_TOWER = 'BOS-9RWEZ-5RETH-SGNJP';
/** Terminal E's extension is the part of its outline west of this x (metres; measured on the packaged shell, where the curved concourse begins). */
export const E_EXTENSION = 4418;
const KEEP_HEIGHT = 24, HANGAR_AREA = 2500;
export type LoganFinish = 'terminal' | 'garage' | 'tower' | 'hangar' | 'shed';
export type LoganPart = LoganFinish | 'roof' | 'red-roof' | 'deck';

const inRing = (flat: number[], x: number, z: number) => {
  let hit = false;
  for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) if ((flat[i + 1] > z) !== (flat[j + 1] > z) && x < (flat[j] - flat[i]) * (z - flat[i + 1]) / (flat[j + 1] - flat[i + 1]) + flat[i]) hit = !hit;
  return hit;
};
const area = (ring: Point2[]) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]; return Math.abs(a) / 2; };
/** How a building on the airport is finished, or undefined for one that is not on it or keeps its ordinary facade. */
export function loganRole(airfield: AirfieldData | undefined, building: Building | undefined): 'complex' | LoganFinish | undefined {
  if (!airfield?.outline || !building) return undefined;
  if (building.id === LOGAN_COMPLEX) return 'complex';
  if (building.id === LOGAN_TOWER) return 'tower';
  if (!inRing(airfield.outline, building.center[0], building.center[1]) || building.height > KEEP_HEIGHT) return undefined;
  return area(building.footprint) >= HANGAR_AREA && building.height >= 9 ? 'hangar' : 'shed';
}
/** Which part of the terminal complex a point of its shell belongs to. */
export function loganComplexPart(airfield: AirfieldData, x: number, z: number, isRoof: boolean): LoganPart {
  const terminal = airfield.terminals.find(t => inRing(t.ring, x, z));
  if (!terminal) return isRoof ? 'deck' : 'garage';
  if (!isRoof) return 'terminal';
  return terminal.name === 'Terminal E' && x < E_EXTENSION ? 'red-roof' : 'roof';
}

