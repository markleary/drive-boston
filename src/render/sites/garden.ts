import * as THREE from 'three';
import type { ParkPath, Point2 } from '../../types';
import { footbridgeRoad } from '../../simulation/footbridges.ts';
import { railing, Shapes, type SiteKit, type SiteModel, type V3 } from '../site-kit.ts';

/** The Public Garden's three signatures, none of which the park data carries: Thomas Ball's equestrian George
 * Washington (1869) inside the Arlington Street gate, the Swan Boats at their landing on the lagoon, and the granite
 * piers, lamps and suspension rods of the 1867 lagoon bridge, set on the deck the park renderer already draws.
 * Positions are measured on the package: the statue stands in the gap the mapped paths leave on the bridge's axis
 * (the centre of the oval the mapped paths draw 40 m inside the Arlington Street gate), the landing on the east bank
 * south of the bridge. */
const AXIS: [Point2, Point2] = [[420.1, -453.5], [383.1, -439.8]], STATUE: Point2 = [314, -413.6], LANDING: Point2 = [423.5, -419.5];

/** A point of a figure's own frame: `side` to its right, `up`, `fwd` ahead of it, scaled and turned to `yaw` (the way it faces). */
const local = (x: number, y: number, z: number, yaw: number, s: number) => (side: number, up: number, fwd: number): V3 => [x + (Math.cos(yaw) * side + Math.sin(yaw) * fwd) * s, y + up * s, z + (-Math.sin(yaw) * side + Math.cos(yaw) * fwd) * s];

/** A horse and rider in the round from tapered limbs and ellipsoids: a walking horse, near foreleg raised, the rider
 * upright in a cocked hat with the reins in his left hand and a sword held low in his right. */
function equestrian(S: Shapes, m: THREE.Material, x: number, y: number, z: number, yaw: number, s: number) {
  const P = local(x, y, z, yaw, s), ball = (at: V3, r: [number, number, number]) => S.place(m, new THREE.SphereGeometry(1, 16, 12), at[0], at[1], at[2], yaw, 0, 0, [r[0] * s, r[1] * s, r[2] * s]), limb = (a: V3, b: V3, ra: number, rb: number) => S.rod(m, a, b, ra * s, rb * s, 10);
  ball(P(0, 1.28, 0), [.36, .4, .88]); ball(P(0, 1.33, .6), [.35, .42, .4]); ball(P(0, 1.36, -.62), [.38, .44, .46]);
  limb(P(0, 1.45, .78), P(0, 2.12, 1.22), .27, .17); limb(P(0, 2.2, 1.16), P(0, 1.84, 1.7), .16, .09); ball(P(0, 2.16, 1.2), [.15, .19, .2]);
  for (const side of [-1, 1]) { limb(P(side * .08, 2.3, 1.14), P(side * .1, 2.45, 1.1), .045, .01); limb(P(side * .2, 1.05, -.7), P(side * .2, .58, -.92), .15, .08); limb(P(side * .2, .58, -.92), P(side * .2, .06, -.8), .075, .06); ball(P(side * .2, .06, -.78), [.09, .07, .11]); }
  limb(P(-.18, 1.02, .66), P(-.18, .55, .7), .13, .08); limb(P(-.18, .55, .7), P(-.18, .06, .68), .07, .06); ball(P(-.18, .06, .7), [.09, .07, .11]);
  limb(P(.18, 1.02, .66), P(.18, .78, 1.02), .13, .08); limb(P(.18, .78, 1.02), P(.18, .42, .86), .07, .06); ball(P(.18, .4, .86), [.09, .07, .11]);
  limb(P(0, 1.5, -.98), P(0, 1.2, -1.22), .1, .08); limb(P(0, 1.2, -1.22), P(0, .5, -1.2), .09, .03);
  for (let i = 0; i < 5; i++) limb(P(0, 1.62 + i * .13, .86 + i * .085), P(.07, 1.52 + i * .13, .74 + i * .085), .05, .03); // mane
  // The rider.
  limb(P(0, 1.62, -.06), P(0, 2.42, 0), .21, .25); ball(P(0, 2.36, 0), [.3, .16, .2]); limb(P(0, 2.45, .01), P(0, 2.58, .02), .09, .08); ball(P(0, 2.68, .03), [.125, .15, .14]);
  S.place(m, new THREE.CylinderGeometry(.27 * s, .27 * s, .05 * s, 3), ...P(0, 2.8, .02), yaw + Math.PI); S.place(m, new THREE.CylinderGeometry(.1 * s, .15 * s, .1 * s, 10), ...P(0, 2.84, .02));
  for (const side of [-1, 1]) { limb(P(side * .2, 1.7, -.04), P(side * .42, 1.3, .32), .13, .1); limb(P(side * .42, 1.3, .32), P(side * .44, .82, .2), .09, .075); ball(P(side * .44, .78, .28), [.07, .06, .14]); limb(P(side * .44, 1.72, -.3), P(side * .52, 1.2, -.42), .03, .2); }
  limb(P(-.28, 2.32, 0), P(-.3, 1.98, .16), .085, .07); limb(P(-.3, 1.98, .16), P(-.12, 1.92, .46), .07, .055); limb(P(.28, 2.32, 0), P(.36, 1.92, .04), .085, .07); limb(P(.36, 1.92, .04), P(.4, 1.6, .2), .07, .055);
  limb(P(.42, 1.62, .22), P(.5, .86, -.1), .022, .012); limb(P(-.12, 1.92, .46), P(0, 2.02, 1.5), .012, .012); // sword and reins
  limb(P(-.2, 2.3, -.12), P(-.3, 1.5, -.5), .22, .3); // the cloak falling over the horse's quarters
}

const washington: SiteModel = {
  id: 'washington-statue', name: 'George Washington statue', place: 'public-garden', tile: '0_-1', at: STATUE, clear: 9,
  note: 'Thomas Ball, cast 1869: the bronze equestrian Washington, 16 ft on a 22 ft granite pedestal (38 ft in all, as published), facing the Arlington Street gate inside its railed bed; the figure is massed from tapered limbs and the pedestal mouldings are interpretive',
  build({ k, ground }) {
    const S = new Shapes(), [x, z] = STATUE, base = ground(x, z), toward = Math.atan2(AXIS[1][0] - AXIS[0][0], AXIS[1][1] - AXIS[0][1]), granite = k.tint('granite', '#b3aea4'), plain = k.tint('castStone', '#bdb8ae'), bronze = k.tint('verdigris', '#4b5f55');
    // Stepped base, plinth, die with its panels and cap: 6.7 m to the bronze's own plinth.
    const tiers: [number, number, number, number][] = [[7.2, 4.4, -.6, .35], [6.4, 3.6, .35, .75], [5.5, 2.8, .75, 1.5], [4.7, 2.15, 1.5, 5.6], [5.4, 2.8, 5.6, 6.05], [5.9, 3.2, 6.05, 6.4], [5, 2.4, 6.4, 6.7]];
    for (const [d, w, y0, y1] of tiers) S.block(y1 - y0 > 2 ? granite : plain, w, d, x, z, base + y0, base + y1, toward, { top: plain });
    for (const side of [-1, 1]) { const px = x + Math.cos(toward) * side * 1.09, pz = z - Math.sin(toward) * side * 1.09; S.box(plain, .04, 3, 3.6, px, base + 3.55, pz, toward); }
    for (const end of [-1, 1]) { const px = x + Math.sin(toward) * end * 2.37, pz = z + Math.cos(toward) * end * 2.37; S.box(plain, 1.5, 3, .04, px, base + 3.55, pz, toward); }
    { const px = x + Math.sin(toward) * 2.41, pz = z + Math.cos(toward) * 2.41; S.place(k.sign('WASHINGTON', { color: '#5b574f', background: '#bdb8ae', aspect: 5.2, font: '600 96px Georgia, serif' }), new THREE.PlaneGeometry(1.4, .27), px, base + 4.6, pz, toward); }
    S.block(bronze, 1.5, 4.3, x, z, base + 6.7, base + 6.86, toward);
    equestrian(S, bronze, x, base + 6.86, z, toward, 1.78);
    // The planted bed and its iron fence, an oval about the pedestal.
    const ring: V3[] = []; for (let i = 0; i <= 28; i++) { const a = i / 28 * Math.PI * 2, u = Math.cos(a) * 5.2, v = Math.sin(a) * 6.6, px = x + Math.cos(toward) * u + Math.sin(toward) * v, pz = z - Math.sin(toward) * u + Math.cos(toward) * v; ring.push([px, ground(px, pz), pz]); }
    S.poly(k.tint('grass', '#55713f'), ring.slice(0, 28).map(p => [p[0], p[1] + .12, p[2]] as V3), [0, 1, 0]);
    railing(S, k.iron, ring, .95, { spacing: 1.5, pickets: .16, post: .05 });
    S.solidBox(4.6, 7.4, x, z, base - .5, base + 7, toward);
    return S;
  },
};

/** One Swan Boat: twin pontoons under a planked deck, six varnished benches between brass rails, and the swan at the
 * stern that hides the driver's pedals. `yaw` is the way the bow points. */
function swanBoat(S: Shapes, k: SiteKit, x: number, wl: number, z: number, yaw: number) {
  const P = local(x, wl, z, yaw, 1), hull = k.tint('planks', '#3d5a47'), deck = k.tint('planks', '#8c3f33'), bench = k.tint('planks', '#9a6a3c'), white = k.whitePaint, boxYaw = yaw;
  for (const side of [-1, 1]) { S.rod(hull, P(side * .95, .12, -4.3), P(side * .95, .12, 4.3), .34, .34, 10); S.place(hull, new THREE.SphereGeometry(.34, 10, 8), ...P(side * .95, .12, 4.3)); S.place(hull, new THREE.SphereGeometry(.34, 10, 8), ...P(side * .95, .12, -4.3)); }
  S.box(deck, 2.6, .1, 8.2, ...P(0, .5, 0), boxYaw);
  for (let i = 0; i < 6; i++) { const f = 3.1 - i * 1.05; S.box(bench, 2.3, .06, .42, ...P(0, .98, f), boxYaw); S.box(bench, 2.3, .46, .05, ...P(0, 1.24, f - .22), boxYaw); for (const side of [-1, 1]) S.box(k.iron, .05, .46, .36, ...P(side * 1.12, .76, f), boxYaw); }
  for (const side of [-1, 1]) { const pts: V3[] = [P(side * 1.26, .55, 3.7), P(side * 1.26, .55, -2.6)]; railing(S, k.gold, pts, .62, { spacing: 1.6, post: .035 }); }
  // The swan: breast and body, the neck in an S, head and bill, wings half raised.
  S.place(white, new THREE.SphereGeometry(1, 14, 10), ...P(0, 1.2, -3.35), yaw, 0, 0, [.62, .62, 1.05]);
  const neck: V3[] = [P(0, 1.5, -2.7), P(0, 2.05, -2.4), P(0, 2.5, -2.62), P(0, 2.72, -2.42)]; for (let i = 0; i + 1 < neck.length; i++) S.rod(white, neck[i], neck[i + 1], .17 - i * .025, .15 - i * .025, 10);
  S.place(white, new THREE.SphereGeometry(.17, 10, 8), ...P(0, 2.74, -2.34)); S.rod(k.tint('redPaint', '#d9772b'), P(0, 2.72, -2.26), P(0, 2.64, -2.02), .07, .03, 8);
  for (const side of [-1, 1]) S.place(white, new THREE.SphereGeometry(1, 12, 8), ...P(side * .62, 1.55, -3.5), yaw, 0, side * -.35, [.12, .66, 1.1]);
  S.solidBox(2.7, 8.8, x, z, wl - .4, wl + 1.3, yaw);
}
const swanBoats: SiteModel = {
  id: 'swan-boats', name: 'Swan Boats', place: 'public-garden', tile: '0_-1', at: LANDING, clear: 6,
  note: 'The Paget family Swan Boats (since 1877) at their landing on the east bank of the lagoon south of the bridge: three boats alongside the float and one out on the water; pontoon boats of six benches with the swan at the stern, sizes and colours from memory of the boats and interpretive',
  build(ctx) {
    const { k, ground } = ctx, S = new Shapes(), [x, z] = LANDING, wl = ctx.water(x - 8, z + 4) ?? ground(x - 8, z + 4), along = Math.atan2(.83, .55), t: Point2 = [Math.sin(along), Math.cos(along)], n: Point2 = [-t[1], t[0]].map(v => v) as Point2, out: Point2 = n[0] < 0 ? n : [-n[0], -n[1]];
    // The float along the bank with its gangway, ticket hut and rail.
    const float = k.tint('planks', '#8f8a80'), fx = x + out[0] * 3.2, fz = z + out[1] * 3.2;
    S.block(float, 3, 26, fx, fz, wl - .3, wl + .42, along, { top: float });
    const shore: V3 = [x - out[0] * 2.5, ground(x - out[0] * 2.5, z - out[1] * 2.5) + .05, z - out[1] * 2.5]; S.beam(float, [fx - out[0] * 1.2, wl + .46, fz - out[1] * 1.2], shore, 1.5, .1);
    railing(S, k.tint('iron', '#2d4a39'), [[fx - out[0] * 1.4 - t[0] * 12.5, wl + .42, fz - out[1] * 1.4 - t[1] * 12.5], [fx - out[0] * 1.4 - t[0] * 1.2, wl + .42, fz - out[1] * 1.4 - t[1] * 1.2]], 1, { spacing: 1.8, post: .05 });
    railing(S, k.tint('iron', '#2d4a39'), [[fx - out[0] * 1.4 + t[0] * 1.2, wl + .42, fz - out[1] * 1.4 + t[1] * 1.2], [fx - out[0] * 1.4 + t[0] * 12.5, wl + .42, fz - out[1] * 1.4 + t[1] * 12.5]], 1, { spacing: 1.8, post: .05 });
    { const hx = shore[0] - out[0] * 2.2 + t[0] * 3, hz = shore[2] - out[1] * 2.2 + t[1] * 3, hy = ground(hx, hz); S.block(k.tint('clapboard', '#3f5a47'), 2.4, 2, hx, hz, hy - .3, hy + 2.3, along, { top: null }); S.block(k.tint('shingle', '#4a4a44'), 3, 2.6, hx, hz, hy + 2.3, hy + 2.5, along); S.place(k.sign('SWAN BOATS', { color: '#f1eee6', background: '#3f5a47', aspect: 5 }), new THREE.PlaneGeometry(2, .4), hx + out[0] * 1.03, hy + 1.95, hz + out[1] * 1.03, Math.atan2(out[0], out[1])); S.place(k.opening, new THREE.PlaneGeometry(1.3, .8), hx + out[0] * 1.02, hy + 1.25, hz + out[1] * 1.02, Math.atan2(out[0], out[1])); }
    for (const d of [-8.2, 0.6, 9.4]) swanBoat(S, k, fx + out[0] * 3.1 + t[0] * d, wl, fz + out[1] * 3.1 + t[1] * d, along);
    swanBoat(S, k, x + out[0] * 21 - t[0] * 26, wl, z + out[1] * 21 - t[1] * 26, along + 2.2);
    return S;
  },
};

const lagoonBridge: SiteModel = {
  id: 'lagoon-bridge', name: 'Public Garden lagoon bridge', place: 'public-garden', tile: '0_-1', at: [(AXIS[0][0] + AXIS[1][0]) / 2, (AXIS[0][1] + AXIS[1][1]) / 2], clear: 0,
  note: 'William G. Preston and Clemens Herschel, 1867: the four granite piers with their lamp standards and the iron suspension rods of the lagoon bridge, dressed onto the deck the park renderer draws for the mapped crossing; pier sizes and the span between them interpretive',
  build({ k, city }) {
    const S = new Shapes(), path: ParkPath = { id: 'lagoon-bridge', points: [AXIS[0], AXIS[1]], width: 3.2, bridge: true, bridgePoints: [AXIS[1], AXIS[0]] }, road = footbridgeRoad(city, path); if (!road?.elevations) return S;
    const lengths = [0]; for (let i = 1; i < road.points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(road.points[i][0] - road.points[i - 1][0], road.points[i][1] - road.points[i - 1][1]));
    const total = lengths[lengths.length - 1], at = (d: number, side: number, up = 0): V3 => { let i = 1; while (i < lengths.length - 1 && lengths[i] < d) i++; const u = (d - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1), a = road.points[i - 1], b = road.points[i], dx = (b[0] - a[0]), dz = (b[1] - a[1]), l = Math.hypot(dx, dz) || 1; return [a[0] + dx * u + dz / l * side, road.elevations![i - 1] + (road.elevations![i] - road.elevations![i - 1]) * u + up, a[1] + dz * u - dx / l * side]; };
    const yaw = Math.atan2(road.points[road.points.length - 1][0] - road.points[0][0], road.points[road.points.length - 1][1] - road.points[0][1]), granite = k.tint('granite', '#aaa69d'), cap = k.tint('castStone', '#bcb7ad'), half = road.width / 2 + .62, d0 = total * .28, d1 = total * .72, towerTop = 3.3;
    for (const d of [d0, d1]) for (const side of [-1, 1]) {
      const p = at(d, side * half);
      S.block(granite, 1.15, 1.15, p[0], p[2], p[1] - 3.2, p[1] + towerTop, yaw, { top: cap }); S.box(cap, 1.4, .22, 1.4, p[0], p[1] + towerTop + .11, p[2], yaw); S.box(cap, 1.3, .16, 1.3, p[0], p[1] + 1.05, p[2], yaw);
      S.rod(k.bronze, [p[0], p[1] + towerTop + .2, p[2]], [p[0], p[1] + towerTop + 1.5, p[2]], .07, .045, 8); S.place(k.lamp, new THREE.SphereGeometry(.24, 12, 8), p[0], p[1] + towerTop + 1.7, p[2]);
    }
    // The rods: from each pier head down to the rail at mid-span and out to the abutments, with hangers.
    for (const side of [-1, 1]) {
      const s = side * (half - .2), curve = (d: number) => { const mid = (d0 + d1) / 2, inner = d >= d0 && d <= d1; return inner ? 1.15 + (towerTop - 1.35) * ((d - mid) / ((d1 - d0) / 2)) ** 2 : 1.1 + (towerTop - 1.3) * Math.max(0, 1 - (d < d0 ? d0 - d : d - d1) / (total * .2)) ** 1.6; };
      for (let i = 0; i < 28; i++) { const a = total * .09 + (total * .82) * i / 28, b = total * .09 + (total * .82) * (i + 1) / 28; S.beam(k.iron, at(a, s, curve(a)), at(b, s, curve(b)), .06, .09); if (i % 2 === 0 && curve(a) > 1.3) S.beam(k.iron, at(a, s, 1.05), at(a, s, curve(a)), .03, .03); }
    }
    return S;
  },
};
export const SITES: SiteModel[] = [washington, swanBoats, lagoonBridge];
