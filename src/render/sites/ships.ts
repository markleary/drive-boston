import * as THREE from 'three';
import type { Point2 } from '../../types';
import { railing, Shapes, type SiteContext, type SiteModel, type V3 } from '../site-kit.ts';

/** USS Constitution at Pier 1 of the Charlestown Navy Yard, moored starboard side to with her bow toward the yard.
 * Hull 62 m from billet head to taffrail on a 53.3 m waterline, 13.3 m in beam (the published 204 ft, 175 ft and
 * 43 ft 6 in); black topsides with the white gun-deck stripe and its fifteen ports a side, copper at the waterline,
 * three masts (the main truck 172 ft over the spar deck by the Navy's figure, the fore and mizzen about 47 and 41 m in
 * proportion to their published lengths)
 * with their tops, yards and furled sails, bowsprit and jib-booms, shrouds with ratlines, stays and backstays.
 * The hull is lofted from a waterline and a deck plan between which the sections tumble home; its lines, the
 * rigging plan and the deck furniture are drawn from the ship's published dimensions and are interpretive in detail. */
const PIER_EDGE: [Point2, Point2] = [[1485, -2500], [1625, -2420]], BERTH: Point2 = [1540.3, -2457.7];
let ensign: THREE.MeshStandardMaterial | undefined;
/** The national ensign, both sides drawn (the fly reads mirrored from behind, as cloth does). */
function ensignMaterial() {
  if (ensign) return ensign;
  ensign = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .9, side: THREE.DoubleSide }); ensign.name = 'site ensign';
  if (typeof document === 'undefined') { ensign.color.set('#8a2a32'); return ensign; }
  const c = document.createElement('canvas'); c.width = 380; c.height = 200; const x = c.getContext('2d')!;
  for (let i = 0; i < 13; i++) { x.fillStyle = i % 2 ? '#f4f1ea' : '#a52231'; x.fillRect(0, i * 200 / 13, 380, 200 / 13 + 1); }
  x.fillStyle = '#27335c'; x.fillRect(0, 0, 152, 200 * 7 / 13); x.fillStyle = '#f4f1ea';
  for (let r = 0; r < 9; r++) for (let s = 0; s < (r % 2 ? 5 : 6); s++) { x.beginPath(); x.arc(13 + s * 25.2 + (r % 2 ? 12.6 : 0), 11 + r * 10.7, 3.4, 0, Math.PI * 2); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; ensign.map = t; return ensign;
}
const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function constitutionShapes(ctx: SiteContext) {
  const { k } = ctx, S = new Shapes(), [cx, cz] = BERTH, el = Math.hypot(PIER_EDGE[1][0] - PIER_EDGE[0][0], PIER_EDGE[1][1] - PIER_EDGE[0][1]);
  // Forward is along the pier toward the yard; starboard, the side at the pier, is to the right of it.
  const F: Point2 = [(PIER_EDGE[0][0] - PIER_EDGE[1][0]) / el, (PIER_EDGE[0][1] - PIER_EDGE[1][1]) / el], R: Point2 = [-F[1], F[0]], heading = Math.atan2(F[0], F[1]), boxYaw = heading - Math.PI / 2;
  const wl = ctx.water(cx, cz) ?? ctx.ground(cx, cz), P = (l: number, h: number, side: number): V3 => [cx + F[0] * l + R[0] * side, wl + h, cz + F[1] * l + R[1] * side];
  const black = k.tint('planks', '#1d1c1a'), white = k.tint('planks', '#e6e2d6'), copper = k.tint('planks', '#6c7462'), deckWood = k.paleDeck, green = k.tint('planks', '#3b5a45'), spar = k.tint('timber', '#2a2622'), mastWhite = k.whitePaint, rope = k.rope, buff = k.tint('timber', '#b08a55');
  // ---- hull: stations from the taffrail (t = 0) to the stem (t = 1), six levels from below the water to the rail.
  const HALF = 6.63, N = 30, LEVELS = [-1.3, .3, 2.25, 3.75, 5.4, 6.9], FRACTION = [0, .05, .36, .6, .86, 1], TUMBLE = [.93, 1, 1.02, .99, .93, .9];
  const deckPlan = (t: number) => (t < .22 ? lerp(.7, 1, smooth(t / .22)) : t > .78 ? Math.sqrt(Math.max(0, 1 - ((t - .78) / .22) ** 2.4)) : 1), waterPlan = (t: number) => (t < .4 ? lerp(.05, 1, smooth(t / .4)) : t > .7 ? Math.max(0, 1 - ((t - .7) / .3) ** 2) ** .8 : 1);
  const sheer = (t: number) => 1.25 * (2 * t - 1) ** 2 * (t > .5 ? 1.25 : .85);
  /** Hull surface: length along the ship, height over the water and half-breadth at station t and level fraction f (0 waterline, 1 rail). */
  const section = (t: number, level: number) => { const f = FRACTION[level]; return { l: -26.75 - 2 * f + t * (53.5 + 5.6 * f), h: LEVELS[level] + sheer(t) * f, half: Math.max(.14, HALF * lerp(waterPlan(t), deckPlan(t), f) * TUMBLE[level]) }; };
  const hullAt = (t: number, h: number) => { // interpolated between levels at a height over the water (without sheer)
    let i = 1; while (i < LEVELS.length - 1 && LEVELS[i] < h) i++; const a = section(t, i - 1), b = section(t, i), u = (h - LEVELS[i - 1]) / (LEVELS[i] - LEVELS[i - 1]);
    return { l: lerp(a.l, b.l, u), h: lerp(a.h, b.h, u), half: lerp(a.half, b.half, u) };
  };
  const bands = [copper, black, white, black, black];
  for (let i = 0; i < N; i++) for (let level = 0; level + 1 < LEVELS.length; level++) for (const side of [-1, 1]) {
    const a = section(i / N, level), b = section((i + 1) / N, level), c = section((i + 1) / N, level + 1), d = section(i / N, level + 1);
    S.poly(bands[level], [P(a.l, a.h, a.half * side), P(b.l, b.h, b.half * side), P(c.l, c.h, c.half * side), P(d.l, d.h, d.half * side)], [R[0] * side, .1, R[1] * side], p => [((p[0] - cx) * F[0] + (p[2] - cz) * F[1]) / 2, p[1] / 2]);
  }
  // The stern: a flat transom with its row of cabin windows, the name board and white mouldings.
  { const ring: V3[] = []; for (let level = 1; level < LEVELS.length; level++) { const s = section(0, level); ring.push(P(s.l, s.h, s.half)); } for (let level = LEVELS.length - 1; level >= 1; level--) { const s = section(0, level); ring.push(P(s.l, s.h, -s.half)); }
    S.poly(black, ring, [-F[0], 0, -F[1]]);
    const at = (h: number, side: number, out = .06): V3 => { const s = hullAt(0, h); return P(s.l - out, s.h, side); };
    for (let i = -2; i <= 2; i++) { const p = at(4.55, i * 1.55, .05); S.place(k.glass, new THREE.PlaneGeometry(1.1, 1.05), p[0], p[1], p[2], heading + Math.PI); S.box(k.whitePaint, 1.24, .08, .06, ...at(5.12, i * 1.55), boxYaw + Math.PI / 2); S.box(k.whitePaint, 1.24, .08, .06, ...at(3.98, i * 1.55), boxYaw + Math.PI / 2); S.box(k.whitePaint, .05, 1.05, .06, ...at(4.55, i * 1.55), boxYaw + Math.PI / 2); }
    for (const h of [3.55, 5.6]) S.box(k.whitePaint, 9.2, .1, .08, ...at(h, 0), boxYaw + Math.PI / 2);
    const n = at(2.85, 0, .07); S.place(k.sign('CONSTITUTION', { color: '#e9dfbd', background: '#1d1c1a', aspect: 7.5, font: '700 96px Georgia, serif' }), new THREE.PlaneGeometry(6, .8), n[0], n[1], n[2], heading + Math.PI);
    const r = at(1.2, 0, .3); S.box(black, .5, 5.2, 1.1, r[0], r[1] - .6, r[2], boxYaw + Math.PI / 2); // the rudder head
  }
  // The stem, cutwater and head: the knee of the head carried forward to the billet, trail boards and head rails.
  { const top = section(1, 5), low = section(1, 1); S.beam(black, P(low.l, -1.2, 0), P(top.l + .15, top.h + .5, 0), .5, .7);
    const billet = P(top.l + 4.6, top.h - .55, 0), knee = P(low.l + .6, 2.4, 0), root = P(top.l, top.h - .3, 0);
    for (const side of [-1, 1]) S.poly(side > 0 ? white : white, [P(low.l + .4, 2.6, side * .16), P(top.l + 4.4, top.h - 1.05, side * .1), P(top.l + 4.5, top.h - .5, side * .1), P(top.l + .2, top.h - .7, side * .2)], [R[0] * side, 0, R[1] * side]);
    S.beam(black, knee, billet, .28, .3); S.beam(black, root, billet, .26, .22);
    for (const side of [-1, 1]) { const from = section(.955, 4); S.beam(black, P(from.l, from.h + .2, from.half * side), P(top.l + 4.1, top.h - .65, side * .22), .12, .16); S.beam(white, P(from.l, from.h - .9, from.half * side), P(top.l + 3.6, top.h - 1.15, side * .2), .1, .14); }
    S.place(k.gold, new THREE.TorusGeometry(.34, .1, 6, 14), billet[0], billet[1] + .1, billet[2], heading + Math.PI / 2);
  }
  // Gun ports: fifteen a side in the white stripe, lids triced open over the muzzles, and the carronade ports of the spar deck above.
  const outwardYaw = (t: number, h: number, side: number) => { const a = hullAt(t - .01, h), b = hullAt(t + .01, h), dl = b.l - a.l, dh = (b.half - a.half) * side, nx = -dh, nz = dl * side; return { n: [(F[0] * nx + R[0] * nz), (F[1] * nx + R[1] * nz)] as Point2 }; };
  for (const side of [-1, 1]) for (let i = 0; i < 15; i++) {
    const t = .135 + i * .051, s = hullAt(t, 3), { n } = outwardYaw(t, 3, side), nl = Math.hypot(...n), nx = n[0] / nl, nz = n[1] / nl, yaw = Math.atan2(nx, nz), p = P(s.l, s.h, s.half * side);
    S.box(k.opening, .95, .82, .1, p[0] + nx * .03, p[1], p[2] + nz * .03, yaw); S.box(k.redPaint, .95, .06, .7, p[0] + nx * .38, p[1] + .46, p[2] + nz * .38, yaw);
    S.rod(k.iron, [p[0] - nx * .3, p[1] - .05, p[2] - nz * .3], [p[0] + nx * .75, p[1] - .05, p[2] + nz * .75], .13, .1, 8);
  }
  for (const side of [-1, 1]) for (let i = 0; i < 10; i++) { if (i === 4 || i === 5) continue; const t = .16 + i * .074, s = hullAt(t, 5.95), { n } = outwardYaw(t, 5.95, side), nl = Math.hypot(...n), nx = n[0] / nl, nz = n[1] / nl, p = P(s.l, s.h + sheer(t) * .0, s.half * side); S.box(k.opening, .9, .62, .1, p[0] + nx * .03, p[1], p[2] + nz * .03, Math.atan2(nx, nz)); }
  // ---- spar deck, bulwarks inboard, rail and hammock nettings.
  const deckH = (t: number) => section(t, 5).h - 1.75, deckHalf = (t: number) => Math.max(.1, section(t, 5).half - .32), deckL = (t: number) => section(t, 5).l;
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    S.poly(deckWood, [P(deckL(t0), deckH(t0), -deckHalf(t0)), P(deckL(t1), deckH(t1), -deckHalf(t1)), P(deckL(t1), deckH(t1), deckHalf(t1)), P(deckL(t0), deckH(t0), deckHalf(t0))], [0, 1, 0], p => [((p[0] - cx) * R[0] + (p[2] - cz) * R[1]) / 2, ((p[0] - cx) * F[0] + (p[2] - cz) * F[1]) / 2]);
    for (const side of [-1, 1]) {
      const a = section(t0, 5), b = section(t1, 5);
      S.poly(green, [P(deckL(t0), deckH(t0), deckHalf(t0) * side), P(deckL(t1), deckH(t1), deckHalf(t1) * side), P(b.l, b.h, (b.half - .3) * side), P(a.l, a.h, (a.half - .3) * side)], [-R[0] * side, 0, -R[1] * side]);
      S.beam(black, P(a.l, a.h + .05, (a.half - .15) * side), P(b.l, b.h + .05, (b.half - .15) * side), .42, .12);
      if (t0 > .14 && t1 < .9) S.beam(white, P(a.l, a.h + .32, (a.half - .15) * side), P(b.l, b.h + .32, (b.half - .15) * side), .34, .42);
    }
  }
  const onDeck = (t: number, side = 0, up = 0): V3 => P(deckL(t), deckH(t) + up, side);
  // Hatches with their gratings, the capstan, the double wheel, the galley stack, skylight and the boats on their skids.
  for (const t of [.36, .47, .62, .71]) { const p = onDeck(t, 0, .2); S.box(spar, 2.6, .4, 2.2, p[0], p[1], p[2], boxYaw); S.box(buff, 2.3, .06, 1.9, p[0], p[1] + .22, p[2], boxYaw); }
  { const p = onDeck(.3, 0); S.place(buff, new THREE.CylinderGeometry(.5, .75, 1.1, 12), p[0], p[1] + .55, p[2]); S.place(spar, new THREE.CylinderGeometry(.85, .85, .16, 12), p[0], p[1] + 1.15, p[2]); }
  { const p = onDeck(.2, 0, 1); for (const d of [-.35, .35]) S.place(buff, new THREE.TorusGeometry(.8, .05, 6, 20), p[0] + F[0] * d, p[1], p[2] + F[1] * d, heading); for (let i = 0; i < 8; i++) S.box(buff, .04, 1.9, .04, p[0], p[1], p[2], heading, 0, i * Math.PI / 8); S.box(spar, .3, 1, 1.1, p[0], p[1] - .5, p[2], boxYaw); }
  { const p = onDeck(.66, 0); S.place(k.iron, new THREE.CylinderGeometry(.22, .26, 2.2, 10), p[0], p[1] + 1.1, p[2]); }
  for (const [t, side] of [[.5, -2.2], [.5, 2.2], [.58, 0]] as [number, number][]) { const p = onDeck(t, side, 1.9); S.place(k.whitePaint, new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), p[0], p[1], p[2], heading, 0, 0, [1.05, .85, 4.2]); S.place(k.tint('timber', '#7a5c3a'), new THREE.CircleGeometry(1, 14), p[0], p[1] - .02, p[2], heading, -Math.PI / 2, 0, [1, 4.1, 1]); for (const d of [-2.4, 2.4]) S.box(spar, 2.4, 1.9, .16, p[0] + F[0] * d, p[1] - .95, p[2] + F[1] * d, boxYaw); }
  // ---- masts, tops, yards with their furled sails.
  const line = (a: V3, b: V3, w = .045) => S.beam(rope, a, b, w, w);
  interface Mast { t: number; height: number; yards: number[]; rake: number; name: string; }
  const masts: Mast[] = [{ name: 'fore', t: .8, height: 47, yards: [25.6, 18.9, 12.8, 8.5], rake: .015 }, { name: 'main', t: .525, height: 52.4, yards: [28.7, 20.4, 13.4, 8.8], rake: .03 }, { name: 'mizzen', t: .255, height: 41, yards: [20.7, 14.3, 10, 6.7], rake: .05 }];
  const tops: { top: V3; cross: V3; truck: V3; foot: V3; mast: Mast }[] = [];
  for (const mast of masts) {
    const foot = onDeck(mast.t), at = (h: number, side = 0, fore = 0): V3 => [foot[0] - F[0] * (h * mast.rake - fore) + R[0] * side, foot[1] + h, foot[2] - F[1] * (h * mast.rake - fore) + R[1] * side], H = mast.height, hTop = H * .37, hCross = H * .68;
    S.rod(mastWhite, at(-1), at(hTop + 2.2), .46, .36, 12); for (let h = 2.2; h < hTop; h += 2.1) S.rod(k.iron, at(h), at(h + .12), .44 - h * .003, .44 - h * .003, 12);
    S.rod(spar, at(hTop - 1.6, 0, .55), at(hCross + 1.6, 0, .55), .27, .2, 10); S.rod(spar, at(hCross - 1.2, 0, .95), at(H, 0, .95), .16, .07, 8); S.place(k.gold, new THREE.SphereGeometry(.16, 8, 6), ...at(H + .1, 0, .95));
    // The top: a D-shaped platform on its trestle trees, railed aft; the crosstrees above.
    { const p = at(hTop, 0, .3); S.box(spar, 4.4, .14, 3.2, p[0], p[1], p[2], boxYaw); S.box(spar, .3, .3, 3.6, p[0], p[1] - .2, p[2], boxYaw); for (const s of [-1.9, 1.9]) S.box(spar, .1, .9, .1, p[0] + R[0] * s - F[0] * 1.5, p[1] + .5, p[2] + R[1] * s - F[1] * 1.5); S.box(spar, 3.9, .08, .08, p[0] - F[0] * 1.5, p[1] + .95, p[2] - F[1] * 1.5, boxYaw); }
    { const p = at(hCross, 0, .75); S.box(spar, 2.6, .1, .14, p[0], p[1], p[2], boxYaw); S.box(spar, 2.6, .1, .14, p[0] - F[0] * .7, p[1], p[2] - F[1] * .7, boxYaw); S.box(spar, .14, .1, 1.6, p[0], p[1] + .05, p[2], boxYaw); }
    // Yards: lower, topsail, topgallant and royal, each tapered to its arms, with the sail furled along it.
    const yards: [number, number][] = [[hTop - 3.2, mast.yards[0]], [hCross - 2.4, mast.yards[1]], [H * .83, mast.yards[2]], [H * .94, mast.yards[3]]];
    yards.forEach(([h, length], i) => {
      const c = at(h, 0, .5 + i * .22 + .6), r = .26 - i * .05;
      for (const side of [-1, 1]) S.rod(spar, c, [c[0] + R[0] * side * length / 2, c[1], c[2] + R[1] * side * length / 2], r, r * .45, 8);
      if (i < 3 && !(mast.name === 'mizzen' && i === 0)) S.rod(k.canvas, [c[0] - R[0] * length * .43, c[1] + r + .16, c[2] - R[1] * length * .43], [c[0] + R[0] * length * .43, c[1] + r + .16, c[2] + R[1] * length * .43], .2 - i * .03, .2 - i * .03, 7);
      // Lifts from the yard arms to the mast above.
      for (const side of [-1, 1]) line([c[0] + R[0] * side * length * .48, c[1], c[2] + R[1] * side * length * .48], at(h + Math.max(2.5, length * .16), 0, .6), .03);
    });
    // Shrouds with ratlines to the top, topmast shrouds to the crosstrees, backstays to the channels.
    for (const side of [-1, 1]) {
      const chain = (d: number): V3 => { const t = mast.t - d / 58, s = section(t, 4); return P(s.l, s.h + .1, (s.half + .55) * side); }, head = at(hTop - .3, side * .5, .3);
      { const a = chain(.6), b = chain(5.4); S.box(black, .7, .14, 5.6, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, heading); }
      const feet = [0, 1, 2, 3, 4, 5, 6].map(i => chain(.8 + i * .72)); for (const p of feet) line(p, head, .05);
      for (let j = 1; j < 16; j++) { const u = j / 17; line([lerp(feet[0][0], head[0], u), lerp(feet[0][1], head[1], u), lerp(feet[0][2], head[2], u)], [lerp(feet[6][0], head[0], u), lerp(feet[6][1], head[1], u), lerp(feet[6][2], head[2], u)], .022); }
      const topEdge = (i: number): V3 => at(hTop + .1, side * 2.05, .3 - .9 + i * .45), cross = at(hCross - .2, side * .3, .75);
      for (let i = 0; i < 4; i++) line(topEdge(i), cross, .035); for (let j = 1; j < 9; j++) { const u = j / 10; line([lerp(topEdge(0)[0], cross[0], u), lerp(topEdge(0)[1], cross[1], u), lerp(topEdge(0)[2], cross[2], u)], [lerp(topEdge(3)[0], cross[0], u), lerp(topEdge(3)[1], cross[1], u), lerp(topEdge(3)[2], cross[2], u)], .018); }
      line(chain(6.2), at(hCross, side * .2, .75), .04); line(chain(7), at(H * .84, side * .12, .95), .035); line(chain(7.8), at(H - .6, 0, .95), .03);
    }
    tops.push({ top: at(hTop, 0, .3), cross: at(hCross, 0, .75), truck: at(H - .5, 0, .95), foot, mast });
    S.solidBox(1.2, 1.2, foot[0], foot[2], foot[1], foot[1] + H, boxYaw);
  }
  // ---- bowsprit, jib-boom and flying jib-boom, the martingale and its stays.
  const stemTop = section(1, 5), sprit = (d: number, side = 0, drop = 0): V3 => { const p = P(stemTop.l - 2.2 + d * Math.cos(.42), stemTop.h + .3 + d * Math.sin(.42) - drop, side); return p; };
  S.rod(mastWhite, sprit(-2), sprit(13.5), .42, .33, 12); S.rod(spar, sprit(9), sprit(24), .24, .17, 10); S.rod(spar, sprit(19.5), sprit(30.5), .15, .07, 8);
  S.box(spar, .5, .9, .5, ...sprit(13.4), boxYaw); S.rod(spar, sprit(13.4), sprit(13.4, 0, 4.6), .11, .07, 8);
  { const tip = sprit(13.4, 0, 4.6), low = section(1, 1); line(tip, sprit(24), .04); line(tip, sprit(30), .035); line(tip, P(low.l + .5, 1.2, 0), .06); line(sprit(11), P(low.l + .45, .6, 0), .07); for (const side of [-1, 1]) { const cat = section(.93, 4); line(sprit(13.2), P(cat.l, cat.h, cat.half * side), .05); line(sprit(23.6), P(cat.l - 1, cat.h, cat.half * side), .04); } }
  const [fore, main, mizzen] = tops;
  // Stays: each mast forward to the deck, the next mast or the head rigging; the spanker gaff and boom on the mizzen.
  line(fore.top, sprit(10.5), .08); line(fore.cross, sprit(22.5), .05); line(fore.truck, sprit(29.8), .035); line([fore.cross[0], fore.cross[1] + 6, fore.cross[2]], sprit(26.5), .035);
  line(main.top, onDeck(.83, 0, .6), .08); line(main.cross, fore.top, .05); line(main.truck, [fore.cross[0], fore.cross[1] + .5, fore.cross[2]], .035);
  line(mizzen.top, [main.foot[0], main.foot[1] + 4, main.foot[2]], .06); line(mizzen.cross, main.top, .045); line(mizzen.truck, [main.cross[0], main.cross[1] + .5, main.cross[2]], .03);
  { const m = mizzen, at = (h: number, aft: number, side = 0): V3 => [m.foot[0] - F[0] * aft + R[0] * side, m.foot[1] + h, m.foot[2] - F[1] * aft + R[1] * side], peak = at(m.mast.height * .37 + 5.4, 12.6), boom = at(3.1, 17.5);
    S.rod(spar, at(3.2, .5), boom, .2, .12, 8); S.rod(spar, at(m.mast.height * .37 - 1.6, .5), peak, .15, .09, 8); S.rod(k.canvas, at(m.mast.height * .37 - 1.5, 1.2), [peak[0], peak[1] - .25, peak[2]], .2, .14, 7);
    line(peak, at(m.mast.height * .68, 0), .03); line(boom, at(m.mast.height * .37, 0), .03); line(peak, boom, .03);
    // The ensign at the gaff's peak and the commission pennant at the main truck.
    const fly = 4.4, hoist = 2.3, g = new THREE.PlaneGeometry(fly, hoist, 8, 1), gp = g.getAttribute('position'); for (let i = 0; i < gp.count; i++) gp.setZ(i, Math.sin(gp.getX(i) * 1.7) * .16); g.computeVertexNormals();
    S.place(ensignMaterial(), g, peak[0] - F[0] * (fly / 2 + .2), peak[1] - hoist / 2 - .2, peak[2] - F[1] * (fly / 2 + .2), heading + Math.PI / 2);
    const pg = new THREE.PlaneGeometry(5, .22); S.place(k.tint('canvas', '#b3273a'), pg, main.truck[0] - F[0] * 2.6, main.truck[1] + .4, main.truck[2] - F[1] * 2.6, heading + Math.PI / 2);
  }
  // ---- the brow from the pier to the entry port, and the collider: the hull as one prism to its rail.
  { const t = .46, s = section(t, 5), a = P(s.l, deckH(t) + 1.25, s.half), land = P(s.l, 0, s.half + 9), shore: V3 = [land[0], ctx.ground(land[0], land[2]) + .05, land[2]];
    S.beam(k.tint('planks', '#8b8f92'), a, shore, 1.5, .12); for (const side of [-.72, .72]) railing(S, k.whitePaint, [[a[0] + F[0] * side, a[1], a[2] + F[1] * side], [shore[0] + F[0] * side, shore[1], shore[2] + F[1] * side]], 1.05, { spacing: 1.5, post: .05 });
    S.box(k.tint('planks', '#8b8f92'), 1.6, .1, 1.5, ...P(s.l, deckH(t) + 1.25, s.half - .7), boxYaw + Math.PI / 2); }
  const outline: V3[] = []; for (let i = 0; i <= N; i += 2) { const s = section(i / N, 3); outline.push(P(s.l, 0, s.half)); } for (let i = N; i >= 0; i -= 2) { const s = section(i / N, 3); outline.push(P(s.l, 0, -s.half)); }
  const y0 = wl - 1.5, y1 = wl + 7.2;
  for (let i = 0; i < outline.length; i++) { const a = outline[i], b = outline[(i + 1) % outline.length]; S.solid.push(a[0], y0, a[2], b[0], y0, b[2], b[0], y1, b[2], a[0], y0, a[2], b[0], y1, b[2], a[0], y1, a[2]); }
  for (let i = 1; i + 1 < outline.length; i++) S.solid.push(outline[0][0], y1, outline[0][2], outline[i][0], y1, outline[i][2], outline[i + 1][0], y1, outline[i + 1][2]);
  return S;
}

const constitution: SiteModel = {
  id: 'uss-constitution', name: 'USS Constitution', place: 'charlestown-navy-yard', tile: '1_-3', at: BERTH,
  note: 'The 1797 frigate at Pier 1: hull, rig and paint from her published dimensions (175 ft waterline, 43 ft 6 in beam, main truck 172 ft over the spar deck, 94 ft main yard); lines, rigging plan and deck furniture interpretive',
  build: ctx => constitutionShapes(ctx),
};
/** USS Cassin Young (DD-793), the Fletcher-class destroyer across Pier 1 from the frigate: 376 ft by 39 ft 8 in,
 * haze grey over black boot topping, flush deck rising to the bow, the bridge with its gun director, a tripod
 * foremast, two raked stacks, five single 5 in mounts (two forward, three aft), one bank of torpedo tubes and the
 * 40 mm tubs of her 1950s outfit, "793" on the bow. Dimensions and armament are published; the lines are lofted. */
const DESTROYER_EDGE: [Point2, Point2] = [[1630, -2500], [1683, -2430]], DESTROYER_BERTH: Point2 = [1679.6, -2454.7];
function cassinYoungShapes(ctx: SiteContext) {
  const { k } = ctx, S = new Shapes(), [cx, cz] = DESTROYER_BERTH, el = Math.hypot(DESTROYER_EDGE[1][0] - DESTROYER_EDGE[0][0], DESTROYER_EDGE[1][1] - DESTROYER_EDGE[0][1]);
  const F: Point2 = [(DESTROYER_EDGE[0][0] - DESTROYER_EDGE[1][0]) / el, (DESTROYER_EDGE[0][1] - DESTROYER_EDGE[1][1]) / el], R: Point2 = [-F[1], F[0]], heading = Math.atan2(F[0], F[1]), boxYaw = heading - Math.PI / 2;
  const wl = ctx.water(cx, cz) ?? ctx.ground(cx, cz), P = (l: number, h: number, side: number): V3 => [cx + F[0] * l + R[0] * side, wl + h, cz + F[1] * l + R[1] * side];
  const plate = k.tint('concrete', '#8b9299'), grey = plate, deckGrey = k.tint('concrete', '#5d6368'), boot = k.blackPaint, dark = k.tint('steel', '#3c4146');
  const L = 114.7, HALF = 6.05, N = 34, LEVELS = [-1.2, .35, 1, 1], FR = [0, .12, .5, 1];
  const plan = (t: number) => (t < .12 ? lerp(.55, .86, smooth(t / .12)) : t < .42 ? lerp(.86, 1, smooth((t - .12) / .3)) : t > .56 ? Math.max(0, 1 - ((t - .56) / .44) ** 1.75) : 1), water = (t: number) => plan(t) * (t < .15 ? lerp(.6, .97, t / .15) : t > .7 ? lerp(.97, .7, (t - .7) / .3) : .97);
  const free = (t: number) => 3.1 + (t > .45 ? 3.3 * ((t - .45) / .55) ** 1.7 : .25 * ((.45 - t) / .45) ** 2);
  const section = (t: number, level: number) => { const f = FR[level], h = level < 2 ? LEVELS[level] : level === 2 ? free(t) * .5 : free(t); return { l: -L / 2 + t * L + (t > .9 ? (t - .9) * 22 * f : 0) - (t < .04 ? (.04 - t) * 30 * (1 - f) : 0), h, half: Math.max(.1, HALF * lerp(water(t), plan(t), f)) }; };
  const bands = [boot, boot, grey];
  for (let i = 0; i < N; i++) for (let level = 0; level < 3; level++) for (const side of [-1, 1]) {
    const a = section(i / N, level), b = section((i + 1) / N, level), c = section((i + 1) / N, level + 1), d = section(i / N, level + 1);
    S.poly(level === 1 ? grey : bands[level], [P(a.l, a.h, a.half * side), P(b.l, b.h, b.half * side), P(c.l, c.h, c.half * side), P(d.l, d.h, d.half * side)], [R[0] * side, .1, R[1] * side], p => [((p[0] - cx) * F[0] + (p[2] - cz) * F[1]) / 2, p[1] / 2]);
  }
  { const ring: V3[] = []; for (let level = 1; level < 4; level++) { const s = section(0, level); ring.push(P(s.l, s.h, s.half)); } for (let level = 3; level >= 1; level--) { const s = section(0, level); ring.push(P(s.l, s.h, -s.half)); } S.poly(grey, ring, [-F[0], 0, -F[1]]); }
  const deckY = (t: number) => section(t, 3).h, lOf = (t: number) => section(t, 3).l;
  for (let i = 0; i < N; i++) { const a = section(i / N, 3), b = section((i + 1) / N, 3); S.poly(deckGrey, [P(a.l, a.h, -a.half), P(b.l, b.h, -b.half), P(b.l, b.h, b.half), P(a.l, a.h, a.half)], [0, 1, 0]); }
  // Hull numbers on the bow, and the smaller ones on the quarters.
  for (const side of [-1, 1]) { const s = section(.86, 3), q = section(.84, 3), yaw = Math.atan2(R[0] * side + F[0] * .32, R[1] * side + F[1] * .32); const p = P(s.l, s.h - 2.3, (s.half + .12) * side); void q; S.place(k.sign('793', { color: '#f1f1ee', background: '#8b9299', aspect: 2.2, font: '700 132px Arial, sans-serif' }), new THREE.PlaneGeometry(5.6, 2.5), p[0], p[1], p[2], yaw);
    const a = section(.045, 3), ap = P(a.l, a.h - 1.3, (a.half + .08) * side); S.place(k.sign('793', { color: '#f1f1ee', background: '#8b9299', aspect: 2.2, font: '700 132px Arial, sans-serif' }), new THREE.PlaneGeometry(2.4, 1.05), ap[0], ap[1], ap[2], Math.atan2(R[0] * side, R[1] * side)); }
  /** A deckhouse block: from t0 to t1 along the ship, w wide, standing on height y0 over the deck at its middle. */
  const house = (t0: number, t1: number, w: number, y0: number, h: number, m: THREE.Material = plate) => { const tm = (t0 + t1) / 2, c = P(lOf(tm), 0, 0), base = wl + deckY(tm) + y0; S.block(m, w, (t1 - t0) * L, c[0], c[2], base, base + h, boxYaw, { top: deckGrey }); return base + h; };
  /** A single 5 in/38 mount: the enclosed gun house with its sloped face, and the barrel trained fore (dir 1) or aft (-1). */
  const mount = (t: number, y0: number, dir: number) => {
    const c = P(lOf(t), deckY(t) + y0, 0), y = c[1]; S.place(dark, new THREE.CylinderGeometry(1.9, 1.9, .5, 16), c[0], y + .25, c[2]); S.block(plate, 3.3, 4.3, c[0], c[2], y + .5, y + 2.7, boxYaw, { top: plate });
    S.box(plate, 3.1, 1.2, 1.4, c[0] + F[0] * dir * 2.3, y + 1.5, c[2] + F[1] * dir * 2.3, boxYaw, dir * .5); S.rod(dark, [c[0] + F[0] * dir * 2.2, y + 1.75, c[2] + F[1] * dir * 2.2], [c[0] + F[0] * dir * 7.6, y + 2.5, c[2] + F[1] * dir * 7.6], .16, .11, 8);
  };
  // Forward: mount 51 on the forecastle, mount 52 superfiring on the deckhouse, the bridge and its director.
  mount(.845, 0, 1); const fwd = house(.655, .775, 6.6, 0, 2.5); mount(.75, 2.5, 1);
  const bridge = house(.645, .715, 7.4, 2.5, 2.6), pilot = house(.655, .705, 5.6, 5.1, 2.4); void fwd; void bridge;
  { const c = P(lOf(.68), 0, 0); S.place(plate, new THREE.CylinderGeometry(1.5, 1.7, 1.2, 14), c[0], pilot + .6, c[2]); S.block(plate, 2.6, 2.4, c[0], c[2], pilot + 1.2, pilot + 2.9, boxYaw); S.box(dark, 4.4, .5, .5, c[0], pilot + 2.6, c[2], boxYaw);
    for (const side of [-1, 1]) for (let i = 0; i < 5; i++) { const w = P(lOf(.68) + 3.9, 0, side * (.6 + i * .55) - side * .3); S.box(k.glass, .42, .5, .06, w[0], pilot - 1.1, w[2], heading); } }
  // The tripod foremast with its radar platforms and yard.
  { const c = P(lOf(.635), 0, 0), y0 = wl + deckY(.635) + 5, top = y0 + 17.5, head: V3 = [c[0], top, c[2]];
    S.rod(plate, [c[0] + F[0] * 1.2, y0, c[2] + F[1] * 1.2], head, .26, .16, 8); for (const side of [-1, 1]) S.rod(plate, [c[0] - F[0] * 1.6 + R[0] * side * 1.6, y0 - 2.5, c[2] - F[1] * 1.6 + R[1] * side * 1.6], [c[0], top - 3, c[2]], .2, .14, 8);
    S.box(plate, 2.4, .16, 2, c[0], top - 4.6, c[2], boxYaw); S.box(dark, 3.6, 1.5, .25, c[0] + F[0] * .6, top - 3.6, c[2] + F[1] * .6, boxYaw + Math.PI / 2, -.15); S.rod(plate, head, [c[0], top + 3.4, c[2]], .12, .05, 6); S.box(plate, 7.4, .1, .1, c[0], top - 1.2, c[2], boxYaw);
    S.place(dark, new THREE.CylinderGeometry(1.2, 1.2, .25, 12), c[0], top + .3, c[2]); S.solidBox(1.4, 1.4, c[0], c[2], y0 - 3, top + 3, boxYaw); }
  // Two raked stacks with their black caps, the midships deckhouse, the torpedo tubes and 40 mm tubs.
  house(.4, .6, 5.2, 0, 2.4);
  for (const t of [.555, .44]) { const c = P(lOf(t), 0, 0), y0 = wl + deckY(t) + 2.4, g = new THREE.CylinderGeometry(1, 1.15, 6.6, 16); S.place(plate, g, c[0] - F[0] * .35, y0 + 3.3, c[2] - F[1] * .35, heading, -.07, 0, [1.05, 1, 1.9]); S.place(boot, new THREE.CylinderGeometry(1.03, 1.02, .9, 16), c[0] - F[0] * .6, y0 + 6.9, c[2] - F[1] * .6, heading, -.07, 0, [1.05, 1, 1.9]); S.solidBox(2.4, 4, c[0], c[2], y0, y0 + 7, boxYaw); }
  { const c = P(lOf(.37), 0, 0), y0 = wl + deckY(.37) + 2.4; S.place(dark, new THREE.CylinderGeometry(1.2, 1.2, .4, 12), c[0], y0 + .2, c[2]); for (let i = -2; i <= 2; i++) S.rod(plate, [c[0] + R[0] * i * .62 - F[0] * 3.4, y0 + .9, c[2] + R[1] * i * .62 - F[1] * 3.4], [c[0] + R[0] * i * .62 + F[0] * 3.4, y0 + .9, c[2] + R[1] * i * .62 + F[1] * 3.4], .29, .29, 10); S.box(plate, 3.4, .9, 1.4, c[0], y0 + 1.6, c[2], boxYaw); }
  for (const [t, side] of [[.5, 3.6], [.5, -3.6], [.31, 0]] as [number, number][]) { const c = P(lOf(t), 0, side), y0 = wl + deckY(t) + (side ? 0 : 2.4); S.place(plate, new THREE.CylinderGeometry(1.7, 1.7, 1.1, 14, 1, true), c[0], y0 + .55 + (side ? 2.4 : 0), c[2]); for (const b of [-.35, .35]) S.rod(dark, [c[0] + R[0] * b, y0 + 1.3 + (side ? 2.4 : 0), c[2] + R[1] * b], [c[0] + R[0] * b + F[0] * 2.4 * (side ? 1 : -1), y0 + 2.2 + (side ? 2.4 : 0), c[2] + R[1] * b + F[1] * 2.4 * (side ? 1 : -1)], .06, .04, 6); }
  // Aft: the after deckhouse with mounts 53 and 54, mount 55 on the fantail, the depth charge track at the stern.
  house(.17, .34, 5.6, 0, 2.4); mount(.3, 2.4, -1); mount(.2, 2.4, -1); mount(.105, 0, -1);
  { const c = P(lOf(.025), 0, 2.2), y0 = wl + deckY(.025); S.box(dark, .9, .7, 5.5, c[0], y0 + .45, c[2], heading); }
  // Jackstaff, ensign staff with the ensign, anchors, and the brow to the pier.
  { const b = P(lOf(.995) + 1.6, 0, 0), y0 = wl + deckY(.995); S.rod(plate, [b[0], y0, b[2]], [b[0], y0 + 3.2, b[2]], .05, .03, 6); const a = P(lOf(.01), 0, 0), ya = wl + deckY(.01); S.rod(plate, [a[0], ya, a[2]], [a[0] - F[0] * .8, ya + 4.4, a[2] - F[1] * .8], .05, .03, 6);
    const g = new THREE.PlaneGeometry(2.6, 1.4, 6, 1), gp = g.getAttribute('position'); for (let i = 0; i < gp.count; i++) gp.setZ(i, Math.sin(gp.getX(i) * 2.2) * .1); g.computeVertexNormals(); S.place(ensignMaterial(), g, a[0] - F[0] * 2.2, ya + 3.6, a[2] - F[1] * 2.2, heading + Math.PI / 2);
    for (const side of [-1, 1]) { const s = section(.93, 3), p = P(s.l, s.h - 1.3, (s.half + .15) * side); S.box(dark, 1.2, 1.5, .3, p[0], p[1], p[2], Math.atan2(R[0] * side, R[1] * side)); } }
  { const t = .46, s = section(t, 3), a = P(s.l, s.h + .1, -s.half), land = P(s.l, 0, -s.half - 7.5), shore: V3 = [land[0], ctx.ground(land[0], land[2]) + .05, land[2]];
    S.beam(k.tint('planks', '#8b8f92'), a, shore, 1.4, .12); for (const side of [-.68, .68]) railing(S, k.whitePaint, [[a[0] + F[0] * side, a[1], a[2] + F[1] * side], [shore[0] + F[0] * side, shore[1], shore[2] + F[1] * side]], 1.05, { spacing: 1.5, post: .05 }); }
  // Lifelines along the deck edge.
  for (const side of [-1, 1]) for (let i = 1; i < N - 1; i++) { const a = section(i / N, 3), b = section((i + 1) / N, 3), pa = P(a.l, a.h, (a.half - .15) * side), pb = P(b.l, b.h, (b.half - .15) * side); S.box(plate, .05, 1, .05, pa[0], pa[1] + .5, pa[2]); for (const h of [.55, 1]) S.beam(plate, [pa[0], pa[1] + h, pa[2]], [pb[0], pb[1] + h, pb[2]], .025, .025); }
  const outline: V3[] = []; for (let i = 0; i <= N; i += 2) { const s = section(i / N, 3); outline.push(P(s.l, 0, s.half)); } for (let i = N; i >= 0; i -= 2) { const s = section(i / N, 3); outline.push(P(s.l, 0, -s.half)); }
  const y0 = wl - 1.5, y1 = wl + 3.2;
  for (let i = 0; i < outline.length; i++) { const a = outline[i], b = outline[(i + 1) % outline.length]; S.solid.push(a[0], y0, a[2], b[0], y0, b[2], b[0], y1, b[2], a[0], y0, a[2], b[0], y1, b[2], a[0], y1, a[2]); }
  for (let i = 1; i + 1 < outline.length; i++) S.solid.push(outline[0][0], y1, outline[0][2], outline[i][0], y1, outline[i][2], outline[i + 1][0], y1, outline[i + 1][2]);
  return S;
}
const cassinYoung: SiteModel = {
  id: 'uss-cassin-young', name: 'USS Cassin Young', place: 'charlestown-navy-yard', tile: '1_-3', at: DESTROYER_BERTH,
  note: 'Fletcher-class destroyer DD-793 on the east side of Pier 1: published length, beam and armament (five single 5 in mounts, tripod mast, two stacks); hull lines and deckhouse measures interpretive',
  build: ctx => cassinYoungShapes(ctx),
};
export const SITES: SiteModel[] = [constitution, cassinYoung];
