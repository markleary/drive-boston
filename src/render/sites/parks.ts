import * as THREE from 'three';
import type { Point2 } from '../../types';
import { archShape, archWindow, band, chimney, cornice, course, door, frame, gable, hip, parapet, pediment, pyramid, railing, rectPoly, rectWalls, rectWindow, Shapes, signBoard, slope, spread, stairs, type Frame, type M, type SiteKit, type SiteModel, type V3, type WallFrame } from '../site-kit.ts';

// ------------------------------------------------------------------ shared parts
/** Distance along a wall frame of a plan point. */
const sOn = (w: WallFrame, p: Point2) => (p[0] - w.a[0]) * w.t[0] + (p[1] - w.a[1]) * w.t[1];
/** Half-timbering on a wall between y0 and y1: a stud at every bay line, a sill and a plate. */
function studs(S: Shapes, m: M, w: WallFrame, y0: number, y1: number, bays: number) {
  for (let i = 0; i <= bays; i++) { const [x, z] = w.at(Math.min(w.length - .08, Math.max(.08, w.length * i / bays)), .03); S.box(m, .16, y1 - y0, .08, x, (y0 + y1) / 2, z, w.yaw); }
  band(S, m, w, 0, w.length, y0, .16, .08); band(S, m, w, 0, w.length, y1 - .09, .18, .08);
}
/** Half-timbering in a gable over s0..s1 of a wall: studs up to the rake, the tie beam and a collar. */
function gableTimber(S: Shapes, m: M, w: WallFrame, s0: number, s1: number, y0: number, rise: number, step = .85) {
  const mid = (s0 + s1) / 2, half = (s1 - s0) / 2, top = (d: number) => rise * (1 - Math.abs(d) / half);
  for (let d = -half + step / 2; d < half; d += step) { const h = top(d) - .1; if (h < .25) continue; const [x, z] = w.at(mid + d, .03); S.box(m, .14, h, .08, x, y0 + h / 2, z, w.yaw); }
  band(S, m, w, s0, s1, y0, .2, .1); const c = .58, cw = half * (1 - c) - .1; band(S, m, w, mid - cw, mid + cw, y0 + rise * c, .16, .09);
}
/** An open boat lying at heading (bow toward it) on the water plane wl: lapped sides, floor, transom and thwarts. */
function boat(S: Shapes, hull: M, inner: M, x: number, z: number, heading: number, wl: number, len = 3.7, beam = 1.3) {
  const F: Point2 = [Math.sin(heading), Math.cos(heading)], R: Point2 = [F[1], -F[0]], N = 6, P = (l: number, h: number, s: number): V3 => [x + F[0] * l + R[0] * s, wl + h, z + F[1] * l + R[1] * s];
  const half = (t: number) => beam / 2 * Math.sqrt(Math.max(0, 1 - Math.max(0, (t - .4) / .6) ** 2.2)) * (.78 + .22 * Math.min(1, t / .3)), sheer = (t: number) => .34 + .12 * (2 * t - 1) ** 2;
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N, l0 = (t0 - .5) * len, l1 = (t1 - .5) * len;
    for (const side of [-1, 1]) { const q: V3[] = [P(l0, -.1, half(t0) * .5 * side), P(l1, -.1, half(t1) * .5 * side), P(l1, sheer(t1), half(t1) * side), P(l0, sheer(t0), half(t0) * side)]; S.poly(hull, q, [R[0] * side, .2, R[1] * side]); S.poly(inner, q, [-R[0] * side, .3, -R[1] * side]); }
    S.poly(inner, [P(l0, -.08, -half(t0) * .5), P(l1, -.08, -half(t1) * .5), P(l1, -.08, half(t1) * .5), P(l0, -.08, half(t0) * .5)], [0, 1, 0]);
  }
  S.poly(hull, [P(-len / 2, -.1, -half(0) * .5), P(-len / 2, -.1, half(0) * .5), P(-len / 2, sheer(0), half(0)), P(-len / 2, sheer(0), -half(0))], [-F[0], 0, -F[1]]);
  for (const t of [.3, .58]) { const p = P((t - .5) * len, .24, 0); S.box(inner, half(t) * 1.9, .04, .24, p[0], p[1], p[2], heading); }
}

// ------------------------------------------------------------------ Jamaica Pond
const POND_CREAM = '#e0d4b6', POND_TIMBER = '#5b4231';
/** Jamaica Pond Boathouse (William D. Austin of Stickney & Austin, 1910-12), the southern and larger of the pair on
 * the pond's east shore at the foot of Pond Street: "Tudor-Bungalow", one and a half storeys of painted brick and
 * stucco with dark half-timbering under a steep terracotta tile roof with copper gutters. The surveyed shell gives
 * the plan (15.7 by 8.8 m, long side to the water) and the porch bay on the path side; the cross gables, the veranda
 * toward the pond with its boat doors, the chimney of the fireplace room and the dock with its rowboats and small
 * sailboats are drawn from descriptions of the building and are interpretive in their measures. */
const boathouse: SiteModel = {
  id: 'jamaica-pond-boathouse', name: 'Jamaica Pond Boathouse', place: 'jamaica-pond', tile: '-4_3', building: 'BOS-3UKI1-VI2NL-LQXTV',
  note: 'William D. Austin (Stickney & Austin), 1910-12, Tudor-Bungalow: half-timbered stucco over painted brick, terracotta tile gable roof; plan from the surveyed shell, cross gables, veranda, chimney and dock interpretive',
  build({ k, ground, water }, b) {
    const S = new Shapes(), base = b?.baseElevation ?? 15.89, foot = base - 1.8, y = (h: number) => base + h;
    // North-west corner, u south along the wall that faces the pond (15.7 m), v inland (8.8 m).
    const f = frame([-3510.68, 3838.68], [-3516.24, 3853.17], [-3508.14, 3856.84]), L = 15.7, W = 8.8, eave = 3.1, rise = 4.5, sill = 1.05;
    const stucco = k.tint('stucco', POND_CREAM), painted = k.tint('brick', '#cbbd9d'), timber = k.tint('timber', POND_TIMBER), tile = k.tile, ridgeTile = k.tint('tile', '#8e4a30'), green = k.tint('door', '#34463a'), copper = k.tint('copperPlain', '#7c6a4d');
    const body = { u0: 0, u1: L, v0: 0, v1: W }, poly = rectPoly(f, body), walls = rectWalls(f, body), win = { frame: k.sash, sill: timber, panes: [2, 3] as [number, number] };
    S.prism(painted, poly, foot, y(sill), { top: null }); S.prism(stucco, poly, y(sill), y(eave), { top: null });
    const ridge = gable(S, f, body, y(eave), rise, tile, { wall: stucco, overhang: .4, trim: timber }); S.beam(ridgeTile, ridge[0], ridge[1], .24, .16);
    for (const w of [walls.front, walls.back]) { studs(S, timber, w, y(sill), y(eave), 6); const [ax, az] = w.at(0, .5), [bx, bz] = w.at(w.length, .5); S.beam(copper, [ax, y(eave - .5), az], [bx, y(eave - .5), bz], .12, .1); }
    // The gable ends: studs to the rake, the window of the room in the roof, windows and a door below.
    for (const w of [walls.left, walls.right]) {
      studs(S, timber, w, y(sill), y(eave), 4); gableTimber(S, timber, w, 0, W, y(eave), rise);
      rectWindow(S, k, w, W / 2, y(eave + .75), 1.5, 1.25, { ...win, panes: [3, 2] });
      for (const s of [W / 8, W * 7 / 8]) rectWindow(S, k, w, s, y(sill + .12), 1.1, 1.45, win);
      if (w === walls.left) door(S, k, w, W / 2, y(.05), 1.7, 2.3, { leaf: green, frame: timber }); else for (const s of [W * 3 / 8, W * 5 / 8]) rectWindow(S, k, w, s, y(sill + .12), 1.1, 1.45, win);
    }
    // Toward the pond: a cross gable over the pair of boat doors, and a veranda whose tile roof carries the main slope out on posts.
    const c = L / 2, cross = { u0: c - 2.62, u1: c + 2.62, v0: 0, v1: W / 2 }, front = walls.front, cs = sOn(front, f.W(c, 0));
    gable(S, f, cross, y(eave), 2.75, tile, { axis: 'v', wall: stucco, overhang: .35, trim: timber }); gableTimber(S, timber, front, cs - 2.62, cs + 2.62, y(eave), 2.75, .75);
    rectWindow(S, k, front, cs, y(eave + .55), 1.4, 1.1, { ...win, panes: [3, 2] });
    for (const d of [-1.3, 1.3]) door(S, k, front, cs + d, y(.05), 2.2, 2.35, { leaf: green, frame: timber });
    for (const s of [L / 12, L * 3 / 12, L * 9 / 12, L * 11 / 12]) rectWindow(S, k, front, s, y(sill + .12), 1.25, 1.45, win);
    const D = 2.6, deck = { u0: 0, u1: L, v0: -D, v1: 0 }, dw = rectWalls(f, deck), at = (u: number, v: number, h: number): V3 => { const p = f.W(u, v); return [p[0], y(h), p[1]]; };
    S.prism(painted, rectPoly(f, deck), foot, y(.04), { top: k.paleDeck });
    const roofAt = (p: Point2) => y(2.78 - .5 * Math.min(1, (-f.vOf(p) - .3) / (D + .15))), eavePoly = rectPoly(f, { u0: -.4, u1: L + .4, v0: -D - .45, v1: -.3 });
    slope(S, tile, eavePoly, roofAt, f.U, [-f.V[0], 1, -f.V[1]], false); slope(S, timber, eavePoly, p => roofAt(p) - .06, f.U, [f.V[0], -1, f.V[1]], false);
    for (let i = 0; i <= 6; i++) {
      const u = Math.min(L - .12, Math.max(.12, L * i / 6)), p = f.W(u, -D + .14); S.block(timber, .2, .2, p[0], p[1], y(.04), y(2.34), f.yaw, { top: null });
      for (const side of [-1, 1]) if (u + side * .6 > 0 && u + side * .6 < L) S.beam(timber, at(u, -D + .14, 1.75), at(u + side * .6, -D + .14, 2.3), .1, .12);
    }
    S.beam(timber, at(0, -D + .14, 2.36), at(L, -D + .14, 2.36), .16, .2); S.beam(copper, at(-.4, -D - .5, 2.24), at(L + .4, -D - .5, 2.24), .12, .1);
    railing(S, timber, [at(L / 2 - 2.6, -D + .14, .04), at(.12, -D + .14, .04), at(.12, -.1, .04)], .95, { spacing: 2.6, pickets: .16, post: .08 });
    railing(S, timber, [at(L / 2 + 2.6, -D + .14, .04), at(L - .12, -D + .14, .04), at(L - .12, -.1, .04)], .95, { spacing: 2.6, pickets: .16, post: .08 });
    stairs(S, k.granite, dw.front, sOn(dw.front, f.W(c, -D)), 5, y(.04), 4, { rise: .16, tread: .34 });
    // Toward the path and the Jamaicaway: the gabled porch on the surveyed bay, a smaller cross gable and the fireplace chimney.
    const back = walls.back, porch = { u0: .5, u1: 4.5, v0: W, v1: W + 1.4 }, pw = rectWalls(f, porch);
    S.prism(painted, rectPoly(f, porch), foot, y(sill), { top: null }); S.prism(stucco, rectPoly(f, porch), y(sill), y(2.6), { top: null });
    gable(S, f, { ...porch, v0: W - 2.2 }, y(2.6), 2.1, tile, { axis: 'v', wall: stucco, overhang: .3, trim: timber }); gableTimber(S, timber, pw.back, 0, 4, y(2.6), 2.1, .7);
    door(S, k, pw.back, 2, y(.05), 1.6, 2.25, { leaf: green, frame: timber }); for (const s of [.45, 3.55]) rectWindow(S, k, pw.back, s, y(sill + .25), .5, 1.1, { ...win, panes: [1, 3] });
    const ec = 8.6, es = sOn(back, f.W(ec, W));
    gable(S, f, { u0: ec - 1.9, u1: ec + 1.9, v0: W / 2, v1: W }, y(eave), 2, tile, { axis: 'v', wall: stucco, overhang: .3, trim: timber }); gableTimber(S, timber, back, es - 1.9, es + 1.9, y(eave), 2, .76);
    rectWindow(S, k, back, es, y(eave + .3), 1.2, .95, { ...win, panes: [3, 2] });
    for (const u of [5.9, 7.7, 9.5, 11.3, 14.4]) rectWindow(S, k, back, sOn(back, f.W(u, W)), y(sill + .12), 1.1, 1.45, win);
    { const p = f.W(12.9, W - 1.5); chimney(S, k.brick, p[0], p[1], y(2.4), y(8.5), 1.25, .85, f.yaw, k.castStone); for (const d of [-.3, .3]) { const q = f.W(12.9 + d, W - 1.5); S.place(k.tint('tile', '#9a5236'), new THREE.CylinderGeometry(.13, .16, .5, 8), q[0], y(8.8), q[1]); } }
    // The dock at the foot of the plaza's path: a plank deck on piles with a cross head, rowboats and two small sailboats alongside.
    const wl = water(-3536, 3818) ?? Math.min(ground(-3536, 3818), base - 1.8), d: Point2 = [-.916, -.401], n: Point2 = [.401, -.916], o: Point2 = [-3518.6, 3825.5], dyaw = Math.atan2(d[0], d[1]), len = 21, Q = (l: number, s: number): Point2 => [o[0] + d[0] * l + n[0] * s, o[1] + d[1] * l + n[1] * s], dockTop = wl + .46, wood = k.tint('paleDeck', '#8f8168');
    { const m = Q(len / 2, 0); S.block(wood, 2.3, len, m[0], m[1], dockTop - .14, dockTop, dyaw); const h = Q(len - 1.1, 0); S.block(wood, 9, 2.2, h[0], h[1], dockTop - .14, dockTop, dyaw); }
    for (let l = 3; l < len; l += 3) for (const s of [-1.1, 1.1]) { const p = Q(l, s); S.rod(timber, [p[0], wl - 1.2, p[1]], [p[0], dockTop + (l % 6 ? .05 : .75), p[1]], .1, .1, 7); }
    for (const s of [-4.4, 4.4]) for (const l of [len - 2.1, len - .1]) { const p = Q(l, s); S.rod(timber, [p[0], wl - 1.2, p[1]], [p[0], dockTop + .75, p[1]], .1, .1, 7); }
    const hulls = [k.whitePaint, k.tint('whitePaint', '#3f5c4a'), k.tint('whitePaint', '#9c3b30'), k.tint('whitePaint', '#31506e')], inner = k.tint('paleDeck', '#b79c70');
    [[6.5, -1.95, 0], [10.6, -1.95, 1], [14.7, -1.95, 2], [8.4, 1.95, 3], [12.6, 1.95, 0]].forEach(([l, s, i]) => { const p = Q(l, s); boat(S, hulls[i], inner, p[0], p[1], dyaw + Math.PI, wl); });
    for (const [s, i] of [[-3.3, 3], [3.2, 0]]) {
      const p = Q(len + .95, s), heading = dyaw + Math.PI / 2 * Math.sign(s), m = [p[0] + Math.sin(heading) * .5, p[1] + Math.cos(heading) * .5]; boat(S, hulls[i], inner, p[0], p[1], heading, wl, 4.3, 1.5);
      S.rod(k.tint('paleDeck', '#c9b48a'), [m[0], wl + .1, m[1]], [m[0], wl + 5.6, m[1]], .05, .035, 6); const e: V3 = [m[0] - Math.sin(heading) * 2.4, wl + .95, m[1] - Math.cos(heading) * 2.4]; S.rod(k.tint('paleDeck', '#c9b48a'), [m[0], wl + .9, m[1]], e, .04, .04, 6); S.rod(k.canvas, [m[0], wl + 1.02, m[1]], [e[0], e[1] + .1, e[2]], .1, .07, 6);
    }
    return S;
  },
};

/** The Bandstand beside the boathouse (same architect and years), the northern building of the pair: an enclosed
 * lower storey (ranger station and nature centre) carrying an open pavilion for concerts under a hipped terracotta
 * tile roof on timber posts. The surveyed shell gives the 8.1 by 8.5 m plan; the arched openings below, the posts,
 * brackets and railings and the stair from the plaza are interpretive. */
const bandstand: SiteModel = {
  id: 'jamaica-pond-bandstand', name: 'Jamaica Pond Bandstand', place: 'jamaica-pond', tile: '-4_3', building: 'BOS-5GEP1-MKWR8-2XALQ',
  note: 'William D. Austin (Stickney & Austin), 1910-12: stuccoed lower storey with an open timber pavilion above under a hipped terracotta tile roof; plan from the surveyed shell, openings, posts and stair interpretive',
  build({ k }, b) {
    const S = new Shapes(), base = b?.baseElevation ?? 15.93, foot = base - 1.8, y = (h: number) => base + h;
    // North-west corner, u south along the wall that faces the pond (8.08 m), v inland (8.48 m).
    const f = frame([-3500.59, 3816.17], [-3503.82, 3823.58], [-3492.82, 3819.56]), L = 8.08, W = 8.48, floor = 2.8, eave = 5.5, rise = 2.5, sill = 1.05;
    const stucco = k.tint('stucco', POND_CREAM), painted = k.tint('brick', '#cbbd9d'), timber = k.tint('timber', POND_TIMBER), green = k.tint('door', '#34463a'), body = { u0: 0, u1: L, v0: 0, v1: W }, poly = rectPoly(f, body), walls = rectWalls(f, body);
    S.prism(painted, poly, foot, y(sill), { top: null }); S.prism(stucco, poly, y(sill), y(floor - .2), { top: null });
    const slab = rectPoly(f, { u0: -.3, u1: L + .3, v0: -.3, v1: W + .3 }); S.prism(timber, slab, y(floor - .24), y(floor), { top: k.paleDeck, bottom: timber });
    for (const w of [walls.front, walls.back, walls.left, walls.right]) { for (const s of [.12, w.length - .12]) { const [x, z] = w.at(s, .03); S.box(timber, .2, floor - .24 - sill, .08, x, y((floor - .24 + sill) / 2), z, w.yaw); } band(S, timber, w, 0, w.length, y(sill), .16, .08); }
    // Below: three round arches toward the pond, the door on the path side, windows to the north.
    for (const s of spread(.4, L - .4, 3)) archWindow(S, k, walls.front, s, y(.25), 1.7, 1.45, { frame: k.sash, head: timber, sill: null, panes: [2, 2] });
    door(S, k, walls.back, W / 2, y(.05), 1.5, 2.2, { leaf: green, frame: timber }); for (const s of [1.5, W - 1.5]) rectWindow(S, k, walls.back, s, y(sill + .1), 1, 1.2, { frame: k.sash, sill: timber, panes: [2, 2] });
    for (const s of spread(.3, W - .3, 3)) rectWindow(S, k, walls.left, s, y(sill + .1), 1.1, 1.2, { frame: k.sash, sill: timber, panes: [2, 2] });
    // The stair from the plaza along the south wall, rising from the path side to a landing at the pavilion floor.
    const south = walls.right, steps = 16, tread = .29, sw = 1.35, top = south.length - .4 - steps * tread, land = top - 1.4;
    for (let i = 0; i < steps; i++) { const [x, z] = south.at(top + (steps - i - .5) * tread, sw / 2 + .3); S.block(painted, tread, sw, x, z, foot, y(floor * (i + 1) / (steps + 1)), south.yaw, { top: k.granite }); }
    { const [x, z] = south.at((top + land) / 2, sw / 2 + .3); S.block(painted, top - land, sw, x, z, foot, y(floor), south.yaw, { top: k.granite }); }
    const rail = (s: number, h: number): V3 => { const [x, z] = south.at(s, sw + .22); return [x, y(h), z]; }, endRail = (out: number): V3 => { const [x, z] = south.at(land + .08, out); return [x, y(floor), z]; };
    railing(S, timber, [rail(south.length - .4, 0), rail(top, floor), rail(land + .08, floor), endRail(.36)], .95, { spacing: 1.5, pickets: .16, post: .08 });
    // Above: posts with brackets, the railing between them (open at the landing) and the hipped roof with its boarded ceiling.
    const ring = rectPoly(f, { u0: .14, u1: L - .14, v0: .14, v1: W - .14 });
    for (let e = 0; e < 4; e++) {
      const a = ring[e], c = ring[(e + 1) % 4], len = Math.hypot(c[0] - a[0], c[1] - a[1]), t: Point2 = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
      for (let i = 0; i < 3; i++) {
        const p: Point2 = [a[0] + t[0] * len * i / 3, a[1] + t[1] * len * i / 3]; S.block(timber, .22, .22, p[0], p[1], y(floor), y(eave), f.yaw, { top: null });
        for (const [q, side] of [[p, 1], [[a[0] + t[0] * len * (i + 1) / 3, a[1] + t[1] * len * (i + 1) / 3], -1]] as [Point2, number][]) S.beam(timber, [q[0], y(eave - .95), q[1]], [q[0] + t[0] * side * .75, y(eave - .16), q[1] + t[1] * side * .75], .1, .14);
      }
    }
    course(S, timber, ring, y(eave - .13), .26, .09);
    const gapA = south.at(land - .02, -.14), gapB = south.at(top + .02, -.14), P3 = (p: Point2): V3 => [p[0], y(floor), p[1]];
    railing(S, timber, [P3(gapB), P3(ring[2]), P3(ring[3]), P3(ring[0]), P3(ring[1]), P3(gapA)], .95, { spacing: 2.7, pickets: .16, post: .08 });
    const hipped = hip(S, f, body, y(eave), rise, k.tile, { overhang: 1.25, trim: timber }); S.cap(k.tint('planks', '#7a5b3c'), rectPoly(f, { u0: -1.25, u1: L + 1.25, v0: -1.25, v1: W + 1.25 }), y(eave) - .1, false, false);
    { const [x, z] = f.W(L / 2, W / 2); S.rod(k.tint('copperPlain', '#7c6a4d'), [x, hipped.top - .1, z], [x, hipped.top + .9, z], .09, .02, 8); S.place(k.tint('copperPlain', '#7c6a4d'), new THREE.SphereGeometry(.16, 10, 8), x, hipped.top + .35, z); }
    return S;
  },
};

// ------------------------------------------------------------------ Arnold Arboretum
/** A gabled roof dormer on a slope that rises `pitch` from `eaveY` at `over` outside the wall line v = 0 of frame g. */
function dormer(S: Shapes, k: SiteKit, g: Frame, u: number, eaveY: number, pitch: number, over: number, cheeks: M, roof: M, trim: M, sash: M) {
  const w = 1.8, v0 = 1.35, at = (v: number) => eaveY + pitch * (v + over), top = at(v0) + 1.6, r = .7, rect = { u0: u - w / 2, u1: u + w / 2, v0, v1: v0 + 2.6 };
  S.prism(cheeks, rectPoly(g, rect), at(v0) - .35, top, { top: null, solid: false });
  gable(S, g, { ...rect, v1: (top + r - eaveY) / pitch - over }, top, r, roof, { axis: 'v', wall: cheeks, overhang: .2, trim, solid: false });
  rectWindow(S, k, rectWalls(g, rect).front, w / 2, at(v0) + .22, 1.15, 1.25, { frame: sash, sill: trim, panes: [2, 2] });
}
/** The Hunnewell Building at the Arborway Gate of the Arnold Arboretum (Alexander Wadsworth Longfellow Jr. of
 * Longfellow, Alden & Harlow, 1892): dark red-brown brick with brown sandstone trim under a black slate hip roof,
 * two storeys over a raised basement with a finished attic, its entrance in the middle of the south-east front;
 * behind it the three-storey link, the flat-roofed four-storey rear addition and the stair tower of 1993. The
 * surveyed outline gives every block (the front 31.5 by 12.8 m); storey heights, the nine bays, the door surround,
 * dormers and chimneys are drawn from descriptions and are interpretive. */
const hunnewell: SiteModel = {
  id: 'hunnewell-building', name: 'Hunnewell Building', place: 'arnold-arboretum', tile: '-4_4', building: 'BOS-G3956-V1I28-WJ1HE',
  note: 'A. W. Longfellow Jr., 1892: dark brick with sandstone trim, slate hip roof, central entrance; front block, link, rear addition and 1993 stair tower on the surveyed outline, bays, dormers and door surround interpretive',
  build({ k }, b) {
    const S = new Shapes(), base = b?.baseElevation ?? 13.89, foot = base - 2.4, y = (h: number) => base + h;
    // East corner, u south-west along the entrance front (31.55 m), v north-west into the building.
    const f = frame([-3749.25, 4763.97], [-3772.32, 4785.48], [-3757.98, 4754.6]), L = 31.55, D = 12.83, F1 = .3, F2 = 4.5, eave = 8.9, rise = 3.9, over = .55, pitch = rise / (D / 2 + over);
    const brick = k.tint('darkBrick', '#784539'), later = k.tint('darkBrick', '#80493b'), stone = k.tint('brownstone', '#8a6a55'), slate = k.tint('slate', '#3b3f42'), sash = k.cream, membrane = k.tint('concrete', '#d4d3cc');
    const A = { u0: 0, u1: L, v0: 0, v1: D }, pa = rectPoly(f, A), wa = rectWalls(f, A), win = { frame: sash, sill: stone, head: stone, panes: [2, 3] as [number, number] };
    S.prism(stone, pa, foot, y(F1), { top: null }); S.prism(brick, pa, y(F1), y(eave), { top: null });
    course(S, stone, pa, y(F1), .26, .1); course(S, stone, pa, y(F2 + .72), .22, .09); cornice(S, stone, pa, y(eave + .1), .8, .5);
    const roof = hip(S, f, A, y(eave), rise, slate, { overhang: over, trim: k.verdigris });
    S.beam(k.verdigris, [roof.inner[0][0], roof.top + .05, roof.inner[0][1]], [roof.inner[1][0], roof.top + .05, roof.inner[1][1]], .16, .14);
    // Windows bay by bay: tall on the first floor, the herbarium's above, small lights in the sandstone basement.
    const bays = (w: WallFrame, n: number, skip?: (i: number) => boolean) => spread(0, w.length, n).forEach((s, i) => {
      if (skip?.(i)) return;
      rectWindow(S, k, w, s, y(F1 + .95), 1.35, 2.45, win); rectWindow(S, k, w, s, y(F2 + .85), 1.35, 2.15, win); rectWindow(S, k, w, s, y(-.95), 1.1, .6, { frame: sash, sill: null, panes: [2, 1] });
      const [x, z] = w.at(s, .07); S.box(stone, .3, .4, .1, x, y(F2 + 3.14), z, w.yaw);
    });
    bays(wa.front, 9, i => i === 4); bays(wa.back, 9, i => i > 1 && i < 7); bays(wa.left, 3); bays(wa.right, 3);
    // The entrance: sandstone steps and landing, a pedimented surround with the fanlit door, an arched window over it.
    const mid = L / 2, front = wa.front;
    stairs(S, stone, front, mid, 4.2, y(F1), 7, { landing: 1.8, cheeks: stone, rise: .17 });
    door(S, k, front, mid, y(F1), 1.9, 2.6, { leaf: k.tint('door', '#2f3a30'), frame: stone, fan: true });
    for (const side of [-1, 1]) { const [x, z] = front.at(mid + side * 1.55, .16); S.block(stone, .5, .32, x, z, y(F1), y(F1 + 3.75), front.yaw); const [cx, cz] = front.at(mid + side * 1.55, .2); S.box(stone, .62, .2, .44, cx, y(F1 + 3.6), cz, front.yaw); }
    { const [x, z] = front.at(mid, .22); S.box(stone, 4, .5, .46, x, y(F1 + 4), z, front.yaw); } pediment(S, stone, front, mid - 2, mid + 2, y(F1 + 4.25), .95, .5, { tympanum: stone, roof: slate });
    archWindow(S, k, front, mid, y(F2 + 1.75), 1.5, 1.5, { frame: sash, head: stone, sill: stone });
    // Attic dormers on all four slopes, and the two chimneys through the ridge.
    const slopes: [Frame, number[]][] = [[f, [L * 3 / 18, mid, L * 15 / 18]], [frame(f.W(L, D), f.W(0, D), f.W(L, 0)), [L * 3 / 18, L * 15 / 18]], [frame(f.W(L, 0), f.W(L, D), f.W(0, 0)), [D / 2]], [frame(f.W(0, D), f.W(0, 0), f.W(L, D)), [D / 2]]];
    for (const [g, at] of slopes) for (const u of at) dormer(S, k, g, u, y(eave), pitch, over, slate, slate, k.verdigris, sash);
    for (const u of [L * .3, L * .7]) { const p = f.W(u, D / 2 + .9); chimney(S, brick, p[0], p[1], y(eave + 2.4), y(eave + rise + 1.7), 1.7, .9, f.yaw, stone); }
    // The link, the four-storey rear addition under its white membrane roof and the 1993 stair tower.
    const link = { u0: 9.31, u1: 23.55, v0: D, v1: 18.15 }, rear = { u0: 7.54, u1: 24.1, v0: 18.15, v1: 30.76 }, tower = { u0: 23.55, u1: 26.74, v0: 14.93, v1: 18.75 }, plain = { frame: sash, sill: stone, head: stone, panes: [2, 2] as [number, number] };
    S.prism(later, rectPoly(f, link), foot, y(10.4), { top: membrane }); course(S, stone, rectPoly(f, link), y(10.3), .24, .08);
    { const w = rectWalls(f, link).left; for (const h of [1.3, 4.5, 7.6]) for (const s of spread(0, w.length, 2)) rectWindow(S, k, w, s, y(h), 1.2, 1.7, plain); }
    const pr = rectPoly(f, rear), wr = rectWalls(f, rear); S.prism(later, pr, foot, y(12.4), { top: membrane }); parapet(S, later, pr, y(12.4), .5, .3, stone); course(S, stone, pr, y(.3), .26, .1); course(S, stone, pr, y(12.2), .3, .12);
    for (const [w, n] of [[wr.left, 4], [wr.right, 4], [wr.back, 5]] as [WallFrame, number][]) for (const h of [1.2, 4.3, 7.4, 10.1]) for (const s of spread(0, w.length, n)) rectWindow(S, k, w, s, y(h), 1.3, h > 10 ? 1.45 : 1.75, plain);
    const pt = rectPoly(f, tower), wt = rectWalls(f, tower); S.prism(brick, pt, foot, y(13.3), { top: membrane }); course(S, stone, pt, y(13.25), .2, .08);
    rectWindow(S, k, wt.right, wt.right.length / 2, y(1.4), 1.1, 9.6, { frame: k.sash, sill: stone, head: stone, panes: [1, 8] }); door(S, k, wt.front, wt.front.length / 2, y(-1.2), 1.1, 2.2, { leaf: k.tint('door', '#2f3a30'), frame: stone });
    return S;
  },
};

/** The Arborway Gate (plans by A. W. Longfellow Jr., contract 1898, in place by June 1899): square piers of roughly
 * dressed Roxbury puddingstone with bluestone bases, bands and caps, the taller pair flanking the carriage drive and
 * a lower pier beyond each sidewalk, wrought-iron leaves with a little scrollwork and a pineapple finial (drawn
 * swung open, so the drive and both sidewalks pass), and the boundary walls running out along the back of the
 * Arborway's sidewalk. It stands across the Arboretum drive as the tiles pave it, 8.9 m of asphalt between two
 * sidewalks; pier and wall sizes are estimates. */
const arborwayGate: SiteModel = {
  id: 'arborway-gate', name: 'Arborway Gate', place: 'arnold-arboretum', tile: '-4_4', at: [-3697.45, 4755.8], clear: 20,
  note: 'A. W. Longfellow Jr., 1898-99: Roxbury puddingstone piers and boundary walls with bluestone dressings, wrought-iron gates drawn open; placed across the paved Arboretum drive, sizes estimated',
  build({ k, ground }) {
    const S = new Shapes(), C: Point2 = [-3697.45, 4755.8], g: Point2 = [.894, .447], d: Point2 = [-.447, .894], yaw = Math.atan2(-g[1], g[0]), leafYaw = Math.atan2(-d[1], d[0]);
    const pudding = k.puddingstone, blue = k.tint('castStone', '#6f7a86'), iron = k.iron, Q = (t: number, into = 0): Point2 => [C[0] + g[0] * t + d[0] * into, C[1] + g[1] * t + d[1] * into];
    const pier = (p: Point2, w: number, h: number) => {
      const gy = ground(p[0], p[1]), sq = (e: number): Point2[] => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, c]) => [p[0] + (g[0] * a + d[0] * c) * e, p[1] + (g[1] * a + d[1] * c) * e] as Point2);
      S.block(pudding, w, w, p[0], p[1], gy - .9, gy + h, yaw, { top: null }); S.box(blue, w + .18, .34, w + .18, p[0], gy + .17, p[1], yaw); S.box(blue, w + .08, .16, w + .08, p[0], gy + h * .62, p[1], yaw);
      S.box(blue, w + .3, .22, w + .3, p[0], gy + h + .11, p[1], yaw); pyramid(S, blue, sq(w / 2 + .1), gy + h + .22, gy + h + .22 + w * .5, undefined, { solid: false }); return gy;
    };
    // An open leaf from its hinge into the park: frame, pickets, a rising top rail with scrolls and the finial on its meeting stile.
    const leaf = (hinge: Point2, width: number, h0: number, h1: number, fancy: boolean) => {
      const gy = ground(hinge[0], hinge[1]), P = (l: number, h: number): V3 => [hinge[0] + d[0] * l, gy + h, hinge[1] + d[1] * l], top = (l: number) => h0 + (h1 - h0) * (l / width) ** 1.6;
      S.beam(iron, P(.05, .22), P(width, .22), .05, .06); S.beam(iron, P(.05, h0 * .52), P(width, h0 * .52), .04, .05); for (let i = 0; i < 8; i++) S.beam(iron, P(.05 + (width - .05) * i / 8, top(width * i / 8)), P(.05 + (width - .05) * (i + 1) / 8, top(width * (i + 1) / 8)), .05, .06);
      for (const l of [.05, width]) S.beam(iron, P(l, .1), P(l, top(l) + .05), .07, .07);
      for (let l = .2; l < width - .05; l += .15) S.beam(iron, P(l, .22), P(l, top(l)), .022, .022);
      if (!fancy) return;
      for (const l of [width * .3, width * .62, width * .9]) { const p = P(l, top(l) + .2); S.place(iron, new THREE.TorusGeometry(.17, .018, 5, 14), p[0], p[1], p[2], leafYaw); }
      const e = P(width, top(width) + .05); S.place(iron, new THREE.SphereGeometry(.11, 8, 6), e[0], e[1] + .18, e[2], 0, 0, 0, [1, 1.5, 1]); S.place(iron, new THREE.ConeGeometry(.07, .22, 6), e[0], e[1] + .44, e[2]);
      const m = P(width / 2, 0); S.solidBox(width, .12, m[0], m[2], gy, gy + h0, leafYaw);
    };
    for (const side of [-1, 1]) {
      pier(Q(side * 5.05), .95, 3.5); pier(Q(side * 8.15), .78, 2.5);
      leaf(Q(side * 4.6, .1), 4.4, 2.3, 2.95, true); leaf(Q(side * 7.75, .1), 1.2, 1.9, 2.1, false);
    }
    { const p = Q(5.05, -.5), gy = ground(p[0], p[1]); S.box(k.bronze, .5, .36, .05, p[0], gy + 1.65, p[1], yaw + Math.PI); }
    // The boundary walls: from each outer pier out along the back of the Arborway's sidewalk.
    const walls: Point2[][] = [[Q(-8.55), [-3703.75, 4749.2], [-3702.65, 4746.2], [-3701.95, 4743.2], [-3701.65, 4740.2], [-3701.65, 4737.2]], [Q(8.55), [-3688, 4760.7], [-3685.7, 4762.5], [-3683.6, 4764.9], [-3681.9, 4767.7], [-3680.6, 4770.6]]];
    for (const line of walls) {
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i], c = line[i + 1], l = Math.hypot(c[0] - a[0], c[1] - a[1]), n: Point2 = [-(c[1] - a[1]) / l * .26, (c[0] - a[0]) / l * .26], gy = Math.max(ground(a[0], a[1]), ground(c[0], c[1])), low = Math.min(ground(a[0], a[1]), ground(c[0], c[1]));
        S.prism(pudding, [[a[0] + n[0], a[1] + n[1]], [c[0] + n[0], c[1] + n[1]], [c[0] - n[0], c[1] - n[1]], [a[0] - n[0], a[1] - n[1]]], low - .8, gy + 1.25, { top: blue }); S.beam(blue, [a[0], gy + 1.31, a[1]], [c[0], gy + 1.31, c[1]], .66, .12);
      }
      pier(line[line.length - 1], .7, 1.7);
    }
    return S;
  },
};

// ------------------------------------------------------------------ Chestnut Hill Reservoir
/** A round-headed opening walled up: the infill, rock-faced jambs and voussoirs, and its sill. */
function blindArch(S: Shapes, w: WallFrame, s: number, y: number, width: number, spring: number, infill: M, surround: M) {
  const [x, z] = w.at(s, .03), [fx, fz] = w.at(s, .06), r = width / 2; S.place(infill, new THREE.ShapeGeometry(archShape(width, spring), 10), x, y, z, w.yaw);
  S.place(surround, new THREE.RingGeometry(r, r + .34, 14, 1, 0, Math.PI), fx, y + spring, fz, w.yaw);
  for (const side of [-1, 1]) { const [jx, jz] = w.at(s + side * (r + .17), .05); S.box(surround, .34, spring, .1, jx, y + spring / 2, jz, w.yaw); }
  const [sx, sz] = w.at(s, .1); S.box(surround, width + .9, .24, .2, sx, y - .12, sz, w.yaw); const [kx, kz] = w.at(s, .1); S.box(surround, .36, .5, .16, kx, y + spring + r + .2, kz, w.yaw);
}
/** Rock-faced quoins at both ends of a wall: long and short blocks by turns from y0 to y1. */
function quoins(S: Shapes, m: M, w: WallFrame, y0: number, y1: number, course = .42) {
  for (let i = 0; y0 + (i + 1) * course <= y1 + .01; i++) for (const end of [0, 1]) { const len = i % 2 ? .5 : .85, [x, z] = w.at(end ? w.length - len / 2 : len / 2, .04); S.box(m, len, course - .04, .1, x, y0 + (i + .5) * course, z, w.yaw); }
}
/** Effluent Gate House No. 1 (1869-70) on the east embankment of the reservoir, above Cleveland Circle: a hip-roofed
 * house of dressed granite ashlar with darker rock-faced quoins and surrounds to its round-headed windows (three to
 * a side, since bricked in), a ventilator at the apex that has lost its cap, on a granite foundation that stands out
 * into the basin; the double stairway of granite climbs the embankment from the Cleveland Circle side. The surveyed
 * shell gives the 16.3 by 13.4 m foundation and the 9 m height; the walk and railing round the house, the storey
 * heights and the stairway's treads (laid along the mapped paths, not solid) are interpretive. */
const gatehouse1: SiteModel = {
  id: 'chestnut-hill-gatehouse-1', name: 'Effluent Gate House No. 1', place: 'chestnut-hill-reservoir', tile: '-7_1', building: 'BOS-SHQPK-6HYG1-RRA3Y',
  note: 'Effluent Gate House No. 1, 1869-70: granite ashlar with rock-faced quoins, bricked-in round-headed windows, slate hip roof with its ventilator; foundation and height from the surveyed shell, walk, railing and stairway treads interpretive',
  build({ k, ground, water }, b) {
    const S = new Shapes(), base = b?.baseElevation ?? 35.51, y = (h: number) => base + h, wl = water(-6545, 1625) ?? base - 1.4, foot = wl - 2.6;
    // North-east corner at the embankment path, u west out over the water (16.26 m), v south (13.42 m).
    const f = frame([-6521.21, 1616.84], [-6537.22, 1619.69], [-6518.86, 1630.05]), L = 16.26, W = 13.42, eave = 6, rise = 3;
    const ashlar = k.tint('granite', '#b4b1a9'), rock = k.tint('rubble', '#8f908d'), plain = k.tint('castStone', '#8f8f8c'), infill = k.tint('brick', '#8f5d4b');
    S.prism(rock, rectPoly(f, { u0: 0, u1: L, v0: 0, v1: W }), foot, y(.12), { top: k.granite }); course(S, plain, rectPoly(f, { u0: 0, u1: L, v0: 0, v1: W }), y(0), .24, .1);
    const house = { u0: .6, u1: L - 1.4, v0: 1.4, v1: W - 1.4 }, ph = rectPoly(f, house), wh = rectWalls(f, house);
    S.prism(ashlar, ph, y(.12), y(eave), { top: null }); course(S, plain, ph, y(4.75), .22, .08); course(S, plain, ph, y(eave - .22), .44, .14); course(S, plain, ph, y(eave + .06), .16, .34);
    const roof = hip(S, f, house, y(eave + .1), rise - .1, k.slate, { overhang: .45, trim: plain });
    { const c = f.W((house.u0 + house.u1) / 2, (house.v0 + house.v1) / 2); S.block(k.tint('slate', '#4a4f4e'), 1.5, 1.5, c[0], c[1], roof.top - .7, roof.top + .85, f.yaw, { top: k.opening }); S.box(plain, 1.7, .14, 1.7, c[0], roof.top + .85, c[1], f.yaw); for (const h of [.1, .35, .6]) S.box(k.opening, 1.56, .1, 1.56, c[0], roof.top + h, c[1], f.yaw); }
    for (const w of [wh.front, wh.right, wh.back, wh.left]) {
      quoins(S, rock, w, y(.9), y(eave - .45)); for (const [s0, s1] of w === wh.left ? [[-.1, w.length / 2 - 1.05], [w.length / 2 + 1.05, w.length + .1]] : [[-.1, w.length + .1]]) band(S, rock, w, s0, s1, y(.5), .76, .1);
      spread(.4, w.length - .4, 3).forEach((s, i) => { if (w === wh.left && i === 1) door(S, k, w, s, y(.12), 1.7, 2.5, { leaf: k.tint('door', '#2c352f'), frame: rock, fan: true }); else blindArch(S, w, s, y(1.45), 1.5, 2.2, infill, rock); });
    }
    const edge = (u: number, v: number): V3 => { const p = f.W(u, v); return [p[0], y(.12), p[1]]; };
    railing(S, k.iron, [edge(.15, .15), edge(L - .15, .15), edge(L - .15, W - .15), edge(.15, W - .15)], 1.05, { spacing: 2.2, pickets: .22, post: .06 });
    // The double stairway on the embankment: granite treads along the mapped paths (drawn only), cheek walls to the upper flight, a parapet at the landing.
    const tread = k.tint('castStone', '#a5a29b');
    for (const [a, c, from] of [[[-6518.1, 1622.1], [-6508.8, 1620.5], 2.4], [[-6509.7, 1615.3], [-6500.4, 1607.7], .6], [[-6508, 1625.6], [-6497.7, 1629.1], .6]] as [Point2, Point2, number][]) {
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]), dir: Point2 = [(c[0] - a[0]) / len, (c[1] - a[1]) / len], n = Math.round((len - from) / .44), step = (len - from) / n, yaw = Math.atan2(dir[0], dir[1]);
      for (let i = 0; i < n; i++) { const l = from + (i + .5) * step, top = Math.max(ground(a[0] + dir[0] * (l - step / 2), a[1] + dir[1] * (l - step / 2)), ground(a[0] + dir[0] * (l + step / 2), a[1] + dir[1] * (l + step / 2))) + .03; S.box(tread, 2.9, .2, step, a[0] + dir[0] * l, top - .1, a[1] + dir[1] * l, yaw); }
      if (from < 1) continue;
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
        const l0 = from + (len - from) * i / 3, l1 = from + (len - from) * (i + 1) / 3, P = (l: number, o: number): Point2 => [a[0] + dir[0] * l - dir[1] * o, a[1] + dir[1] * l + dir[0] * o], q = [P(l0, side * 1.6), P(l1, side * 1.6), P(l1, side * 2.05), P(l0, side * 2.05)], top = Math.max(...q.map(p => ground(p[0], p[1]))) + .5;
        S.prism(rock, q, Math.min(...q.map(p => ground(p[0], p[1]))) - .6, top, { top: plain });
      }
    }
    { const a: Point2 = [-6507.3, 1617.7], c: Point2 = [-6506.5, 1624], q: Point2[] = [a, c, [c[0] + .45, c[1] - .06], [a[0] + .45, a[1] - .06]], gy = Math.max(...q.map(p => ground(p[0], p[1]))); S.prism(rock, q, gy - 1.6, gy + .9, { top: plain }); }
    return S;
  },
};

/** Effluent Gate House No. 2 (Wheelwright & Haven, about 1898-1901) on the embankment across Beacon Street from the
 * High Service station: one tall storey, three window bays long and one deep, Renaissance Revival in dressed
 * granite with rusticated banding, iron grilles in the round-arched windows, a low copper hip roof gone green with
 * bronze cresting, and the gated entrance with its steps at one end. The surveyed shell gives the 11.6 by 7 m plan
 * and the height; the proportions of the openings are interpretive. */
const gatehouse2: SiteModel = {
  id: 'chestnut-hill-gatehouse-2', name: 'Effluent Gate House No. 2', place: 'chestnut-hill-reservoir', tile: '-7_1', building: 'BOS-8TWS8-AT4LM-74763',
  note: 'Effluent Gate House No. 2, Wheelwright & Haven, about 1898-1901: banded granite ashlar, grilled round-arched windows three bays by one, low copper hip roof with bronze cresting; plan and height from the surveyed shell, openings interpretive',
  build({ k }, b) {
    const S = new Shapes(), base = b?.baseElevation ?? 35.81, foot = base - 3.6, y = (h: number) => base + h;
    // North corner, u south-west along the wall over the water (11.63 m), v toward the path and Beacon Street (7 m).
    const f = frame([-6643.72, 1987.07], [-6652.79, 1994.35], [-6639.33, 1992.53]), L = 11.63, W = 7, eave = 5.9, rise = 2.1;
    const ashlar = k.tint('granite', '#bab7af'), rock = k.tint('rubble', '#84858a'), joint = k.tint('castStone', '#85847f'), plain = k.tint('castStone', '#b3b0a8'), body = { u0: 0, u1: L, v0: 0, v1: W }, poly = rectPoly(f, body), walls = rectWalls(f, body);
    S.prism(rock, poly, foot, y(.75), { top: null }); S.prism(ashlar, poly, y(.75), y(eave), { top: null }); course(S, plain, poly, y(.64), .2, .1);
    for (let h = 1.3; h < eave - .7; h += .5) course(S, joint, poly, y(h), .06, .025);
    cornice(S, plain, poly, y(eave + .12), .75, .55); const win = { frame: k.iron, head: plain, sill: plain, panes: [4, 5] as [number, number] };
    for (const w of [walls.front, walls.back]) for (const s of spread(.2, L - .2, 3)) archWindow(S, k, w, s, y(1.55), 1.55, 2.3, win);
    archWindow(S, k, walls.right, W / 2, y(1.55), 1.55, 2.3, win);
    // The entrance at the north-east end: an arched doorway behind an iron gate, up granite steps.
    const end = walls.left; door(S, k, end, W / 2, y(.75), 1.7, 2.6, { leaf: k.tint('door', '#23282a'), frame: plain, fan: true });
    for (let i = -3; i <= 3; i++) { const [x, z] = end.at(W / 2 + i * .26, .14); S.box(k.iron, .03, 2.6, .03, x, y(2.05), z, end.yaw); } for (const h of [.95, 2.1, 3.3]) { const [x, z] = end.at(W / 2, .14); S.box(k.iron, 1.7, .04, .04, x, y(h), z, end.yaw); }
    stairs(S, k.granite, end, W / 2, 2.6, y(.75), 3, { rise: .19, tread: .3, cheeks: rock });
    const roof = hip(S, f, body, y(eave + .15), rise, k.copper, { overhang: .75, trim: k.verdigris }), a = roof.inner[0], c = roof.inner[1], n = 9;
    S.beam(k.bronze, [a[0], roof.top + .12, a[1]], [c[0], roof.top + .12, c[1]], .08, .3);
    for (let i = 0; i <= n; i++) { const x = a[0] + (c[0] - a[0]) * i / n, z = a[1] + (c[1] - a[1]) * i / n, tall = i === 0 || i === n; S.box(k.bronze, .08, tall ? .7 : .28, .08, x, roof.top + (tall ? .5 : .4), z, f.yaw); if (tall) S.place(k.bronze, new THREE.SphereGeometry(.1, 8, 6), x, roof.top + .92, z); }
    return S;
  },
};

const WATERWORKS = 'BOS-2Q1L3-N7A3D-BHIZ1';
/** The High Service Pumping Station on Beacon Street, now the Waterworks Museum (Arthur H. Vinal, City Architect,
 * 1887-88; west wing by Wheelwright & Haven, 1897-99): Richardsonian Romanesque in rock-faced pink Milford granite
 * banded with reddish-brown Longmeadow freestone under blue-grey slate, its three gabled halls rising from the coal
 * pocket in the east to the wing of 1897. The surveyed shell has those halls, the entrance pavilion and the 150 ft
 * brick stack with their real roofs, so it stays, painted granite and slate; drawn on it are the brick of the stack,
 * the freestone bands, the arched windows in twos and threes, the broad "Syrian" entrance arch with the bronze
 * METROPOLITAN WATER WORKS sign, the 1897 date stone, and on the surveyed 112 ft tower between boiler room and
 * pavilion its bands, the arcade of the open observatory and slate over its pyramid (which the shell would paint as
 * wall). Window counts, the tower's stages and the arch's size are interpretive. */
const waterworks: SiteModel = {
  id: 'waterworks-pumping-station', name: 'High Service Pumping Station', place: 'chestnut-hill-reservoir', tile: '-7_2', at: [-6644.5, 2074],
  finish: { [WATERWORKS]: { wall: '#bba79c', roof: '#59626b' } },
  note: 'Arthur H. Vinal, 1887-88, and Wheelwright & Haven, 1897-99: the surveyed shell kept in granite and slate colours and dressed with freestone bands, arched windows, the Syrian arch and its bronze sign, the brick of the stack, the observatory arcade and slate roof of the 112 ft tower; counts and tower stages interpretive',
  build({ k }) {
    // Heights are over the kept shell's base.
    const S = new Shapes(), base = 36.84, y = (h: number) => base + h;
    // Rear corner of the boiler room, u south-west along the building (the 1897 wing ends at 67.1), v toward Beacon Street.
    const f = frame([-6621.47, 2068.25], [-6638.11, 2081.74], [-6627.25, 2061.11]), granite = k.tint('rubble', '#b9a69b'), free = k.tint('brownstone', '#8d5c4a'), win = { frame: k.sash, head: free, sill: free, panes: [2, 3] as [number, number] };
    const face = (u0: number, u1: number, v: number) => rectWalls(f, { u0, u1, v0: v - 1, v1: v }).back, end = (u: number, v0: number, v1: number, east: boolean) => { const w = rectWalls(f, east ? { u0: u, u1: u + 1, v0, v1 } : { u0: u - 1, u1: u, v0, v1 }); return east ? w.left : w.right; };
    const group = (w: WallFrame, p: Point2, n: number, sill: number, width: number, spring: number) => { const s = sOn(w, p); for (let i = 0; i < n; i++) archWindow(S, k, w, s + (i - (n - 1) / 2) * (width + .5), y(sill), width, spring, win); };
    const bands = (w: WallFrame, hs: number[], gap?: [number, number]) => { for (const h of hs) for (const [s0, s1] of gap && h < 4 ? [[0, gap[0]], [gap[1], w.length]] : [[0, w.length]]) band(S, free, w, s0, s1, y(h), .36, .07); };
    // Coal pocket: the gable end to the street with its coal door, and the east wall.
    const coal = face(-25.9, 0, 15.13), east = end(-25.95, -4.6, 15.1, true), sc = sOn(coal, f.W(-17, 15.13)); bands(coal, [1.1, 5.9], [sc - 2.1, sc + 2.1]); bands(east, [1.1, 5.9]);
    blindArch(S, coal, sOn(coal, f.W(-17, 15.1)), y(.2), 3.2, 2.2, k.tint('door', '#3a2f28'), free); group(coal, f.W(-23, 15.1), 1, 2, 1.3, 2.2); group(coal, f.W(-11, 15.1), 1, 2, 1.3, 2.2); group(coal, f.W(-17, 15.1), 2, 7.4, 1.1, 1.6); group(coal, f.W(-3.6, 15.1), 2, 2, 1.2, 2.2);
    for (const v of [0, 5.2, 10.4]) group(east, f.W(-25.9, v), 1, 2, 1.4, 2.4);
    // Boiler room: three pairs of tall arched windows.
    const boiler = face(0, 18.9, 18.5); bands(boiler, [1.1, 6.6]); for (const u of [3.3, 9.45, 15.6]) group(boiler, f.W(u, 18.5), 2, 2, 1.45, 2.7);
    // The stack in its brick, corbelled at the top.
    { const c = f.W(-3.4, 4), brick = k.tint('brick', '#9a4f3c'); S.drum(brick, c[0], c[1], 1.98, 1.78, y(6.5), y(46.4), 16, { top: k.opening }); for (const [h, r] of [[43.6, 1.95], [45.9, 2.02]]) S.drum(brick, c[0], c[1], r, r, y(h), y(h + .5), 16, { solid: false }); }
    // The tower between boiler room and pavilion (the shell has its shaft and its pyramid): freestone bands, slit windows, the arcaded observatory, and slate laid over the surveyed pyramid.
    const tower = { u0: 18.86, u1: 25.64, v0: 17.66, v1: 24.24 }, tw = rectWalls(f, tower), stage = 20.9, crown = 26.75;
    for (const w of [tw.front, tw.right, tw.back, tw.left]) {
      const T = w.length, outer = w === tw.back || w === tw.left;
      for (const h of outer ? [1.1, 6.6, 12.5, 18.3] : [18.3]) band(S, free, w, -.05, T + .05, y(h), .36, .1);
      if (outer) for (const h of [8, 13.6]) rectWindow(S, k, w, T / 2, y(h), .75, 2.4, { frame: k.sash, head: free, sill: free, panes: [1, 3] });
      band(S, free, w, -.08, T + .08, y(stage), .3, .14);
      for (const s of [T / 2 - 1.75, T / 2, T / 2 + 1.75]) { const [x, z] = w.at(s, .03), [rx, rz] = w.at(s, .07); S.place(k.opening, new THREE.ShapeGeometry(archShape(1.3, 3.1), 10), x, y(stage + .15), z, w.yaw); S.place(free, new THREE.RingGeometry(.65, .93, 12, 1, 0, Math.PI), rx, y(stage + 3.25), rz, w.yaw); }
      for (const s of [T / 2 - 2.62, T / 2 - .875, T / 2 + .875, T / 2 + 2.62]) { const [x, z] = w.at(s, .17); S.place(free, new THREE.CylinderGeometry(.15, .17, 2.9, 10), x, y(stage + 1.75), z); for (const h of [.24, 3.29]) S.box(free, .44, .18, .36, x, y(stage + h), z, w.yaw); }
      band(S, free, w, -.2, T + .2, y(crown - .2), .42, .3); for (let q = .15; q < T; q += .55) { const [x, z] = w.at(q, .14); S.box(free, .26, .3, .24, x, y(crown - .56), z, w.yaw); }
    }
    const cap = hip(S, f, tower, y(crown), 8.6, k.tint('slate', '#56606a'), { overhang: .5, trim: k.verdigris, solid: false }), tc = f.W((tower.u0 + tower.u1) / 2, (tower.v0 + tower.v1) / 2);
    S.rod(k.verdigris, [tc[0], cap.top - .1, tc[1]], [tc[0], cap.top + 1.6, tc[1]], .1, .02, 8); S.place(k.verdigris, new THREE.SphereGeometry(.2, 10, 8), tc[0], cap.top + .5, tc[1]);
    // Entrance pavilion: the Syrian arch right of the tower, the bronze sign over it, a triple window in the gable.
    const pav = face(25.6, 40.9, 23.9), sa = sOn(pav, f.W(35.4, 23.9)); bands(pav, [1.1, 6.2], [sa - 3.6, sa + 3.6]);
    { const [x, z] = pav.at(sa, .02), [rx, rz] = pav.at(sa, .08); S.place(k.opening, new THREE.ShapeGeometry(archShape(5.4, .95), 16), x, y(.05), z, pav.yaw); S.place(free, new THREE.RingGeometry(2.7, 3.55, 22, 1, 0, Math.PI), rx, y(1), rz, pav.yaw);
      for (const side of [-1, 1]) { const [jx, jz] = pav.at(sa + side * 3.12, .1); S.box(free, .85, .95, .2, jx, y(.52), jz, pav.yaw); } }
    door(S, k, pav, sa, y(.05), 2.8, 2.7, { leaf: k.tint('door', '#3b2a1f'), frame: free });
    signBoard(S, k, pav, sa, y(5.25), 6, .56, 'METROPOLITAN WATER WORKS', { color: '#d8c48e', background: '#4b3c2a', out: .1, frame: k.bronze });
    group(pav, f.W(33.3, 23.9), 3, 7.4, 1.15, 2); group(pav, f.W(28.4, 23.9), 1, 2, 1.4, 2.7);
    // The wing of 1897: arched windows in threes on two floors, and the date on its west cross gable.
    const wing = face(40.9, 65.4, 20.72), west = end(67.15, 2, 18, false); bands(wing, [1.1, 6.2]); bands(west, [1.1, 6.2]);
    for (const u of [45.9, 58.15]) { group(wing, f.W(u, 20.7), 3, 2, 1.3, 2.7); group(wing, f.W(u, 20.7), 3, 7.3, 1.1, u > 50 ? 2.1 : 1.3); }
    group(west, f.W(67.1, 10), 3, 2, 1.3, 2.7); group(west, f.W(67.1, 10), 3, 7.3, 1.1, 2);
    signBoard(S, k, west, sOn(west, f.W(67.1, 10)), y(13.2), 1.5, .62, '1897', { color: '#3d2a22', background: '#8d5c4a', out: .08 });
    return S;
  },
};

/** The Intermediate Gate House (1866-70) on the old dam between the two basins, at the reservoir's west end: a plain
 * rectangular block of hammered granite, about 30 by 25 ft, under a low hip roof. The surveyed shell gives the
 * 8.9 by 7.7 m plan and 5.5 m height; the door and the grated windows are interpretive. */
const intermediateGatehouse: SiteModel = {
  id: 'chestnut-hill-intermediate-gatehouse', name: 'Intermediate Gate House', place: 'chestnut-hill-reservoir', tile: '-8_1', building: 'BOS-DFDRR-41U3P-TZJSK',
  note: 'Intermediate Gate House, 1866-70: a plain block of hammered granite under a low slate hip roof on the surveyed 8.9 by 7.7 m plan; door and windows interpretive',
  build({ k }, b) {
    const S = new Shapes(), base = b?.baseElevation ?? 36.85, foot = base - 1.6, y = (h: number) => base + h;
    // North-east corner, u west-south-west along the long side (8.92 m), v across (7.66 m); the door end faces the Chestnut Hill Driveway.
    const f = frame([-7233.94, 1737.45], [-7241.88, 1741.52], [-7230.44, 1744.26]), body = { u0: 0, u1: 8.92, v0: 0, v1: 7.66 }, poly = rectPoly(f, body), walls = rectWalls(f, body), eave = 3.7;
    const ashlar = k.tint('granite', '#b0ada6'), plain = k.tint('castStone', '#9a9892'), win = { frame: k.iron, head: plain, sill: plain, panes: [3, 4] as [number, number] };
    S.prism(ashlar, poly, foot, y(eave), { top: null }); course(S, plain, poly, y(.05), .5, .08); course(S, plain, poly, y(eave - .15), .34, .16);
    hip(S, f, body, y(eave + .02), 1.85, k.slate, { overhang: .35, trim: plain });
    for (const w of [walls.front, walls.back]) for (const s of spread(.6, w.length - .6, 2)) rectWindow(S, k, w, s, y(1.25), 1.1, 1.6, win);
    rectWindow(S, k, walls.right, walls.right.length / 2, y(1.25), 1.1, 1.6, win);
    door(S, k, walls.left, walls.left.length / 2, y(.32), 1.5, 2.4, { leaf: k.tint('door', '#2c352f'), frame: plain }); stairs(S, k.granite, walls.left, walls.left.length / 2, 2.2, y(.32), 2, { rise: .19 });
    return S;
  },
};

// ------------------------------------------------------------------ Franklin Park Zoo
/** The Tropical Forest pavilion of Franklin Park Zoo (DiMella Shaffer Associates with Weidlinger Associates, opened
 * 1989): a round hall some 70 m across under a white, translucent membrane of PTFE-coated glass fibre on steel
 * arches and a cable net, 23 m high, over a low concrete perimeter wall. The surveyed shell is that wall (a circle
 * of 35.4 m radius with three flat portals); the roof here is three crossing arches with the fabric drawn down into
 * a valley between each pair, which is an interpretation of "arch-supported membrane with a cable net". */
const tropicalForest: SiteModel = {
  id: 'franklin-park-tropical-forest', name: 'Tropical Forest', place: 'franklin-park-zoo', tile: '-2_4', building: 'BOS-L6HR0-R4VG5-FVWHQ',
  note: 'DiMella Shaffer Associates, 1989: white PTFE membrane on steel arches, 23 m high, over the surveyed round concrete wall and its three portals; the arch layout and the lobes of the fabric are interpretive',
  build({ k, ground }, b) {
    const S = new Shapes(), base = b?.baseElevation ?? 44.4, foot = base - 6.5, y = (h: number) => base + h, c: Point2 = [-1234.74, 4820.85], R = 35.35, wall = 5, crown = 22.7, phase = 8 * Math.PI / 180;
    const concrete = k.tint('concrete', '#bcb7ab'), fabric = k.tint('canvas', '#f2f0e9'), steel = k.tint('whitePaint', '#d5d8d8'), dark = k.tint('blackPaint', '#3b4043');
    S.drum(concrete, c[0], c[1], R, R, foot, y(wall), 72, { top: null }); S.drum(steel, c[0], c[1], R + .22, R + .22, y(wall - .35), y(wall + .15), 72, { top: null, solid: false });
    for (const h of [1.6, 3.3]) S.drum(k.tint('concrete', '#a09b90'), c[0], c[1], R + .03, R + .03, y(h), y(h + .07), 72, { top: null, solid: false });
    // The membrane: highest along the three arches, drawn down between them, meeting the wall all round.
    const arch = (r: number) => wall + (crown - wall) * (1 - (r / R) ** 2), height = (r: number, a: number) => wall + (arch(r) - wall) * (1 - .42 * Math.sin(3 * (a - phase)) ** 2 * Math.sin(Math.PI * r / R) ** .8);
    const P = (r: number, a: number, lift = 0): V3 => [c[0] + Math.sin(a) * r, y(height(r, a)) + lift, c[1] + Math.cos(a) * r], J = 72, I = 12;
    for (let j = 0; j < J; j++) for (let i = 0; i < I; i++) { const a0 = phase + j / J * Math.PI * 2, a1 = phase + (j + 1) / J * Math.PI * 2, r0 = R * i / I, r1 = R * (i + 1) / I; S.poly(fabric, i ? [P(r0, a0), P(r1, a0), P(r1, a1), P(r0, a1)] : [P(0, a0), P(r1, a0), P(r1, a1)], [0, 1, 0], undefined, true); }
    for (let n = 0; n < 3; n++) {
      const a = phase + n * Math.PI / 3, Q = (r: number): V3 => [c[0] + Math.sin(a) * r, y(arch(Math.abs(r))) + .32, c[1] + Math.cos(a) * r];
      for (let i = -16; i < 16; i++) S.rod(steel, Q(R * i / 16), Q(R * (i + 1) / 16), .27, .27, 8);
      for (const side of [-1, 1]) { const r = side * (R + .5), bearing = a + (side < 0 ? Math.PI : 0); S.block(concrete, 2.4, 2, c[0] + Math.sin(a) * r, c[1] + Math.cos(a) * r, foot, y(wall + .5), bearing); }
    }
    S.place(steel, new THREE.CylinderGeometry(.9, 1.7, 1, 14), c[0], y(crown + .6), c[1]);
    // The three portals on the flats of the wall: a concrete frame, glazed doors and a canopy.
    for (const m of [[-1248.2, 4853.72], [-1256.31, 4793.27], [-1200.4, 4815.84]] as Point2[]) {
      const bearing = Math.atan2(m[0] - c[0], m[1] - c[1]), o: Point2 = [Math.sin(bearing), Math.cos(bearing)], gy = ground(m[0] + o[0] * 2.5, m[1] + o[1] * 2.5), at = (out: number, side = 0): Point2 => [m[0] + o[0] * out + o[1] * side, m[1] + o[1] * out - o[0] * side];
      { const p = at(.3); S.block(concrete, 9.4, 2.2, p[0], p[1], foot, gy + 4.4, bearing); } { const p = at(1.43); S.place(k.shopGlass, new THREE.PlaneGeometry(6.4, 2.9), p[0], gy + 1.6, p[1], bearing); }
      for (let i = -2; i <= 2; i++) { const p = at(1.46, i * 1.6); S.box(dark, .09, 2.9, .08, p[0], gy + 1.6, p[1], bearing); } { const p = at(2.3); S.box(dark, 8.2, .16, 2.4, p[0], gy + 3.3, p[1], bearing); }
    }
    return S;
  },
};

/** One of the two marble groups Daniel Chester French carved for the old Boston Post Office: a seated figure with a
 * crouching one at its feet and a standing one at its right, on a granite pedestal. Massed in simple solids. */
function marbleGroup(S: Shapes, k: SiteKit, c: Point2, yaw: number, gy: number, science: boolean) {
  const marble = k.tint('trim', '#e8e4da'), stone = k.tint('granite', '#a9a69f'), plain = k.tint('castStone', '#a5a29b'), F: Point2 = [Math.sin(yaw), Math.cos(yaw)], Rt: Point2 = [Math.cos(yaw), -Math.sin(yaw)], top = gy + 3.05;
  const P = (r: number, f: number, h: number): V3 => [c[0] + Rt[0] * r + F[0] * f, top + h, c[1] + Rt[1] * r + F[1] * f], ball = (r: number, f: number, h: number, rad: number, scale?: V3) => { const p = P(r, f, h); S.place(marble, new THREE.SphereGeometry(rad, 12, 9), p[0], p[1], p[2], yaw, 0, 0, scale); };
  const solid = (w: number, d: number, r: number, f: number, h0: number, h1: number) => { const p = P(r, f, 0); S.box(marble, w, h1 - h0, d, p[0], top + (h0 + h1) / 2, p[2], yaw); };
  S.block(stone, 4.6, 3.6, c[0], c[1], gy - .9, gy + .3, yaw); S.block(stone, 4, 3, c[0], c[1], gy + .3, gy + .6, yaw); S.block(stone, 3.4, 2.4, c[0], c[1], gy + .6, gy + 2.7, yaw); S.box(plain, 3.8, .35, 2.8, c[0], gy + 2.87, c[1], yaw); S.box(plain, 3.56, .14, 2.56, c[0], gy + .98, c[1], yaw);
  solid(3.1, 2.1, 0, 0, 0, .3);
  // The seated figure: throne, lap and drapery, torso, shoulders, head and arms.
  solid(1.3, 1.1, 0, -.35, .3, 1.55); solid(1.15, 1.05, 0, .25, 1.3, 1.9); { const p = P(0, .62, 0); S.place(marble, new THREE.CylinderGeometry(.5, .68, 1.45, 10), p[0], top + 1.02, p[2]); }
  { const p = P(0, -.2, 0); S.place(marble, new THREE.CylinderGeometry(.4, .56, 1.5, 12), p[0], top + 2.6, p[2]); } ball(0, -.2, 3.3, .58, [1.15, .5, .75]); ball(0, -.14, 3.86, .31, [.9, 1.1, 1]);
  S.rod(marble, P(-.6, -.2, 3.2), P(-.85, .35, 2.2), .15, .12, 8); S.rod(marble, P(.6, -.2, 3.2), P(.95, .3, 2.45), .15, .12, 8);
  // The standing figure at its right (the youth with the thunderbolt, or Art).
  { const p = P(1.12, .2, 0); S.place(marble, new THREE.CylinderGeometry(.27, .36, 2.5, 10), p[0], top + 1.55, p[2]); } ball(1.12, .2, 2.85, .4, [1.1, .5, .7]); ball(1.12, .24, 3.3, .25, [.9, 1.1, 1]);
  if (science) { S.rod(marble, P(1.4, .2, 2.85), P(1.62, .3, 4), .11, .09, 8); S.rod(marble, P(1.62, .3, 3.9), P(1.62, .3, 4.5), .05, .09, 6); } else S.rod(marble, P(1.4, .2, 2.85), P(1.5, .6, 2.1), .11, .09, 8);
  // At its feet: the chained giant beside a locomotive wheel, or the anvil that shelters the mother and child.
  ball(-1, .5, .85, .6, [1, .85, 1.25]); ball(-.95, .98, 1.35, .27);
  if (science) { const p = P(-1.25, -.4, 1.05); S.place(marble, new THREE.TorusGeometry(.66, .11, 6, 16), p[0], p[1], p[2], yaw + Math.PI / 2); S.place(marble, new THREE.CylinderGeometry(.14, .14, .3, 8), p[0], p[1], p[2], yaw + Math.PI / 2, Math.PI / 2); }
  else { solid(.7, .5, -.55, -.1, .3, 1.05); solid(1.15, .6, -.55, -.1, 1.05, 1.4); ball(-1.05, .95, .6, .2); }
}
/** "Science Controlling the Forces of Electricity and Steam" and "Labor Sustaining Art and the Family", Daniel
 * Chester French's groups of white Vermont marble from the old Post Office (1885), set up in 1930 on granite
 * pedestals by Arthur Shurcliff to frame the park-side entrance of the zoo on Pierpont Road, facing down the old
 * allée. They stand in the grass neck between Pierpont Road and Glen Lane, west of the entrance buildings; the
 * exact spots, the pedestals and the massing of the figures are interpretive. */
const frenchStatues: SiteModel = {
  id: 'franklin-park-french-statues', name: 'Daniel Chester French statue groups', place: 'franklin-park-zoo', tile: '-2_4', at: [-1601, 4863], clear: 12,
  note: 'Daniel Chester French, "Science" and "Labor" from the old Boston Post Office (1885), on Arthur Shurcliff\'s granite pedestals of 1930 at the Pierpont Road entrance of the zoo; placed either side of the entrance axis, figures massed in simple solids',
  build({ k, ground }) {
    const S = new Shapes(), yaw = Math.atan2(.928, .372);
    for (const [c, science] of [[[-1597.65, 4854.65], true], [[-1604.35, 4871.35], false]] as [Point2, boolean][]) marbleGroup(S, k, c, yaw, ground(c[0], c[1]), science);
    return S;
  },
};

export const SITES: SiteModel[] = [boathouse, bandstand, hunnewell, arborwayGate, gatehouse1, gatehouse2, intermediateGatehouse, waterworks, tropicalForest, frenchStatues];
