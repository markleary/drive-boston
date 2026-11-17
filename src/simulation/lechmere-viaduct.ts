import type { CityData } from '../types';
import { sampleElevation } from './terrain.ts';

/** The Lechmere Viaduct (Boston Elevated Railway, 1907 to 1912): the concrete arch bridge that carries the Green Line
 * beside Charles River Dam Road from Science Park station to East Cambridge. Twelve spans over 518 m, counted from
 * Boston: ten concrete arches, the third span a steel draw over the old lock, the twelfth a girder span over
 * Charlestown Avenue. The alignment is the line midway between the two mapped tracks; span lengths, heights and
 * every detail are an interpretation from photographs, not a survey. No trains run on it yet. */

/** Midway between the two Green Line tracks (OpenStreetMap ways 822621506, 1498089327, 822621503 and 808229777, and
 * their twins 50266184, 1498089328, 822621505 and 822621504), from the middle of Science Park/West End toward Lechmere. */
export const LECHMERE_TRACKS: readonly (readonly [number, number])[] = [[590.08, -1834.16], [571.96, -1846.64], [523.06, -1879.66], [356.07, -1993.32], [106.87, -2162.15], [69.42, -2187.13], [-13.54, -2241.15]];

/** Stations are metres along `LECHMERE_TRACKS`. The surveyed station building ends at `START`; `RAIL` is the top of
 * rail, a hand under the station's 9.4 m platforms; the structure is `HALF` wide each side of the line. */
export const START = 40.5, LENGTH = 518, RAIL = 9.2, DECK = 9, HALF = 4.75, TRACK = 1.885;
export const CORNICE = 8.45, CROWN = 7.55, SPRING = -2.2, FOOT = -4.2, PARAPET = 10.05;

/** The surveyed shell of Science Park/West End station: the viaduct starts where it ends, and it is finished as concrete. */
export const SCIENCE_PARK_STATION = 'BOS-OY1MK-AR3KZ-OOA7P';
/** The survey's shell of the tower at the draw span (first footprint vertex, for its far box): replaced by the viaduct's own. */
export const VIADUCT_TOWER = { id: 'BOS-8O3D0-Z5MGC-U6HBR', first: [456.111, -1915.217] as [number, number], top: 17.3 };

/** The fence along the dam: stations and its offset toward the road. */
export const FENCE = { from: 86, to: 322, across: -7 };

export type SpanKind = 'arch' | 'draw' | 'girder';
export interface ViaductSpan { kind: SpanKind; from: number; to: number; spring: number; crown: number; }
export interface ViaductPier { from: number; to: number; kind: 'pier' | 'abutment' | 'draw'; }
export interface ViaductLayout { spans: ViaductSpan[]; piers: ViaductPier[]; start: number; end: number; }

const PIER = 5, DRAW_PIER = 6, ARCH = 41.25;

/** Spans and piers in order from Boston. The first arch is flat and springs high, over both roadways of Nashua Street; the draw's far pier is where
 * the survey has the bridge's tower; Museum Way passes under the crown of the tenth span. */
export function viaductLayout(): ViaductLayout {
  const spans: ViaductSpan[] = [], piers: ViaductPier[] = [], arch = (from: number, to: number, spring = SPRING): ViaductSpan => ({ kind: 'arch', from, to, spring, crown: CROWN });
  piers.push({ from: START, to: 43, kind: 'abutment' }); spans.push(arch(43, 74.5, 5.6));
  piers.push({ from: 74.5, to: 79.5, kind: 'pier' }); spans.push(arch(79.5, 112));
  piers.push({ from: 112, to: 118, kind: 'draw' }); spans.push({ kind: 'draw', from: 118, to: 156.5, spring: 6.1, crown: 7.35 });
  piers.push({ from: 156.5, to: 156.5 + DRAW_PIER, kind: 'draw' });
  let s = 156.5 + DRAW_PIER;
  for (let i = 0; i < 8; i++) { spans.push(arch(s, s + ARCH)); s += ARCH; piers.push({ from: s, to: s + (i < 7 ? PIER : 5.5), kind: 'pier' }); s += i < 7 ? PIER : 5.5; }
  spans.push({ kind: 'girder', from: s, to: s + 21, spring: 6.85, crown: 6.85 }); s += 21;
  piers.push({ from: s, to: START + LENGTH, kind: 'abutment' });
  return { spans, piers, start: START, end: START + LENGTH };
}

export interface ViaductFrame { x: number; z: number; tx: number; tz: number; nx: number; nz: number; }
const cumulative = (() => { const out = [0]; for (let i = 1; i < LECHMERE_TRACKS.length; i++) out.push(out[i - 1] + Math.hypot(LECHMERE_TRACKS[i][0] - LECHMERE_TRACKS[i - 1][0], LECHMERE_TRACKS[i][1] - LECHMERE_TRACKS[i - 1][1])); return out; })();
/** The line at a station: position, direction toward Cambridge and its right, which is downstream (north-east). */
export function viaductFrame(s: number): ViaductFrame {
  let i = 1; while (i < cumulative.length - 1 && cumulative[i] < s) i++;
  const a = LECHMERE_TRACKS[i - 1], b = LECHMERE_TRACKS[i], length = cumulative[i] - cumulative[i - 1], t = (s - cumulative[i - 1]) / length, tx = (b[0] - a[0]) / length, tz = (b[1] - a[1]) / length;
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, tx, tz, nx: -tz, nz: tx };
}
/** A point `across` metres to the downstream side of the line (negative: toward the road). */
export function viaductPoint(s: number, across: number): [number, number] { const f = viaductFrame(s); return [f.x + f.nx * across, f.z + f.nz * across]; }
/** Station and offset of a world point, on the nearest segment of the line (the offset positive downstream). */
export function viaductStation(x: number, z: number): { s: number; across: number } {
  let best = { s: 0, across: 0 }, nearest = Infinity;
  for (let i = 1; i < LECHMERE_TRACKS.length; i++) {
    const a = LECHMERE_TRACKS[i - 1], b = LECHMERE_TRACKS[i], length = cumulative[i] - cumulative[i - 1], tx = (b[0] - a[0]) / length, tz = (b[1] - a[1]) / length;
    const along = Math.max(0, Math.min(length, (x - a[0]) * tx + (z - a[1]) * tz)), dx = x - a[0] - tx * along, dz = z - a[1] - tz * along, distance = Math.hypot(dx, dz);
    if (distance < nearest) { nearest = distance; best = { s: cumulative[i - 1] + along, across: dx * -tz + dz * tx }; }
  }
  return best;
}
/** Stations from `from` to `to` no further apart than `step`, with every bend of the line among them. */
export function viaductStations(from: number, to: number, step: number): number[] {
  const marks = [from, ...cumulative.filter(c => c > from + .01 && c < to - .01), to], out = [from];
  for (let i = 1; i < marks.length; i++) { const count = Math.max(1, Math.ceil((marks[i] - marks[i - 1]) / step)); for (let j = 1; j <= count; j++) out.push(marks[i - 1] + (marks[i] - marks[i - 1]) * j / count); }
  return out;
}

/** Height of an arch's intrados at a station: half an ellipse between its springings. */
export function intrados(span: ViaductSpan, s: number) { const u = (s - span.from) / (span.to - span.from) * 2 - 1; return span.spring + (span.crown - span.spring) * Math.sqrt(Math.max(0, 1 - u * u)); }
/** The underside of the structure over a station: -Infinity inside a pier, Infinity beyond its ends. */
export function viaductSoffit(s: number, layout = viaductLayout()) {
  if (s < layout.start || s > layout.end) return Infinity;
  const span = layout.spans.find(v => s > v.from && s < v.to); if (!span) return -Infinity;
  return span.kind === 'arch' || span.kind === 'draw' ? intrados(span, s) : span.crown;
}

export type ViaductMaterial = 'concrete' | 'panel' | 'granite' | 'steel' | 'iron' | 'ballast' | 'rail' | 'balustrade' | 'apron' | 'louvre';
export interface ViaductParts { positions: Record<ViaductMaterial, number[]>; uvs: Record<ViaductMaterial, number[]>; poles: number; arches: number; }

/** Every triangle of the viaduct, by material, as plain arrays (positions x, y, z; uvs in metres along and up or across).
 * The structural materials (`VIADUCT_SOLID`) are also what a vehicle, a walker or the helicopter can hit. */
export const VIADUCT_SOLID: readonly ViaductMaterial[] = ['concrete', 'panel', 'granite', 'steel', 'ballast'];
export function lechmereViaductParts(city: CityData): ViaductParts {
  const layout = viaductLayout(), names: ViaductMaterial[] = ['concrete', 'panel', 'granite', 'steel', 'iron', 'ballast', 'rail', 'balustrade', 'apron', 'louvre'];
  const positions = Object.fromEntries(names.map(n => [n, [] as number[]])) as ViaductParts['positions'], uvs = Object.fromEntries(names.map(n => [n, [] as number[]])) as ViaductParts['uvs'];
  let poles = 0;
  type P = [number, number, number];
  const at = (s: number, across: number, y: number): P => { const p = viaductPoint(s, across); return [p[0], y, p[1]]; };
  const tri = (m: ViaductMaterial, a: P, b: P, c: P, ua = [0, 0], ub = [0, 0], uc = [0, 0]) => { positions[m].push(...a, ...b, ...c); uvs[m].push(...ua, ...ub, ...uc); };
  const quad = (m: ViaductMaterial, a: P, b: P, c: P, d: P, u0 = 0, u1 = 0, v0 = 0, v1 = 0) => { tri(m, a, b, c, [u0, v0], [u1, v0], [u1, v1]); tri(m, a, c, d, [u0, v0], [u1, v1], [u0, v1]); };
  /** A cuboid between two stations, two offsets and two heights (the ends square to the line at each station). */
  const block = (m: ViaductMaterial, s0: number, s1: number, a0: number, a1: number, y0: number, y1: number) => {
    const c = (s: number, a: number, y: number) => at(s, a, y);
    quad(m, c(s0, a0, y1), c(s1, a0, y1), c(s1, a1, y1), c(s0, a1, y1), s0, s1, a0, a1); quad(m, c(s0, a1, y0), c(s1, a1, y0), c(s1, a0, y0), c(s0, a0, y0), s0, s1, a0, a1);
    quad(m, c(s0, a0, y0), c(s1, a0, y0), c(s1, a0, y1), c(s0, a0, y1), s0, s1, y0, y1); quad(m, c(s1, a1, y0), c(s0, a1, y0), c(s0, a1, y1), c(s1, a1, y1), s0, s1, y0, y1);
    quad(m, c(s0, a1, y0), c(s0, a0, y0), c(s0, a0, y1), c(s0, a1, y1), a0, a1, y0, y1); quad(m, c(s1, a0, y0), c(s1, a1, y0), c(s1, a1, y1), c(s1, a0, y1), a0, a1, y0, y1);
  };
  /** A strip along the line through the bends, as blocks. */
  const strip = (m: ViaductMaterial, from: number, to: number, a0: number, a1: number, y0: number, y1: number) => { const marks = viaductStations(from, to, 60); for (let i = 1; i < marks.length; i++) block(m, marks[i - 1], marks[i], a0, a1, y0, y1); };
  const ground = (s: number, across: number) => { const p = viaductPoint(s, across); return sampleElevation(city, p[0], p[1]); };
  // Concrete arches: the barrel, a closed spandrel wall on each face with its darker panel, and the arch ring standing proud of it.
  const RING = .85, PROUD = .1, STEPS = 28;
  for (const span of layout.spans) {
    if (span.kind !== 'arch') continue;
    const marks = viaductStations(span.from, span.to, (span.to - span.from) / STEPS);
    for (let i = 1; i < marks.length; i++) {
      const s0 = marks[i - 1], s1 = marks[i], y0 = intrados(span, s0), y1 = intrados(span, s1);
      quad('concrete', at(s0, -HALF, y0), at(s1, -HALF, y1), at(s1, HALF, y1), at(s0, HALF, y0), s0, s1, -HALF, HALF);
      for (const side of [-1, 1]) {
        const face = side * HALF, out = side * (HALF + PROUD), r0 = Math.min(CORNICE, y0 + RING), r1 = Math.min(CORNICE, y1 + RING);
        if (r0 < CORNICE || r1 < CORNICE) quad('panel', at(s0, face, r0), at(s1, face, r1), at(s1, face, CORNICE), at(s0, face, CORNICE), s0, s1, r0, CORNICE);
        quad('concrete', at(s0, out, y0), at(s1, out, y1), at(s1, out, r1), at(s0, out, r0), s0, s1, y0, r0);
        quad('concrete', at(s0, face, r0), at(s1, face, r1), at(s1, out, r1), at(s0, out, r0)); quad('concrete', at(s0, face, y0), at(s1, face, y1), at(s1, out, y1), at(s0, out, y0));
      }
    }
  }
  // Piers with their pilasters, a granite plinth at the waterline, a moulded cap at the deck and a parapet block.
  for (const pier of layout.piers) {
    const middle = (pier.from + pier.to) / 2, low = Math.max(-3.2, Math.min(...[-1, 1].flatMap(side => [pier.from, pier.to].map(s => ground(s, side * (HALF + 1))))));
    block('concrete', pier.from, pier.to, -HALF, HALF, FOOT, CORNICE);
    for (const side of [-1, 1]) block('concrete', pier.from + .5, pier.to - .5, side * HALF, side * (HALF + .45), FOOT, CORNICE);
    block('granite', pier.from - .35, pier.to + .35, -HALF - .8, HALF + .8, FOOT, low + .9);
    block('concrete', pier.from - .15, pier.to + .15, -HALF - .65, HALF + .65, CORNICE, DECK - .05);
    for (const side of [-1, 1]) { block('concrete', pier.from + .3, pier.to - .3, side * (HALF - .32), side * (HALF + .28), DECK - .05, PARAPET + .2); block('panel', pier.from + .9, pier.to - .9, side * (HALF + .28), side * (HALF + .31), DECK + .2, PARAPET - .05); }
    // Catenary: a tubular pole behind each parapet at every pier, a span wire between the two.
    if (pier.kind !== 'abutment') {
      for (const side of [-1, 1]) { block('iron', middle - .11, middle + .11, side * (HALF - .62) - .11, side * (HALF - .62) + .11, DECK, RAIL + 7.2); poles++; }
      block('iron', middle - .02, middle + .02, -HALF + .62, HALF - .62, RAIL + 6.7, RAIL + 6.74);
    }
  }
  // Cornice and deck slab the whole length, ballast between the parapets, two tracks.
  const { start, end } = layout;
  strip('concrete', start, end, -HALF - .22, HALF + .22, CORNICE, DECK - .05); strip('ballast', start, end, -HALF + .32, HALF - .32, DECK - .05, DECK + .02);
  for (const track of [-TRACK, TRACK]) for (const rail of [-.7175, .7175]) strip('rail', start, end, track + rail - .035, track + rail + .035, DECK + .02, RAIL);
  for (const track of [-TRACK, TRACK]) strip('iron', start, end, track - .012, track + .012, RAIL + 5.5, RAIL + 5.53);
  // Balustrade: pierced concrete bays between the pier blocks, a plain railing along the draw.
  for (const span of layout.spans) for (const side of [-1, 1]) {
    const inner = side * (HALF - .3), outer = side * HALF;
    if (span.kind === 'draw') {
      for (const y of [DECK + .55, PARAPET]) strip('iron', span.from, span.to, side * (HALF - .2) - .03, side * (HALF - .2) + .03, y - .05, y);
      for (let s = span.from + .75; s < span.to; s += 1.5) block('iron', s - .025, s + .025, side * (HALF - .2) - .025, side * (HALF - .2) + .025, DECK, PARAPET);
      continue;
    }
    const marks = viaductStations(span.from - .3, span.to + .3, 60);
    for (let i = 1; i < marks.length; i++) {
      const s0 = marks[i - 1], s1 = marks[i];
      quad('balustrade', at(s0, outer, DECK - .05), at(s1, outer, DECK - .05), at(s1, outer, PARAPET), at(s0, outer, PARAPET), s0, s1, 0, 1);
      quad('balustrade', at(s1, inner, DECK - .05), at(s0, inner, DECK - .05), at(s0, inner, PARAPET), at(s1, inner, PARAPET), s1, s0, 0, 1);
      block('concrete', s0, s1, Math.min(inner, outer) - .05, Math.max(inner, outer) + .05, PARAPET, PARAPET + .12);
    }
  }
  // The draw span: two riveted girders with an arched soffit, floor beams between them, and the iron gantry at each end.
  const draw = layout.spans.find(span => span.kind === 'draw')!;
  { const marks = viaductStations(draw.from, draw.to, (draw.to - draw.from) / 18);
    for (let i = 1; i < marks.length; i++) {
      const s0 = marks[i - 1], s1 = marks[i], y0 = intrados(draw, s0), y1 = intrados(draw, s1);
      for (const side of [-1, 1]) for (const a of [side * (HALF - .05), side * (HALF - .45)]) quad('steel', at(s0, a, y0), at(s1, a, y1), at(s1, a, DECK - .05), at(s0, a, DECK - .05), s0, s1, y0, DECK);
      for (const side of [-1, 1]) quad('steel', at(s0, side * (HALF - .45), y0), at(s1, side * (HALF - .45), y1), at(s1, side * (HALF - .05), y1), at(s0, side * (HALF - .05), y0));
      if (i % 2 === 0) block('steel', s0 - .15, s0 + .15, -HALF + .45, HALF - .45, CORNICE - .55, CORNICE);
    }
    strip('steel', draw.from, draw.to, -HALF, HALF, CORNICE, DECK - .05);
    for (const s of [draw.from - 1.2, draw.to + 1.2]) {
      for (const side of [-1, 1]) { block('iron', s - .14, s + .14, side * (HALF - 1.05) - .14, side * (HALF - 1.05) + .14, DECK, RAIL + 5.9); block('iron', s - .22, s + .22, side * (HALF - 1.05) - .22, side * (HALF - 1.05) + .22, RAIL + 5.9, RAIL + 6.25); }
      for (let i = 0; i < 10; i++) { const a0 = -HALF + 1.05 + (2 * HALF - 2.1) * i / 10, a1 = -HALF + 1.05 + (2 * HALF - 2.1) * (i + 1) / 10, rise = (a: number) => RAIL + 5.9 + 1.5 * Math.sqrt(Math.max(0, 1 - (a / (HALF - 1.05)) ** 2)); for (const dy of [0, -.45]) { const p = at(s, a0, rise(a0) + dy), q = at(s, a1, rise(a1) + dy); quad('iron', [p[0], p[1] - .06, p[2]], [q[0], q[1] - .06, q[2]], [q[0], q[1] + .06, q[2]], [p[0], p[1] + .06, p[2]]); } }
    }
  }
  // The tower at the draw's Cambridge pier, on the road side: square concrete shaft, louvred openings, a shallow cap.
  { const pier = layout.piers[3], s0 = pier.from - .6, s1 = pier.to - .2, a0 = -HALF - 4.4, a1 = -HALF - .45, top = VIADUCT_TOWER.top;
    block('concrete', s0, s1, a0, a1, FOOT, top); block('concrete', s0 - .3, s1 + .3, a0 - .3, a1 + .3, top, top + .35); block('concrete', s0 + .5, s1 - .5, a0 + .5, a1 - .5, top + .35, top + .9);
    block('concrete', s0 - .12, s1 + .12, a0 - .12, a1 + .12, CORNICE + .2, CORNICE + .6); block('granite', s0 - .3, s1 + .3, a0 - .3, a1 + .12, FOOT, Math.max(-2.3, Math.min(ground(s0, a0), ground(s1, a0)) + .9));
    for (const [u0, u1] of [[s0 + 1.2, s1 - 1.2]]) { block('louvre', u0, u1, a0 - .04, a0, 12.6, 16.2); block('louvre', u0, u1, a1, a1 + .04, 12.6, 16.2); }
    block('louvre', s0 - .04, s0, a0 + .9, a1 - .9, 12.6, 16.2); block('louvre', s1, s1 + .04, a0 + .9, a1 - .9, 12.6, 16.2);
    block('louvre', (s0 + s1) / 2 - .5, (s0 + s1) / 2 + .5, a0 - .04, a0, 3.2, 5.4);
  }
  // The girder span over Charlestown Avenue: plate girders under the deck, cross frames between them.
  for (const span of layout.spans) {
    if (span.kind !== 'girder') continue;
    for (const a of [-HALF + .15, -1.6, 1.6, HALF - .15]) strip('steel', span.from - .4, span.to + .4, a - .12, a + .12, span.crown, CORNICE);
    for (let s = span.from + 3.5; s < span.to; s += 3.5) block('steel', s - .08, s + .08, -HALF + .15, HALF - .15, CORNICE - 1.1, CORNICE - .9);
    strip('concrete', span.from, span.to, -HALF, HALF, CORNICE - .25, CORNICE);
  }
  // The end of the line the game carries: a closed wall across the tracks.
  block('concrete', end - .45, end, -HALF + .32, HALF - .32, DECK, PARAPET + .2);
  // A paved strip between the sidewalk and the arches, and under them, where the viaduct stands on the dam's crest.
  { const marks = viaductStations(start, end, 3), row = (s: number) => [-7.4, -HALF - .9, 0, HALF + .9].map(a => at(s, a, ground(s, a) + .05)), level = (s: number) => { const g = [-7.4, 0, HALF + .9].map(a => ground(s, a)); return Math.max(...g) - Math.min(...g) < .12; };
    for (let i = 1; i < marks.length; i++) { if (!level(marks[i - 1]) || !level(marks[i])) continue; const a = row(marks[i - 1]), b = row(marks[i]); for (let k = 1; k < a.length; k++) quad('apron', a[k - 1], b[k - 1], b[k], a[k], marks[i - 1], marks[i], k - 1, k); }
  }
  // The iron fence at the outer edge of the dam road's sidewalk, on a low concrete kerb: posts, three rails. Its level
  // is the sidewalk's (sampled a metre inside it), since the ground behind it falls to the river under the arches.
  { const marks = viaductStations(FENCE.from, FENCE.to, 2.5), level = (s: number) => ground(s, FENCE.across - 1.2);
    for (let i = 0; i < marks.length; i++) {
      const s = marks[i], g = level(s); block('iron', s - .045, s + .045, FENCE.across - .045, FENCE.across + .045, g, g + 1.45);
      if (!i) continue;
      const s0 = marks[i - 1], mid = (level(s0) + g) / 2; block('concrete', s0, s, FENCE.across - .14, FENCE.across + .14, Math.min(mid - .9, ground((s0 + s) / 2, FENCE.across + .5) - .3), mid + .14);
      for (const y of [.3, .85, 1.36]) block('iron', s0, s, FENCE.across - .02, FENCE.across + .02, mid + y, mid + y + .05);
    }
  }
  return { positions, uvs, poles, arches: layout.spans.filter(span => span.kind === 'arch').length };
}
