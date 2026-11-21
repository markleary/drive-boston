import * as THREE from 'three';
import type { Point2 } from '../../types';
import { archShape, archWindow, band, chimney, clock, column, cornice, course, dome, door, frame, gable, inset, lampPost, parapet, pediment, rectPoly, rectWalls, Shapes, signBoard, spread, stairs, wallFrames, type M, type Rect, type SiteKit, type SiteModel, type WallFrame } from '../site-kit.ts';

/** A light sash window (a fifth of the kit window's triangles, for fronts of a hundred of them): white frame, glass and
 * glazing bars as flat panes, a projecting sill, and a lintel and keystone where asked. Sill at y, centred s along the wall. */
function sash(S: Shapes, k: SiteKit, f: WallFrame, s: number, y: number, w: number, h: number, o: { bars?: [number, number]; sill?: M | null; head?: M; key?: M } = {}) {
  const [cols, rows] = o.bars ?? [3, 4], at = (out: number, m: M, pw: number, ph: number, ds = 0, dy = 0) => { const [x, z] = f.at(s + ds, out); S.place(m, new THREE.PlaneGeometry(pw, ph), x, y + h / 2 + dy, z, f.yaw); };
  at(.03, k.whiteSash, w, h); at(.06, k.glass, w - .14, h - .14);
  for (let i = 1; i < cols; i++) at(.085, k.whiteSash, .04, h - .14, -w / 2 + w * i / cols);
  for (let i = 1; i < rows; i++) at(.085, k.whiteSash, w - .14, i * 2 === rows ? .07 : .04, 0, -h / 2 + h * i / rows);
  if (o.sill !== null) { const [x, z] = f.at(s, .09); S.box(o.sill ?? k.castStone, w + .24, .12, .18, x, y - .06, z, f.yaw); }
  if (o.head) { const [x, z] = f.at(s, .05); S.box(o.head, w + .36, .3, .1, x, y + h + .15, z, f.yaw); }
  if (o.key) { const [x, z] = f.at(s, .08); S.box(o.key, .26, .4, .16, x, y + h + .17, z, f.yaw); }
}
/** A flat pilaster against a wall: base, shaft and a two-part capital, w wide and `out` proud. */
function pilaster(S: Shapes, m: M, f: WallFrame, s: number, y0: number, y1: number, w: number, out = .2, capital = .5) {
  const part = (pw: number, h: number, d: number, yc: number) => { const [x, z] = f.at(s, d / 2); S.box(m, pw, h, d, x, yc, z, f.yaw); };
  part(w + .16, .3, out + .08, y0 + .15); part(w, y1 - y0 - .3 - capital, out, (y0 + .3 + y1 - capital) / 2); part(w + .1, capital * .6, out + .1, y1 - capital * .7); part(w + .3, capital * .4, out + .2, y1 - capital * .2);
}
/** A run of roof balustrade from a to b standing on y: rails, balusters and a pedestal at each end. */
function balustrade(S: Shapes, m: M, a: Point2, b: Point2, y: number, h = 1, step = .6) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz); if (len < .6) return; const n = Math.max(1, Math.round(len / step)), yaw = Math.atan2(-dz, dx);
  S.beam(m, [a[0], y + .09, a[1]], [b[0], y + .09, b[1]], .3, .18); S.beam(m, [a[0], y + h - .08, a[1]], [b[0], y + h - .08, b[1]], .34, .16);
  for (let i = 0; i < n; i++) { const t = (i + .5) / n; S.box(m, .15, h - .34, .15, a[0] + dx * t, y + h / 2 + .01, a[1] + dz * t, yaw); }
  for (const p of [a, b]) S.box(m, .44, h + .1, .44, p[0], y + (h + .1) / 2, p[1], yaw);
}
const within = (q: Point2, poly: Point2[]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i][1] > q[1]) !== (poly[j][1] > q[1]) && q[0] < (poly[j][0] - poly[i][0]) * (q[1] - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c; return c; };

/** Medford City Hall (Michael A. Dyer, 1936-37, a PWA project): Colonial Revival, a T on the mapped outline. The main
 * block is 55.7 m (the 180 ft of the record) by 17.5 m facing north to Salem Street, the council wing 18 by 22 m behind.
 * From the Massachusetts Historical Commission's form: granite base, ashlar limestone first storey, water-struck red
 * brick above between rusticated limestone corners, 12-over-12 sash under limestone lintels, then rubbed brick flat
 * arches with and without keystones, a modillion cornice and a balustrade on every side; the five centre bays a flat
 * limestone frontispiece with three segmental-arched portals, an engaged Corinthian order, iron balconies and an empty
 * pediment over the centre three; behind it the tower in three stages (arched louvres between Doric pilasters, the
 * clock, an octagonal cupola) under a gold saucer dome. The form counts 18 bays; 19 are drawn so that five can stand
 * in the middle. Storey heights, the tower's measures and its white paint are estimates. */
const cityHall: SiteModel = {
  id: 'medford-city-hall', name: 'Medford City Hall', place: 'medford-square', tile: '-3_-8', building: 'osm-way-29641266',
  note: 'Michael A. Dyer, 1936-37, Colonial Revival: limestone first storey, red brick above, 19 bays (the record counts 18), limestone frontispiece and pediment, three-stage clock tower with a gold dome, facing north; heights and tower measures estimated',
  build({ k }, b) {
    const S = new Shapes(), base = b!.baseElevation ?? 0, foot = base - 1.5, y = (h: number) => base + h;
    // North-east corner: u west along the Salem Street front, v south into the building.
    const f = frame([-2555.69, -7564.08], [-2611.31, -7561.72], [-2554.95, -7546.69]), L = 55.67, D = 17.45, c = L / 2, bay = 2.82, F = .75, B = 4.75, A = 12.1, R = 13;
    const main: Rect = { u0: 0, u1: L, v0: 0, v1: D }, wing: Rect = { u0: 18.83, u1: 36.79, v0: D, v1: 39.58 }, mw = rectWalls(f, main), ww = rectWalls(f, wing);
    const plan: Point2[] = [f.W(0, 0), f.W(L, 0), f.W(L, D), f.W(wing.u1, D), f.W(wing.u1, wing.v1), f.W(wing.u0, wing.v1), f.W(wing.u0, D), f.W(0, D)];
    const lime = k.limestone, stone = k.tint('castStone', '#d2cab5'), rubbed = k.tint('trim', '#b0654e'), white = k.trim, louvre = k.tint('clapboard', '#7c817c');
    S.prism(k.granite, plan, foot, y(F), { top: null }); S.prism(lime, plan, y(F), y(B), { top: null }); S.prism(k.brick, plan, y(B), y(R), { top: k.gravel });
    course(S, stone, plan, y(F), .2, .1); course(S, stone, plan, y(B), .32, .12); cornice(S, stone, plan, y(R), .9, .55, false);
    for (const w of wallFrames(plan)) for (let s = .3; s < w.length; s += 1.1) { const [x, z] = w.at(s, .26); S.box(stone, .22, .2, .4, x, y(R - .5), z, w.yaw); }
    for (const [u, v] of [[.45, .45], [L - .45, .45], [L - .45, D - .45], [.45, D - .45], [wing.u0 + .45, wing.v1 - .45], [wing.u1 - .45, wing.v1 - .45]]) { const [x, z] = f.W(u, v); S.block(lime, 1.1, 1.1, x, z, y(B), y(A), f.yaw); }
    // The three storeys of a bay: limestone lintel, rubbed brick flat arch with a keystone, flat arch without.
    const us = Array.from({ length: 19 }, (_, i) => c + (i - 9) * bay);
    const storeys = (w: WallFrame, s: number) => { sash(S, k, w, s, y(1.7), 1.2, 2.3, { head: stone, sill: stone }); sash(S, k, w, s, y(5.9), 1.2, 2.5, { head: rubbed, key: stone, sill: stone }); sash(S, k, w, s, y(9.7), 1.2, 1.95, { head: rubbed, sill: stone }); };
    us.forEach((u, i) => { if (i < 7 || i > 11) storeys(mw.front, u); if (i < 6 || i > 12) storeys(mw.back, L - u); });
    // The limestone frontispiece of the five centre bays.
    const FR: Rect = { u0: c - 7.5, u1: c + 7.5, v0: -.45, v1: .3 }, fw = rectWalls(f, FR).front, fs = (i: number) => us[i] - FR.u0;
    S.prism(lime, rectPoly(f, FR), foot, y(R), { top: stone });
    band(S, stone, fw, -.12, 15.12, y(A + .2), .4, .18); band(S, stone, fw, -.3, 15.3, y(R - .2), .4, .62); band(S, stone, fw, -.05, 15.05, y(B), .32, .14);
    for (let j = 0; j < 6; j++) pilaster(S, stone, fw, 7.5 + (j - 2.5) * bay, y(B + .2), y(A), .6, .22, .75);
    const portal = (s: number) => {
      const wd = 1.9, h = 2.75, r = 1.284, drop = r - .42, a0 = Math.acos(wd / 2 / r), top = y(F) + h + .16;
      door(S, k, fw, s, y(F), wd, h, { leaf: k.bronze, frame: stone, glazed: true });
      const shape = new THREE.Shape(); shape.moveTo(-wd / 2, 0); shape.lineTo(wd / 2, 0); shape.absarc(0, -drop, r, a0, Math.PI - a0, false); shape.lineTo(-wd / 2, 0);
      const [x, z] = fw.at(s, .05), [ax, az] = fw.at(s, .09); S.place(k.glass, new THREE.ShapeGeometry(shape, 8), x, top, z, fw.yaw);
      S.place(stone, new THREE.RingGeometry(r, r + .26, 12, 1, a0, Math.PI - 2 * a0), ax, top - drop, az, fw.yaw); S.box(stone, .26, .46, .16, ax, top + .55, az, fw.yaw);
    };
    for (let i = 7; i <= 11; i++) {
      const s = fs(i);
      if (i > 7 && i < 11) portal(s); else sash(S, k, fw, s, y(1.7), 1.2, 2.3, { sill: stone });
      // Second floor: a limestone architrave and a shallow iron balcony. Third floor: plain.
      sash(S, k, fw, s, y(5.9), 1.2, 2.5, { sill: null });
      for (const side of [-1, 1]) { const [x, z] = fw.at(s + side * .7, .05); S.box(stone, .16, 2.7, .1, x, y(5.9) + 1.35, z, fw.yaw); }
      { const [x, z] = fw.at(s, .07); S.box(stone, 1.84, .2, .14, x, y(8.5), z, fw.yaw); S.box(stone, 2, .1, .22, x, y(8.66), z, fw.yaw); }
      { const [x, z] = fw.at(s, .2), [rx, rz] = fw.at(s, .38); S.box(stone, 1.9, .1, .4, x, y(5.82), z, fw.yaw); S.box(k.iron, 1.86, .05, .04, rx, y(6.7), rz, fw.yaw); S.box(k.iron, 1.86, .04, .04, rx, y(5.95), rz, fw.yaw); for (const t of spread(-.93, .93, 9)) { const [px, pz] = fw.at(s + t, .38); S.box(k.iron, .03, .75, .03, px, y(6.32), pz, fw.yaw); } }
      sash(S, k, fw, s, y(9.7), 1.2, 1.95, { sill: stone });
    }
    stairs(S, k.granite, fw, 7.5, 11, y(F), 5, { rise: .15, tread: .36, cheeks: lime });
    for (const side of [-1, 1]) { const [x, z] = fw.at(7.5 + side * 6.6, 2.6); lampPost(S, k, x, y(0), z, 3.2); }
    { const [x, z] = fw.at(7.5 - 1.5 * bay, .03); S.box(k.bronze, .7, .5, .05, x, y(2.2), z, fw.yaw); }
    // The empty pediment over the centre three bays, a gabled attic behind it.
    gable(S, f, { u0: c - 4.7, u1: c + 4.7, v0: -.45, v1: 3.2 }, y(R), 2.3, k.seam, { axis: 'v', wall: lime, overhang: .25, trim: stone });
    pediment(S, stone, fw, 2.8, 12.2, y(R), 2.3, .3, { tympanum: lime });
    // Each end: a centre door under a broken segmental pediment on consoles with the city seal, an empty arched niche above.
    for (const w of [mw.left, mw.right]) {
      const m = D / 2, r = 1.6, a0 = Math.acos(1.25 / r), cy = y(F) + 3 - r * Math.sin(a0), [x, z] = w.at(m, .1), [nx, nz] = w.at(m, .03);
      for (const j of [0, 1, 3, 4]) storeys(w, m + (j - 2) * 3.1);
      door(S, k, w, m, y(F), 1.7, 2.6, { frame: stone }); S.box(stone, 2.9, .2, .34, x, y(F) + 2.9, z, w.yaw);
      for (const side of [-1, 1]) { const [qx, qz] = w.at(m + side * 1.2, .14); S.box(stone, .22, .55, .28, qx, y(F) + 2.55, qz, w.yaw); }
      S.place(stone, new THREE.RingGeometry(r, r + .26, 6, 1, a0, Math.PI / 2 - .3 - a0), x, cy, z, w.yaw); S.place(stone, new THREE.RingGeometry(r, r + .26, 6, 1, Math.PI / 2 + .3, Math.PI / 2 - .3 - a0), x, cy, z, w.yaw);
      S.place(k.bronze, new THREE.CircleGeometry(.34, 16), x, cy + r + .02, z, w.yaw, 0, 0, [.82, 1.12, 1]);
      S.place(k.tint('castStone', '#b3ab96'), new THREE.ShapeGeometry(archShape(1.1, 1.9), 8), nx, y(5.9), nz, w.yaw); S.place(stone, new THREE.RingGeometry(.55, .78, 12, 1, 0, Math.PI), x, y(7.8), z, w.yaw); S.box(stone, 1.4, .12, .2, x, y(5.84), z, w.yaw);
      sash(S, k, w, m, y(9.7), 1.2, 1.95, { head: rubbed, sill: stone }); stairs(S, k.granite, w, m, 2.6, y(F), 5, { rise: .15, tread: .32, cheeks: lime });
    }
    { const [x, z] = f.W(1.7, D - 1.5); chimney(S, k.brick, x, z, y(R), y(R + 4.8), 2.1, 1.3, f.yaw, stone); }
    // The council wing: two-storey arched windows under limestone swags, and a pediment with an oculus on its south end.
    const tall = (w: WallFrame, s: number) => { sash(S, k, w, s, y(1.7), 1.2, 2.3, { head: stone, sill: stone }); archWindow(S, k, w, s, y(5.9), 1.7, 4.2, { frame: k.whiteSash, head: stone, sill: stone, panes: [3, 5] }); const [x, z] = w.at(s, .06); S.place(stone, new THREE.RingGeometry(.42, .6, 8, 1, Math.PI, Math.PI), x, y(11.95), z, w.yaw); };
    for (const w of [ww.left, ww.right]) for (const s of spread(1.2, w.length - 1.2, 5)) tall(w, s);
    for (const s of spread(1.6, ww.back.length - 1.6, 3)) tall(ww.back, s);
    const wc = (wing.u0 + wing.u1) / 2;
    gable(S, f, { u0: wc - 4.6, u1: wc + 4.6, v0: wing.v1 - 3.2, v1: wing.v1 + .1 }, y(R), 2.1, k.seam, { axis: 'v', wall: k.brick, overhang: .25, trim: stone });
    pediment(S, stone, ww.back, ww.back.length / 2 - 4.6, ww.back.length / 2 + 4.6, y(R), 2.1, .3, { tympanum: k.brick, oculus: k.glass });
    // The balustrade round the roof, broken by the two pediments.
    const rail = inset(plan, -.3);
    rail.forEach((a, i) => {
      const q = rail[(i + 1) % rail.length], n = Math.max(1, Math.round(Math.hypot(q[0] - a[0], q[1] - a[1]) / (bay * 2)));
      for (let j = 0; j < n; j++) { const p0: Point2 = [a[0] + (q[0] - a[0]) * j / n, a[1] + (q[1] - a[1]) * j / n], p1: Point2 = [a[0] + (q[0] - a[0]) * (j + 1) / n, a[1] + (q[1] - a[1]) * (j + 1) / n], u = f.uOf([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]); if ((i === 0 && Math.abs(u - c) < 5) || (i === 4 && Math.abs(u - wc) < 5)) continue; balustrade(S, stone, p0, p1, y(R)); }
    });
    // The tower behind the pediment: a brick base, the louvred stage, the clock stage, the octagonal cupola, the gold dome.
    const tv = 6.6, [tx, tz] = f.W(c, tv), sq = (half: number) => rectPoly(f, { u0: c - half, u1: c + half, v0: tv - half, v1: tv + half }), p0 = sq(3.4), p1 = sq(2.9), p2 = sq(2.3);
    S.prism(k.brick, p0, y(R), y(R + 2.3), { top: stone }); course(S, stone, p0, y(R + 2.2), .26, .12);
    S.prism(white, p1, y(R + 2.3), y(R + 7.6), { top: white });
    for (const w of wallFrames(p1)) { archWindow(S, k, w, 2.9, y(R + 3.3), 1.6, 2.5, { glass: louvre, frame: white, head: white, sill: white, panes: [1, 1] }); for (const s of [.3, 1.4, 4.4, 5.5]) pilaster(S, white, w, s, y(R + 2.35), y(R + 6.9), .42, .12, .4); }
    cornice(S, white, p1, y(R + 7.6), .7, .4, true);
    S.prism(white, p2, y(R + 7.6), y(R + 11.2), { top: white });
    for (const w of wallFrames(p2)) { clock(S, k, w, 2.3, y(R + 9.25), 1.1, k.blackPaint); const [x, z] = w.at(2.3, .07); S.place(white, new THREE.RingGeometry(1.34, 1.6, 16, 1, 0, Math.PI), x, y(R + 9.25), z, w.yaw); for (const s of [.25, 4.35]) pilaster(S, white, w, s, y(R + 7.65), y(R + 10.8), .36, .1, .3); }
    cornice(S, white, p2, y(R + 11.2), .5, .3, false);
    const oct: Point2[] = Array.from({ length: 8 }, (_, i) => { const a = (i + .5) / 8 * Math.PI * 2; return f.W(c + Math.cos(a) * 1.95, tv + Math.sin(a) * 1.95); });
    S.prism(white, oct, y(R + 11.2), y(R + 14.3), { top: white });
    for (const w of wallFrames(oct)) archWindow(S, k, w, w.length / 2, y(R + 11.9), .7, 1.3, { frame: k.whiteSash, head: white, sill: white, panes: [2, 2] });
    for (const p of oct) S.rod(white, [p[0], y(R + 11.2), p[1]], [p[0], y(R + 14.1), p[1]], .13, .13, 6);
    course(S, white, oct, y(R + 14.2), .3, .24); S.solidBox(4, 4, tx, tz, y(R + 11.2), y(R + 15.4), f.yaw);
    dome(S, k.gold, tx, y(R + 14.35), tz, 2.1, 1.15, 24); S.rod(k.gold, [tx, y(R + 15.4), tz], [tx, y(R + 16.9), tz], .1, .03); S.place(k.gold, new THREE.SphereGeometry(.24, 12, 10), tx, y(R + 15.85), tz);
    return S;
  },
};

/** The Chevalier Theatre and the Old Medford High School it is the south wing of (Michael A. Dyer; the theatre a WPA
 * project of 1939, dedicated 1940). The mapped footprint is the whole complex along Forest Street, its fronts facing
 * east: the 1895 centre block between its end pavilions, the 1929 north wing and the 1939 south wing, each an L whose
 * arm reaches east to the street, joined to the centre by narrow three-storey connectors. All of it stands as brick
 * blocks on that outline, three storeys of windows under flat roofs and parapets. The south arm is the auditorium:
 * its east end is drawn from the National Register nomination as a five-bay pavilion with a rusticated ground storey,
 * three entries in cast-stone surrounds, engaged Ionic columns through the two storeys above between windows in eared
 * surrounds, paired pilasters at the corners, a cast-stone cornice with a copper crown and a plain brick parapet, the
 * stage house rising behind. Heights, the column count (four), the bay rhythm of the other blocks and the wording of
 * the name board (the venue's present name; no source gives the building's lettering) are interpretive. */
const chevalier: SiteModel = {
  id: 'chevalier-theatre', name: 'Chevalier Theatre', place: 'medford-square', tile: '-3_-8', building: 'osm-way-29686962',
  note: 'Michael A. Dyer, 1939 (WPA), the south wing of the Old Medford High School: the complex as brick blocks on its mapped outline, the five-bay Ionic pavilion front on Forest Street facing east; heights, four columns and the name board interpretive',
  build({ k, ground }) {
    // South-west corner of the auditorium arm: u east toward Forest Street, v north along the complex.
    const S = new Shapes(), f = frame([-2907.15, -7706.86], [-2813.08, -7672.93], [-2898.98, -7729.53]), g0 = ground(...f.W(53, 12)), foot = g0 - 1.7, y = (h: number) => g0 + h;
    const cast = k.tint('castStone', '#cfc8b6'), brick = k.brick, old = k.tint('brick', '#96513c'), brown = k.brownstone, joint = k.tint('trim', '#7f4a3a');
    const P = (pts: [number, number][]) => pts.map(([u, v]) => f.W(u, v)), box = (u0: number, u1: number, v0: number, v1: number) => P([[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    // The auditorium arm is a shade off square with the rest: its south wall falls .8 m and its north wall gains .5 m over 50 m.
    const sk = (u: number) => -.8 * u / 50.2, nk = (u: number) => 24.1 + .5 * u / 50.2, rooms: [number, number][] = [[1.5, 2.2], [5.7, 2.3], [9.6, 2.1]];
    interface Block { p: Point2[]; top: number; m: M; floors: [number, number][]; bay: number; w: number; keep?: (wall: number, s: number, floor: number) => boolean; base?: M; }
    const stage: Block = { p: P([[0, 0], [12, sk(12)], [12, nk(12)], [0, 24.1]]), top: 17.8, m: brick, floors: [[1.5, 1.6], [6, 1.6]], bay: 5.5, w: 1.2 };
    const hall: Block = { p: P([[12, sk(12)], [50.2, -.8], [50.2, 24.6], [12, nk(12)]]), top: 13.6, m: brick, floors: [[1.5, 1.8], [6.2, 4.4]], bay: 4.7, w: 1.6, keep: wall => wall !== 1 };
    const south: Block = { p: box(7, 27.2, 24.2, 64.2), top: 12.8, m: brick, floors: rooms, bay: 3.5, w: 2 };
    const centre: Block = { p: P([[5.3, 70.9], [30.6, 70.9], [30.6, 83.7], [27.5, 83.7], [27.5, 116], [30, 116], [30, 129.6], [4.8, 129.6], [4.8, 112.7], [10.1, 112.7], [10.1, 108.1], [-6.5, 108.1], [-6.5, 91.6], [10.4, 91.6], [10.4, 84.1], [5.3, 84.1]]), top: 13.8, m: old, floors: [[2.1, 2.2], [6.1, 2.4], [10, 2.1]], bay: 3.3, w: 1.5, keep: (wall, s, floor) => !(wall === 3 && floor === 0 && Math.abs(s - 16.15) < 3), base: brown };
    const north: Block = { p: P([[7, 136], [28.1, 136], [28.1, 163], [52.2, 163], [52.2, 183.1], [7, 183.1]]), top: 12.8, m: brick, floors: rooms, bay: 3.5, w: 2 };
    const linkS: Block = { p: box(12, 18.9, 64, 71.1), top: 12, m: brick, floors: rooms.slice(1), bay: 2.2, w: 1.2 }, linkN: Block = { p: box(11.5, 19.6, 129.4, 136.2), top: 12, m: brick, floors: rooms, bay: 2.4, w: 1.3 };
    const exits: Block[] = [{ p: P([[4.1, -6.5], [9.5, -6.5], [9.5, -4.9], [13.6, -4.9], [13.6, .2], [4.1, .2]]), top: 8.4, m: brick, floors: [[1.5, 1.6], [5, 1.6]], bay: 3, w: 1.1 }, { p: box(36.1, 40, -4.1, -.4), top: 8.4, m: brick, floors: [[1.5, 1.6], [5, 1.6]], bay: 3, w: 1.1 }];
    const blocks = [stage, hall, south, linkS, centre, linkN, north, ...exits];
    for (const block of blocks) {
      if (block.base) { S.prism(block.base, block.p, foot, y(1.5), { top: null }); S.prism(block.m, block.p, y(1.5), y(block.top), { top: k.gravel }); } else S.prism(block.m, block.p, foot, y(block.top), { top: k.gravel });
      parapet(S, block.m, block.p, y(block.top), .9, .3, cast); course(S, block.base ?? cast, block.p, y(block === hall ? 5.2 : 4.9), .3, .1); course(S, block.base ?? cast, block.p, y(block.top - .25), .4, .16);
      wallFrames(block.p).forEach((w, i) => {
        const n = Math.floor((w.length - .8) / block.bay); if (n < 1) return;
        for (const s of spread(.4, w.length - .4, n)) block.floors.forEach(([sill, h], floor) => {
          if (sill + h > block.top - .5 || (block.keep && !block.keep(i, s, floor))) return;
          const out = w.at(s, .7); if (blocks.some(o => o !== block && o.top + .9 > sill + h / 2 && within(out, o.p))) return;
          sash(S, k, w, s, y(sill), block.w, h, { bars: h > 3 ? [3, 5] : [2, 2], sill: block.base ?? cast });
        });
      });
    }
    // The theatre front on Forest Street: five bays between paired corner pilasters.
    const tf = wallFrames(hall.p)[1], TL = tf.length, F = .5, G = 5.2, A = 12.3, bays = spread(2.2, TL - 2.2, 5), bw = (TL - 4.4) / 5;
    for (let h = .95; h < G - .3; h += .5) band(S, joint, tf, 0, TL, y(h), .06, .02);
    band(S, cast, tf, -.1, TL + .1, y(.35), .7, .1); band(S, cast, tf, -.12, TL + .12, y(G), .4, .2);
    bays.forEach((s, i) => {
      if (i > 0 && i < 4) {
        // An entry: double doors in a cast-stone surround under a cornice hood.
        door(S, k, tf, s, y(F), 2, 2.7, { leaf: k.tint('door', '#5b2f22'), frame: cast });
        for (const side of [-1, 1]) { const [x, z] = tf.at(s + side * 1.3, .09); S.box(cast, .36, 3.2, .18, x, y(F) + 1.6, z, tf.yaw); }
        const [x, z] = tf.at(s, .16), [hx, hz] = tf.at(s, .24); S.box(cast, 3.1, .42, .32, x, y(F) + 3.3, z, tf.yaw); S.box(cast, 3.5, .14, .48, hx, y(F) + 3.58, hz, tf.yaw);
      } else sash(S, k, tf, s, y(1.6), 1.5, 2.3, { head: cast, sill: cast });
      // Above: a tall window and a square one, each in an eared surround, the lower with a moulded cap.
      for (const [sill, h, cap] of [[6.3, 2.7, true], [10, 1.6, false]] as [number, number, boolean][]) {
        sash(S, k, tf, s, y(sill), 1.5, h, { bars: [3, cap ? 4 : 2], sill: cast });
        for (const side of [-1, 1]) { const [x, z] = tf.at(s + side * .85, .05); S.box(cast, .2, h, .1, x, y(sill) + h / 2, z, tf.yaw); }
        const [x, z] = tf.at(s, .06); S.box(cast, 2.2, .22, .12, x, y(sill) + h + .11, z, tf.yaw); if (cap) { const [cx, cz] = tf.at(s, .12); S.box(cast, 2.4, .12, .24, cx, y(sill) + h + .34, cz, tf.yaw); }
      }
    });
    for (let j = 1; j < 5; j++) { const [x, z] = tf.at(2.2 + bw * j, .36); column(S, cast, x, z, y(G + .2), A - G - .2, .42, { order: 'ionic', yaw: tf.yaw }); }
    for (const s of [.6, 1.62, TL - 1.62, TL - .6]) pilaster(S, cast, tf, s, y(G + .2), y(A), .62, .16, .5);
    band(S, cast, tf, -.2, TL + .2, y(A + .22), .44, .84); band(S, cast, tf, -.2, TL + .2, y(A + .72), .56, .8); band(S, cast, tf, -.3, TL + .3, y(A + 1.14), .28, 1.06); band(S, k.copperPlain, tf, -.34, TL + .34, y(A + 1.33), .1, 1.12);
    signBoard(S, k, tf, TL / 2, y(4.55), 6.4, .56, 'CHEVALIER THEATRE', { color: '#efe6cf', background: '#2a211d', frame: k.bronze, out: .14 });
    stairs(S, k.granite, tf, TL / 2, bw * 3 + 1.2, y(F), 3, { rise: .17, tread: .34 });
    // The pedimented parapets of the classroom wings, the connector's three doors in pedimented frames, the old school's door.
    const crown = (block: Block, wall: number, half: number, rise: number) => {
      const w = wallFrames(block.p)[wall], m = w.length / 2, top = y(block.top + .9); pediment(S, cast, w, m - half, m + half, top, rise, .2, { tympanum: block.m });
      const a = w.at(m - half, -.3), c = w.at(m + half, -.3), e = w.at(m, -.3); S.poly(block.m, [[a[0], top, a[1]], [c[0], top, c[1]], [e[0], top + rise, e[1]]], [-w.n[0], 0, -w.n[1]]);
    };
    crown(south, 1, 6, 1.7); crown(north, 1, 5, 1.5); crown(north, 3, 6, 1.7); crown(centre, 1, 5, 1.6); crown(centre, 5, 5, 1.6);
    const lw = wallFrames(linkS.p)[1];
    for (const s of spread(.2, lw.length - .2, 3)) { door(S, k, lw, s, y(.6), 1.4, 2.5, { leaf: k.tint('door', '#5b2f22'), frame: cast }); pediment(S, cast, lw, s - .95, s + .95, y(3.3), .45, .22); }
    stairs(S, k.granite, lw, lw.length / 2, lw.length - .4, y(.6), 4, { rise: .16, tread: .32 });
    const cw = wallFrames(centre.p)[3];
    door(S, k, cw, 16.15, y(1.5), 2.2, 2.9, { leaf: k.tint('door', '#4a2a1c'), frame: brown, fan: true });
    for (const side of [-1, 1]) { const [x, z] = cw.at(16.15 + side * 1.9, .25); S.block(brown, .8, .5, x, z, foot, y(5.9), cw.yaw); }
    { const [x, z] = cw.at(16.15, .3); S.box(k.tint('trim', '#7d5a48'), 4.8, .5, .7, x, y(6.1), z, cw.yaw); }
    stairs(S, brown, cw, 16.15, 4.2, y(1.5), 9, { rise: .17, tread: .32, cheeks: brown });
    return S;
  },
};
export const SITES: SiteModel[] = [cityHall, chevalier];
