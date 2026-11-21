import * as THREE from 'three';
import type { Point2 } from '../../types';
import { band, column, course, dome, door, frame, gable, lampPost, pediment, rectPoly, rectWindow, Shapes, signBoard, spread, stairs, wallFrame, type Frame, type SiteKit, type SiteModel, type V3, type WallFrame } from '../site-kit.ts';

/** Dressing for large surveyed buildings whose shells stay: each model here is an addition laid against the real
 * wall planes of a kept shell (measured on the packaged roof outlines and wall faces), which the site's `finish`
 * paints one plain stone colour. */

// ------------------------------------------------------------------ local parts
/** A wall from a to b, left to right for a viewer outside it; its normal points at that viewer. */
const wallOf = (a: Point2, b: Point2): WallFrame => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return wallFrame(a, b, [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]); };
/** The stretch s0..s1 of a wall, moved `out` metres toward the viewer. */
const proud = (w: WallFrame, out: number, s0 = 0, s1 = w.length) => wallFrame(w.at(s0, out), w.at(s1, out), w.n);
/** A solid block standing `out` proud of a wall from s0 to s1. */
const pier = (S: Shapes, m: THREE.Material, w: WallFrame, s0: number, s1: number, out: number, y0: number, y1: number, o: { top?: THREE.Material | null; bottom?: THREE.Material; solid?: boolean } = {}) => S.prism(m, [w.at(s0, 0), w.at(s1, 0), w.at(s1, out), w.at(s0, out)], y0, y1, o);
/** A window in a stone architrave: jambs, lintel and sill, and with `hood` a frieze and cornice over it. */
function framedWindow(S: Shapes, k: SiteKit, w: WallFrame, s: number, y: number, ww: number, h: number, stone: THREE.Material, o: { panes?: [number, number]; hood?: boolean; glass?: THREE.Material; sash?: THREE.Material } = {}) {
  const j = Math.min(.32, ww * .14);
  rectWindow(S, k, w, s, y, ww, h, { frame: o.sash ?? k.sash, panes: o.panes, sill: null, glass: o.glass });
  for (const side of [-1, 1]) { const [x, z] = w.at(s + side * (ww / 2 + j / 2), .07); S.box(stone, j, h + j, .14, x, y + (h + j) / 2, z, w.yaw); }
  { const [x, z] = w.at(s, .07); S.box(stone, ww + 2 * j, j, .14, x, y + h + j / 2, z, w.yaw); }
  { const [x, z] = w.at(s, .13); S.box(stone, ww + 2 * j + .3, .22, .26, x, y - .11, z, w.yaw); }
  if (o.hood) { const [x, z] = w.at(s, .2), [fx, fz] = w.at(s, .05); S.box(stone, ww + 2 * j + .5, .26, .4, x, y + h + j + .47, z, w.yaw); S.box(stone, ww + 2 * j, .34, .1, fx, y + h + j + .17, fz, w.yaw); }
}
/** An entablature along a wall under its top T: architrave, the frieze left as wall, bed mould, modillions and cornice,
 * and the coping of the parapet over it. `ext` carries it round an outer corner at either end. */
function entablature(S: Shapes, m: THREE.Material, w: WallFrame, top: number, ext: [number, number] = [0, 0], s0 = 0, s1 = w.length) {
  const a = s0 - ext[0], b = s1 + ext[1];
  const e = (out: number): [number, number] => [ext[0] ? a + .62 - out : a, ext[1] ? b - .62 + out : b];
  band(S, m, w, ...e(.12), top - 3.75, .7, .12); band(S, m, w, ...e(.22), top - 2.17, .26, .22); band(S, m, w, a, b, top - 1.75, .5, .62); band(S, m, w, ...e(.1), top - .1, .2, .1);
  for (let s = s0 + .6; s < s1 - .3; s += 1.25) { const [x, z] = w.at(s, .36); S.box(m, .32, .22, .32, x, top - 2.02 + .08, z, w.yaw); }
}

// ------------------------------------------------------------------ Museum of Fine Arts, Huntington Avenue front
/** Axes of the museum's Huntington Avenue front, measured on the packaged shell BOS-3E07U-O3HT3-8U178: u runs east
 * along the avenue from the south-west corner of the west range, v into the building. Heights are over the shell's
 * base, 1.82 m; the forecourt lawn lies about 1.1 m under it. */
const MFA_ORIGIN: Point2 = [-1620.89, 1294.82], MFA_BASE = 1.823, MFA_SHELLS = ['BOS-3E07U-O3HT3-8U178', 'BOS-PH17J-IAH3T-N1LR7'], MFA_STONE = '#b1afa9';
const mfaFrame = () => frame(MFA_ORIGIN, [MFA_ORIGIN[0] + 87.682, MFA_ORIGIN[1] - 48.09], [-1590.38, 1191.82]);
interface MfaStone { granite: THREE.Material; base: THREE.Material; stone: THREE.Material; panel: THREE.Material; shade: THREE.Material; }

/** One two-storey wall of the wings: the granite skin over the kept shell, a rusticated ground storey with its windows,
 * the belt course at the main floor, tall main-floor windows under cornice hoods with a panel over each, and the
 * entablature and parapet. T is the height of the shell's wall. */
function mfaWing(S: Shapes, k: SiteKit, w: WallFrame, y: (h: number) => number, foot: number, T: number, bays: number[], M: MfaStone, ext: [number, number] = [0, 0]) {
  S.wall(M.granite, w.a, w.b, foot, y(T), y(T), w.n);
  pier(S, M.base, w, 0, w.length, .28, foot, y(2.3), { top: M.stone }); band(S, M.stone, w, -ext[0] * .7, w.length + ext[1] * .7, y(2.45), .3, .42);
  const g = proud(w, .28);
  for (const s of bays) {
    rectWindow(S, k, g, s, y(-.15), 1.5, 1.7, { frame: k.sash, panes: [2, 2], sill: M.stone });
    framedWindow(S, k, w, s, y(3.7), 2.3, T > 18 ? 6 : 5.4, M.stone, { panes: [2, 4], hood: true });
    if (T > 18) { const [x, z] = w.at(s, .04); S.box(M.panel, 2.9, 1.6, .08, x, y(12.7), z, w.yaw); }
  }
  entablature(S, M.stone, w, y(T), ext);
}

/** The pedimented pavilion that ends each forecourt wing: the wing's wall with a centre 8.3 m wide standing 2 m
 * forward, there two engaged Ionic columns between antae about a tall window, under an entablature broken forward
 * and a pediment against the parapet. `planes` are the three front planes [u0, u1, v] west to east. */
function mfaPavilion(S: Shapes, k: SiteKit, f: Frame, y: (h: number) => number, foot: number, planes: [number, number, number][], M: MfaStone) {
  const T = 18.61, [l, c, r] = planes.map(([u0, u1, v], i) => wallOf(f.W(u0 - (i === 1 ? .06 : 0), v - .06), f.W(u1 + (i === 1 ? .06 : 0), v - .06)));
  for (const w of [l, r]) { S.wall(M.granite, w.a, w.b, foot, y(T), y(T), w.n); pier(S, M.base, w, 0, w.length, .28, foot, y(2.3), { top: M.stone }); band(S, M.stone, w, 0, w.length, y(2.45), .3, .42); entablature(S, M.stone, w, y(T), [w === l ? .62 : 0, w === r ? .62 : 0]); }
  // The returns of the centre.
  for (const side of [wallOf(f.W(planes[1][0] - .06, planes[0][2]), c.a), wallOf(c.b, f.W(planes[1][1] + .06, planes[2][2]))]) S.wall(M.granite, side.a, side.b, foot, y(T), y(T), side.n);
  S.wall(M.granite, c.a, c.b, foot, y(T), y(T), c.n); pier(S, M.base, c, -.28, c.length + .28, .28, foot, y(2.3), { top: M.stone }); band(S, M.stone, c, -.42, c.length + .42, y(2.45), .3, .42);
  const mid = c.length / 2, colH = 11.9, top = y(2.6) + colH;
  for (const side of [-1, 1]) {
    const [x, z] = c.at(mid + side * 2.25, .62); column(S, M.stone, x, z, y(2.6), colH, .62, { order: 'ionic', yaw: c.yaw });
    pier(S, M.stone, c, side < 0 ? 0 : c.length - 1, side < 0 ? 1 : c.length, .16, y(2.6), top, { solid: false });
  }
  framedWindow(S, k, c, mid, y(3.7), 2.4, 6.4, M.stone, { panes: [2, 4], hood: true });
  rectWindow(S, k, proud(c, .28), mid, y(-.15), 1.5, 1.7, { frame: k.sash, panes: [2, 2], sill: M.stone });
  { const [x, z] = c.at(mid, .04); S.box(M.panel, 2.9, 1.5, .08, x, y(12.9), z, c.yaw); }
  // Entablature broken forward over the columns, and the pediment.
  pier(S, M.stone, c, mid - 3.25, mid + 3.25, 1.2, top, y(16.3), { bottom: M.stone, solid: false });
  band(S, M.stone, c, 0, mid - 3.25, top + .35, .7, .12); band(S, M.stone, c, mid + 3.25, c.length, top + .35, .7, .12);
  pier(S, M.stone, c, mid - 3.5, mid + 3.5, 1.45, y(16.3), y(16.55), { solid: false }); pier(S, M.stone, c, mid - 3.9, mid + 3.9, 1.85, y(16.55), y(17.05), { solid: false });
  band(S, M.stone, c, -.62, mid - 3.9, y(T - 1.75), .5, .62); band(S, M.stone, c, mid + 3.9, c.length + .62, y(T - 1.75), .5, .62); band(S, M.stone, c, -.1, c.length + .1, y(T - .1), .2, .1);
  pediment(S, M.stone, c, mid - 3.75, mid + 3.75, y(17.05), 1.45, 1.8, { tympanum: M.granite, roof: M.shade });
}

/** The Evans Wing on the Fenway (Guy Lowell, 1911-15): a giant Ionic colonnade along the whole wing between its end
 * pavilions, over a rusticated ground storey. The shell's wall plane is the line of the entablature, so the columns
 * stand on a podium before it with the gallery wall and its windows behind them. */
function mfaEvans(S: Shapes, k: SiteKit, f: Frame, y: (h: number) => number, foot: number, M: MfaStone) {
  const T = 21.78, w = wallOf(f.W(111, 142.73), f.W(40.94, 142.73)), L = w.length, n = 22, pod = 1.8, floor = 4.4, colH = 12.6, at = Array.from({ length: n }, (_, i) => 1.05 + i * (L - 2.1) / (n - 1)), g = proud(w, pod);
  S.wall(M.granite, w.a, w.b, foot, y(T), y(T), w.n); pier(S, M.base, w, 0, L, pod, foot, y(floor), { top: M.stone }); band(S, M.stone, g, 0, L, y(floor - .16), .32, .14);
  for (const s of at) { const [x, z] = w.at(s, .95); column(S, M.stone, x, z, y(floor), colH, .68, { order: 'ionic', yaw: w.yaw }); }
  for (let i = 0; i + 1 < n; i++) {
    const s = (at[i] + at[i + 1]) / 2, mid = i === 10;
    framedWindow(S, k, w, s, y(floor + 1.3), 1.7, 5.6, M.stone, { panes: [2, 4], hood: true });
    { const [x, z] = w.at(s, .04); S.box(M.panel, 2, 1.5, .08, x, y(floor + 10.4), z, w.yaw); }
    if (mid) door(S, k, g, s, y(-.15), 2.2, 3.4, { leaf: k.bronze, frame: M.stone }); else rectWindow(S, k, g, s, y(.7), 1.4, 2.1, { frame: k.sash, panes: [2, 2], sill: M.stone });
  }
  // Entablature on the columns, with the parapet (the shell's wall) over it.
  const top = floor + colH;
  pier(S, M.stone, w, 0, L, pod - .05, y(top), y(top + 2.3), { bottom: M.stone, solid: false }); band(S, M.stone, proud(w, pod - .05), 0, L, y(top + .85), .1, .08);
  pier(S, M.stone, w, -.2, L + .2, pod + .2, y(top + 2.3), y(top + 2.55), { solid: false }); pier(S, M.stone, w, -.5, L + .5, pod + .65, y(top + 2.55), y(top + 3.05), { solid: false });
  for (let s = .5; s < L; s += 1.08) { const [x, z] = w.at(s, pod + .38); S.box(M.stone, .3, .24, .34, x, y(top + 2.42), z, w.yaw); }
  band(S, M.stone, w, 0, L, y(T - .1), .2, .1);
  // End pavilions: a tall framed window between antae, the entablature carried round.
  for (const p of [wallOf(f.W(122.5, 143.94), f.W(111, 143.94)), wallOf(f.W(40.94, 144.49), f.W(29.54, 144.49))]) {
    const l = p.length;
    S.wall(M.granite, p.a, p.b, foot, y(T), y(T), p.n); pier(S, M.base, p, 0, l, .28, foot, y(floor), { top: M.stone }); band(S, M.stone, p, -.3, l + .3, y(floor - .16), .32, .42);
    for (const s of [.7, l - .7]) pier(S, M.stone, p, s - .6, s + .6, .16, y(floor), y(top), { solid: false });
    framedWindow(S, k, p, l / 2, y(floor + 1.3), 2.6, 6.6, M.stone, { panes: [2, 4], hood: true }); rectWindow(S, k, proud(p, .28), l / 2, y(.7), 1.6, 2.1, { frame: k.sash, panes: [2, 2], sill: M.stone });
    { const [x, z] = p.at(l / 2, .04); S.box(M.panel, 3.2, 1.5, .08, x, y(floor + 10.4), z, p.yaw); }
    band(S, M.stone, p, -.12, l + .12, y(top + .42), .85, .12); band(S, M.stone, p, -.22, l + .22, y(top + 2.42), .26, .22); band(S, M.stone, p, -.62, l + .62, y(top + 2.8), .5, .62); band(S, M.stone, p, -.1, l + .1, y(T - .1), .2, .1);
  }
}

/** Cyrus Dallin's "Appeal to the Great Spirit" (bronze, 1908, set up here in 1912): a rider on a standing horse, his
 * arms spread low and wide and his head thrown back to the sky, on a granite pedestal. Built from tapered rods and
 * spheres at a little over life size (2.9 m of bronze); `yaw` is the way the horse faces. */
function appealToTheGreatSpirit(S: Shapes, k: SiteKit, x: number, z: number, ground: number, yaw: number, granite: THREE.Material, stone: THREE.Material) {
  const bronze = k.tint('verdigris', '#587869'), sc = 1.14, top = ground + 2.05, fw: Point2 = [Math.sin(yaw), Math.cos(yaw)], sd: Point2 = [Math.cos(yaw), -Math.sin(yaw)];
  const P = (a: number, b: number, h: number): V3 => [x + (fw[0] * a + sd[0] * b) * sc, top + .08 + h * sc, z + (fw[1] * a + sd[1] * b) * sc];
  const rod = (a: V3, b: V3, ra: number, rb = ra, n = 8) => S.rod(bronze, a, b, ra * sc, rb * sc, n), ball = (p: V3, r: number, squash: V3 = [1, 1, 1]) => S.place(bronze, new THREE.SphereGeometry(r * sc, 12, 9), p[0], p[1], p[2], yaw, 0, 0, squash);
  // Pedestal: base course, die and cap of granite.
  S.block(granite, 2.1, 4, x, z, ground - 1.2, ground + .4, yaw, { top: stone }); S.block(granite, 1.6, 3.5, x, z, ground + .4, top - .22, yaw); S.block(granite, 1.9, 3.8, x, z, top - .22, top, yaw, { top: stone });
  S.box(bronze, 1.05 * sc, .08, 2.7 * sc, x, top + .04, z, yaw);
  // The horse: barrel, quarters and chest, neck stretched forward with the head lowered, four legs standing square, the tail.
  rod(P(-.7, 0, 1.2), P(-.15, 0, 1.15), .3, .33, 12); rod(P(-.15, 0, 1.15), P(.55, 0, 1.22), .33, .28, 12); ball(P(-.72, 0, 1.2), .31, [1, 1.05, 1.1]); ball(P(.56, 0, 1.22), .29, [.95, 1.05, 1]); ball(P(-.1, 0, 1.12), .34, [.98, 1, 1.9]);
  rod(P(.48, 0, 1.3), P(1.02, 0, 1.52), .24, .14, 10); S.beam(bronze, P(.5, 0, 1.52), P(1, 0, 1.68), .05 * sc, .12 * sc);
  rod(P(.98, 0, 1.58), P(1.36, 0, 1.2), .14, .08, 10); ball(P(1.37, 0, 1.19), .085); ball(P(1, 0, 1.57), .15);
  for (const b of [-1, 1]) {
    rod(P(1, b * .07, 1.66), P(.97, b * .09, 1.82), .04, .008, 6);
    rod(P(.5, b * .17, 1.12), P(.52, b * .17, .56), .12, .07); rod(P(.52, b * .17, .56), P(.52, b * .17, .13), .062, .05); rod(P(.52, b * .17, .13), P(.56, b * .17, 0), .055, .085); ball(P(.52, b * .17, .56), .075);
    rod(P(-.6, b * .19, 1.1), P(-.84, b * .19, .6), .16, .08); rod(P(-.84, b * .19, .6), P(-.74, b * .19, .13), .065, .05); rod(P(-.74, b * .19, .13), P(-.7, b * .19, 0), .055, .085); ball(P(-.84, b * .19, .6), .08);
  }
  rod(P(-.96, 0, 1.32), P(-1.12, 0, 1), .06, .09); rod(P(-1.12, 0, 1), P(-1.1, 0, .42), .09, .03);
  // The rider, bareback: torso leaning back, the head tipped to the sky, arms out to either side with the palms up, the legs hanging.
  rod(P(-.03, 0, 1.46), P(-.13, 0, 2.02), .17, .19, 10); ball(P(-.13, 0, 2.02), .2, [1.25, .6, .8]); ball(P(-.03, 0, 1.5), .19, [1.1, .7, 1]);
  rod(P(-.14, 0, 2.05), P(-.2, 0, 2.2), .06, .055, 6); ball(P(-.23, 0, 2.27), .115, [.9, 1, 1.1]);
  for (let i = -3; i <= 3; i++) rod(P(-.27, i * .03, 2.3), P(-.5 + Math.abs(i) * .025, i * .11, 2.36 - Math.abs(i) * .045), .022, .006, 5);
  S.beam(bronze, P(-.3, 0, 2.18), P(-.44, 0, 1.52), .2 * sc, .04 * sc);
  for (const b of [-1, 1]) {
    rod(P(-.13, b * .23, 2), P(-.06, b * .5, 1.74), .065, .052); rod(P(-.06, b * .5, 1.74), P(.1, b * .8, 1.64), .05, .04); ball(P(.12, b * .84, 1.64), .055, [1.2, .5, 1]);
    rod(P(-.03, b * .15, 1.48), P(.3, b * .34, 1.2), .1, .075); rod(P(.3, b * .34, 1.2), P(.22, b * .37, .78), .07, .048); rod(P(.22, b * .37, .78), P(.36, b * .37, .7), .045, .032, 6);
  }
  S.solidBox(1.9, 3.8, x, z, ground - 1.2, top + 2.6, yaw);
}

/** Museum of Fine Arts, Huntington Avenue (Guy Lowell, 1907-09): the 150 m granite front. The surveyed shell keeps its
 * massing: two outer ranges, two wings that come forward to pedimented pavilions and enclose the forecourt lawn, and
 * the centre block behind the Ionic temple portico. This model is the facade laid on those wall planes. */
const mfa: SiteModel = {
  id: 'mfa-huntington', name: 'Museum of Fine Arts, Huntington Avenue front', place: 'huntington-mfa', tile: '-2_1', at: [-1586.2, 1201.7],
  finish: Object.fromEntries(MFA_SHELLS.map(id => [id, { wall: MFA_STONE, roof: '#8e908d' }])),
  // The hull of the 26,000 m2 shell fills the forecourt: collided by its own walls, the steps and the drive can be reached.
  exact: ['BOS-3E07U-O3HT3-8U178'],
  note: 'Guy Lowell, 1907-09, grey granite: tetrastyle Ionic portico, forecourt wings with pedimented pavilions, outer ranges, and Cyrus Dallin\'s Appeal to the Great Spirit (1908) on the lawn. Laid on the surveyed wall planes and heights; bay counts, window forms, the pavilions\' columns and the figure are interpretive',
  build({ k, ground }) {
    const S = new Shapes(), f = mfaFrame(), y = (h: number) => MFA_BASE + h, foot = MFA_BASE - 3.2;
    const M: MfaStone = { granite: k.tint('concrete', MFA_STONE), base: k.tint('granite', '#a3a19b'), stone: k.tint('trim', '#b9b7b1'), panel: k.tint('trim', '#a5a39d'), shade: k.tint('seam', '#8f9391') };
    const front = (u0: number, u1: number, v: number) => wallOf(f.W(u0, v - .06), f.W(u1, v - .06)), east = (u: number, v0: number, v1: number) => wallOf(f.W(u + .06, v0), f.W(u + .06, v1)), west = (u: number, v0: number, v1: number) => wallOf(f.W(u - .06, v1), f.W(u - .06, v0));
    const C = 75.22;
    { // Outer ranges, five bays each to the avenue, with their end walls, and the pavilions of the two wings.
      mfaWing(S, k, front(-1.38, 28.72, 0), y, foot, 16.87, spread(1.38 + 1.2, 1.38 + 27.6, 5), M, [.62, 0]);
      mfaWing(S, k, west(-1.32, 0, 29.82), y, foot, 16.87, spread(1.6, 28.2, 5), M, [.62, .62]);
      mfaPavilion(S, k, f, y, foot, [[28.72, 30.31, -1.26], [30.31, 38.62, -3.27], [38.62, 40.26, -1.4]], M);
      mfaWing(S, k, wallOf(f.W(121.65, -.26), f.W(151.56, -.47)), y, foot, 17.37, spread(1.2, 27.6, 5), M, [0, .62]);
      mfaWing(S, k, east(151.5, -.47, 28.9), y, foot, 17.37, spread(1.9, 27.9, 5), M, [.62, .62]);
      mfaPavilion(S, k, f, y, foot, [[109.74, 111.47, -1.82], [111.47, 119.9, -3.87], [119.9, 121.65, -2.09]], M);
    }
    { // Forecourt: the wings' inner walls and the centre block either side of the portico.
      mfaWing(S, k, wallOf(f.W(40.08, -1.46), f.W(40.46, 28.56)), y, foot, 18.61, spread(1.2, 30, 5), M, [.62, 0]);
      mfaWing(S, k, front(40.44, 65.99, 28.62), y, foot, 18.61, spread(.42, 25.02, 5), M);
      mfaWing(S, k, front(84.34, 110.34, 28.69), y, foot, 18.61, spread(.64, 25.24, 5), M);
      // The east wing's inner wall: a later block stands a metre into the court where its middle bay would be, and the wall beyond it lies back.
      mfaWing(S, k, west(109.8, -1.88, 11.4), y, foot, 18.61, [11.4 - 8.38, 11.4 - 2.62], M, [0, .62]);
      mfaWing(S, k, west(108.9, 11.4, 17), y, foot, 18.61, [], M, [.62, .62]);
      mfaWing(S, k, wallOf(f.W(110.34, 28.63), f.W(110.14, 17)), y, foot, 18.61, [28.63 - 25.66, 28.63 - 19.9], M);
      for (const w of [front(108.84, 109.74, 11.4), wallOf(f.W(110.14, 17.06), f.W(108.84, 17.06))]) S.wall(M.granite, w.a, w.b, foot, y(18.61), y(18.61), w.n);
    }
    {
      // The central pavilion: shoulders either side of the portico, to the height of its entablature.
      const T = 23.47, pf = front(68.59, 81.855, 20.62), a0 = 19.47;
      for (const w of [front(65.93, 68.59, 24.97), front(81.855, 84.4, 24.9), west(65.99, 24.91, 28.62), east(84.34, 24.84, 28.69)]) { S.wall(M.granite, w.a, w.b, foot, y(T), y(T), w.n); pier(S, M.base, w, 0, w.length, .28, foot, y(2.3), { top: M.stone }); band(S, M.stone, w, 0, w.length, y(2.45), .3, .42); band(S, M.stone, w, 0, w.length, y(a0 + .6), 1.2, .14); }
      // Porch wall in shade behind the columns, with the three doors and the windows over them.
      const porch = k.tint('granite', '#85837d');
      for (const w of [pf, west(68.59, 20.56, 24.97), east(81.855, 20.56, 24.97)]) { S.wall(w === pf ? porch : M.granite, w.a, w.b, foot, y(a0), y(a0), w.n); }
      for (const [s, dw, dh] of [[pf.length / 2, 2.6, 5.2], [pf.length / 2 - 3.75, 2, 4.4], [pf.length / 2 + 3.75, 2, 4.4]]) { door(S, k, pf, s, y(2.6), dw, dh, { leaf: k.bronze, frame: M.stone }); rectWindow(S, k, pf, s, y(2.6) + dh + 2.6, dw, 3.4, { frame: k.sash, panes: [2, 3], sill: M.stone, head: M.stone }); }
      // Stylobate and the flight of steps down to the forecourt, between stepped cheek blocks with bronze lamps.
      const sw = 15.2, run = stairs(S, M.granite, pf, pf.length / 2, sw, y(2.6), 22, { rise: .168, tread: .36, landing: 2.5 });
      for (const side of [-1, 1]) {
        const s = pf.length / 2 + side * (sw / 2 + .65);
        for (const [d0, d1, top] of [[0, 3.6, 2.95], [3.6, 7, 1.45], [7, run + .3, -.1]]) pier(S, M.granite, proud(pf, d0, s - .65, s + .65), 0, 1.3, d1 - d0, foot, y(top), { top: M.stone });
        for (const [d, top] of [[5.3, 1.45], [run - 1.5, -.1]]) { const [x, z] = pf.at(s, d); S.block(M.stone, .7, .7, x, z, y(top), y(top + .5), pf.yaw, { solid: false }); lampPost(S, k, x, y(top + .5), z, 2.6); }
      }
      // Four Ionic columns, the entablature with the museum's name on its frieze, and the pediment.
      for (const du of [-5.6, -1.87, 1.87, 5.6]) { const [x, z] = pf.at(pf.length / 2 + du, 1.15); column(S, M.stone, x, z, y(2.6), a0 - 2.6, .92, { order: 'ionic', yaw: pf.yaw }); S.solidBox(1.9, 1.9, x, z, y(2.6), y(a0), pf.yaw); }
      for (const w of [west(68.59, 23.9, 24.97), east(81.855, 23.9, 24.97)]) pier(S, M.stone, w, 0, w.length, .22, y(2.6), y(a0), { solid: false });
      S.prism(M.stone, rectPoly(f, { u0: C - 6.92, u1: C + 6.92, v0: 20.62 - 2.1, v1: 24.97 }), y(a0), y(22.1), { bottom: M.stone, solid: false });
      { const w = proud(pf, 2.1, -.3, pf.length + .3); band(S, M.stone, w, 0, w.length, y(a0 + 1.26), .12, .1); signBoard(S, k, w, w.length / 2, y(21.4), 11.6, 1.05, 'MUSEUM OF FINE ARTS', { color: '#55534e', background: '#b9b7b1', out: .02, font: '600 104px Georgia, serif' }); }
      S.prism(M.stone, rectPoly(f, { u0: C - 7.2, u1: C + 7.2, v0: 20.62 - 2.4, v1: 24.97 }), y(22.1), y(22.45), { solid: false });
      S.prism(M.stone, rectPoly(f, { u0: C - 7.65, u1: C + 7.65, v0: 20.62 - 2.85, v1: 24.97 }), y(22.45), y(23.05), { solid: false });
      for (let s = -6.6; s <= 6.61; s += 1.1) { const [x, z] = pf.at(pf.length / 2 + s, 2.52); S.box(M.stone, .34, .3, .34, x, y(22.29), z, pf.yaw); }
      pediment(S, M.stone, pf, pf.length / 2 - 7.45, pf.length / 2 + 7.45, y(23.05), 2.15, 2.85, { tympanum: M.granite, roof: M.shade });
      S.prism(M.stone, rectPoly(f, { u0: 65.6, u1: 84.74, v0: 24.55, v1: 28.6 }), y(22.45), y(23.05), { solid: false });
    }
    mfaEvans(S, k, f, y, foot, M);
    { const [x, z] = f.W(C, -10.5); appealToTheGreatSpirit(S, k, x, z, ground(x, z), Math.atan2(-f.V[0], -f.V[1]), M.granite, M.stone); }
    return S;
  },
};

// ------------------------------------------------------------------ Peter Bent Brigham Hospital, Francis Street
/** Axes of the old administration building's surviving block, measured on the hospital's one great shell
 * (BOS-XFBKR-9L3KX-5UV9C, which is not refinished: it is the whole modern hospital): u east along the south front
 * from the block's north-west corner, v north into the building, heights over the shell's base, 10.4 m. The block
 * is 18.3 m wide and 20.4 m deep; its front wall stands at v = -20.37 and its walls are 14 m high. */
const PBB_ORIGIN: Point2 = [-2515.79, 1700.13], PBB_BASE = 10.405;
const pbbFrame = () => frame(PBB_ORIGIN, [PBB_ORIGIN[0] + 92.643, PBB_ORIGIN[1] + 37.647], [-2504.5, 1672.3]);

/** Peter Bent Brigham Hospital, administration building (Codman & Despradelle, 1911-13), 15 Francis Street: the
 * six-column portico and pediment toward Francis Street and Brigham Circle. The block that carries it is one corner
 * of the hospital's surveyed shell, so the model is a skin of brick and stone round that block, the portico before
 * its south wall and a low gabled roof behind the pediment, where the survey has a ridge. */
const brigham: SiteModel = {
  id: 'peter-bent-brigham', name: 'Peter Bent Brigham Hospital portico', place: 'brigham-circle', tile: '-3_1', at: [-2511.2, 1712.8],
  note: 'Codman & Despradelle, 1911-13, Classical Revival: six monumental Doric columns and a pediment on the south entry, set on the 18.3 m block of the surveyed hospital shell. Brick walls with stone trim follow one source; the order, the window rows, the steps and the roof are interpretive',
  build({ k, ground }) {
    const S = new Shapes(), f = pbbFrame(), y = (h: number) => PBB_BASE + h, foot = PBB_BASE - 3.4, T = 14.02, floor = -.85;
    const brick = k.tint('brick', '#97584a'), stone = k.tint('trim', '#d9d4c6'), lime = k.tint('limestone', '#d2cbb8'), sash = k.whiteSash;
    const south = wallOf(f.W(-.3, -20.5), f.W(18.27, -20.5)), west = wallOf(f.W(-.3, .2), f.W(-.3, -20.5)), east = wallOf(f.W(18.27, -20.5), f.W(18.27, -5.9)), north = wallOf(f.W(13.4, .2), f.W(-.3, .2)), L = south.length, mid = L / 2;
    for (const w of [south, west, east, north]) S.wall(brick, w.a, w.b, foot, y(T), y(T), w.n);
    // Three rows of windows: behind the columns about the door, and along the sides.
    const rows: [number, number][] = [[.5, 2.7], [5, 2.6], [8.7, 1.45]], win = (w: WallFrame, s: number, r: number) => rectWindow(S, k, w, s, y(rows[r][0]), 1.4, rows[r][1], { frame: sash, panes: r === 2 ? [2, 1] : [2, 3], sill: stone, head: stone });
    for (const du of [-6.6, -3.3, 0, 3.3, 6.6]) for (let r = 0; r < 3; r++) if (du || r) win(south, mid + du, r);
    door(S, k, south, mid, y(floor), 2.1, 3.3, { leaf: k.tint('door', '#2c2824'), frame: stone, fan: true });
    for (const s of [2.5, 9.7, 13.4, 17.1]) for (let r = 0; r < 3; r++) win(west, s, r);
    // The chimney breast on the west wall (the survey has its 2.6 m bay), carried up as a stack.
    pier(S, brick, west, 4.3, 7.3, 1.25, foot, y(17.2), { top: stone }); band(S, stone, proud(west, 1.25), 4.2, 7.4, y(17.05), .3, .12);
    for (const s of [3.2, 8.6, 12.4]) for (let r = s < 6 ? 2 : 0; r < 3; r++) win(east, s, r);
    for (const w of [west, east]) { band(S, stone, w, 0, w.length, y(floor + .1), .3, .14); band(S, stone, w, 0, w.length, y(11.4), .8, .12); band(S, stone, w, 0, w.length, y(13.1), .26, .3); band(S, stone, w, 0, w.length, y(13.5), .5, .75); }
    // Portico: podium and steps, six columns, entablature and pediment; the low roof runs back to the survey's ridge end.
    pier(S, k.granite, south, -.3, L + .3, 1.72, foot, y(floor), { top: k.paving });
    stairs(S, k.granite, proud(south, 1.72), mid, 9.9, y(floor), 4, { rise: .175, tread: .28 });
    for (const du of [-8.25, -4.95, -1.65, 1.65, 4.95, 8.25]) { const [x, z] = south.at(mid + du, .8); column(S, stone, x, z, y(floor), 11 - floor, .66, { order: 'doric', yaw: south.yaw }); S.solidBox(1.4, 1.4, x, z, y(floor), y(11), south.yaw); }
    pier(S, lime, south, -.35, L + .35, 1.6, y(11), y(13.1), { bottom: stone, solid: false }); band(S, stone, proud(south, 1.6), -.35, L + .35, y(11.85), .12, .1);
    pier(S, stone, south, -.65, L + .65, 1.9, y(13.1), y(13.4), { solid: false }); pier(S, stone, south, -1.05, L + 1.05, 2.35, y(13.4), y(T), { solid: false });
    for (let s = -.2; s < L + .3; s += .95) { const [x, z] = south.at(s, 2.08); S.box(stone, .3, .24, .34, x, y(13.26), z, south.yaw); }
    const roof = { u0: -.3, u1: 18.27, v0: -22.1, v1: -9.8 }, rise = 2.3, pitch = rise / ((roof.u1 - roof.u0) / 2);
    gable(S, f, roof, y(T), rise, k.slate, { axis: 'v', wall: lime, overhang: .9 });
    for (const side of [-1, 1]) { const a = f.W(8.985 + side * 10.2, -22.6), b = f.W(8.985, -22.6); S.beam(stone, [a[0], y(T) - .9 * pitch - .12, a[1]], [b[0], y(T) + rise - .12, b[1]], .9, .34); }
    { const [x, z] = south.at(mid, 1.62); S.place(k.glass, new THREE.CircleGeometry(.62, 20), x, y(T + 1), z, south.yaw); S.place(stone, new THREE.RingGeometry(.62, .8, 24), x, y(T + 1), z + 0, south.yaw); }
    for (const side of [-1, 1]) { const [x, z] = south.at(mid + side * 5.6, 3.1); lampPost(S, k, x, ground(x, z), z, 3); }
    // The rotunda behind the east wing: its surveyed drum in the same brick, under a shallow copper dome.
    { const drum = ([[21.9, -7.5], [21.9, -11.65], [23.2, -13.3], [24.55, -14.3], [27.15, -14.27], [28.63, -13.68], [30.12, -12.33], [30.72, -11.26], [30.72, -7.5]] as Point2[]).map(([u, v]) => f.W(u, v)), [x, z] = f.W(26.3, -10.6);
      S.prism(brick, drum, foot, y(18.01), { top: null }); course(S, stone, drum, y(17.8), .42, .2); dome(S, k.copper, x, y(18.01), z, 4.3, 1.9, 24); S.place(k.copper, new THREE.CylinderGeometry(.5, .6, .9, 10), x, y(20.2), z); }
    // The low wing beside the block on the east, in the same brick.
    for (const w of [wallOf(f.W(18.27, -20.93), f.W(28.1, -20.93)), wallOf(f.W(28.1, -20.93), f.W(28.1, -14.54)), wallOf(f.W(28.1, -14.54), f.W(18.27, -14.54))]) {
      S.wall(brick, w.a, w.b, foot, y(9.76), y(9.76), w.n); band(S, stone, w, 0, w.length, y(9.6), .3, .14);
      if (w.length > 8) for (const s of spread(.8, w.length - .8, 3)) for (let r = 0; r < 2; r++) win(w, s, r);
    }
    return S;
  },
};

// ------------------------------------------------------------------ Burnham Building (Filene's), Downtown Crossing
const FILENES = 'BOS-DA92S-AMYZE-IVG81', FIL_BASE = 5.661, FIL_WALL = '#a3a595';
/** Burnham Building, the former Filene's (Daniel H. Burnham & Co., 1911-12), 426 Washington Street: eight storeys
 * of glazed terra cotta on Washington, Summer and Hawley Streets. The surveyed shell keeps its mass (the upper walls,
 * and a ground storey that stands out to the line of the marquee); this model is the three street fronts on those
 * planes: shopfronts under the marquee, the glazed second storey, five storeys of wide three-part windows between
 * piers, the attic and the deep cornice, with the clock on the Washington and Summer Street corner. */
const filenes: SiteModel = {
  id: 'burnham-filenes', name: 'Burnham Building (Filene\'s)', place: 'downtown-crossing', tile: '1_-1', at: [1227.83, -595.51],
  finish: { [FILENES]: { wall: FIL_WALL, roof: '#73756f' } },
  note: 'Daniel H. Burnham & Co., 1911-12, Beaux-Arts: glazed terra cotta and wide three-part windows on the surveyed wall planes of Washington, Summer and Hawley Streets, a two-storey glazed base under a marquee, attic and deep cornice. Bay counts, storey heights, the grey-green of the terra cotta and the corner clock are interpretive; the shop lettering is that of the present tenants',
  build({ k, ground }) {
    const S = new Shapes(), y = (h: number) => FIL_BASE + h, foot = FIL_BASE - 3.6, T = 41.72;
    const tc = k.tint('castStone', FIL_WALL), trim = k.tint('trim', '#b7b9aa'), dark = k.tint('trim', '#8f9183'), iron = k.tint('iron', '#27352f'), sash = k.tint('sash', '#59665d'), bronze = k.tint('bronze', '#4a4436');
    const W: Point2 = [1190.08, -602.35], N: Point2 = [1219.49, -638.3], K: Point2 = [1212.79, -580.54], So: Point2 = [1239.5, -553.72], E: Point2 = [1268.09, -590.43];
    // Upper walls: [wall, bays, pier at its left end, pier at its right end].
    const upper: [WallFrame, number, number, number][] = [[wallOf(N, W), 7, 1.7, 1.7], [wallOf(W, K), 5, 1.7, 1.1], [wallOf(K, So), 6, 0, 1.7], [wallOf(So, E), 7, 1.7, 1.7]];
    const floors = [10.6, 15.1, 19.6, 24.1, 28.6];
    for (const [w, n, pl, pr] of upper) {
      const L = w.length, bw = L / n;
      for (let i = 0; i <= n; i++) { const pw = i === 0 ? pl : i === n ? pr : 1.1, s = i === 0 ? pw / 2 : i === n ? L - pw / 2 : i * bw; if (pw) pier(S, tc, w, s - pw / 2, s + pw / 2, .3, y(5.73), y(37.9), { solid: false, top: null }); }
      for (let i = 0; i < n; i++) {
        const s = (i + .5) * bw, gw = bw - 1.5, three = (y0: number, h: number, frame: THREE.Material, bars: number) => {
          const [x, z] = w.at(s, .05), [fx, fz] = w.at(s, .1); S.place(k.glass, new THREE.PlaneGeometry(gw, h), x, y0 + h / 2, z, w.yaw);
          for (const du of [-.5, -.27, .27, .5]) { const [mx, mz] = w.at(s + du * gw, .1); S.box(frame, Math.abs(du) === .5 ? .12 : .09, h, .12, mx, y0 + h / 2, mz, w.yaw); }
          for (let b = 0; b <= bars; b++) S.box(frame, gw, b === 0 || b === bars ? .12 : .07, .12, fx, y0 + h * b / bars, fz, w.yaw);
        };
        // The glazed second storey in its iron frame, then five storeys of three-part windows over panelled spandrels, and the attic.
        three(y(6.3), 3.6, iron, 2);
        for (const fl of floors) { three(y(fl + 1.15), 2.75, sash, 1); const [x, z] = w.at(s, .06), [sx, sz] = w.at(s, .1); S.box(dark, gw - .5, .7, .08, x, y(fl + .5), z, w.yaw); S.box(trim, gw + .2, .16, .2, sx, y(fl + 1.07), sz, w.yaw); }
        three(y(34.1), 2.5, sash, 1);
        for (const du of [-.27, .27]) { const [x, z] = w.at(s + du * gw, .12); S.box(trim, .34, 3.3, .2, x, y(35.2), z, w.yaw); }
      }
      band(S, trim, w, pl ? -.5 : 0, L + (pr > 1.2 ? .5 : 0), y(10.25), .5, .5); band(S, trim, w, pl ? -.4 : 0, L + (pr > 1.2 ? .4 : 0), y(33.3), .4, .4);
      // The cornice: bed mould, modillions, corona and cymatium, under the parapet.
      const e0 = pl ? -1.5 : 0, e1 = L + (pr > 1.2 ? 1.5 : 0);
      band(S, trim, w, e0 + 1, e1 - 1, y(38.15), .5, .5); band(S, trim, w, e0, e1, y(38.95), .55, 1.5); band(S, trim, w, e0 - .1, e1 + .1, y(39.35), .25, 1.62); band(S, trim, w, pl ? -.12 : 0, L + (pr > 1.2 ? .12 : 0), y(T - .12), .24, .12);
      for (let s2 = .5; s2 < L; s2 += 1.06) { const [x, z] = w.at(s2, .95); S.box(trim, .36, .32, .9, x, y(38.52), z, w.yaw); }
    }
    // Ground storey on the line of the marquee: shop windows in iron frames over a stone base, and the marquee's fascia.
    const P: Point2[] = [[1217.12, -639.58], [1188.3, -603.06], [1188.07, -601.51], [1188.99, -599.63], [1239.37, -551.25], [1241.76, -551.99], [1270, -588.74]];
    for (let i = 0; i + 1 < P.length; i++) {
      const w = proud(wallOf(P[i], P[i + 1]), .05), L = w.length, n = Math.max(1, Math.round(L / 6.6)), bw = L / n, street = L > 20;
      pier(S, k.granite, w, 0, L, .12, foot, y(.55), { top: trim });
      const [gx, gz] = w.at(L / 2, .04); S.place(k.shopGlass, new THREE.PlaneGeometry(L, 3.65), gx, y(.55 + 3.65 / 2), gz, w.yaw);
      for (let j = 0; j <= n; j++) { const [x, z] = w.at(Math.min(L - .25, Math.max(.25, j * bw)), .12); S.box(iron, .5, 3.65, .24, x, y(.55 + 3.65 / 2), z, w.yaw); }
      if (street) for (let j = 0; j < n; j++) for (const d of [1 / 3, 2 / 3]) { const [x, z] = w.at((j + d) * bw, .1); S.box(iron, .08, 3.65, .12, x, y(.55 + 3.65 / 2), z, w.yaw); }
      { const [x, z] = w.at(L / 2, .1); S.box(iron, L, .1, .12, x, y(3.25), z, w.yaw); }
      { const [x, z] = w.at(L / 2, .2); S.box(bronze, L + .3, 1.5, .4, x, y(4.97), z, w.yaw); const [tx, tz] = w.at(L / 2, .25); S.box(trim, L + .5, .14, .5, tx, y(5.73), tz, w.yaw); S.box(k.bulb, L - .4, .06, .06, tx, y(4.26), tz, w.yaw); }
      if (street) { const s = (Math.floor(n / 2) + .5) * bw, [x, z] = w.at(s, .3), g0 = ground(x, z) + .03; door(S, k, proud(w, .14), s, g0, 3.2, y(3.2) - g0, { glazed: true, leaf: iron, frame: iron }); }
      if (i === 0 || i === 3) signBoard(S, k, w, (Math.floor(n / 2) + .5) * bw, y(4.97), 5.4, 1, 'PRIMARK', { color: '#2aa7cf', background: '#f3f3ef', out: .42, lit: true, font: '700 110px Helvetica, Arial, sans-serif' });
      if (i === 3) signBoard(S, k, w, L - 1.5 * bw, y(4.97), 5.6, .9, 'ROCHE BROS.', { color: '#2c6b3c', background: '#f1efe6', out: .42, lit: true });
    }
    // The clock on the Washington and Summer Street corner: a four-faced bronze case on a bracket over the marquee.
    { const c: Point2 = [1188.07, -601.51], d: Point2 = [-.9985, .054], x = c[0] + d[0] * 1.25, z = c[1] + d[1] * 1.25, yaw = Math.atan2(d[0], d[1]);
      for (const h of [6.6, 8.3]) S.beam(bronze, [W[0], y(h), W[1]], [x, y(h + (h < 7 ? .5 : -.3)), z], .14, .14);
      const faces = S.block(bronze, 1.5, 1.5, x, z, y(6.85), y(8.35), yaw, { solid: false }); S.box(bronze, 1.75, .16, 1.75, x, y(8.43), z, yaw); S.box(bronze, 1.75, .16, 1.75, x, y(6.8), z, yaw);
      pyramidCap(S, bronze, x, z, y(8.51), .95, .7, yaw); S.place(k.gold, new THREE.SphereGeometry(.13, 10, 8), x, y(9.3), z);
      for (const w of faces) { const [dx, dz] = w.at(w.length / 2, .06); S.place(k.clock, new THREE.CircleGeometry(.6, 28), dx, y(7.6), dz, w.yaw); S.place(k.gold, new THREE.RingGeometry(.6, .68, 28), dx - w.n[0] * .01, y(7.6), dz - w.n[1] * .01, w.yaw); } }
    return S;
  },
};
/** A small four-sided cap: half-width r at y, rising h to a point. */
function pyramidCap(S: Shapes, m: THREE.Material, x: number, z: number, y: number, r: number, h: number, yaw: number) { S.place(m, new THREE.ConeGeometry(r * Math.SQRT2, h, 4), x, y + h / 2, z, yaw + Math.PI / 4); }

export const SITES: SiteModel[] = [mfa, brigham, filenes];
