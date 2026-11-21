import * as THREE from 'three';
import type { Point2 } from '../../types';
import { archWindow, band, chimney, clock, column, course, dome, door, flagpole, frame, hip, inset, lathe, outward, parapet, pediment, rectPoly, rectWalls, rectWindow, Shapes, shopfront, signBoard, spread, stairs, wallFrame, wallFrames, type Rect, type SiteKit, type SiteModel, type V3, type WallFrame } from '../site-kit.ts';

type Mat = THREE.Material;
// ------------------------------------------------------------------ local parts (the kit has no equivalent)
/** A regular polygon in plan, its first corner `turn` radians from +z toward +x. */
const ngon = (x: number, z: number, r: number, n: number, turn = 0): Point2[] => Array.from({ length: n }, (_, i) => [x + Math.sin(i / n * Math.PI * 2 + turn) * r, z + Math.cos(i / n * Math.PI * 2 + turn) * r] as Point2);
/** A sash window under a flat lintel with a projecting keystone. */
function keyed(S: Shapes, k: SiteKit, w: WallFrame, s: number, y: number, wd: number, h: number, lintel: Mat, key: Mat, panes: [number, number] = [2, 3]) {
  rectWindow(S, k, w, s, y, wd, h, { panes, sill: key, head: lintel }); const [x, z] = w.at(s, .09); S.box(key, .26, .42, .14, x, y + h + .18, z, w.yaw);
}
/** A cornice on blocks (modillions) round a polygon, its top at y; the crown stands 2 x out proud. */
function modillions(S: Shapes, m: Mat, poly: Point2[], y: number, h = .8, out = .3, step = .62) {
  course(S, m, poly, y - h * .78, h * .44, out * .3); course(S, m, poly, y - h * .18, h * .36, out);
  for (const w of wallFrames(poly)) for (const s of spread(.1, w.length - .1, Math.max(1, Math.round(w.length / step)))) { const [x, z] = w.at(s, out * 1.1); S.box(m, .2, h * .2, out * 1.5, x, y - h * .46, z, w.yaw); }
}
/** Alternating long and short corner blocks up the walls that meet at `corner`. */
function quoins(S: Shapes, m: Mat, corner: Point2, walls: WallFrame[], y0: number, y1: number) {
  walls.forEach((w, j) => { const sc = (corner[0] - w.a[0]) * w.t[0] + (corner[1] - w.a[1]) * w.t[1], dir = sc < w.length / 2 ? 1 : -1; for (let i = 0, yy = y0; yy + .4 <= y1; i++, yy += .56) { const wq = (i + j) % 2 ? .46 : .76, [x, z] = w.at(sc + dir * wq / 2, .04); S.box(m, wq, .42, .1, x, yy + .21, z, w.yaw); } });
}
/** A turned balustrade round a polygon standing on y: corner posts, rails and square balusters. */
function balustrade(S: Shapes, m: Mat, poly: Point2[], y: number, h = .95, step = .75, closed = true) {
  for (let i = 0; i + (closed ? 0 : 1) < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / step));
    S.beam(m, [a[0], y + h, a[1]], [b[0], y + h, b[1]], .22, .12); S.beam(m, [a[0], y + .07, a[1]], [b[0], y + .07, b[1]], .2, .12); S.box(m, .3, h + .16, .3, a[0], y + (h + .16) / 2, a[1]); if (!closed && i === poly.length - 2) S.box(m, .3, h + .16, .3, b[0], y + (h + .16) / 2, b[1]);
    for (let j = 1; j < n; j++) S.box(m, .11, h - .16, .11, a[0] + (b[0] - a[0]) * j / n, y + h / 2, a[1] + (b[1] - a[1]) * j / n, Math.atan2(-(b[1] - a[1]), b[0] - a[0]));
  }
}
/** A classical urn standing on y. */
const urn = (S: Shapes, m: Mat, x: number, y: number, z: number, s = 1) => lathe(S, m, ([[.2, 0], [.2, .1], [.09, .2], [.27, .5], [.31, .74], [.18, .92], [.24, 1.02], [.03, 1.26]] as [number, number][]).map(([r, h]) => [r * s, h * s]), x, y, z, 12);
/** A pedimented dormer on a roof slope of that pitch: centred s along the eave wall w, its face d0 behind the wall, sill at y0. */
function dormer(S: Shapes, k: SiteKit, w: WallFrame, s: number, d0: number, y0: number, wd: number, h: number, pitch: number, wall: Mat, roof: Mat, trim: Mat) {
  const r = .6, L = (h + r) / pitch + .2, e = .16, A = (ds: number, d: number, y: number): V3 => { const [x, z] = w.at(s + ds, -d0 - d); return [x, y, z]; }, [cx, cz] = w.at(s, -d0 - L / 2), face = wallFrame(w.at(s - wd / 2, -d0), w.at(s + wd / 2, -d0), w.n);
  S.block(wall, wd, L, cx, cz, y0 - .5, y0 + h, w.yaw, { top: null, solid: false });
  rectWindow(S, k, face, wd / 2, y0 + .14, wd - .4, h - .3, { panes: [2, 3], sill: trim });
  for (const side of [-1, 1]) S.poly(roof, [A(side * (wd / 2 + e), -e, y0 + h), A(0, -e, y0 + h + r), A(0, L, y0 + h + r), A(side * (wd / 2 + e), L, y0 + h)], [w.t[0] * side, 1, w.t[1] * side]);
  S.poly(trim, [A(-wd / 2 - e, -.03, y0 + h - .1), A(wd / 2 + e, -.03, y0 + h - .1), A(0, -.03, y0 + h + r - .04)], [w.n[0], 0, w.n[1]]);
}
/** The head of a segmental-arched opening whose chord lies at `top`: the arch ring, its glazed or panelled segment and a keystone. */
function segHead(S: Shapes, k: SiteKit, w: WallFrame, s: number, top: number, wd: number, arch: Mat, key: Mat, fill: Mat = k.glass) {
  const a = .55, R = (wd / 2 + .04) / Math.sin(a), cy = top - R * Math.cos(a), [x, z] = w.at(s, .05), [gx, gz] = w.at(s, .018), [kx, kz] = w.at(s, .09);
  S.place(arch, new THREE.RingGeometry(R, R + .34, 10, 1, Math.PI / 2 - a, a * 2), x, cy, z, w.yaw); S.place(fill, new THREE.CircleGeometry(R, 10, Math.PI / 2 - a, a * 2), gx, cy, gz, w.yaw); S.box(key, .24, .48, .12, kx, cy + R + .16, kz, w.yaw);
}
/** A sash window under a segmental brick arch with a keystone. */
function segWindow(S: Shapes, k: SiteKit, w: WallFrame, s: number, y: number, wd: number, h: number, arch: Mat, key: Mat, panes: [number, number] = [2, 2]) {
  rectWindow(S, k, w, s, y, wd, h, { panes, sill: key, head: null }); segHead(S, k, w, s, y + h, wd, arch, key);
}
/** A row of small blocks under a cornice along part of a wall. */
function dentils(S: Shapes, m: Mat, w: WallFrame, s0: number, s1: number, y: number, step = .45, out = .16) {
  for (const s of spread(s0, s1, Math.max(1, Math.round((s1 - s0) / step)))) { const [x, z] = w.at(s, out / 2 + .04); S.box(m, .2, .2, out, x, y, z, w.yaw); }
}

// ------------------------------------------------------------------ Chelsea City Hall
/** Chelsea City Hall, 500 Broadway (Peabody and Stearns, 1908-10): Georgian Revival in red brick with grey terracotta,
 * recalling Independence Hall. The mapped outline gives the main block (41.75 by 19 m) with its slightly projecting
 * central bay toward Broadway and the two one-storey wings set forward of its corners round a forecourt. The tower
 * rises from the central bay through the hipped roof: brick shaft, white clock stage with urns, octagonal arcaded
 * lantern and gilded dome. Bay counts, storey heights and the tower's stages are interpretive (no source gives them);
 * the Soldiers' and Sailors' Monument (Franklin Simmons, 1869, moved here 1911) stands in the forecourt. */
const cityHall: SiteModel = {
  id: 'chelsea-city-hall', name: 'Chelsea City Hall', place: 'bellingham-square', tile: '3_-5', building: 'osm-way-29763941',
  note: 'Peabody and Stearns, 1908-10, Georgian Revival after Independence Hall: main block, projecting tower bay and one-storey wings on the mapped outline; bay counts, heights and tower stages interpretive; Soldiers and Sailors Monument in the forecourt',
  build({ k, ground }, b) {
    const S = new Shapes();
    // u north-east along the Broadway front from the line of the wings' fronts, v back (north-west) toward Washington Avenue.
    const f = frame([3384.76, -4819.63], [3392.74, -4825.66], [3364.26, -4846.76]), base = 5.6, y = (h: number) => base + h; void b;
    const main: Rect = { u0: 0, u1: 41.75, v0: 15.05, v1: 34 }, wings: Rect[] = [{ u0: -22.45, u1: 1.5, v0: 0, v1: 16.25 }, { u0: 39.9, u1: 64.35, v0: .4, v1: 16.8 }], links: Rect[] = [{ u0: -3.15, u1: .2, v0: 16.25, v1: 26.9 }, { u0: 41.55, u1: 45.25, v0: 16.8, v1: 27.2 }];
    const plan = ([[0, 15.05], [16.8, 15.05], [16.8, 12.1], [25.4, 12.1], [25.4, 15.05], [41.75, 15.05], [41.75, 34], [0, 34]] as Point2[]).map(([u, v]) => f.W(u, v));
    const foot = Math.min(...[...plan, ...wings.flatMap(r => rectPoly(f, r))].map(p => ground(p[0], p[1]))) - 1;
    const brick = k.brick, stone = k.tint('castStone', '#b9b7ae'), white = k.trim, slate = k.slate, eave = 11.2, floor = 1.2;
    const inRect = (p: Point2, r: Rect, grow = 0) => { const u = f.uOf(p), v = f.vOf(p); return u > r.u0 - grow && u < r.u1 + grow && v > r.v0 - grow && v < r.v1 + grow; };
    // Main block and tower bay: brick on a grey base, belt course, keystone lintels, modillioned cornice, hipped slate roof.
    const walls = S.prism(brick, plan, foot, y(eave), { top: k.deck }); S.prism(stone, inset(plan, .1), foot, y(floor));
    modillions(S, white, plan, y(eave), .8, .3, 1); const pitch = 4.7 / ((main.v1 - main.v0 + 1.3) / 2); hip(S, f, main, y(eave), 4.7, slate, { overhang: .65 });
    walls.forEach((w, i) => {
      if (i === 1 || i === 3) return;
      if (i !== 2) band(S, stone, w, 0, w.length, y(6.15), .3, .1);
      const bays = i === 2 ? [] : i === 0 || i === 4 ? spread(i === 0 ? 1.7 : 0, i === 0 ? w.length : w.length - 1.7, 4) : i === 6 ? spread(.6, w.length - .6, 11) : spread(.8, w.length - .8, 4);
      bays.forEach((s, j) => {
        const out = w.at(s, .4), covered = links.some(r => inRect(out, r)) || wings.some(r => inRect(out, r)), rearDoor = i === 6 && j === 5;
        if (!covered && !rearDoor) keyed(S, k, w, s, y(2.3), 1.35, 2.7, stone, stone);
        keyed(S, k, w, s, y(7), 1.35, 2.5, stone, stone);
        if (i === 6 && !rearDoor && ground(out[0], out[1]) < y(-2)) rectWindow(S, k, w, s, y(-1.55), 1.2, 1.1, { panes: [2, 1], sill: stone, head: stone });
      });
    });
    for (const [u, v, a, c] of [[0, 15.05, 7, 0], [41.75, 15.05, 4, 5], [41.75, 34, 5, 6], [0, 34, 6, 7], [16.8, 12.1, 1, 2], [25.4, 12.1, 2, 3]]) quoins(S, stone, f.W(u, v), [walls[a], walls[c]], y(floor + .1), y(eave - .9));
    // Dormers of the half storey, and the paired end chimneys.
    for (const s of [4.6, 11.6]) { dormer(S, k, walls[0], s, 1.72, y(12.3), 1.4, 1.5, pitch, white, slate, white); dormer(S, k, walls[4], walls[4].length - s, 1.72, y(12.3), 1.4, 1.5, pitch, white, slate, white); }
    for (const s of spread(3, main.u1 - 3, 5)) dormer(S, k, walls[6], s, 1.72, y(12.3), 1.4, 1.5, pitch, white, slate, white);
    for (const u of [2.6, main.u1 - 2.6]) for (const v of [20.4, 28.7]) { const [x, z] = f.W(u, v); chimney(S, brick, x, z, y(eave + .6), y(18), 1.5, .9, f.yaw + Math.PI / 2, stone); }
    // The central bay toward Broadway: terracotta doorway under a pediment, an arched window over it, steps to the forecourt.
    const pf = walls[2], mid = pf.length / 2;
    door(S, k, pf, mid, y(floor), 2.2, 3.2, { leaf: k.tint('door', '#33261d'), frame: stone, fan: true });
    for (const side of [-1, 1]) { const [x, z] = pf.at(mid + side * 1.75, .14); S.box(stone, .5, 4.9, .28, x, y(floor + 2.45), z, pf.yaw); S.box(stone, .62, .2, .36, x, y(floor + .1), z, pf.yaw); }
    band(S, stone, pf, mid - 2.15, mid + 2.15, y(floor + 5.15), .5, .4); pediment(S, stone, pf, mid - 2.15, mid + 2.15, y(floor + 5.4), 1, .45);
    archWindow(S, k, pf, mid, y(8), 1.7, 1.45, { head: stone, sill: stone, panes: [3, 2] });
    for (const s of [1.25, pf.length - 1.25]) { keyed(S, k, pf, s, y(2.3), .9, 2.7, stone, stone, [2, 3]); keyed(S, k, pf, s, y(7), .9, 2.5, stone, stone, [2, 3]); }
    stairs(S, k.granite, pf, mid, 5.4, y(floor), 7, { cheeks: k.granite, landing: 1 });
    // The rear entrance toward Washington Avenue, down a long flight (the ground falls about 3 m across the site).
    { const w = walls[6], s = w.length / 2, [gx, gz] = w.at(s, 4), n = Math.max(3, Math.min(18, Math.ceil((y(floor) - ground(gx, gz)) / .17))); door(S, k, w, s, y(floor), 1.9, 2.9, { leaf: k.tint('door', '#33261d'), frame: stone, fan: true }); stairs(S, k.granite, w, s, 3.6, y(floor), n, { cheeks: k.granite, landing: 1.2 }); }
    // The tower: brick shaft through the roof, cornice with corner urns, clock stage, octagonal arcaded lantern, gilded dome.
    const tu = 21.1, tv = 15.85, T = 7.2, [tx, tz] = f.W(tu, tv), square = (half: number) => rectPoly(f, { u0: tu - half, u1: tu + half, v0: tv - half, v1: tv + half });
    const shaft = square(T / 2), sf = S.prism(brick, shaft, y(eave - .2), y(19.6), { top: k.deck });
    for (const w of sf) { archWindow(S, k, w, T / 2, y(14.9), 1.5, 2, { head: stone, sill: stone, panes: [2, 3] }); band(S, stone, w, -.06, T + .06, y(13.9), .28, .1); }
    shaft.forEach((c, i) => quoins(S, stone, c, [sf[i], sf[(i + 3) % 4]], y(14.2), y(18.8)));
    modillions(S, white, shaft, y(19.6), .7, .24, .55);
    for (const c of square(T / 2 - .45)) { S.block(white, .8, .8, c[0], c[1], y(19.6), y(20.25), f.yaw, { solid: false }); urn(S, stone, c[0], y(20.25), c[1], 1.15); }
    const C = 5.2, stage = square(C / 2), cf = S.prism(k.whitePaint, stage, y(19.6), y(24.7), { top: k.deck });
    for (const w of cf) { clock(S, k, w, C / 2, y(22.3), 1.3, k.blackPaint); for (const s of [.28, C - .28]) { const [x, z] = w.at(s, .06); S.box(white, .5, 4.6, .12, x, y(22.05), z, w.yaw); } band(S, white, w, 0, C, y(20), .4, .14); }
    course(S, white, stage, y(24.4), .3, .1); course(S, white, stage, y(24.7), .26, .24);
    const oct = ngon(tx, tz, 2.5, 8, Math.atan2(f.V[0], f.V[1]) + Math.PI / 8), of = S.prism(k.whitePaint, oct, y(24.7), y(29.4), { top: k.deck });
    for (const w of of) { archWindow(S, k, w, w.length / 2, y(25.6), 1, 2.1, { glass: k.opening, frame: white, head: white, sill: white, panes: [1, 1] }); for (const s of [.1, w.length - .1]) { const [x, z] = w.at(s, .05); S.box(white, .2, 4.4, .1, x, y(27), z, w.yaw); } }
    course(S, white, oct, y(29.2), .24, .08); course(S, white, oct, y(29.45), .22, .2);
    dome(S, k.gold, tx, y(29.56), tz, 2.4, 2.5, 24);
    S.place(k.gold, new THREE.CylinderGeometry(.42, .55, .9, 8), tx, y(32.4), tz); S.place(k.gold, new THREE.SphereGeometry(.5, 14, 10), tx, y(33.15), tz);
    S.rod(k.gold, [tx, y(33.4), tz], [tx, y(35.6), tz], .07, .03); S.place(k.gold, new THREE.SphereGeometry(.16, 10, 8), tx, y(34.5), tz); S.box(k.gold, 1.1, .08, .05, tx, y(35.2), tz, f.yaw + .5);
    // The one-storey wings: tall keystone windows, hipped slate roofs with a balustraded deck; flat-roofed links behind them.
    for (const r of wings) {
      const poly = rectPoly(f, r), ww = S.prism(brick, poly, foot, y(6.4), { top: k.deck }); S.prism(stone, inset(poly, .1), foot, y(floor));
      course(S, white, poly, y(5.95), .3, .09); course(S, white, poly, y(6.3), .26, .22);
      ww.forEach((w, i) => { for (const s of spread(.5, w.length - .5, i % 2 ? 3 : 5)) { const out = w.at(s, .4); if (!inRect(out, main, .3) && !links.some(q => inRect(out, q, .3))) keyed(S, k, w, s, y(2.3), 1.4, 2.9, stone, stone); } });
      const roof = hip(S, f, r, y(6.4), 2.3, slate, { overhang: .45, deck: 4.2, deckMaterial: k.deck }); balustrade(S, white, inset(roof.inner, -.2), roof.top);
    }
    for (const r of links) { const poly = rectPoly(f, r); S.prism(brick, poly, foot, y(5.6), { top: k.deck }); course(S, stone, poly, y(5.6), .22, .07); }
    // In the forecourt: the Soldiers' and Sailors' Monument (granite base and column, a bronze soldier; about 10 m) and a flagpole.
    { const [x, z] = f.W(tu, 3.2), g = ground(x, z), granite = k.tint('granite', '#b3aea6');
      S.block(granite, 3.4, 3.4, x, z, g - 1, g + .35, f.yaw); S.block(granite, 2.5, 2.5, x, z, g + .35, g + .7, f.yaw); S.block(granite, 1.7, 1.7, x, z, g + .7, g + 2.7, f.yaw); S.block(granite, 2, 2, x, z, g + 2.7, g + 2.95, f.yaw);
      column(S, granite, x, z, g + 2.95, 5.2, .43, { order: 'doric', yaw: f.yaw }); S.solidBox(.9, .9, x, z, g + 2.95, g + 8.2, f.yaw); soldier(S, k.bronze, x, g + 8.15, z, f.yaw + Math.PI); }
    { const [x, z] = f.W(9.5, 5); flagpole(S, k, x, ground(x, z), z, 14); S.solidBox(.3, .3, x, z, ground(x, z), ground(x, z) + 3); }
    return S;
  },
};
/** A standing infantryman at parade rest on a small plinth (about 1.95 m), facing `yaw`. */
function soldier(S: Shapes, m: Mat, x: number, y: number, z: number, yaw: number) {
  const c = Math.cos(yaw), s = Math.sin(yaw), P = (dx: number, dy: number, dz: number): V3 => [x + c * dx + s * dz, y + dy, z - s * dx + c * dz];
  S.box(m, .7, .12, .6, x, y + .06, z, yaw);
  for (const side of [-1, 1]) { S.rod(m, P(side * .12, .12, 0), P(side * .1, .98, 0), .085, .1, 7); S.rod(m, P(side * .26, 1.5, 0), P(side * .2, .98, .16), .06, .05, 6); }
  S.rod(m, P(0, .95, 0), P(0, 1.58, 0), .19, .21, 8); S.rod(m, P(0, 1.1, -.02), P(0, .5, -.04), .23, .3, 8);
  S.place(m, new THREE.SphereGeometry(.115, 10, 8), ...P(0, 1.74, 0)); S.rod(m, P(0, 1.8, .01), P(0, 1.9, .03), .12, .1, 8); S.box(m, .16, .02, .12, ...P(0, 1.81, .12), yaw);
  S.rod(m, P(.16, .12, .22), P(.16, 1.55, .2), .022, .018, 5);
}

// ------------------------------------------------------------------ Somerville Theatre
/** The Somerville Theatre in the Hobbs Building, 49-55 Davis Square (Funk and Wilcox, 1914): a three-storey commercial
 * block of yellow-grey brick with stone accents, shops along Holland and Dover Streets, the five tall arched windows of
 * the second-floor hall on Dover Street, a dentil cornice and parapet, and at the right-hand end of the Holland Street
 * front the three-storey entrance arch over the marquee (the present marquee is of 1996). The mapped outline is the
 * whole block; storey heights, bay widths, the stage house and the marquee's measures are interpretive. */
const theatre: SiteModel = {
  id: 'somerville-theatre', name: 'Somerville Theatre', place: 'davis-square', tile: '-4_-6', building: 'osm-way-29787712',
  note: 'Hobbs Building, Funk and Wilcox, 1914: yellow-grey brick block on the mapped outline, shopfronts, five arched hall windows on Dover Street, entrance arch and marquee at the north end of the Holland Street front; heights, bays and stage house interpretive',
  build({ k, ground }, b) {
    const S = new Shapes(), base = 4.4, y = (h: number) => base + h; void b;
    // Clockwise from the Holland/Dover corner: Dover Street (south), the west side, the two rear walls, Holland Street (east).
    const plan: Point2[] = [[-3967.45, -5138.87], [-4009.78, -5129.53], [-4020.31, -5159.8], [-3996.65, -5169.33], [-3983.08, -5165.1]], foot = Math.min(...plan.map(p => ground(p[0], p[1]))) - 1.2;
    const brick = k.tint('buffBrick', '#bcad8e'), rear = k.tint('brick', '#85604f'), stone = k.tint('castStone', '#dcd5c3'), cream = k.tint('whiteSash', '#d8d0ba'), dark = k.tint('blackPaint', '#2b2f2c'), roofY = 12, [dover, west, north, plaza, holland] = wallFrames(plan);
    plan.forEach((a, i) => S.wall(i === 0 || i === 4 ? brick : rear, a, plan[(i + 1) % 5], foot, y(roofY), y(roofY), outward(plan, i)));
    S.cap(k.gravel, plan, y(roofY)); parapet(S, brick, plan, y(roofY), 1, .35, stone); S.prism(k.tint('granite', '#9c9992'), inset(plan, .05), foot, y(.4), { top: null });
    // A street bay: shopfront, stone belt, paired one-over-one windows on two floors with a stone lozenge between, brick piers.
    const pier = (w: WallFrame, s: number) => { const [x, z] = w.at(s, .1); S.block(brick, .85, .3, x, z, foot, y(11.3), w.yaw, { top: stone, solid: false }); const [cx, cz] = w.at(s, .27); S.box(stone, .5, .5, .05, cx, y(10.6), cz, w.yaw, 0, Math.PI / 4); };
    const street = (w: WallFrame, s0: number, s1: number) => { band(S, stone, w, s0, s1, y(4.5), .4, .2); band(S, stone, w, s0, s1, y(11.5), .3, .16); band(S, stone, w, s0, s1, y(11.88), .3, .42); dentils(S, stone, w, s0, s1, y(11.63)); };
    const hl = holland.length, bay = (hl - 8) / 4;
    street(holland, 0, hl - 6.9);
    for (let i = 0; i < 4; i++) {
      const c = .7 + bay * (i + .5); shopfront(S, k, holland, c - bay / 2 + .5, c + bay / 2 - .5, y(0), 4.1, { frame: dark, bay: 1.5, door: c });
      for (const s of [c - 1.2, c + 1.2]) { rectWindow(S, k, holland, s, y(5.8), 1.3, 2.2, { panes: [1, 2], sill: stone, head: stone }); rectWindow(S, k, holland, s, y(9), 1.3, 2, { panes: [1, 2], sill: stone, head: stone }); }
      const [x, z] = holland.at(c, .04); S.box(stone, .55, .55, .06, x, y(8.5), z, holland.yaw, 0, Math.PI / 4);
    }
    for (let i = 0; i <= 4; i++) pier(holland, .7 + bay * i);
    // Dover Street: the hall's five arched windows over shops toward the square, the auditorium's plainer wall beyond.
    const dl = dover.length, hall = spread(dl - 25.6, dl - .6, 5);
    street(dover, 0, dl);
    for (const c of hall) {
      shopfront(S, k, dover, c - 2, c + 2, y(0), 4.1, { frame: dark, bay: 1.35, door: c });
      archWindow(S, k, dover, c, y(5.8), 3, 3.1, { head: null, sill: stone, panes: [3, 3], frame: cream });
      const [x, z] = dover.at(c, .05); S.place(stone, new THREE.RingGeometry(1.5, 1.86, 20, 1, 0, Math.PI), x, y(8.9), z, dover.yaw); const [kx, kz] = dover.at(c, .1); S.box(stone, .34, .6, .14, kx, y(10.62), kz, dover.yaw);
    }
    for (let i = 0; i <= 5; i++) pier(dover, dl - 25.6 + 5 * i);
    for (const c of spread(1.2, dl - 26.4, 3)) { rectWindow(S, k, dover, c, y(5.8), 1.3, 2.2, { panes: [1, 2], sill: stone, head: stone }); rectWindow(S, k, dover, c, y(9), 1.3, 2, { panes: [1, 2], sill: stone, head: stone }); }
    for (const c of [4.2, 12.6]) { const [gx, gz] = dover.at(c, .4); door(S, k, dover, c, ground(gx, gz) + .05, 1.9, 2.5, { leaf: k.tint('door', '#55291f'), frame: stone }); }
    pier(dover, .5);
    // The theatre entrance: a projecting bay with the three-storey stone arch, its raised parapet, the doors and the marquee.
    const ac = hl - 3.7, pw = 6.4, [bx, bz] = holland.at(ac, .2), pv = wallFrame(holland.at(ac - pw / 2, .45), holland.at(ac + pw / 2, .45), holland.n), m = pw / 2;
    S.block(brick, pw, .5, bx, bz, foot, y(14.2), holland.yaw, { top: stone });
    shopfront(S, k, pv, m - 2, m + 2, y(0), 3.5, { frame: k.tint('bronze', '#4a3a2a'), bay: 1, door: m });
    archWindow(S, k, pv, m, y(5.5), 4, 3.3, { head: null, sill: stone, panes: [4, 3], frame: cream });
    for (const side of [-1, 1]) { const [x, z] = pv.at(m + side * 2.33, .08); S.box(stone, .56, 8.8, .16, x, y(4.4), z, pv.yaw); const [ix, iz] = pv.at(m + side * 2.33, .11); S.box(stone, .74, .3, .22, ix, y(8.8), iz, pv.yaw); const [rx, rz] = pv.at(m + side * 2.3, .04); S.place(stone, new THREE.CircleGeometry(.36, 16), rx, y(11.05), rz, pv.yaw); }
    { const [x, z] = pv.at(m, .07); S.place(stone, new THREE.RingGeometry(2.03, 2.62, 24, 1, 0, Math.PI), x, y(8.8), z, pv.yaw); const [kx, kz] = pv.at(m, .13); S.box(stone, .5, .95, .2, kx, y(11.2), kz, pv.yaw); }
    band(S, stone, pv, -.1, pw + .1, y(12.1), .34, .3); dentils(S, stone, pv, 0, pw, y(11.82)); band(S, stone, pv, -.05, pw + .05, y(14.2), .2, .14);
    { const [x, z] = pv.at(m, .05); S.box(stone, 2.6, .9, .08, x, y(13.15), z, pv.yaw); }
    // The marquee: a canopy over the sidewalk hung on rods, changeable-letter boards on three sides between rows of lamps, the name above in red.
    { const mw = 6, md = 2.7, y0 = y(3.6), y1 = y(4.65), [cx, cz] = pv.at(m, md / 2), front = wallFrame(pv.at(m - mw / 2, md), pv.at(m + mw / 2, md), pv.n), sides = [wallFrame(pv.at(m - mw / 2, 0), pv.at(m - mw / 2, md), [-pv.t[0], -pv.t[1]]), wallFrame(pv.at(m + mw / 2, md), pv.at(m + mw / 2, 0), pv.t)];
      S.box(dark, mw, y1 - y0, md, cx, (y0 + y1) / 2, cz, pv.yaw); S.box(k.bulb, mw - .3, .05, md - .3, cx, y0 - .03, cz, pv.yaw);
      for (const w of [front, ...sides]) { const [x, z] = w.at(w.length / 2, .03); S.box(k.sign(' ', { background: '#f3efe4', lit: true, aspect: 4 }), w.length - .3, y1 - y0 - .34, .04, x, (y0 + y1) / 2, z, w.yaw); for (const yy of [y0 + .1, y1 - .1]) S.box(k.bulb, w.length - .1, .07, .07, x, yy, z, w.yaw); for (const t of [.33, .5, .67]) S.box(dark, w.length - .4, .025, .05, x, y0 + (y1 - y0) * t, z, w.yaw); }
      signBoard(S, k, wallFrame(pv.at(m - mw / 2, md - .25), pv.at(m + mw / 2, md - .25), pv.n), mw / 2, y1 + .5, 5.6, .8, 'SOMERVILLE THEATRE', { color: '#b3221b', background: '#efe9da', lit: true, frame: dark, out: .1 });
      for (const side of [-1, 1]) { const a = pv.at(m + side * (mw / 2 - .3), md - .3), c = pv.at(m + side * (mw / 2 - .3), 0); S.rod(k.iron, [a[0], y1, a[1]], [c[0], y(7.4), c[1]], .03); } }
    // The plain side toward the station plaza and the rear walls; the stage house over the auditorium's west end.
    for (const s of spread(1, plaza.length - 1, 3)) for (const h of [5.8, 9]) rectWindow(S, k, plaza, s, y(h), 1.2, 2, { panes: [1, 2], sill: stone });
    for (const [w, at] of [[west, [5, 16, 27]], [north, [4, 20]]] as [WallFrame, number[]][]) for (const s of at) { const [gx, gz] = w.at(s, .4); door(S, k, w, s, ground(gx, gz) + .05, 1.8, 2.4, { leaf: k.tint('door', '#4b4a47'), frame: k.tint('door', '#4b4a47') }); }
    { const g = frame(plan[2], plan[3], plan[0]), poly = rectPoly(g, { u0: 2.5, u1: 19, v0: 1.4, v1: 11.5 }); S.prism(rear, poly, y(roofY), y(15.4), { top: k.gravel }); course(S, stone, poly, y(15.4), .2, .06); }
    return S;
  },
};

// ------------------------------------------------------------------ Union Square engine house
/** The former engine house at 90-92 Union Square, Somerville (Walter T. Littlefield, 1903): two storeys of brick on a
 * granite base, segmental-arched ground-floor openings and flat-arched upper windows with limestone keystones, a
 * limestone course at the second floor, and a slate hip roof whose eaves kick out at a flatter pitch over exposed
 * rafter tails. The square clock tower at the south-west corner is drawn as it stands, without the octagonal look-out
 * it once carried: round dials, an open top level, a flat roof. The mapped outline gives the main block, the low east
 * wing and the shallow projections; which wall held the three apparatus bays, the window rhythm and the tower's
 * stages are interpretive. */
const engineHouse: SiteModel = {
  id: 'union-square-engine-house', name: 'Union Square Engine House', place: 'union-square', tile: '-2_-4', building: 'osm-way-29520494',
  note: 'Walter T. Littlefield, 1903: brick on granite with limestone keystones, double-pitched slate hip roof, south-west clock tower in its present flat-topped state on the mapped outline; apparatus bays, window rhythm and tower stages interpretive',
  build({ k }, b) {
    const S = new Shapes(), base = 0, foot = base - 1.5, y = (h: number) => base + h; void b;
    // u east along Somerville Avenue from the tower corner, v north toward the parking lot; the west wall faces the square.
    const f = frame([-1640.57, -3241], [-1631.56, -3236.65], [-1633.46, -3255.63]), main: Rect = { u0: 0, u1: 25.4, v0: 0, v1: 16.27 }, mp = rectPoly(f, main), walls = rectWalls(f, main);
    const brick = k.tint('brick', '#a2523b'), lime = k.tint('castStone', '#cfc8b5'), granite = k.granite, ring = k.tint('trim', '#8c4533'), white = k.trim, red = k.tint('redDoor', '#6e2019'), slate = k.slate, eave = 9, belt = 4.95;
    S.prism(brick, mp, foot, y(eave), { top: k.deck }); S.prism(granite, inset(mp, .08), foot, y(.9));
    const lower = (w: WallFrame, s: number, wd = 1.2) => segWindow(S, k, w, s, y(1.75), wd, 2.2, ring, lime), upper = (w: WallFrame, s: number, wd = 1.2) => keyed(S, k, w, s, y(5.95), wd, 2.2, ring, lime, [2, 2]);
    for (const w of Object.values(walls)) { band(S, lime, w, 0, w.length, y(belt), .3, .14); band(S, white, w, 0, w.length, y(eave - .22), .44, .07); for (const s of spread(0, w.length, Math.round(w.length / .62))) { const [x, z] = w.at(s, .36); S.box(white, .1, .15, .66, x, y(eave - .1), z, w.yaw); } }
    S.cap(white, rectPoly(f, { u0: main.u0 - .75, u1: main.u1 + .75, v0: main.v0 - .75, v1: main.v1 + .75 }), y(eave), false, false);
    // The west front on the square: three apparatus bays under segmental arches (now glazed), paired windows over each.
    for (const s of spread(0, main.v1 - 5.05, 3)) {
      const w = walls.left, wd = 3, h = 3.3, [x, z] = w.at(s, .03), [fx, fz] = w.at(s, .07);
      S.place(k.shopGlass, new THREE.PlaneGeometry(wd, h), x, y(.35) + h / 2, z, w.yaw); S.box(red, wd, .85, .08, fx, y(.78), fz, w.yaw);
      for (const u of [-wd / 2 + .07, -wd / 6, wd / 6, wd / 2 - .07]) { const [mx, mz] = w.at(s + u, .07); S.box(red, .13, h, .09, mx, y(.35) + h / 2, mz, w.yaw); }
      for (const hh of [1.2, 2.5, h - .06]) S.box(red, wd, .1, .09, fx, y(.35 + hh), fz, w.yaw);
      segHead(S, k, w, s, y(.35 + h), wd, ring, lime, red); for (const d of [-.75, .75]) upper(w, s + d, 1.05);
    }
    // The Somerville Avenue side: two shallow projecting bays (the eastern one carries the chimney), windows between.
    const bays: Rect[] = [{ u0: 5.87, u1: 9.99, v0: -1, v1: .3 }, { u0: 12.88, u1: 15.99, v0: -1, v1: .3 }];
    bays.forEach((r, i) => { const poly = rectPoly(f, r), w = rectWalls(f, r).front; S.prism(brick, poly, foot, y(eave), { top: k.deck }); S.prism(granite, inset(poly, .08), foot, y(.9)); course(S, lime, poly, y(belt), .3, .07); course(S, white, poly, y(eave - .22), .44, .04);
      if (i === 0) for (const s of [1.05, w.length - 1.05]) { lower(w, s, 1.1); upper(w, s, 1.1); } else { lower(w, w.length / 2, 1); const [x, z] = f.W((r.u0 + r.u1) / 2, -.2); chimney(S, brick, x, z, y(eave - .5), y(15.6), 1.5, 1, f.yaw, lime); } });
    for (const u of [11.43, ...spread(16.3, 25.2, 3)]) { lower(walls.front, u); upper(walls.front, u); }
    for (const u of [2.8, 18.4, 21, 23.6]) { lower(walls.back, main.u1 - u); upper(walls.back, main.u1 - u); }
    for (const v of [4, 8.1, 12.2]) upper(walls.right, v); lower(walls.right, 1.3);
    // Rear stair bays and the one-storey east wing under flat roofs.
    for (const r of [{ u0: 5.69, u1: 12.3, v0: 16, v1: 18.9 }, { u0: 13.29, u1: 16.61, v0: 16, v1: 17.63 }] as Rect[]) { const poly = rectPoly(f, r), w = rectWalls(f, r).back; S.prism(brick, poly, foot, y(8.2), { top: k.deck }); course(S, lime, poly, y(8.2), .2, .06); for (const s of spread(.3, w.length - .3, r.u1 - r.u0 > 4 ? 2 : 1)) { lower(w, s, 1); keyed(S, k, w, s, y(5.4), 1, 1.9, ring, lime, [2, 2]); } }
    { const r: Rect = { u0: 25.2, u1: 28.9, v0: 2.57, v1: 16.27 }, poly = rectPoly(f, r), w = rectWalls(f, r); S.prism(brick, poly, foot, y(4.5), { top: k.deck }); S.prism(granite, inset(poly, .08), foot, y(.9)); course(S, lime, poly, y(4.5), .22, .07);
      for (const s of spread(.5, w.right.length - .5, 4)) lower(w.right, s, 1.1); door(S, k, w.front, w.front.length / 2, y(.2), 1.1, 2.3, { leaf: red, frame: white }); }
    // The roof: a 4:12 skirt at the eaves, then the 8:12 hip.
    const skirt = hip(S, f, main, y(eave), .55, slate, { overhang: .75, deck: 1.65 }); hip(S, f, { u0: main.u0 + .9, u1: main.u1 - .9, v0: main.v0 + .9, v1: main.v1 - .9 }, skirt.top, 4.82, slate, { overhang: 0, trim: k.copperPlain });
    // The clock tower over the main entrance.
    const T = 5.2, tr: Rect = { u0: -.15, u1: T - .15, v0: -.15, v1: T - .15 }, tp = rectPoly(f, tr), tw = rectWalls(f, tr), by0 = y(16.6), by1 = y(19.3);
    S.prism(brick, tp, foot, by0, { top: k.deck }); S.prism(granite, inset(tp, .08), foot, y(.9)); for (const h of [belt, 9.3, 13]) course(S, lime, tp, y(h), .3, .07);
    door(S, k, tw.left, T / 2, y(.35), 1.7, 2.6, { leaf: red, frame: white, fan: true }); stairs(S, granite, tw.left, T / 2, 2.8, y(.35), 2); lower(tw.front, T / 2);
    for (const w of [tw.front, tw.left]) upper(w, T / 2);
    for (const w of Object.values(tw)) { archWindow(S, k, w, T / 2, y(10.2), .85, 1.6, { head: lime, sill: lime, panes: [1, 2] }); clock(S, k, w, T / 2, y(14.8), 1.08, lime); }
    modillions(S, lime, tp, by0, .6, .2, .5);
    for (const c of rectPoly(f, { u0: tr.u0 + .5, u1: tr.u1 - .5, v0: tr.v0 + .5, v1: tr.v1 - .5 })) S.block(brick, 1, 1, c[0], c[1], by0, by1, f.yaw);
    for (const w of Object.values(tw)) {
      const [px, pz] = w.at(T / 2, -.35); S.block(brick, .5, .6, px, pz, by0, by0 + 2.2, w.yaw, { solid: false });
      for (const s of [1.675, T - 1.675]) { const [x, z] = w.at(s, -.3); for (const turn of [0, Math.PI]) S.place(ring, new THREE.RingGeometry(.675, 1, 12, 1, 0, Math.PI), x, by0 + 1.4, z, w.yaw + turn); const [rx, rz] = w.at(s, -.3); S.box(k.iron, 1.4, .05, .05, rx, by0 + .95, rz, w.yaw); }
      const [hx, hz] = w.at(T / 2, -.3); S.box(ring, T - 1.9, .7, .58, hx, by1 - .35, hz, w.yaw);
    }
    S.prism(brick, tp, by1, by1 + .6, { top: k.deck }); course(S, lime, tp, by1 + .12, .3, .16); course(S, lime, tp, by1 + .58, .16, .1);
    return S;
  },
};

export const SITES: SiteModel[] = [cityHall, theatre, engineHouse];
