import * as THREE from 'three';
import { archWindow, band, door, frame, gable, inset, oculus, pyramid, railing, rectPoly, rectWalls, Shapes, slope, stairs, wallFrames, type Rect, type SiteModel, type V3, type WallFrame } from '../site-kit.ts';

/** A wall panel from s0 to s1 of a wall, y0 to y1 and t thick, pierced by round-arched openings ([centre s, width, sill y,
 * spring y]; a sill at y0 opens to the floor): both faces, the reveals, and solid piers and parapets when `solid`. */
function arcade(S: Shapes, m: THREE.Material, f: WallFrame, s0: number, s1: number, y0: number, y1: number, t: number, openings: [number, number, number, number][], solid = true) {
  const mid = (s0 + s1) / 2, list = [...openings].sort((a, b) => a[0] - b[0]);
  for (const face of [1, -1]) {
    const shape = new THREE.Shape(), order = face > 0 ? list : [...list].reverse(); shape.moveTo(s0 - mid, y0);
    for (const [s, w, sill, spring] of order) {
      const c = (s - mid) * face, r = w / 2;
      if (sill <= y0 + 1e-3) { shape.lineTo(c - r, y0); shape.lineTo(c - r, spring); shape.absarc(c, spring, r, Math.PI, 0, true); shape.lineTo(c + r, y0); }
      else { const hole = new THREE.Path(); hole.moveTo(c - r, sill); hole.lineTo(c + r, sill); hole.lineTo(c + r, spring); hole.absarc(c, spring, r, 0, Math.PI, false); hole.lineTo(c - r, sill); shape.holes.push(hole); }
    }
    shape.lineTo(s1 - mid, y0); shape.lineTo(s1 - mid, y1); shape.lineTo(s0 - mid, y1); shape.lineTo(s0 - mid, y0);
    const g = new THREE.ShapeGeometry(shape, 8), uv = g.getAttribute('uv'); for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2);
    const [x, z] = f.at(mid, face > 0 ? 0 : -t); S.place(m, g, x, 0, z, f.yaw + (face > 0 ? 0 : Math.PI));
  }
  let from = s0;
  for (const [s, w, sill, spring] of list) {
    const r = w / 2, line: [number, number][] = [[s - r, sill], [s - r, spring], ...Array.from({ length: 9 }, (_, i) => [s - Math.cos((i + 1) / 10 * Math.PI) * r, spring + Math.sin((i + 1) / 10 * Math.PI) * r] as [number, number]), [s + r, spring], [s + r, sill]];
    if (sill > y0 + 1e-3) line.push([s - r, sill]);
    for (let i = 0; i + 1 < line.length; i++) {
      const [a, ya] = line[i], [c, yc] = line[i + 1], P = (q: number, h: number, out: number): V3 => { const [x, z] = f.at(q, out); return [x, h, z]; }, du = s - (a + c) / 2, dy = (sill + spring + r) / 2 - (ya + yc) / 2;
      S.poly(m, [P(a, ya, 0), P(c, yc, 0), P(c, yc, -t), P(a, ya, -t)], [f.t[0] * du, dy, f.t[1] * du]);
    }
    if (solid) { const [x, z] = f.at((from + s - r) / 2, -t / 2); S.solidBox(s - r - from, t, x, z, y0, y1, f.yaw); if (sill > y0 + 1e-3) { const [px, pz] = f.at(s, -t / 2); S.solidBox(w, t, px, pz, y0, sill, f.yaw); } }
    from = s + r;
  }
  if (solid) { const [x, z] = f.at((from + s1) / 2, -t / 2); S.solidBox(s1 - from, t, x, z, y0, y1, f.yaw); }
}

/** Goddard Chapel, Tufts University (J. Philip Rinn, 1882-83): Lombardic Romanesque in dark blue-grey Somerville slate
 * rubble under a red slate roof. The mapped outline gives the rectangle the chapel stands in (17.8 by 26 m, the nave
 * running north-north-east) and the one finished transept on its east flank. From the written accounts: the entrance
 * at the south end, the chancel at the north, the hundred-foot bell tower on the west flank and, opposite it, the
 * triple-arched cloister that joins the transept to the entrance, its roof rising to a point. The nave's width inside
 * that rectangle, the tower's place at the entrance corner, its stages and belfry, the stub of the unbuilt west
 * transept and the window rhythm are interpretive. */
const goddard: SiteModel = {
  id: 'goddard-chapel', name: 'Goddard Chapel', place: 'tufts-university', tile: '-4_-7', building: 'osm-way-29796935',
  note: 'J. Philip Rinn, 1882-83, Lombardic Romanesque: slate rubble, red slate roof, entrance south, 30.5 m tower west, cloister and transept east on the mapped outline; nave width, tower corner, belfry and windows interpretive',
  build({ k, ground }, b) {
    const S = new Shapes(), base = b!.baseElevation ?? 0, foot = base - 2.8, y = (h: number) => base + h;
    // West corner of the mapped rectangle: u east-south-east along the entrance end (17.8 m), v north-north-east along the nave (26 m).
    const f = frame([-3720.36, -6305.92], [-3704.68, -6297.54], [-3708.01, -6328.84]);
    const stone = k.tint('rubble', '#7a7d82'), dress = k.tint('castStone', '#a8a092'), roof = k.redSlate, lights = { glass: k.stained, frame: k.sash, head: dress, sill: dress }, slit = { glass: k.opening, frame: k.sash, head: dress, sill: dress, panes: [1, 1] as [number, number] };
    const steps = (top: number, u: number, v: number) => Math.max(3, Math.min(14, Math.ceil((top - ground(...f.W(u, v))) / .17)));
    // The nave: 12 m wide inside the mapped rectangle, a steep gable over it.
    const N: Rect = { u0: 3, u1: 15, v0: 1, v1: 26 }, eave = 7.6, rise = 7.6, nw = rectWalls(f, N);
    S.prism(stone, rectPoly(f, N), foot, y(eave), { top: null }); gable(S, f, N, y(eave), rise, roof, { axis: 'v', wall: stone, overhang: .3, trim: dress });
    for (const w of [nw.front, nw.back]) {
      // Each gable end: the great memorial window between two narrow lights, a round window in the peak, a stepped corbel table under the rakes.
      const south = w === nw.front;
      archWindow(S, k, w, 6, y(south ? 4.9 : 3.2), 3, south ? 3.2 : 4.4, { ...lights, panes: [3, 3] });
      for (const s of [2.9, 9.1]) archWindow(S, k, w, s, y(south ? 5.1 : 3.6), .9, 2.4, { ...lights, panes: [1, 2] });
      oculus(S, k, w, 6, y(eave + 4.4), .75, { glass: k.stained, frame: dress }); band(S, dress, w, 0, 12, y(.25), .28, .14);
      for (const side of [-1, 1]) for (let i = 0; i < 10; i++) { const d = .45 + i * .56, [x, z] = w.at(6 + side * (6 - d), .1); S.box(dress, .3, .32, .2, x, y(eave + rise * d / 6 - .55), z, w.yaw); }
    }
    door(S, k, nw.front, 6, y(0), 2.2, 3, { leaf: k.tint('door', '#4a2a1c'), frame: dress, fan: true });
    // Flanks: round-arched windows between buttresses; s runs from the north end on the west wall, from the south end on the east.
    for (const s of [18.5, 15.8, 2.15]) archWindow(S, k, nw.left, s, y(2.6), 1.3, 2.9, lights);
    for (const s of [17.15, .45]) { const [x, z] = nw.left.at(s, .3); S.block(stone, .8, .6, x, z, foot, y(5.4), nw.left.yaw, { top: dress }); }
    band(S, dress, nw.left, 0, 4.3, y(eave - .2), .26, .18); band(S, dress, nw.left, 13.7, 20.6, y(eave - .2), .26, .18); band(S, dress, nw.left, 0, 4.3, y(.25), .28, .14); band(S, dress, nw.left, 13.7, 20.6, y(.25), .28, .14);
    archWindow(S, k, nw.right, 22.85, y(2.6), 1.3, 2.9, lights); band(S, dress, nw.right, 20.7, 25, y(eave - .2), .26, .18); band(S, dress, nw.right, 20.7, 25, y(.25), .28, .14);
    { const [x, z] = nw.right.at(24.55, .3); S.block(stone, .8, .6, x, z, foot, y(5.4), nw.right.yaw, { top: dress }); }
    // The east transept on its mapped outline, and the stub of the one never carried out on the west.
    const E: Rect = { u0: 15, u1: 26.2, v0: 12.3, v1: 21.7 }, ew = rectWalls(f, E), trEave = 6.6, trRise = 5;
    S.prism(stone, rectPoly(f, E), foot, y(trEave), { top: null }); gable(S, f, { ...E, u0: 10 }, y(trEave), trRise, roof, { axis: 'u', wall: stone, overhang: .3, trim: dress });
    archWindow(S, k, ew.right, 4.7, y(2.4), 1.5, 2.9, lights); for (const s of [2.3, 7.1]) archWindow(S, k, ew.right, s, y(2.6), 1.1, 2.3, lights);
    oculus(S, k, ew.right, 4.7, y(trEave + 2.3), .7, { glass: k.stained, frame: dress }); band(S, dress, ew.right, 0, 9.4, y(.25), .28, .14);
    for (const side of [-1, 1]) for (let i = 0; i < 8; i++) { const d = .45 + i * .56, [x, z] = ew.right.at(4.7 + side * (4.7 - d), .1); S.box(dress, .3, .32, .2, x, y(trEave + trRise * d / 4.7 - .55), z, ew.right.yaw); }
    archWindow(S, k, ew.front, 7.1, y(2.6), 1.2, 2.5, lights); archWindow(S, k, ew.back, 5.6, y(2.6), 1.2, 2.5, lights);
    const Wt: Rect = { u0: 0, u1: 3, v0: 12.3, v1: 21.7 }, ww = rectWalls(f, Wt);
    S.prism(stone, rectPoly(f, Wt), foot, y(trEave), { top: null }); gable(S, f, { ...Wt, u1: 8 }, y(trEave), trRise, roof, { axis: 'u', wall: stone, overhang: .3, trim: dress });
    for (const s of [3.5, 5.9]) archWindow(S, k, ww.left, s, y(2.6), 1.1, 2.5, lights); oculus(S, k, ww.left, 4.7, y(trEave + 2.3), .7, { glass: k.stained, frame: dress }); band(S, dress, ww.left, 0, 9.4, y(.25), .28, .14);
    // The cloister on the east flank, from the transept to the entrance end: three arches on a parapet (the middle one opening
    // on the steps down to the library plaza), a lean-to roof, and a pointed roof over the bay at the entrance.
    const C: Rect = { u0: 15, u1: 18, v0: 1, v1: 12.3 }, cw = rectWalls(f, C), bay = (C.v1 - C.v0) / 3, ch = 3.9;
    S.prism(stone, rectPoly(f, C), foot, y(0), { top: k.paving });
    arcade(S, stone, cw.right, 0, C.v1 - C.v0, y(0), y(ch), .5, [0, 1, 2].map(i => [bay * (i + .5), 2.5, y(i === 1 ? 0 : .9), y(2.2)] as [number, number, number, number]));
    arcade(S, stone, cw.front, 0, 3, y(0), y(ch), .5, [[1.5, 1.9, y(0), y(2.2)]]);
    for (const w of [cw.right, cw.front]) { band(S, dress, w, 0, w.length, y(ch - .12), .24, .16); band(S, dress, w, 0, w.length, y(.05), .24, .12); }
    for (const i of [0, 2]) { const [x, z] = cw.right.at(bay * (i + .5), -.25); S.box(dress, 2.7, .12, .66, x, y(.96), z, cw.right.yaw); }
    slope(S, roof, rectPoly(f, { u0: 15, u1: 18.3, v0: C.v0 + bay, v1: C.v1 }), p => y(5.4) - (f.uOf(p) - 15) * (5.4 - ch) / 3.3, f.V, [f.U[0], 1.5, f.U[1]]);
    pyramid(S, roof, rectPoly(f, { u0: 14.95, u1: 18.3, v0: C.v0 - .3, v1: C.v0 + bay }), y(ch), y(8.3), undefined, { trim: dress });
    door(S, k, nw.right, 2, y(0), 1.5, 2.5, { leaf: k.tint('door', '#4a2a1c'), frame: dress }); door(S, k, ew.front, 1.5, y(0), 1.4, 2.4, { leaf: k.tint('door', '#4a2a1c'), frame: dress });
    stairs(S, k.granite, cw.right, bay * 1.5, 2.6, y(0), steps(y(0), 21.4, C.v0 + bay * 1.5), { cheeks: stone });
    // The terrace before the entrance, between the tower and the cloister, and its steps down to the President's Lawn.
    const Tr: Rect = { u0: 5.6, u1: 18, v0: -1.6, v1: 1 }, tw = rectWalls(f, Tr), P = (u: number, v: number): V3 => { const [x, z] = f.W(u, v); return [x, y(0), z]; };
    S.prism(k.granite, rectPoly(f, Tr), foot, y(0), { top: k.paving });
    stairs(S, k.granite, tw.front, 3.4, 5, y(0), steps(y(0), 9, -5), { cheeks: k.granite });
    railing(S, k.iron, [P(11.9, -1.5), P(17.9, -1.5), P(17.9, .9)], 1, { spacing: 1.5, pickets: .16 });
    // The bell tower at the entrance corner of the west flank: a plain square shaft in three stages, the open belfry of
    // paired arches, a corbelled cornice and a red slate pyramid with the beacon of 2002 at its point (30.5 m).
    const T = 5.8, TR: Rect = { u0: -.2, u1: 5.6, v0: -.4, v1: 5.4 }, tp = rectPoly(f, TR), tf = wallFrames(tp), bel = 19.6, top = 25, [tx, tz] = f.W(TR.u0 + T / 2, TR.v0 + T / 2);
    S.prism(stone, tp, foot, y(bel), { top: k.deck });
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { const [x, z] = f.W(TR.u0 + .33 + u * (T - .66), TR.v0 + .33 + v * (T - .66)); S.block(stone, .9, .9, x, z, foot, y(top), f.yaw); }
    tf.forEach((w, i) => {
      for (const h of [6.5, 13, bel]) band(S, dress, w, -.1, T + .1, y(h), .3, .16);
      if (i === 0 || i === 3) { archWindow(S, k, w, T / 2, y(2.4), .6, 2, slit); archWindow(S, k, w, T / 2, y(8.6), .55, 2.2, slit); }
      for (const s of [T / 2 - .75, T / 2 + .75]) archWindow(S, k, w, s, y(15), .55, 2.4, slit);
      arcade(S, stone, w, 0, T, y(bel), y(top), .6, [[1.75, 1.5, y(bel + .9), y(bel + 3.3)], [4.05, 1.5, y(bel + .9), y(bel + 3.3)]], false);
      for (const s of [1.75, 4.05]) { const [x, z] = w.at(s, -.3); S.box(k.iron, 1.5, .05, .05, x, y(bel + 1.5), z, w.yaw); }
      band(S, dress, w, -.2, T + .2, y(top - .16), .32, .3); for (let s = .25; s < T; s += .59) { const [x, z] = w.at(s, .12); S.box(dress, .26, .34, .22, x, y(top - .5), z, w.yaw); }
    });
    S.solidBox(T, T, tx, tz, y(bel), y(top), f.yaw); S.cap(k.deck, tp, y(top) - .02);
    S.place(k.bronze, new THREE.CylinderGeometry(.38, .82, 1.2, 14, 1, true), tx, y(bel + 2.3), tz); S.box(k.timber, 4.6, .22, .22, tx, y(bel + 3.05), tz, f.yaw);
    const apex = pyramid(S, roof, inset(tp, .3), y(top), y(30), undefined, { trim: dress });
    S.rod(k.iron, apex, [apex[0], apex[1] + .4, apex[2]], .07, .05); S.place(k.lamp, new THREE.SphereGeometry(.2, 10, 8), apex[0], apex[1] + .5, apex[2]);
    return S;
  },
};
export const SITES: SiteModel[] = [goddard];
