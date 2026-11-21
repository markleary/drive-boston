import * as THREE from 'three';
import type { Point2 } from '../../types';
import { band, clock, colonnade, course, dome, door, flagpole, frame, hip, inset, lathe, parapet, pyramid, railing, rectPoly, rectWalls, rectWindow, Shapes, signBoard, spread, stairs, wallFrame, wallFrames, type SiteKit, type SiteModel, type V3, type WallFrame } from '../site-kit.ts';

// ------------------------------------------------------------------ local parts
/** A segmentally arched window (sill at y0, jambs `spring` high, the head rising about a sixth of the width) under a
 * stone arch with a keystone: the first-floor windows of an 1870s town hall. The kit's arches are round or pointed. */
function segmentalWindow(S: Shapes, k: SiteKit, f: WallFrame, s: number, y0: number, w: number, spring: number, stone: THREE.Material, fr: THREE.Material = k.whiteSash) {
  const r = w / 2, rise = w * .17, R = (r * r + rise * rise) / (2 * rise), half = Math.asin(r / R), cy = spring + rise - R, [x, z] = f.at(s, .03), [fx, fz] = f.at(s, .06), [hx, hz] = f.at(s, .05), [kx, kz] = f.at(s, .09), [sx, sz] = f.at(s, .11), g = new THREE.Shape();
  g.moveTo(-r, 0); g.lineTo(r, 0); g.lineTo(r, spring); g.absarc(0, cy, R, Math.PI / 2 - half, Math.PI / 2 + half, false); g.lineTo(-r, 0);
  S.place(k.glass, new THREE.ShapeGeometry(g, 8), x, y0, z, f.yaw);
  for (const side of [-1, 1]) S.box(fr, .08, spring, .09, fx + f.t[0] * side * (r - .04), y0 + spring / 2, fz + f.t[1] * side * (r - .04), f.yaw);
  S.box(fr, w, .08, .09, fx, y0 + .04, fz, f.yaw); S.box(fr, .05, spring + rise * .9, .05, fx, y0 + (spring + rise * .9) / 2, fz, f.yaw); S.box(fr, w - .1, .06, .05, fx, y0 + spring * .52, fz, f.yaw);
  S.place(fr, new THREE.RingGeometry(R - .08, R, 10, 1, Math.PI / 2 - half, half * 2), fx, y0 + cy, fz, f.yaw);
  S.place(stone, new THREE.RingGeometry(R + .01, R + .3, 12, 1, Math.PI / 2 - half * 1.16, half * 2.32), hx, y0 + cy, hz, f.yaw);
  S.box(stone, .3, .54, .18, kx, y0 + spring + rise + .16, kz, f.yaw); S.box(stone, w + .3, .14, .22, sx, y0 - .07, sz, f.yaw);
}
/** A fixed draw in 0..1 for a pair of whole numbers. */
const draw = (a: number, b: number) => { let x = Math.imul((a * 374761393 + b * 668265263) ^ 0x9e3779b9, 1274126177); x ^= x >>> 15; x = Math.imul(x, 2246822519); x ^= x >>> 13; return (x >>> 0) / 4294967296; };
/** A curtain wall on s0..s1 of a wall: storeys of `fl` from y0, each a spandrel panel under a band of glass, mullions
 * about every 1.45 m and a fascia on top; blinds are drawn part of the way down a share of the lights, the same ones
 * every time. `open` leaves the lowest spandrel out between two module lines (an entrance). Returns the module width. */
function curtainWall(S: Shapes, k: SiteKit, f: WallFrame, s0: number, s1: number, y0: number, floors: number, fl: number, panel: THREE.Material, mull: THREE.Material, blind: THREE.Material, open?: [number, number]) {
  const w = s1 - s0, n = Math.max(1, Math.round(w / 1.45)), bay = w / n, top = floors * fl + .45;
  const strip = (m: THREE.Material, a: number, c: number, lo: number, hi: number, out: number, d: number) => { const [x, z] = f.at((a + c) / 2, out); S.box(m, c - a, hi - lo, d, x, y0 + (lo + hi) / 2, z, f.yaw); };
  for (let i = 0; i <= floors; i++) {
    const lo = i * fl - .38, hi = i === floors ? top : i * fl + .78;
    if (i === 0 && open) { const a = s0 + open[0] * bay, c = s0 + open[1] * bay, [x, z] = f.at((a + c) / 2, .04); strip(panel, s0, a, lo, hi, .05, .1); strip(panel, c, s1, lo, hi, .05, .1); S.place(k.curtainWall, new THREE.PlaneGeometry(c - a, hi), x, y0 + hi / 2, z, f.yaw); }
    else strip(panel, s0, s1, lo, hi, .05, .1);
  }
  for (let i = 0; i < floors; i++) {
    const lo = i * fl + .78, hi = (i + 1) * fl - .38, [x, z] = f.at((s0 + s1) / 2, .04);
    S.place(k.curtainWall, new THREE.PlaneGeometry(w, hi - lo), x, y0 + (lo + hi) / 2, z, f.yaw);
    for (const h of [lo, lo + .8, hi]) strip(mull, s0, s1, h - .03, h + .03, .1, .08);
    for (let j = 0; j < n; j++) {
      const r = draw(i * 131 + Math.round(s0 * 7), j), drop = r < .55 ? 0 : (hi - lo) * [.22, .35, .5, .8][Math.floor((r - .55) / .45 * 4)], [bx, bz] = f.at(s0 + (j + .5) * bay, .05);
      if (drop && !(open && i === 0 && j >= open[0] && j < open[1])) S.place(blind, new THREE.PlaneGeometry(bay - .09, drop), bx, y0 + hi - drop / 2, bz, f.yaw);
    }
  }
  for (let i = 0; i <= n; i++) strip(mull, s0 + i * bay - .035, s0 + i * bay + .035, -.38, top, .13, .14);
  return bay;
}

// ------------------------------------------------------------------ Melrose Memorial Hall
/** Soldiers and Sailors Memorial Hall, 590 Main Street, Melrose (George F. Newton, 1912): a monument front of grey
 * Quincy granite salvaged from the 1830s Suffolk County Court House, a two-storey centre between two monumental piers
 * with one-storey wings, before the auditorium. The mapped outline gives the wings, the piers (3.2 m wide, 0.6 m proud),
 * the 12 m centre and the hall behind; the National Register form gives the eleven steps, the colonnade and its frieze. */
const memorialHall: SiteModel = {
  id: 'melrose-memorial-hall', name: 'Melrose Memorial Hall', place: 'melrose-city-hall', tile: '0_-12', building: 'osm-way-29564579',
  note: 'George F. Newton, 1912: Quincy granite front on the mapped outline (centre between two piers, one-storey wings), eleven steps, colonnade and frieze lettering from the National Register form; the four Doric columns, heights, openings and the buff brick auditorium are interpretive',
  build({ k }, b) {
    const S = new Shapes(), base = b!.baseElevation ?? 0, foot = base - 2.6, y = (h: number) => base + h;
    // South-east corner; u north along the Main Street front (29.8 m), v west into the building.
    const f = frame([799.42, -11884.91], [811.22, -11912.26], [766.7, -11929.89]), out: Point2 = [-f.V[0], -f.V[1]];
    const W = 29.79, D = 6.75, P0 = 5.32, C0 = 8.5, C1 = 20.55, P1 = 23.72, CL = C1 - C0, F = 1.87, wing = 7, colTop = 9, attic = 12.4, pier = 11.8;
    const granite = k.tint('limestone', '#b1b0ac'), dressed = k.tint('trim', '#c1bfb9'), sash = k.tint('sash', '#2f2c27'), bronze = k.tint('door', '#4a3d2c'), brick = k.tint('buffBrick', '#b7a587'), ink = '#4f4c46';
    const front = wallFrame(f.W(0, 0), f.W(W, 0), out), tall = { frame: sash, panes: [3, 4] as [number, number], sill: dressed, head: dressed };
    // One-storey wings (they run on behind the piers), a window to the street and one to the side.
    for (const [u0, u1, mid] of [[0, C0, P0 / 2], [C1, W, (P1 + W) / 2]]) {
      const r = { u0, u1, v0: 0, v1: D }, p = rectPoly(f, r), w = rectWalls(f, r);
      S.prism(granite, p, foot, y(wing), { top: k.deck });
      const side = u0 === 0 ? w.left : w.right, s0 = u0 === 0 ? 0 : P1, s1 = u0 === 0 ? P0 : W;
      for (const [h, t, d] of [[F - .12, .24, .1], [wing - .8, .3, .14], [wing - .08, .16, .08]]) { band(S, dressed, front, s0, s1, y(h), t, d); band(S, dressed, side, -d, D, y(h), t, d); }
      rectWindow(S, k, front, mid, y(F + 1.05), 1.9, 3, tall); rectWindow(S, k, side, D / 2, y(F + 1.05), 1.9, 3, tall);
    }
    // The monumental piers: plain shafts with a slit window, a sunk panel, a stepped cap and a flagpole each.
    for (const [u0, u1] of [[P0, C0], [C1, P1]]) {
      const r = { u0, u1, v0: -.6, v1: 3.6 }, p = rectPoly(f, r), w = rectWalls(f, r), [cx, cz] = f.W((u0 + u1) / 2, 1.5);
      S.prism(granite, p, foot, y(pier)); course(S, dressed, p, y(F - .12), .24, .1); course(S, dressed, p, y(pier - .12), .24, .12);
      S.block(granite, 2.3, 3.2, cx, cz, y(pier), y(pier + .45), f.yaw); flagpole(S, k, cx, y(pier + .45), cz, 6.5);
      rectWindow(S, k, w.front, (u1 - u0) / 2, y(F + 1.4), .9, 2.3, { frame: sash, panes: [1, 3], sill: dressed, head: dressed });
      band(S, dressed, w.front, .75, u1 - u0 - .75, y(8.6), 1.7, .06);
    }
    // The centre: the hall's front wall behind an open loggia, its entablature and attic carried on four columns.
    S.prism(granite, rectPoly(f, { u0: C0, u1: C1, v0: 1.6, v1: D }), foot, y(attic), { top: k.deck });
    S.prism(granite, rectPoly(f, { u0: C0, u1: C1, v0: -.6, v1: 1.6 }), foot, y(F));
    S.prism(granite, rectPoly(f, { u0: C0, u1: C1, v0: -.35, v1: 1.6 }), y(colTop), y(attic), { top: k.deck, bottom: dressed });
    const ent = wallFrame(f.W(C0, -.35), f.W(C1, -.35), out), back = wallFrame(f.W(C0, 1.6), f.W(C1, 1.6), out), stylo = wallFrame(f.W(C0, -.6), f.W(C1, -.6), out);
    for (const [x, z] of colonnade(S, dressed, stylo, [1, 2, 3, 4].map(i => i * CL / 5), -.75, y(F), colTop - F, .46, { order: 'doric' })) S.solidBox(.9, .9, x, z, y(F), y(colTop), f.yaw);
    band(S, dressed, ent, 0, CL, y(colTop + .5), .1, .07); band(S, dressed, ent, 0, CL, y(colTop + .98), .84, .04);
    band(S, dressed, ent, 0, CL, y(colTop + 1.5), .2, .16); band(S, dressed, ent, 0, CL, y(colTop + 1.95), .34, .5); band(S, dressed, ent, 0, CL, y(attic - .08), .16, .1);
    for (let s = .25; s < CL; s += .42) { const [x, z] = ent.at(s, .14); S.box(dressed, .2, .18, .2, x, y(colTop + 1.69), z, ent.yaw); }
    band(S, dressed, ent, CL / 2 - 3.2, CL / 2 + 3.2, y(attic - .75), .8, .05);
    // The frieze: SOLDIERS . MEMORIAL . SAILORS, cut in the granite.
    for (const [text, s, w] of [['SOLDIERS', 2.15, 2.9], ['MEMORIAL', CL / 2, 3], ['SAILORS', CL - 2.05, 2.6]] as [string, number, number][]) signBoard(S, k, ent, s, y(colTop + .98), w, .6, text, { color: ink, background: '#c1bfb9', out: .09 });
    for (const s of [4.07, CL - 3.93]) { const [x, z] = ent.at(s, .09); S.box(k.tint('trim', ink), .11, .11, .02, x, y(colTop + .98), z, ent.yaw); }
    // Three bronze doors under transoms in the middle bays, the second-storey transom windows over them.
    for (const [i, s] of spread(0, CL, 5).entries()) {
      const mid = i > 0 && i < 4;
      if (mid) { door(S, k, back, s, y(F), 1.7, 2.75, { leaf: bronze, frame: dressed }); rectWindow(S, k, back, s, y(F + 3), 1.7, .7, { frame: sash, panes: [3, 1], sill: null }); }
      else rectWindow(S, k, back, s, y(F + 1.1), 1, 2.3, { frame: sash, panes: [1, 3], sill: dressed });
      rectWindow(S, k, back, s, y(F + 4.35), mid ? 1.7 : 1, 2.2, { frame: sash, panes: mid ? [3, 3] : [1, 3], sill: dressed, head: dressed });
    }
    band(S, dressed, back, 0, CL, y(F + 3.98), .2, .08);
    // The flight of eleven granite steps between cheek blocks, with two rails.
    const run = stairs(S, granite, stylo, CL / 2, CL, y(F), 11, { rise: .17, tread: .34 });
    for (const s of [-.85, CL + .85]) { const [x, z] = stylo.at(s, run / 2); S.block(granite, 1.7, run, x, z, foot, y(F + .3), stylo.yaw); const [ex, ez] = stylo.at(s, run + .45); S.block(granite, 1.7, .9, ex, ez, foot, y(.75), stylo.yaw); }
    for (const s of [CL / 2 - 2, CL / 2 + 2]) { const a = stylo.at(s, .25), c = stylo.at(s, run - .1); railing(S, k.blackPaint, [[a[0], y(F), a[1]], [c[0], y(F - 1.7), c[1]]], .9, { spacing: 1.2, post: .05 }); }
    // The auditorium behind: buff brick on a granite base, tall hall windows between piers, a low metal roof inside its parapet.
    const aud = { u0: 0, u1: 28.4, v0: D, v1: 47.86 }, ap = rectPoly(f, aud), aw = rectWalls(f, aud), eave = 10.4;
    S.prism(brick, ap, foot, y(eave), { top: k.deck }); parapet(S, brick, ap, y(eave), .7, .3, dressed);
    S.prism(granite, inset(ap, .07), foot, y(F - .2), { top: null }); course(S, dressed, ap, y(F - .12), .2, .14);
    hip(S, f, { u0: .3, u1: 28.1, v0: D + .3, v1: 47.56 }, y(eave + .1), 1.5, k.tint('seam', '#6c7274'), { overhang: 0, deck: 7, deckMaterial: k.deck });
    for (const [u0, u1] of [[0, C0], [C1, 28.4]]) S.wall(granite, f.W(u0, D - .03), f.W(u1, D - .03), y(wing), y(eave + .7), y(eave + .7), out, false);
    for (const w of [aw.left, aw.right]) {
      band(S, dressed, w, 0, w.length, y(9.3), .36, .1);
      for (const s of spread(5.5, w.length - 5.5, 6)) rectWindow(S, k, w, s, y(F + 1.6), 2, 5, { frame: sash, panes: [3, 6], sill: dressed, head: dressed });
      for (let i = 0; i <= 6; i++) { const [x, z] = w.at(5.5 + i * (w.length - 11) / 6, .13); S.block(brick, .85, .26, x, z, y(F - .2), y(9.12), w.yaw, { solid: false, top: dressed }); }
      for (const s of [2.6, w.length - 2.6]) rectWindow(S, k, w, s, y(6.2), 1.2, 1.9, { frame: sash, sill: dressed, head: dressed });
    }
    // North lobby doors under a flat canopy, and the stage doors on the car park side.
    door(S, k, aw.right, 2.9, y(.34), 1.9, 2.5, { glazed: true, leaf: sash, frame: dressed }); stairs(S, granite, aw.right, 2.9, 3.2, y(.34), 3);
    { const [x, z] = aw.right.at(2.9, .75); S.box(dressed, 3.4, .18, 1.5, x, y(3.2), z, aw.right.yaw); }
    band(S, dressed, aw.back, 0, aw.back.length, y(9.3), .36, .1);
    door(S, k, aw.back, 5, y(-.8), 1.8, 2.3, { leaf: k.tint('door', '#3c3a36'), frame: dressed }); door(S, k, aw.back, 21, y(-.8), 2.8, 3.1, { leaf: k.tint('door', '#55534e'), frame: dressed, double: false });
    for (const s of spread(4, aw.back.length - 4, 4)) rectWindow(S, k, aw.back, s, y(6.2), 1.2, 1.9, { frame: sash, sill: dressed, head: dressed });
    return S;
  },
};

// ------------------------------------------------------------------ Melrose City Hall
/** Melrose City Hall, 562 Main Street (John Stevens, 1873-74; top floor lost to the 1937 fire, remodelled 1937-39): red
 * brick with brownstone trimmings. The first floor is the Second Empire original (rusticated brick pilasters between
 * the bays, a wide corbelled belt course, segmentally arched windows with keystones); the second is the plain rebuild
 * with rectangular windows and a flat parapet. The mapped outline gives the 30.7 by 21.2 m block and a 13 m north wing. */
const cityHall: SiteModel = {
  id: 'melrose-city-hall', name: 'Melrose City Hall', place: 'melrose-city-hall', tile: '0_-12', building: 'osm-way-29612522',
  note: 'John Stevens, 1873-74, rebuilt after the 1937 fire: arched first floor, plain second floor and flat parapet from the National Register form; sources conflict on the tower, modelled as the lower rebuilt clock tower at the centre of the Main Street front (its place, height and cap are interpretive, as are the bay count, the entrance and the plain north wing)',
  build({ k, ground }, b) {
    const S = new Shapes(), base = b!.baseElevation ?? 0, foot = base - 3.4, y = (h: number) => base + h;
    // South-east corner; u north along Main Street, v west. The ground falls 2 m to the north end.
    const g = frame([764.47, -11808.16], [776.68, -11836.36], [745.43, -11817.68]), L = 30.73, D = 21.24, F = 1.1, belt = 5.9, top = 10.5, TW = 5.6, tc = L / 2;
    const brick = k.tint('brick', '#944e3e'), rustic = k.tint('brick', '#a35a48'), newBrick = k.tint('brick', '#9d5644'), flat = k.tint('trim', '#9a5343'), brown = k.tint('trim', '#86644f'), cast = k.tint('trim', '#cdc6b6'), granite = k.granite;
    const M: Point2[] = [g.W(0, 0), g.W(L, 0), g.W(L, D), g.W(1.2, D), g.W(1.2, 5.77), g.W(0, 5.77)], [east, , west, south, , corner] = wallFrames(M);
    S.prism(brick, M, foot, y(top), { top: k.deck }); parapet(S, brick, M, y(top), .7, .3, cast);
    const dress = (p: Point2[]) => { S.prism(granite, inset(p, .1), foot, y(F - .15), { top: null }); course(S, brown, p, y(F - .08), .18, .16); course(S, flat, p, y(belt), .6, .14); course(S, brown, p, y(belt + .36), .14, .2); };
    dress(M); course(S, cast, M, y(top - .2), .3, .1);
    // A bay: the arched first-floor window with its keystone, the plain rebuilt window above; rusticated pilasters between.
    const bays = (w: WallFrame, at: number[]) => { for (const s of at) { segmentalWindow(S, k, w, s, y(F + .95), 1.3, 2.45, brown); rectWindow(S, k, w, s, y(7.15), 1.3, 2.4, { sill: cast, head: cast }); } };
    const pilasters = (w: WallFrame, at: number[]) => { for (const s of at) { const [x, z] = w.at(s, .1), [cx, cz] = w.at(s, .13); for (let h = F + .1; h < belt - 1.05; h += .45) S.block(rustic, .8, .2, x, z, y(h), y(h + .35), w.yaw, { solid: false }); S.box(brown, .92, .16, .26, cx, y(belt - .68), cz, w.yaw); } };
    const corbels = (w: WallFrame, s0: number, s1: number) => { for (let s = s0 + .3; s < s1; s += .55) { const [x, z] = w.at(s, .1); S.box(flat, .24, .24, .2, x, y(belt - .42), z, w.yaw); } };
    const side = tc - TW / 2;
    bays(east, [...spread(0, side, 4), ...spread(L - side, L, 4)]); pilasters(east, [.45, side / 4, side / 2, side * 3 / 4, side - .42, L - side + .42, L - side * 3 / 4, L - side / 2, L - side / 4, L - .45]); corbels(east, 0, side); corbels(east, L - side, L);
    bays(south, spread(0, south.length, 5)); pilasters(south, [.45, ...[1, 2, 3, 4].map(i => i * south.length / 5), south.length - .45]); corbels(south, 0, south.length);
    bays(corner, [corner.length / 2]); pilasters(corner, [.45, corner.length - .45]); corbels(corner, 0, corner.length);
    bays(west, spread(0, west.length, 9)); pilasters(west, [.45, ...[1, 2, 3, 4, 5, 6, 7, 8].map(i => i * west.length / 9), west.length - .45]); corbels(west, 0, west.length);
    // The clock tower over the entrance: brick shaft, a dial on each face, a corbelled cornice and a low copper cap.
    const T = { u0: tc - TW / 2, u1: tc + TW / 2, v0: -.5, v1: TW - .5 }, tp = rectPoly(g, T), tw = rectWalls(g, T), tTop = 17.4;
    S.prism(brick, tp, foot, y(tTop), { top: k.deck }); dress(tp);
    course(S, cast, tp, y(top + .55), .3, .12); course(S, cast, tp, y(12.9), .22, .12); course(S, flat, tp, y(tTop - .62), .34, .1); course(S, cast, tp, y(tTop - .2), .4, .3);
    for (const w of [tw.front, tw.right, tw.back, tw.left]) {
      clock(S, k, w, TW / 2, y(14.9), 1.15, cast); band(S, cast, w, TW / 2 - 1.55, TW / 2 + 1.55, y(14.9), 3.1, .04);
      for (let s = .3; s < TW; s += .5) { const [x, z] = w.at(s, .1); S.box(flat, .22, .22, .2, x, y(tTop - .9), z, w.yaw); }
      for (const s of [.5, TW - .5]) { const [x, z] = w.at(s, .06); S.block(brick, .7, .12, x, z, y(top + .7), y(tTop - 1), w.yaw, { solid: false }); }
    }
    const tip = pyramid(S, k.copper, inset(tp, .28), y(tTop), y(tTop + 2.5)); S.rod(k.verdigris, tip, [tip[0], tip[1] + 1.5, tip[2]] as V3, .06, .03); S.place(k.gold, new THREE.SphereGeometry(.16, 10, 8), tip[0], tip[1] + 1.55, tip[2]);
    // Entrance in the tower's foot: an arched doorway in brownstone at the head of granite steps, paired windows above.
    door(S, k, tw.front, TW / 2, y(F), 2.1, 2.7, { leaf: k.tint('door', '#3b2a1f'), frame: brown, fan: true });
    { const [x, z] = tw.front.at(TW / 2, .07); S.place(brown, new THREE.RingGeometry(1.2, 1.5, 16, 1, 0, Math.PI), x, y(F + 2.86), z, tw.front.yaw); S.box(brown, .34, .6, .2, x, y(F + 4.4), z, tw.front.yaw); for (const side of [-1, 1]) { const [px, pz] = tw.front.at(TW / 2 + side * 1.36, .08); S.box(brown, .32, 2.86, .16, px, y(F + 1.43), pz, tw.front.yaw); } }
    for (const s of [TW / 2 - .85, TW / 2 + .85]) rectWindow(S, k, tw.front, s, y(7.15), 1.05, 2.4, { sill: cast, head: cast });
    for (const w of [tw.front, tw.right, tw.back, tw.left]) rectWindow(S, k, w, TW / 2, y(11.45), .8, 1.1, { glass: k.opening, frame: flat, panes: [1, 5], sill: cast });
    stairs(S, granite, tw.front, TW / 2, 4.4, y(F), 10, { rise: .165, tread: .3, cheeks: granite });
    // The north wing: plainer brick, rectangular windows, its basement out of the ground and a door on City Hall Plaza.
    const A = { u0: L, u1: 44.05, v0: 1.04, v1: D }, ap = rectPoly(g, A), aw = rectWalls(g, A), B = { u0: 44.05, u1: 46.2, v0: 7.06, v1: 16.1 }, bp = rectPoly(g, B), bw = rectWalls(g, B), aTop = 9.9;
    const plain = (w: WallFrame, at: number[], cellar = true) => { for (const s of at) { rectWindow(S, k, w, s, y(F + .95), 1.3, 2.6, { panes: [2, 3], sill: cast, head: cast }); rectWindow(S, k, w, s, y(6.95), 1.3, 2.2, { sill: cast, head: cast }); if (cellar) rectWindow(S, k, w, s, y(-1.3), 1.2, .8, { panes: [2, 1], sill: cast }); } };
    for (const p of [ap, bp]) { S.prism(newBrick, p, foot, y(aTop), { top: k.deck }); parapet(S, newBrick, p, y(aTop), .6, .3, cast); S.prism(granite, inset(p, .1), foot, y(F - .15), { top: null }); course(S, cast, p, y(F - .08), .18, .14); course(S, cast, p, y(belt + .1), .24, .08); }
    plain(aw.front, spread(0, aw.front.length, 4)); plain(aw.back, spread(0, aw.back.length, 4)); plain(aw.right, [3, aw.right.length - 2.6]); plain(bw.front, [bw.front.length / 2], false); plain(bw.back, [bw.back.length / 2], false);
    door(S, k, bw.right, bw.right.length / 2, y(-2.05), 1.8, 2.3, { glazed: true, leaf: k.sash, frame: cast }); rectWindow(S, k, bw.right, bw.right.length / 2, y(F + .95), 1.6, 2.6, { panes: [2, 3], sill: cast, head: cast }); rectWindow(S, k, bw.right, bw.right.length / 2, y(6.95), 1.6, 2.2, { sill: cast, head: cast });
    // The bronze planting urn of 1885 on its granite block, on the lawn before the south half of the front.
    { const [x, z] = g.W(tc - 8.5, -7.5), gy = ground(x, z); S.block(granite, 1.1, 1.1, x, z, gy - .6, gy + .9, g.yaw);
      lathe(S, k.bronze, [[.34, 0], [.38, .07], [.2, .16], [.14, .36], [.3, .52], [.5, .74], [.58, .98], [.52, 1.03], [.62, 1.1], [.56, 1.14], [.45, 1.1]], x, gy + .9, z, 16); dome(S, k.tint('grass', '#4c6a3a'), x, gy + 1.98, z, .5, .32, 12); }
    return S;
  },
};

// ------------------------------------------------------------------ Everett City Hall
/** Everett City Hall, 484 Broadway (Harold Michael Turiello, 1960-62): a Mid-Century Modern block with a curtain wall,
 * its spandrel panels white now (bright blue when built). The mapped outline is a 56.6 by 24.7 m rectangle along
 * Broadway; the ground falls 4.3 m toward Church Street, so three storeys stand on Broadway at the uphill end and the
 * lower level comes out of the ground at the Church Street end, where its accessible entrance is. */
const everettCityHall: SiteModel = {
  id: 'everett-city-hall', name: 'Everett City Hall', place: 'everett-square', tile: '1_-7', building: 'osm-way-29568701',
  note: 'Harold Michael Turiello, 1960-62: curtain-wall block with white spandrel panels (once bright blue), main entrance on Broadway, lower-level entrance toward Church Street and the corner flagpole from the sources; the module, the buff brick end walls, the canopy, the place of the doors and the EVERETT CITY HALL lettering are interpretive',
  build({ k, ground }, b) {
    const S = new Shapes(), base = b!.baseElevation ?? 0, foot = base - 6.2, y = (h: number) => base + h;
    // South corner (the Church Street end); u north-east up Broadway, v north-west to the car park. Level 1 is at the base height.
    const f = frame([1618.01, -6447.41], [1650.45, -6493.74], [1597.81, -6461.57]), L = 56.56, D = 24.65, FL = 3.7, H = 3 * FL, END = 2.6;
    const brick = k.tint('buffBrick', '#c2b196'), panel = k.tint('trim', '#e6e5df'), mull = k.tint('trim', '#b4b9bc'), blind = k.tint('trim', '#cdc5ae'), plinth = k.tint('concrete', '#a8a49a'), lower = { frame: mull, panes: [2, 1] as [number, number], sill: panel };
    const bp = rectPoly(f, { u0: 0, u1: L, v0: 0, v1: D }), w = rectWalls(f, { u0: 0, u1: L, v0: 0, v1: D });
    S.prism(brick, bp, foot, y(H + .05), { top: k.gravel }); parapet(S, brick, bp, y(H + .05), .45, .3, panel);
    S.prism(plinth, inset(bp, .12), foot, y(-.4), { top: null }); course(S, panel, bp, y(-.36), .12, .16);
    // The Broadway front: three storeys of curtain wall between the brick ends, two sets of double doors under a flat canopy.
    const bay = curtainWall(S, k, w.front, END, L - END, y(0), 3, FL, panel, mull, blind, [25, 28]), doors = [25.5, 27.5].map(i => END + i * bay), mid = END + 26.5 * bay;
    for (const s of doors) door(S, k, w.front, s, y(0), 1.34, 2.3, { glazed: true, leaf: mull, frame: mull });
    { const [x, z] = w.front.at(mid, 1.15), [ex, ez] = w.front.at(mid, 1.17);
      S.box(panel, 6.8, .3, 2.3, x, y(2.82), z, w.front.yaw); S.box(mull, 6.9, .06, 2.4, ex, y(3), ez, w.front.yaw);
      signBoard(S, k, w.front, mid, y(FL + .2), 5.8, .72, 'EVERETT CITY HALL', { color: '#262a2d', background: '#e6e5df', out: .23 }); }
    stairs(S, plinth, w.front, mid, 7.2, y(0), 7, { rise: .17, tread: .3, landing: .3 });
    for (const s of [mid - 2.6, mid + 2.6]) { const a = w.front.at(s, .3), c = w.front.at(s, 2.3); railing(S, mull, [[a[0], y(0), a[1]], [c[0], y(-1.19), c[1]]], .9, { spacing: 1.1, post: .05 }); }
    // The car park side: the same wall, a door to level 1 near the uphill end.
    const rear = curtainWall(S, k, w.back, END, L - END, y(0), 3, FL, panel, mull, blind, [4, 5]);
    door(S, k, w.back, END + 4.5 * rear, y(0), 1.34, 2.3, { glazed: true, leaf: mull, frame: mull }); { const [x, z] = w.back.at(END + 4.5 * rear, .8); S.box(panel, 3, .2, 1.6, x, y(2.75), z, w.back.yaw); }
    // Lower-level windows in the base where the ground has fallen away.
    for (const u of [4.2, 7.8, 11.4, 15]) { rectWindow(S, k, w.front, u, y(-2.75), 2.3, 1.5, lower); rectWindow(S, k, w.back, L - u, y(-2.75), 2.3, 1.5, lower); }
    // Brick end walls with a glazed stair strip; the lower-level entrance under a canopy at the Church Street end.
    for (const e of [w.left, w.right]) curtainWall(S, k, e, D / 2 - 2.9, D / 2 + 2.9, y(0), 3, FL, panel, mull, blind);
    door(S, k, w.left, D / 2, y(-FL + .05), 1.9, 2.3, { glazed: true, leaf: mull, frame: mull }); stairs(S, plinth, w.left, D / 2, 4.2, y(-FL + .05), 3, { rise: .15, tread: .32 });
    { const [x, z] = w.left.at(D / 2, .95); S.box(panel, 4.6, .2, 1.9, x, y(-1.02), z, w.left.yaw); }
    for (const s of [D / 2 - 9, D / 2 - 5, D / 2 + 5, D / 2 + 9]) rectWindow(S, k, w.left, s, y(-2.75), 2.3, 1.5, lower);
    // Roof: the lift and plant penthouse and three ventilators.
    { const [x, z] = f.W(34, 13); S.block(brick, 10, 7, x, z, y(H + .05), y(H + 2.9), f.yaw, { top: k.gravel }); for (const u of [14, 20, 46]) { const [vx, vz] = f.W(u, 12); S.box(mull, 2.2, 1.1, 1.6, vx, y(H + .6), vz, f.yaw); } }
    // The corner toward Church Street: the flagpole and the low walls of the sitting area (2012-13).
    { const [x, z] = f.W(-5.5, 2.6); flagpole(S, k, x, ground(x, z), z, 11);
      for (const [u, v, wu, wv] of [[-7.6, 8, .45, 6.4], [-4.9, 4.6, 5.8, .45]]) { const [sx, sz] = f.W(u, v), gy = ground(sx, sz); S.block(plinth, wu, wv, sx, sz, gy - .9, gy + .45, f.yaw); } }
    return S;
  },
};

export const SITES: SiteModel[] = [memorialHall, cityHall, everettCityHall];
