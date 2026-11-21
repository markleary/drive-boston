import * as THREE from 'three';
import type { Point2 } from '../../types';
import { course, door, frame, gable, outward, parapet, plaque, rectPoly, rectWalls, signBoard, spread, wallFrame, wallFrames, Shapes, type Frame, type M, type Rect, type SiteKit, type SiteModel, type V3, type WallFrame } from '../site-kit.ts';

/** The Orange Line stations north of the Charles: the three of the Haymarket North Extension (Wellington and Malden
 * Center 1975, Oak Grove 1977: bare board-formed concrete, flat concrete canopies, angular stair and lift enclosures,
 * orange tile and block) and the 2014 infill station at Assembly (white steel and glass). Each stands in place of the
 * flat OpenStreetMap outline of its station. The track, the platforms and their thin canopy slabs are the rail layer's
 * (public/data/rail.json, src/render/rail-tracks.ts): every model here keeps its piers and walls off the track beds,
 * bridges them at the height of a fare mezzanine, and wraps the rail layer's canopy slabs in its own deeper ones. */
const ORANGE = '#dc781c', INK = '#16181a', BOARD = '#f3f1ea', NAME_FONT = '700 84px Helvetica, Arial, sans-serif', T_FONT = '700 96px Helvetica, Arial, sans-serif';
const finishes = (k: SiteKit) => ({
  k, conc: k.concrete, dark: k.tint('concrete', '#98958d'), beam: k.tint('trim', '#a8a59b'), tile: k.tint('paving', ORANGE), block: k.tint('sandstone', '#c8701f'), orange: k.tint('trim', ORANGE),
  white: k.tint('trim', '#f0eee8'), panel: k.tint('seam', '#c9ccce'), mullion: k.tint('sash', '#3b3e41'), steelDoor: k.tint('door', '#5d6468'),
});
type Fin = ReturnType<typeof finishes>;
type Foot = (x: number, z: number) => number;
const along = (f: WallFrame, p: Point2) => (p[0] - f.a[0]) * f.t[0] + (p[1] - f.a[1]) * f.t[1];

/** The MBTA station name band on a wall: the name in black on white under an orange stripe. */
function nameBand(S: Shapes, c: Fin, f: WallFrame, s: number, y: number, name: string, h = .55, out = .1) {
  const w = h * (name.length * .6 + 1.2), [x, z] = f.at(s, out);
  signBoard(S, c.k, f, s, y, w, h, name, { color: INK, background: BOARD, font: NAME_FONT, lit: true, out, frame: c.k.blackPaint }); S.box(c.orange, w + .16, h * .26, out + .02, x, y + h * .63 + .08, z, f.yaw);
}
/** The same band hung free, read from both sides (under a canopy, on a post). */
function hungName(S: Shapes, c: Fin, x: number, y: number, z: number, yaw: number, name: string, h = .5) {
  const w = h * (name.length * .6 + 1.2); for (const a of [yaw, yaw + Math.PI]) plaque(S, c.k, x, y, z, a, w, h, name, { color: INK, background: BOARD, font: NAME_FONT, lit: true });
  S.box(c.orange, w + .1, h * .26, .1, x, y + h * .63 + .05, z, yaw);
}
/** The "T" in a circle, facing `yaw`. */
function roundel(S: Shapes, c: Fin, x: number, y: number, z: number, yaw: number, r: number, out = .05) {
  const dx = Math.sin(yaw), dz = Math.cos(yaw);
  S.place(c.k.sign('T', { color: INK, background: '#f6f4ee', aspect: 1, font: T_FONT, lit: true }), new THREE.CircleGeometry(r, 28), x + dx * out, y, z + dz * out, yaw); S.place(c.k.blackPaint, new THREE.RingGeometry(r * .87, r, 28), x + dx * (out + .012), y, z + dz * (out + .012), yaw);
}
const wallRoundel = (S: Shapes, c: Fin, f: WallFrame, s: number, y: number, r: number) => { const [x, z] = f.at(s, .06); roundel(S, c, x, y, z, f.yaw, r, .02); S.place(c.k.blackPaint, new THREE.CircleGeometry(r * 1.04, 28), x, y, z, f.yaw); };
/** The lollipop sign at a station entrance: the T on a disc both ways, the station's name under it. */
function pylon(S: Shapes, c: Fin, x: number, y: number, z: number, yaw: number, name: string) {
  S.rod(c.k.blackPaint, [x, y, z], [x, y + 4.3, z], .09, .07); S.place(c.k.blackPaint, new THREE.CylinderGeometry(.66, .66, .08, 28), x, y + 4.9, z, yaw, Math.PI / 2);
  for (const a of [yaw, yaw + Math.PI]) roundel(S, c, x, y + 4.9, z, a, .62); hungName(S, c, x, y + 3.75, z, yaw, name, .42); S.solidBox(.3, .3, x, z, y, y + 4);
}
/** A band of mullioned glazing on a wall from s0 to s1, y0 to y1. */
function glaze(S: Shapes, c: Fin, f: WallFrame, s0: number, s1: number, y0: number, y1: number, o: { bay?: number; rows?: number; glass?: M; frame?: M } = {}) {
  const fr = o.frame ?? c.mullion, n = Math.max(1, Math.round((s1 - s0) / (o.bay ?? 1.6))), rows = o.rows ?? 1;
  S.wall(o.glass ?? c.k.glass, f.at(s0, .04), f.at(s1, .04), y0, y1, y1, f.n, false);
  for (let i = 0; i <= n; i++) { const [x, z] = f.at(s0 + (s1 - s0) * i / n, .06); S.box(fr, .08, y1 - y0, .08, x, (y0 + y1) / 2, z, f.yaw); }
  for (let i = 0; i <= rows; i++) { const [x, z] = f.at((s0 + s1) / 2, .06); S.box(fr, s1 - s0 + .08, .08, .08, x, y0 + (y1 - y0) * i / rows, z, f.yaw); }
}
/** Concrete fins standing proud of a wall at the places given, from y0 to y1. */
function fins(S: Shapes, c: Fin, f: WallFrame, at: number[], y0: number, y1: number, w = .3, out = .35) { for (const s of at) { const [x, z] = f.at(s, out / 2); S.box(c.beam, w, y1 - y0, out, x, (y0 + y1) / 2, z, f.yaw); } }
/** A flat canopy over a rectangle of the frame: a deep slab on piers (plan points in u, v) with a cross head through each
 * pier row and a strip light in every bay. `across` is the short axis the heads span. */
function canopy(S: Shapes, c: Fin, f: Frame, r: Rect, soffit: number, piers: Point2[], foot: Foot, o: { thick?: number; across?: 'u' | 'v'; pier?: [number, number]; slab?: M; post?: M; head?: M; lights?: boolean } = {}) {
  const thick = o.thick ?? .55, u = (o.across ?? 'u') === 'u', [pw, pd] = o.pier ?? [.6, .9], m = o.slab ?? c.conc, head = o.head ?? c.beam;
  S.prism(m, rectPoly(f, r), soffit, soffit + thick, { bottom: m });
  for (const [pu, pv] of piers) { const [x, z] = f.W(pu, pv); S.block(o.post ?? c.conc, u ? pw : pd, u ? pd : pw, x, z, foot(x, z), soffit, f.yaw, { top: null }); }
  const rows = [...new Set(piers.map(p => u ? p[1] : p[0]))].sort((a, b) => a - b);
  rows.forEach((at, i) => {
    const a = u ? f.W(r.u0 + .3, at) : f.W(at, r.v0 + .3), b = u ? f.W(r.u1 - .3, at) : f.W(at, r.v1 - .3); S.beam(head, [a[0], soffit - .2, a[1]], [b[0], soffit - .2, b[1]], .45, .4);
    if (o.lights === false || i + 1 >= rows.length) return;
    const mid = (at + rows[i + 1]) / 2, [x, z] = u ? f.W((r.u0 + r.u1) / 2, mid) : f.W(mid, (r.v0 + r.v1) / 2); S.box(c.k.lamp, u ? .22 : 1.8, .06, u ? 1.8 : .22, x, soffit - .04, z, f.yaw);
  });
}
/** A box with a sloping top, the angular form of the stair and escalator enclosures: the rectangle's v0 end stands y0
 * high, its v1 end y1. Returns its walls (front v0, right u1, back v1, left u0) and its roof height at a plan point. */
function incline(S: Shapes, wall: M, roof: M, f: Frame, r: Rect, foot: number, y0: number, y1: number) {
  const p = rectPoly(f, r), h = [y0, y0, y1, y1], top = (q: Point2) => y0 + (y1 - y0) * (f.vOf(q) - r.v0) / (r.v1 - r.v0);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; S.wall(wall, p[i], p[j], foot, h[i], h[j], outward(p, i)); }
  S.poly(roof, p.map((q, i) => [q[0], h[i], q[1]] as V3), [0, 1, 0], undefined, true);
  // A concrete coping along the rakes.
  for (const [i, j] of [[1, 2], [3, 0]]) S.beam(roof, [p[i][0], h[i] + .06, p[i][1]], [p[j][0], h[j] + .06, p[j][1]], .34, .2);
  return { ...rectWalls(f, r), top };
}
/** A band of glazing that follows a sloping roof: from `drop` under it, h high, over s0..s1 of a wall. */
function rakedGlass(S: Shapes, c: Fin, f: WallFrame, s0: number, s1: number, top: (p: Point2) => number, drop: number, h: number, glass: M = c.k.glass) {
  const a = f.at(s0, .04), b = f.at(s1, .04), ya = top(f.at(s0)) - drop, yb = top(f.at(s1)) - drop, n = Math.max(1, Math.round((s1 - s0) / 1.5));
  S.poly(glass, [[a[0], ya - h, a[1]], [b[0], yb - h, b[1]], [b[0], yb, b[1]], [a[0], ya, a[1]]], [f.n[0], 0, f.n[1]]);
  for (const d of [0, h]) S.beam(c.mullion, [a[0], ya - d, a[1]], [b[0], yb - d, b[1]], .08, .08);
  for (let i = 0; i <= n; i++) { const t = i / n, [x, z] = f.at(s0 + (s1 - s0) * t, .06); S.box(c.mullion, .07, h, .07, x, ya + (yb - ya) * t - h / 2, z, f.yaw); }
}
/** An enclosed footbridge from a to b, w wide, its floor at `floor`: floor and roof slabs, a solid spandrel and mullioned
 * glazing on both sides, on piers at the distances given; `truss` hangs a steel truss of that depth under it. */
function walkway(S: Shapes, c: Fin, a: Point2, b: Point2, w: number, floor: number, foot: Foot, o: { h?: number; sill?: number; piers?: number[]; glass?: M; panel?: M; roof?: M; frame?: M; bay?: number; truss?: number; pier?: M } = {}) {
  const g = frame(a, b), len = Math.hypot(b[0] - a[0], b[1] - a[1]), h = o.h ?? 3.1, sill = o.sill ?? .9, r = { u0: 0, u1: len, v0: -w / 2, v1: w / 2 }, panel = o.panel ?? c.conc, fr = o.frame ?? c.mullion, deck = o.truss ? .3 : .5, walls = rectWalls(g, r);
  S.prism(panel, rectPoly(g, r), floor - deck, floor + sill, { top: null, bottom: panel });
  S.prism(o.roof ?? panel, rectPoly(g, { u0: -.1, u1: len + .1, v0: -w / 2 - .25, v1: w / 2 + .25 }), floor + h, floor + h + .32, { bottom: panel });
  for (const side of [walls.front, walls.back]) {
    S.wall(o.glass ?? c.k.curtainWall, side.at(0, -.05), side.at(len, -.05), floor + sill, floor + h, floor + h, side.n);
    const n = Math.max(1, Math.round(len / (o.bay ?? 1.8))); for (let i = 0; i <= n; i++) { const [x, z] = side.at(len * i / n, 0); S.box(fr, .09, h - sill, .14, x, floor + (sill + h) / 2, z, side.yaw); }
    const [x, z] = side.at(len / 2, 0); S.box(fr, len, .08, .12, x, floor + sill + .04, z, side.yaw); S.box(fr, len, .07, .12, x, floor + sill + (h - sill) * .62, z, side.yaw);
  }
  if (o.truss) {
    const d = o.truss, steel = fr, n = Math.max(2, Math.round(len / (d * 1.5)));
    for (const v of [-w / 2 + .2, w / 2 - .2]) {
      const P = (u: number, y: number): V3 => { const [x, z] = g.W(u, v); return [x, y, z]; };
      S.beam(steel, P(0, floor - deck - d), P(len, floor - deck - d), .3, .3); S.beam(steel, P(0, floor - deck - .15), P(len, floor - deck - .15), .3, .3);
      for (let i = 0; i < n; i++) { const u0 = len * i / n, u1 = len * (i + 1) / n; S.beam(steel, P(u0, floor - deck - (i % 2 ? d : 0)), P(u1, floor - deck - (i % 2 ? 0 : d)), .22, .22); S.beam(steel, P(u0, floor - deck), P(u0, floor - deck - d), .2, .2); }
    }
    for (let i = 0; i <= n; i++) { const p = g.W(len * i / n, -w / 2 + .2), q = g.W(len * i / n, w / 2 - .2); S.beam(steel, [p[0], floor - deck - d, p[1]], [q[0], floor - deck - d, q[1]], .2, .2); }
  }
  for (const d of o.piers ?? []) { const [x, z] = g.W(d, 0); S.block(o.pier ?? c.conc, .9, Math.min(w - .8, 2.6), x, z, foot(x, z), floor - deck - (o.truss ?? 0), g.yaw, { top: null }); }
  return { g, walls, len };
}

/** `incline` along a frame's u instead: the u0 end stands y0 high, the u1 end y1. Its walls: front (u0), back (u1), left (v0), right (v1). */
function inclineU(S: Shapes, wall: M, roof: M, f: Frame, r: Rect, foot: number, y0: number, y1: number) {
  const g = frame(f.W(r.u0, r.v0), f.W(r.u0, r.v1), f.W(r.u1, r.v0)); return incline(S, wall, roof, g, { u0: 0, u1: r.v1 - r.v0, v0: 0, v1: r.u1 - r.u0 }, foot, y0, y1);
}
/** Mullions up a wall to a sloping roof, and a white rail under the roof's edge. */
function rakedMullions(S: Shapes, c: Fin, w: WallFrame, y0: number, top: (p: Point2) => number, fr: M = c.mullion, bay = 1.8) {
  const n = Math.max(1, Math.round(w.length / bay)), a = w.at(0, .04), e = w.at(w.length, .04);
  for (let i = 0; i <= n; i++) { const s = w.length * i / n, t = top(w.at(s)), [x, z] = w.at(s, .03); if (t > y0 + .2) S.box(fr, .09, t - y0, .12, x, (y0 + t) / 2, z, w.yaw); }
  S.beam(c.white, [a[0], top(a) - .12, a[1]], [e[0], top(e) - .12, e[1]], .16, .42);
}
/** A glazed volume: curtain wall round a polygon from y0 to y1 with mullions, transoms and a white fascia under its roof. */
function glassBox(S: Shapes, c: Fin, poly: Point2[], y0: number, y1: number, o: { bay?: number; rows?: number; roof?: M; fascia?: M; glass?: M; frame?: M } = {}) {
  const walls = S.prism(o.glass ?? c.k.curtainWall, poly, y0, y1, { top: o.roof ?? c.white }), fr = o.frame ?? c.mullion, rows = o.rows ?? Math.max(1, Math.round((y1 - y0) / 2.4));
  for (const w of walls) {
    const n = Math.max(1, Math.round(w.length / (o.bay ?? 1.6))), [x, z] = w.at(w.length / 2, .03);
    for (let i = 0; i <= n; i++) { const [mx, mz] = w.at(w.length * i / n, .03); S.box(fr, .09, y1 - y0, .12, mx, (y0 + y1) / 2, mz, w.yaw); }
    for (let i = 1; i < rows; i++) S.box(fr, w.length, .09, .1, x, y0 + (y1 - y0) * i / rows, z, w.yaw);
  }
  course(S, o.fascia ?? c.white, poly, y1 - .22, .6, .14); return walls;
}

/** Oak Grove (1977), the line's northern terminal: the fare lobby is a glazed concrete bridge over the three tracks at
 * the south end of the platforms, reached from Washington Street by a stair in an orange tile enclosure and a lift in an
 * orange block shaft beside a covered waiting area, and from Banks Place by a glazed footbridge to a second lift tower
 * and a covered drop-off; inclined enclosures bring the stairs down to the island platform and the commuter platform,
 * each under a flat concrete canopy four cars long. */
const oakGrove: SiteModel = {
  id: 'oak-grove-station', name: 'Oak Grove station', place: 'oak-grove', tile: '0_-10', building: 'osm-way-29804423',
  note: 'MBTA Orange Line terminal, opened 19 March 1977 (design adapted from North Quincy): lobby bridge, Washington Street stair, lift shaft and waiting area, Banks Place footbridge, tower and drop-off canopy, and both platform canopies on the parts of the mapped outline; heights, pier spacing, window bands and sign positions are interpretive, as is the lobby standing higher over the track than the 3.7 m of the mapped box',
  build({ k, ground }, b) {
    const S = new Shapes(), c = finishes(k), base = b!.baseElevation ?? ground(284.7, -9675), y = (h: number) => base + h, foot: Foot = (x, z) => Math.min(ground(x, z), base) - 1.5;
    // The lobby's south-west corner; u east along the lobby (33.5 m), v north along the platforms.
    const f = frame([261.21, -9639.23], [294.63, -9637.34], [272.89, -9748.58]), G = (u: number, v: number) => ground(...f.W(u, v)), F = (u: number, v: number) => foot(...f.W(u, v));
    // The rail layer's platform tops (island 11.16, low commuter platform 9.59) and the lobby floor over them.
    const island = y(.62), low = y(-.95), L = y(6.4), across = Math.atan2(f.U[0], f.U[1]), alongYaw = Math.atan2(f.V[0], f.V[1]);
    // The lobby bridge: floor box on piers clear of the three track beds (u 3.7, 14.5 and 19), ribbon glazing, a deep fascia.
    const lobby = ([[0, 0], [33.5, 0], [33.5, 4.4], [30.6, 4.4], [30.6, 15.8], [2.4, 15.8], [2.4, 5.4], [0, 5.4]] as Point2[]).map(([u, v]) => f.W(u, v)), lw = wallFrames(lobby);
    S.prism(c.conc, lobby, L - .6, L + 3.7, { top: k.gravel, bottom: c.conc }); parapet(S, c.conc, lobby, L + 3.7, .45, .3);
    glaze(S, c, lw[0], .8, 32.7, L + .95, L + 2.7); glaze(S, c, lw[3], .8, 10.6, L + .95, L + 2.7); glaze(S, c, lw[5], .8, 9.6, L + .95, L + 2.7);
    glaze(S, c, lw[4], along(lw[4], f.W(22.2, 15.8)), along(lw[4], f.W(11.5, 15.8)), L + .95, L + 2.7);
    for (const w of [lw[0], lw[4]]) { const [x, z] = w.at(w.length / 2, .05); S.box(c.dark, w.length, .16, .1, x, L - .05, z, w.yaw); }
    fins(S, c, lw[0], spread(0, 33.5, 8).map(s => s + 33.5 / 16).slice(0, 7), L + .7, L + 2.9); fins(S, c, lw[3], [3.8, 7.6], L + .7, L + 2.9); fins(S, c, lw[5], [3.5, 7], L + .7, L + 2.9);
    nameBand(S, c, lw[0], 16.75, L + 3.5, 'OAK GROVE', .8); wallRoundel(S, c, lw[0], 11.4, L + 3.55, .62);
    for (const [u, v] of [[.9, 1.2], [.9, 4.3], [8.3, 1.2], [8.3, 14.6], [24.6, 1.2], [24.6, 14.6], [32.4, 1.2], [29.6, 14.6]]) { const [x, z] = f.W(u, v); S.block(c.conc, 1, 1, x, z, foot(x, z), L - .6, f.yaw, { top: null }); }
    for (const [u0, u1, v] of [[.2, 33.3, 1.2], [2.6, 30.4, 14.6]]) { const p = f.W(u0, v), q = f.W(u1, v); S.beam(c.beam, [p[0], L - .95, p[1]], [q[0], L - .95, q[1]], .7, .7); }
    // Washington Street side: the lift in its orange block shaft, the stair up from the street in orange tile, the waiting area.
    const gw = G(-2.2, -14.5), lift = { u0: -2.8, u1: .5, v0: 5.4, v1: 8.7 }, lp = rectPoly(f, lift), lf = rectWalls(f, lift);
    S.prism(c.block, lp, F(-1, 7), L + 5.1, { top: c.conc }); course(S, c.beam, lp, L + 4.95, .3, .08); door(S, k, lf.left, 1.65, G(-3, 7), 1.2, 2.2, { leaf: c.steelDoor, frame: c.beam, double: false });
    wallRoundel(S, c, lf.left, 1.65, L + 3.6, .7); nameBand(S, c, lf.left, 1.65, G(-3, 7) + 2.75, 'OAK GROVE', .3, .08);
    const stair = { u0: -4.5, u1: 0, v0: -13.9, v1: 5.3 }, sw = incline(S, c.tile, c.conc, f, stair, F(-2.2, -4), gw + 3.1, L + 3.5);
    rakedGlass(S, c, sw.left, 1.2, 18, sw.top, .7, 1.3); door(S, k, sw.front, 2.25, gw, 2.4, 2.3, { glazed: true, leaf: c.mullion, frame: c.beam });
    const wait = { u0: -6.3, u1: 1.2, v0: -33.9, v1: -13.9 }, ww = rectWalls(f, wait);
    canopy(S, c, f, wait, gw + 3.3, [-31.4, -23.9, -16.4].flatMap(v => [[-5.3, v], [.3, v]] as Point2[]), foot, { pier: [.5, .5] });
    nameBand(S, c, ww.left, 10, gw + 3.58, 'OAK GROVE', .4); wallRoundel(S, c, ww.left, 6.6, gw + 3.58, .25);
    { const [x, z] = f.W(.3, -20.2); S.block(c.conc, .5, 5.4, x, z, F(.3, -20.2), gw + .45, f.yaw); const p = f.W(-8.6, -25); pylon(S, c, p[0], ground(p[0], p[1]), p[1], alongYaw, 'OAK GROVE'); }
    // The stairs down to the platforms in inclined orange tile enclosures.
    for (const [u0, u1, to] of [[5.8, 10.8, island], [22.9, 27.3, low]]) {
      const r = { u0, u1, v0: 15.8, v1: 31.2 }, e = incline(S, c.tile, c.conc, f, r, F((u0 + u1) / 2, 23), L + 3.3, to + 3); for (const w of [e.left, e.right]) rakedGlass(S, c, w, 1.2, 14.2, e.top, .6, 1.2);
      { const [x, z] = f.W((u0 + u1) / 2, 31.25); S.place(k.opening, new THREE.PlaneGeometry(u1 - u0 - 1.2, 2.3), x, to + 1.18, z, e.back.yaw); }
    }
    // The two platform canopies: deep concrete slabs on a row of piers, the island's with the station name hung under it.
    canopy(S, c, f, { u0: 5.9, u1: 13.4, v0: 31.2, v1: 109.8 }, island + 3.4, spread(31.2, 109.8, 8).map(v => [9.3, v] as Point2), foot);
    canopy(S, c, f, { u0: 21.5, u1: 29.2, v0: 31.2, v1: 109.7 }, island + 3.4, spread(31.2, 109.7, 8).map(v => [25.2, v] as Point2), foot);
    for (const v of [41, 60.6, 80.3, 100]) { const [x, z] = f.W(9.3, v); hungName(S, c, x, island + 2.75, z, across, 'OAK GROVE'); const q = f.W(25.2, v); hungName(S, c, q[0], island + 2.75, q[1], across, 'OAK GROVE'); }
    // Banks Place side: the glazed footbridge, the lift and stair tower, the covered drop-off.
    walkway(S, c, f.W(32, .55), f.W(56.2, .55), 7.2, L, foot, { h: 3.2, piers: [12.4] });
    const ge = G(64.5, 0), tower = { u0: 56, u1: 63.3, v0: -6.7, v1: 4.5 }, tp = rectPoly(f, tower), tf = rectWalls(f, tower);
    S.prism(c.conc, tp, F(60, -1), L + 4.1, { top: k.gravel }); parapet(S, c.conc, tp, L + 4.1, .35, .3);
    glaze(S, c, tf.right, 4.4, 10.4, ge + 3.2, L + 3.4, { bay: 1.5, rows: 4, glass: k.curtainWall }); door(S, k, tf.right, 7.4, ge, 2.6, 2.4, { glazed: true, leaf: c.mullion, frame: c.beam });
    { const [x, z] = tf.right.at(7.4, 1); S.box(c.beam, 6.4, .3, 2, x, ge + 2.95, z, tf.right.yaw); const [sx, sz] = tf.right.at(7.4, 2.02); S.box(c.orange, 6.4, .1, .04, sx, ge + 3.05, sz, tf.right.yaw); const e = rectWalls(f, { u0: 56, u1: 65.3, v0: -2.5, v1: 3.9 }).right; nameBand(S, c, e, 3.2, ge + 3.42, 'OAK GROVE', .42); }
    { const shaft = rectPoly(f, { u0: 60.1, u1: 63.7, v0: -7.1, v1: -3.3 }), sf = wallFrames(shaft); S.prism(c.block, shaft, F(62, -5), L + 5.4, { top: c.conc }); course(S, c.beam, shaft, L + 5.25, .3, .08); wallRoundel(S, c, sf[1], 1.9, L + 3.4, .85); wallRoundel(S, c, sf[0], 1.8, L + 3.4, .85); }
    canopy(S, c, f, { u0: 56, u1: 63.3, v0: 4.5, v1: 31.7 }, ge + 3.5, [9.5, 18.5, 27.5].flatMap(v => [[57, v], [62.3, v]] as Point2[]), foot, { pier: [.5, .5] });
    { const p = f.W(66, -8.5); pylon(S, c, p[0], ground(p[0], p[1]), p[1], alongYaw, 'OAK GROVE'); }
    return S;
  },
};
/** Malden Center (1975) stands on the embankment over Pleasant Street. Its frame: u north along the track from the south
 * end of the commuter canopy, v east; the commuter track lies at v -2, the Orange Line at v -5 and -15 about the island. */
const MALDEN = frame([-4.74, -8462.39], [17.25, -8536.34], [25.57, -8523.94]);
/** The east side: the full-height commuter platform under its concrete canopy with a wall at its back, the second exit
 * stair in an inclined concrete enclosure and the headhouse with the lift shaft down to the Commercial Street busway. */
const maldenEast: SiteModel = {
  id: 'malden-center-station', name: 'Malden Center station', place: 'malden-center', tile: '0_-9', building: 'osm-way-196049432',
  note: 'MBTA Orange Line and Haverhill Line station, opened 27 December 1975, lifts and second stair 2003-05: commuter platform canopy and back wall, exit stair and east headhouse on the mapped outline, in bare concrete; the headhouse front, its lift shaft, heights and sign positions are interpretive',
  build({ k, ground }, b) {
    const S = new Shapes(), c = finishes(k), f = MALDEN, base = b!.baseElevation ?? 6.2, foot: Foot = (x, z) => ground(x, z) - 1.5, G = (u: number, v: number) => ground(...f.W(u, v)), F = (u: number, v: number) => foot(...f.W(u, v));
    // The rail layer's commuter platform (top 8.26) and its canopy slab (11.42 to 11.70), which this one wraps.
    const P = base + 2.05, toStreet = Math.atan2(f.V[0], f.V[1]);
    canopy(S, c, f, { u0: -5.6, u1: 86.1, v0: .3, v1: 4.25 }, P + 3.14, spread(-5.6, 86.1, 10).map(u => [u, 3.7] as Point2), foot, { across: 'v', pier: [.45, .8] });
    S.prism(c.conc, rectPoly(f, { u0: -16.6, u1: 97.2, v0: 4, v1: 4.3 }), Math.min(...spread(-16.6, 97.2, 12).map(u => G(u, 4.8))) - 1.5, P + 1.1);
    for (const u of [10, 22, 76, 84]) { const [x, z] = f.W(u, 2.25); hungName(S, c, x, P + 2.6, z, toStreet, 'MALDEN CENTER', .42); }
    // The second exit stair: an inclined concrete enclosure down the embankment to the south.
    const g = frame(f.W(30, 9.1), f.W(30, 3.6), f.W(50.9, 9.1)), ga = G(29.2, 6.4), e = incline(S, c.conc, c.conc, g, { u0: 0, u1: 5.5, v0: 0, v1: 20.9 }, Math.min(F(30, 9.1), F(50.9, 9.1)), ga + 2.9, P + 3.3);
    rakedGlass(S, c, e.left, 1.5, 19.6, e.top, .7, 1.2); door(S, k, e.front, 2.75, ga, 2.2, 2.3, { glazed: true, leaf: c.mullion, frame: c.orange });
    { const a = e.left.at(1.5, .05), q = e.left.at(19.6, .05); S.beam(c.orange, [a[0], e.top(a) - 2.15, a[1]], [q[0], e.top(q) - 2.15, q[1]], .06, .22); }
    // The headhouse: stair hall and lift from the platform down to the busway, the entrance in an orange tile surround.
    const hall = { u0: 50.9, u1: 67.6, v0: 3.6, v1: 11.5 }, hp = rectPoly(f, hall), front = rectWalls(f, hall).back, gb = G(56.4, 12.6);
    S.prism(c.conc, hp, Math.min(F(50.9, 11.5), F(67.6, 11.5)), P + 3.9, { top: k.gravel }); parapet(S, c.conc, hp, P + 3.9, .4, .3);
    S.wall(c.tile, front.at(2, .03), front.at(9, .03), gb, gb + 3.2, gb + 3.2, front.n, false); glaze(S, c, front, 3.3, 7.7, gb + .08, gb + 2.6, { bay: 1.1, glass: k.shopGlass });
    { const [x, z] = front.at(5.5, 1.1); S.box(c.beam, 8, .32, 2.2, x, gb + 3.4, z, front.yaw); S.solidBox(8, .3, ...front.at(5.5, .1), gb - 1.5, gb + .02, front.yaw); }
    nameBand(S, c, front, 5.5, gb + 4.25, 'MALDEN CENTER', .62); glaze(S, c, front, 2, 9, P + 1.3, P + 2.9, { bay: 1.4 }); fins(S, c, front, [2, 5.5, 9], P + 1, P + 3.2);
    const shaft = rectPoly(f, { u0: 61.4, u1: 65.4, v0: 7.6, v1: 11.8 }), sf = wallFrames(shaft); S.prism(c.dark, shaft, F(63, 11.8), P + 5.3, { top: c.conc }); course(S, c.orange, shaft, P + 4.85, .4, .05);
    wallRoundel(S, c, sf[2], 2, P + 2.6, .9); wallRoundel(S, c, sf[1], 2.1, P + 3.4, .7);
    S.prism(c.conc, rectPoly(f, { u0: 69.3, u1: 72.4, v0: 3.6, v1: 6.4 }), F(71, 6.4), P + 2.7);
    { const p = f.W(56.4, 16); pylon(S, c, p[0], ground(p[0], p[1]), p[1], Math.atan2(f.U[0], f.U[1]), 'MALDEN CENTER'); }
    return S;
  },
};
/** The west side: the fare lobby at street level against the embankment (its walls bright orange in the entrance
 * recess), and over the track from it the island platform under its concrete canopy, with the stair and lift heads. */
const maldenLobby: SiteModel = {
  id: 'malden-center-lobby', name: 'Malden Center fare lobby', place: 'malden-center', tile: '-1_-9', building: 'osm-way-29860316',
  note: 'MBTA Malden Center, opened 27 December 1975: the street-level fare lobby on the mapped outline (held 2.3 m off the Orange Line track the outline touches), bare concrete with the bright orange lobby walls shown in the entrance recess, and the island platform canopy with stair and lift heads; the real lobby lies under the platforms, so the front, the heads on the platform, heights and sign positions are interpretive',
  build({ k, ground }, b) {
    const S = new Shapes(), c = finishes(k), f = MALDEN, base = b!.baseElevation ?? 6.2, foot: Foot = (x, z) => ground(x, z) - 1.5, G = (u: number, v: number) => ground(...f.W(u, v)), F = (u: number, v: number) => foot(...f.W(u, v)), W = ([u, v]: number[]) => f.W(u, v);
    // The rail layer's island platform (top 8.03) and canopy slab (11.19 to 11.47); the lobby floor is the busway's ground.
    const island = base + 1.83, fl = G(26, -31), roof = island, west: Point2 = [-f.V[0], -f.V[1]], hallRect = { u0: 11.4, u1: 40.4, v0: -30.4, v1: -17.5 };
    const hall = [[11.4, -30.4], [19.9, -30.4], [19.9, -28.8], [31.9, -28.8], [31.9, -30.4], [40.4, -30.4], [40.4, -17.5], [11.4, -17.5]].map(W), low = Math.min(F(11.4, -30.4), F(40.4, -30.4), F(26, -30.4));
    S.prism(c.conc, hall, low, roof, { top: k.gravel }); S.prism(c.conc, rectPoly(f, { u0: 19.9, u1: 31.9, v0: -30.4, v1: -28.8 }), fl + 3.3, roof, { top: k.gravel, bottom: c.conc }); parapet(S, c.conc, rectPoly(f, hallRect), roof, 1, .3);
    S.prism(k.paving, rectPoly(f, { u0: 19.9, u1: 31.9, v0: -31.6, v1: -28.8 }), low, fl + .04);
    // The entrance recess: orange walls, glazed doors.
    const back = wallFrame(W([31.9, -28.84]), W([19.9, -28.84]), west), face = wallFrame(W([40.4, -30.4]), W([11.4, -30.4]), west);
    S.wall(c.tile, back.a, back.b, fl, fl + 3.3, fl + 3.3, west, false); glaze(S, c, back, 2.4, 9.6, fl + .1, fl + 2.6, { bay: 1.2, glass: k.shopGlass });
    for (const [u, n] of [[19.93, f.U], [31.87, [-f.U[0], -f.U[1]]]] as [number, Point2][]) S.wall(c.tile, f.W(u, -30.4), f.W(u, -28.8), fl, fl + 3.3, fl + 3.3, n, false);
    nameBand(S, c, face, 14.5, fl + 3.85, 'MALDEN CENTER', .72); wallRoundel(S, c, face, 7.6, fl + 3.85, .5);
    glaze(S, c, face, 1, 28, fl + 4.6, roof - .2, { bay: 1.75 }); fins(S, c, face, [1, 4.5, 8, 11.5, 15, 18.5, 22, 25.5, 28], fl + 4.4, roof);
    { const south = wallFrames(rectPoly(f, hallRect))[3]; door(S, k, south, 3, G(10.6, -27.5), 1.1, 2.2, { leaf: c.steelDoor, frame: c.beam, double: false }); }
    // The island platform over the track: its concrete canopy, the stair head in orange tile and the lift shaft.
    canopy(S, c, f, { u0: .4, u1: 74.8, v0: -13.6, v1: -7.2 }, island + 3.08, spread(.4, 74.8, 8).map(u => [u, -10.4] as Point2), foot, { across: 'v', thick: .62 });
    S.prism(c.tile, rectPoly(f, { u0: 19, u1: 27, v0: -12.2, v1: -8.6 }), F(23, -10.4), island + 2.6, { top: c.conc });
    { const n = wallFrames(rectPoly(f, { u0: 19, u1: 27, v0: -12.2, v1: -8.6 }))[1]; const [x, z] = n.at(1.8, .04); S.place(k.opening, new THREE.PlaneGeometry(2.6, 2.2), x, island + 1.1, z, n.yaw); }
    const lift = rectPoly(f, { u0: 31, u1: 34.2, v0: -12.2, v1: -8.6 }), lf = wallFrames(lift); S.prism(c.block, lift, F(32.6, -10.4), island + 4.9, { top: c.conc }); course(S, c.beam, lift, island + 4.75, .3, .08);
    door(S, k, lf[1], 1.8, island, 1.2, 2.15, { leaf: k.steel, frame: c.beam });
    for (const u of [9.7, 46.9, 65.5]) { const [x, z] = f.W(u, -10.4); hungName(S, c, x, island + 2.55, z, Math.atan2(f.V[0], f.V[1]), 'MALDEN CENTER', .42); }
    { const p = f.W(15, -34.5); pylon(S, c, p[0], ground(p[0], p[1]), p[1], Math.atan2(f.U[0], f.U[1]), 'MALDEN CENTER'); }
    return S;
  },
};
/** Wellington (1975) lies at grade beside the carhouse: two island platforms about three tracks. Its frame: u north
 * along the track from the south end of the mapped outline, v east; tracks at v -3 to -1, 6 to 8.5 and 14 to 18. */
const WELLINGTON = frame([-228.31, -5629.55], [-226.13, -5781.58], [-213.14, -5666.25]), WELLINGTON_FLOOR = 6.4;
const wellington: SiteModel = {
  id: 'wellington-station', name: 'Wellington station', place: 'wellington', tile: '-1_-6', building: 'osm-way-29740055',
  note: 'MBTA Orange Line, opened 6 September 1975: the fare mezzanine over the north end of the two island platforms, the stair enclosures and lift shafts up to it, the glazed walkway north to the head of the two exits, the short overpass east to the busway and both platform canopies, in grey board-formed concrete on the mapped outline; pier positions, window bands, heights and the stair tower at the busway are interpretive',
  build({ k, ground }, b) {
    const S = new Shapes(), c = finishes(k), f = WELLINGTON, base = b!.baseElevation ?? .2, foot: Foot = (x, z) => ground(x, z) - 1.5, G = (u: number, v: number) => ground(...f.W(u, v)), F = (u: number, v: number) => foot(...f.W(u, v));
    // The rail layer's platform tops (1.27) and canopy slabs (4.43 to 4.71), and the mezzanine floor 6.4 m over the rails.
    const P = base + 1.07, L = base + WELLINGTON_FLOOR - .2, east = Math.atan2(f.V[0], f.V[1]);
    for (const [a, e, half] of [[[22.6, .8], [124.2, 2.3], 4.07], [[22.4, 9.9], [124.2, 12.7], 3.71]] as [Point2, Point2, number][]) {
      const g = frame(f.W(a[0], a[1]), f.W(e[0], e[1])), len = Math.hypot(e[0] - a[0], e[1] - a[1]);
      canopy(S, c, g, { u0: -.3, u1: len + .3, v0: -half, v1: half }, P + 3.1, spread(0, len, 10).map(u => [u, 0] as Point2), foot, { across: 'v', thick: .6 });
      for (const u of [10.2, 40.6, 71.1, 91.4]) { const [x, z] = g.W(u, 0); hungName(S, c, x, P + 2.55, z, east, 'WELLINGTON', .42); }
    }
    // Stairs and escalators up from the platform ends in inclined concrete enclosures, each beside its lift shaft.
    for (const [v0, v1, s0, s1] of [[2.9, 5.7, .3, 2.7], [10.2, 13.4, 13.7, 16.3]]) {
      const e = inclineU(S, c.conc, c.conc, f, { u0: 137, u1: 152, v0, v1 }, F(145, (v0 + v1) / 2), P + 3, L + 3.2); for (const w of [e.left, e.right]) rakedGlass(S, c, w, 1.2, 13.8, e.top, .6, 1.2);
      { const [x, z] = e.front.at((v1 - v0) / 2, .04); S.place(k.opening, new THREE.PlaneGeometry(v1 - v0 - .8, 2.2), x, P + 1.12, z, e.front.yaw); }
      const shaft = rectPoly(f, { u0: 148.8, u1: 152, v0: s0, v1: s1 }); S.prism(c.dark, shaft, F(150, (s0 + s1) / 2), L + 4.5, { top: c.conc }); course(S, c.beam, shaft, L + 4.35, .3, .08);
    }
    // The mezzanine: a concrete box on piers clear of the three track beds, a narrow window band under a deep fascia.
    const mezz = { u0: 152, u1: 168.2, v0: -5.5, v1: 18.1 }, mp = rectPoly(f, mezz), mw = rectWalls(f, mezz), south = mw.left, north = mw.right, eastWall = mw.back, westWall = mw.front;
    S.prism(c.conc, mp, L - .7, L + 3.6, { top: k.gravel, bottom: c.conc }); parapet(S, c.conc, mp, L + 3.6, .45, .3);
    for (const [w, s0, s1] of [[south, .8, 5.6], [south, 11.6, 15.4], [eastWall, 1, 15.2], [westWall, 1, 15.2], [north, .8, 4.4], [north, 14.6, 22.8]] as [WallFrame, number, number][]) { glaze(S, c, w, s0, s1, L + 1.15, L + 2.35, { bay: 1.5 }); fins(S, c, w, [s0, s1], L + .9, L + 2.6); }
    nameBand(S, c, south, 13.5, L + 3.15, 'WELLINGTON', .56); nameBand(S, c, eastWall, 8.1, L + 3.15, 'WELLINGTON', .7); wallRoundel(S, c, eastWall, 3.2, L + 3.15, .52); nameBand(S, c, westWall, 8.1, L + 3.15, 'WELLINGTON', .7); wallRoundel(S, c, westWall, 13, L + 3.15, .52);
    for (const u of [153.6, 166.6]) {
      for (const v of [-4.6, 3.6, 13.2]) { const [x, z] = f.W(u, v); S.block(c.conc, 1.1, 1, x, z, foot(x, z), L - .7, f.yaw, { top: null }); }
      const p = f.W(u, -5.3), q = f.W(u, 17.9); S.beam(c.beam, [p[0], L - 1.2, p[1]], [q[0], L - 1.2, q[1]], .8, 1);
    }
    // The glazed walkway north over the middle track to the head of the two exits.
    walkway(S, c, f.W(168.2, 8.6), f.W(182.2, 8.6), 9, L, foot, { h: 3.2 });
    const head = { u0: 182.2, u1: 190.5, v0: 1.2, v1: 10.8 }, hp = rectPoly(f, head), hw = rectWalls(f, head);
    S.prism(c.conc, hp, L - .7, L + 3.6, { top: k.gravel, bottom: c.conc }); parapet(S, c.conc, hp, L + 3.6, .45, .3); glaze(S, c, hw.right, .8, 8.8, L + 1.15, L + 2.35, { bay: 1.5 });
    for (const u of [183.6, 189.1]) { const [x, z] = f.W(u, 4); S.block(c.conc, 1, 1, x, z, foot(x, z), L - .7, f.yaw, { top: null }); }
    { const p = f.W(182.4, 4), q = f.W(190.3, 4); S.beam(c.beam, [p[0], L - 1.2, p[1]], [q[0], L - 1.2, q[1]], .8, 1); }
    // The short overpass east across the express and commuter tracks to a stair tower at the north end of the busway.
    walkway(S, c, f.W(187.2, 10.8), f.W(187.2, 36), 3.8, L, foot, { h: 3, piers: [17.5] });
    const tower = { u0: 185, u1: 189.6, v0: 36, v1: 44 }, tp = rectPoly(f, tower), tw = rectWalls(f, tower), gt = G(187.3, 45);
    S.prism(c.conc, tp, Math.min(F(187, 36), F(187, 44)), L + 3.6, { top: k.gravel }); parapet(S, c.conc, tp, L + 3.6, .35, .3);
    door(S, k, tw.back, 2.3, gt, 2, 2.3, { glazed: true, leaf: c.mullion, frame: c.beam }); glaze(S, c, tw.back, 1, 3.6, gt + 3.6, L + 2.9, { bay: 1.3, rows: 2 }); nameBand(S, c, tw.back, 2.3, gt + 2.85, 'WELLINGTON', .34);
    wallRoundel(S, c, tw.left, 4, L + 2.4, .8);
    { const p = f.W(181.5, 47); pylon(S, c, p[0], ground(p[0], p[1]), p[1], Math.atan2(f.U[0], f.U[1]), 'WELLINGTON'); }
    return S;
  },
};
/** The SkyWalk: the enclosed footbridge from the head of Wellington's exits 240 m west over the carhouse yard to the
 * Station Landing garage, carried on the steel truss of the people mover that ran there from 1997 to 2006. */
const skywalk: SiteModel = {
  id: 'wellington-skywalk', name: 'Wellington SkyWalk', place: 'wellington', tile: '-1_-6', at: [-345, -5815.8],
  note: 'The 800 ft enclosed SkyWalk from Wellington station over the yard to the Station Landing garage, on the truss of the 1997-2006 people mover; its line is drawn straight between the station\'s walkway head and the garage, its piers stand in the gaps between the yard tracks of the rail layer, and its section, glazing and truss pattern are interpretive',
  build({ k, ground }) {
    const S = new Shapes(), c = finishes(k), foot: Foot = (x, z) => ground(x, z) - 1.5, z = -5815.8, x0 = -224.42, x1 = -465.6, steel = k.tint('steel', '#6f777c');
    walkway(S, c, [x0, z], [x1, z], 4, WELLINGTON_FLOOR, foot, { h: 2.9, sill: .8, truss: 1.5, bay: 2.4, panel: c.panel, roof: c.panel, frame: steel, pier: c.conc, piers: [-236.5, -272.9, -301.7, -323, -357.1, -388, -412, -440].map(x => x0 - x) });
    return S;
  },
};
/** Assembly (2014), the infill station at Assembly Row. Its frame: u north along the island platform from the south end
 * of its canopy, v east across it (0 to 8.4); the two service tracks lie at v -1.9 and 10. */
const ASSEMBLY = frame([-221.36, -4629.9], [-230.19, -4749.32], [-212.97, -4630.2]);
const assembly: SiteModel = {
  id: 'assembly-station', name: 'Assembly station', place: 'assembly-row', tile: '-1_-5', building: 'osm-way-399653059',
  note: 'MBTA Orange Line infill station, opened 2 September 2014: the white canopy over the whole island platform, the main north headhouse (stair hall, fare mezzanine, bridge over the inbound track and Great River Road, tower toward Foley Street) and the smaller south headhouse toward Revolution Drive, glass and white metal on the mapped outline; cladding colours are unconfirmed in the brief, so the white panels, the roof pitches, column spacing and sign positions are interpretive, and the metal-panel mosaic is not drawn',
  build({ k, ground }, b) {
    const S = new Shapes(), c = finishes(k), f = ASSEMBLY, base = b!.baseElevation ?? -.07, foot: Foot = (x, z) => ground(x, z) - 1.5, G = (u: number, v: number) => ground(...f.W(u, v)), F = (u: number, v: number) => foot(...f.W(u, v));
    // The rail layer's platform (top 1.02) and canopy slab (4.18 to 4.46); the mezzanine and bridges 6.3 m over the rails.
    const P = base + 1.09, L = base + 6.4, seam = k.tint('trim', '#e2e5e4'), panel = k.tint('clapboard', '#d3d7d8'), glass = k.curtainWall, screen = k.tint('water', '#6f8a96'), gb = { roof: seam, glass, frame: c.white }, soffit = P + 3.02, can = { u0: 0, u1: 119.8, v0: -.05, v1: 8.3 }, mid = 4.1;
    // The canopy: a low white roof the length of the platform on a row of steel columns with raking arms, glazed windscreens between some.
    S.prism(c.white, rectPoly(f, can), soffit, soffit + .42, { top: null, bottom: c.white }); gable(S, f, can, soffit + .42, .5, seam, { axis: 'u', overhang: 0, wall: c.white });
    for (const u of spread(0, 119.8, 16)) {
      const [x, z] = f.W(u, mid); S.rod(c.white, [x, F(u, mid), z], [x, soffit, z], .16, .16, 10); S.solidBox(.4, .4, x, z, P - .3, soffit, f.yaw);
      for (const side of [-1, 1]) { const [ax, az] = f.W(u, mid + side * 3.3); S.beam(c.white, [x, soffit - 1.3, z], [ax, soffit - .05, az], .14, .2); }
      const [lx, lz] = f.W(u + 3.74, mid); S.box(k.lamp, .2, .05, 2.4, lx, soffit - .03, lz, f.yaw + Math.PI / 2);
    }
    for (const u of [8.4, 23.4, 53.3, 68.3, 83.2, 98.2]) {
      for (const [v, n] of [[mid - .04, [-f.V[0], -f.V[1]]], [mid + .04, f.V]] as [number, Point2][]) S.wall(screen, f.W(u, v), f.W(u + 5.9, v), P + .25, P + 2.4, P + 2.4, n);
      const p = f.W(u, mid), q = f.W(u + 5.9, mid); S.beam(c.mullion, [p[0], P + 2.42, p[1]], [q[0], P + 2.42, q[1]], .1, .08); S.beam(c.mullion, [p[0], P + .2, p[1]], [q[0], P + .2, q[1]], .1, .08);
    }
    for (const u of [41, 71, 101]) { const [x, z] = f.W(u + 4.3, mid); hungName(S, c, x, P + 2.62, z, Math.atan2(f.V[0], f.V[1]), 'ASSEMBLY', .42); }
    const shaftAt = (r: Rect, top: number) => { const p = rectPoly(f, r); S.prism(panel, p, F((r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2), top, { top: c.white }); course(S, c.orange, p, top - .55, .3, .05); return wallFrames(p); };
    // The south headhouse: stair and lift tower through the canopy, the bridge west, the tower at the end of Revolution Drive.
    { const tower = rectPoly(f, { u0: 35.2, u1: 44.2, v0: 1.6, v1: 6.8 }); S.prism(panel, tower, F(39.7, 4), P + .9); glassBox(S, c, tower, P + .9, L + 3.7, gb); }
    walkway(S, c, f.W(39.7, 1.6), f.W(39.7, -17), 6, L, foot, { h: 3.2, sill: .6, panel: c.white, roof: c.white, glass, frame: c.white });
    { const r = { u0: 34.8, u1: 44.6, v0: -26.5, v1: -17 }, p = rectPoly(f, r), w = rectWalls(f, r), g = G(46, -21); S.prism(panel, p, F(39.7, -22), g + 1); glassBox(S, c, p, g + 1, L + 3.9, gb);
      shaftAt({ u0: 34.6, u1: 38.4, v0: -26.7, v1: -22.7 }, L + 4.7); door(S, k, w.right, 4.2, g, 2.4, 2.4, { glazed: true, leaf: c.mullion, frame: c.white });
      { const [x, z] = w.right.at(4.2, .9); S.box(c.white, 5, .22, 1.8, x, g + 3, z, w.right.yaw); } nameBand(S, c, w.right, 4.2, g + 3.5, 'ASSEMBLY', .5); wallRoundel(S, c, w.right, 7.6, g + 3.5, .42);
      const q = f.W(40, -28.4); pylon(S, c, q[0], ground(q[0], q[1]), q[1], Math.atan2(f.V[0], f.V[1]), 'ASSEMBLY'); }
    // The north headhouse: the glazed stair hall rising from the canopy's end to the fare mezzanine over the platform's head.
    { const r = { u0: 120.2, u1: 146, v0: 1.4, v1: 7 }, e = inclineU(S, glass, seam, f, r, P + .8, P + 3.5, L + 4); S.prism(panel, rectPoly(f, { u0: r.u0 - .05, u1: r.u1, v0: r.v0 - .05, v1: r.v1 + .05 }), F(133, 4), P + .8);
      for (const w of [e.left, e.right]) rakedMullions(S, c, w, P + .8, e.top, c.white); { const [x, z] = e.front.at(2.8, .05); S.place(k.opening, new THREE.PlaneGeometry(3.6, 2.2), x, P + 1.1, z, e.front.yaw); } }
    const mezz = { u0: 146, u1: 164, v0: -2, v1: 9.5 }, mp = rectPoly(f, mezz);
    S.prism(panel, rectPoly(f, { u0: 146, u1: 164, v0: .7, v1: 7.7 }), F(155, 4), L - .5); S.prism(c.white, mp, L - .5, L + .1, { top: null, bottom: c.white });
    const mw = glassBox(S, c, mp, L + .1, L + 4.2, { ...gb, bay: 1.8 }); nameBand(S, c, mw[1], 9, L + 3.95, 'ASSEMBLY', .5); nameBand(S, c, mw[3], 9, L + 3.95, 'ASSEMBLY', .5); nameBand(S, c, mw[2], 5.75, L + 3.95, 'ASSEMBLY', .5);
    // The bridge over the inbound track, the path and Great River Road, and the tower toward Foley Street: lift, then the stair and escalator down to the north.
    walkway(S, c, f.W(150.4, -2), f.W(150.4, -17), 6.6, L, foot, { h: 3.3, sill: .6, panel: c.white, roof: c.white, glass, frame: c.white });
    { const tower = ([[145.7, -17.1], [144.8, -26.1], [154, -27.37], [154, -17]] as Point2[]).map(([u, v]) => f.W(u, v)), g = G(172.5, -22); S.prism(panel, tower, F(150, -22), g + 1); glassBox(S, c, tower, g + 1, L + 4.3, gb);
      const sf = shaftAt({ u0: 144.9, u1: 148.8, v0: -26.4, v1: -22.4 }, L + 5.1); wallRoundel(S, c, sf[3], 2, L + 2.6, .9);
      const r = { u0: 154, u1: 171.4, v0: -27.6, v1: -17.2 }, e = inclineU(S, glass, seam, f, r, g + 1, L + 4, g + 3.6); S.prism(panel, rectPoly(f, { u0: r.u0, u1: r.u1 + .05, v0: r.v0 - .05, v1: r.v1 + .05 }), F(163, -22), g + 1);
      for (const w of [e.left, e.right]) rakedMullions(S, c, w, g + 1, e.top, c.white);
      door(S, k, e.back, 5.2, g, 3, 2.4, { glazed: true, leaf: c.mullion, frame: c.white }); { const [x, z] = e.back.at(5.2, 1); S.box(c.white, 6.4, .22, 2, x, g + 2.85, z, e.back.yaw); } nameBand(S, c, e.back, 5.2, g + 3.25, 'ASSEMBLY', .36);
      const q = f.W(174, -25.5); pylon(S, c, q[0], ground(q[0], q[1]), q[1], Math.atan2(f.V[0], f.V[1]), 'ASSEMBLY'); }
    return S;
  },
};
export const SITES: SiteModel[] = [oakGrove, maldenEast, maldenLobby, wellington, skywalk, assembly];
