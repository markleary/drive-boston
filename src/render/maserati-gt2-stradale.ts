import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { geometryParts, type VehicleSurface } from './car.ts';
import { PLAYER_CARS } from '../simulation/player-cars.ts';
import { GT2 } from '../simulation/gt2-powertrain.ts';
import type { P, Parts } from './sports-car-shapes.ts';

/** Maserati GT2 Stradale: an original procedural model after Maserati's press photographs (public/models/PLAYER_CARS.md
 * lists them and what was measured on them). Chassis-local metres, +Z forward, the tyres' contact plane GROUND below
 * the origin. One skin function gives the body its section at every station, and each end is also a surface that can
 * be walked round its corner onto the flank, so lamps, vents and panels lie on the surface they belong to. */
const SPEC = PLAYER_CARS['maserati-gt2-stradale'];
type Row = [number, number];
type Surface = (u: number, v: number) => P;
type Steps = number | number[];
const lerp = THREE.MathUtils.lerp, smooth = THREE.MathUtils.smoothstep;
/** The car as it stands on its springs: the physics rests the body with the road .582 m under the chassis origin
 * (tests/gt2-stradale.test.mjs holds it), its front wheel centres .244 m and its rear ones .234 m under it. */
const GROUND = -.582, WHEEL_Y = [GROUND + SPEC.wheelRadius, GROUND + SPEC.rearWheelRadius], AXLE = SPEC.wheelbase / 2;
/** The splitter's lip is the front of the car: the nose stands this far behind it. */
const SPLITTER = .045;
const FRONT = AXLE + GT2.overhang[0] - SPLITTER, REAR = -AXLE - GT2.overhang[1];
/** Height above the road to chassis-local y. */
const H = (h: number) => h + GROUND;

/** A C1 curve through rows of [station, value]: Catmull-Rom tangents, held beyond its ends. */
const curve = (rows: Row[]) => {
  const n = rows.length, m = rows.map((_, i) => { const a = rows[Math.max(0, i - 1)], b = rows[Math.min(n - 1, i + 1)]; return (b[1] - a[1]) / (b[0] - a[0]); });
  return (z: number) => {
    if (z <= rows[0][0]) return rows[0][1]; if (z >= rows[n - 1][0]) return rows[n - 1][1];
    let i = 1; while (rows[i][0] < z) i++;
    const [z0, v0] = rows[i - 1], [z1, v1] = rows[i], h = z1 - z0, t = (z - z0) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * h * m[i - 1] + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * h * m[i];
  };
};
/** Heights above the road along the car, and values against height above the road. */
const heights = (rows: Row[]) => curve(rows.map(([z, h]) => [z, H(h)]));
const byHeight = (rows: Row[]) => curve(rows.map(([h, v]) => [H(h), v]));

// Side view, measured on the photographs against the wheels, the roof and the published length: the centre line of
// the skin, the crown of the wings, the height of greatest width, the height the flank's tuck is reckoned to, and the
// lower edge of the paint (the sill between the wheels, a diagonal up to the tail's corner behind the rear one).
const top = heights([[REAR, .812], [-2.0, .840], [-1.78, .872], [-1.35, .905], [-.9, .92], [0, .88], [.85, .830], [1.0, .806], [1.35, .742], [1.7, .676], [2.0, .612], [2.2, .552], [FRONT, .470]]);
const crown = heights([[REAR, .800], [-2.0, .836], [-1.7, .872], [-1.35, .892], [-1.0, .890], [-.6, .872], [0, .842], [.6, .822], [1.0, .815], [1.35, .806], [1.6, .792], [1.85, .738], [2.05, .655], [2.25, .548], [FRONT, .462]]);
const belt = heights([[REAR, .635], [-1.9, .64], [-1.35, .64], [-.6, .60], [.3, .585], [1.35, .60], [2.0, .50], [FRONT, .40]]);
const rocker = heights([[REAR, .30], [-1.35, .27], [1.35, .26], [FRONT, .235]]);
const paintLow = heights([[REAR, .455], [-2.10, .355], [-1.95, .26], [-1.80, .18], [-1.35, .26], [-.98, .37], [-.7, .315], [0, .30], [.7, .30], [.95, .31], [1.35, .28], [1.75, .26], [2.1, .25], [FRONT, .235]]);
// Plan view: half the width (turning in at each end to meet the panel there), the share of it the wing's crown lies
// at, and how far the flank tucks in toward the rocker.
const width = curve([[REAR, .80], [REAR + .045, .836], [REAR + .14, .886], [-1.95, .936], [-1.76, .972], [-1.55, .981], [-1.35, .9825], [-1.05, .972], [-.8, .945], [-.4, .905], [.1, .892], [.6, .905], [.9, .940], [1.1, .962], [1.35, .970], [1.75, .962], [2.0, .948], [2.2, .922], [FRONT - .05, .885], [FRONT, .86]]);
const crownAt = curve([[REAR, .80], [-1.35, .77], [0, .76], [1.35, .74], [2.1, .68], [FRONT, .60]]);
const tuck = curve([[REAR, .05], [-1.35, .03], [0, .045], [1.35, .025], [FRONT, .08]]);
/** How round the shoulder is in section: 2 is a quarter ellipse (the wings), less leans the upper door in flatter toward the glass. */
const shoulder = curve([[-1.35, 2], [-.8, 1.7], [-.3, 1.45], [.5, 1.45], [.95, 1.8], [1.35, 2]]);
/** The door's hollow: it begins as a step in from the front wing's trailing edge, behind the wheel, and deepens toward
 * the rear wing, whose leading edge stands out of it ahead of the wheel. */
const scallop = (z: number) => smooth(z, -.93, -.74) * (1 - smooth(z, .84, .90)) * lerp(.092, .034, smooth(z, -.72, .84));
/** Half width of the bonnet's carbon panel, round across its front, and the hollow in the paint along each side of it. */
const bonnet = (z: number) => z >= 2.06 ? .44 * Math.sqrt(Math.max(0, (2.16 - z) / .10)) : lerp(.54, .44, smooth(z, 1.25, 2.06));
const valley = (a: number, z: number) => { const g = smooth(z, 1.08, 1.32) * (1 - smooth(z, 1.92, 2.18)); if (g <= 0) return 0; const u = (a - bonnet(z) - .075) / .08; return Math.abs(u) < 1 ? .028 * g * (1 - u * u) ** 2 : 0; };
/** Each exhaust tip: distance from the centre line and height above the road. */
const EXHAUST = [.265, .365];

// Each end: where its rounding begins, its half width, its plan as terms of [depth, power] of the share of that half
// width, and its lean in side view against height.
const NOSE_FROM = 1.74, TAIL_FROM = -1.76, W_F = width(FRONT), W_R = width(REAR);
const NOSE: Row[] = [[.05, 2], [.13, 4], [.10, 12]], TAIL: Row[] = [[.04, 2], [.11, 5], [.04, 14]];
/** The nose is blunt at the splitter and rounder at the bonnet's edge: the share of its plan depth by height. */
const noseDepth = byHeight([[.28, .74], [.36, .86], [.46, 1.06]]);
const noseLean = byHeight([[.10, .03], [.20, .02], [.34, .004], [.40, 0], [.44, .006], [.48, .035]]);
const tailLean = byHeight([[.16, .045], [.30, .04], [.42, .02], [.52, .004], [.58, 0], [.66, 0], [.74, .012], [.82, .035]]);
/** How far an end's panel stands back from the end at a distance from the centre line. Beyond the panel's own half
 * width the depth eases off instead of stopping, so a flank that is wider than the end is carried along with no crease. */
function plan(x: number, reach: number, terms: Row[]) {
  const e = Math.abs(x) / reach;
  if (e <= 1) return terms.reduce((sum, [c, n]) => sum + c * e ** n, 0);
  const over = e - 1; return terms.reduce((sum, [c]) => sum + c, 0) + terms.reduce((sum, [c, n]) => sum + c * n, 0) * over / (1 + over / .06);
}
/** Plan-view rounding of the nose and tail, and the lean of each end in side view. */
function warp(z: number, x: number, y: number) {
  if (z > NOSE_FROM) return z - (plan(x, W_F, NOSE) * noseDepth(y) + noseLean(y)) * smooth(z, NOSE_FROM, FRONT);
  if (z < TAIL_FROM) return z + (plan(x, W_R, TAIL) + tailLean(y)) * (1 - smooth(z, REAR, TAIL_FROM));
  return z;
}
/** The upper section at a station: height of the skin at a distance from the centre line (no further than the widest point). */
function upper(z: number, x: number) {
  const w = width(z), c = crownAt(z) * w, yc = crown(z), a = Math.abs(x);
  if (a <= c) { const k = a / c, yt = top(z); return yt + (yc - yt) * k * k * (3 - 2 * k) - valley(a, z); }
  const k = Math.min(1, (a - c) / (w - c)), n = shoulder(z); return belt(z) + (yc - belt(z)) * (1 - k ** n) ** (1 / n);
}
/** Half width of the body at a height: the flank below the belt, the shoulder above it. */
function side(z: number, y: number) {
  const w = width(z), yb = belt(z);
  if (y >= yb) { const c = crownAt(z) * w, k = Math.min(1, (y - yb) / (crown(z) - yb)), n = shoulder(z); return c + (w - c) * (1 - k ** n) ** (1 / n); }
  const t = Math.min(1.5, (yb - y) / (yb - rocker(z)));
  return w - tuck(z) * t * t - scallop(z) * Math.sin(Math.PI * Math.min(1, t)) ** 2;
}
/** A point of the upper skin by its plan position, and of the flank by its height. */
const onTop = (s: number, x: number, z: number): P => { const y = upper(z, x); return [s * x, y, warp(z, x, y)]; };
const onSide = (s: number, y: number, z: number): P => { const x = side(z, y); return [s * x, y, warp(z, x, y)]; };
/** A point of the nose (sign 1) or tail panel, `depth` behind its face. */
const onEnd = (sign: number, x: number, y: number, depth = 0): P => [x, y, warp(sign > 0 ? FRONT : REAR, x, y) - sign * depth];
/** Each end walked round its corner at a height: t runs 0 to 1 across the panel from the centre line to the corner,
 * then on along the flank, a metre of it to each unit. `across` is where a distance from the centre line falls. */
const aft = (s: number, t: number, y: number): P => {
  if (t > 1) return onSide(s, y, REAR + t - 1);
  const x = Math.min(W_R * Math.sin(t * Math.PI / 2), side(REAR, y)); return [s * x, y, warp(REAR, x, y)];
};
const fore = (s: number, t: number, y: number): P => {
  if (t > 1) return onSide(s, y, FRONT - t + 1);
  const x = Math.min(W_F * Math.sin(t * Math.PI / 2), side(FRONT, y)); return [s * x, y, warp(FRONT, x, y)];
};
const across = (x: number, reach: number) => Math.asin(Math.min(1, x / reach)) * 2 / Math.PI;
/** Body skin. k runs 0 to 1 across the top to the crown of the wing, 1 to 2 over the shoulder, 2 to 3 down the flank to `low`. */
function skin(s: number, z: number, k: number, low = paintLow(z)): P {
  const w = width(z), c = crownAt(z) * w;
  if (k <= 1) return onTop(s, c * k, z);
  if (k <= 2) { const a = (k - 1) * Math.PI / 2, n = 2 / shoulder(z), x = c + (w - c) * Math.sin(a) ** n, y = belt(z) + (crown(z) - belt(z)) * Math.cos(a) ** n; return [s * x, y, warp(z, x, y)]; }
  return onSide(s, lerp(belt(z), low, k - 2), z);
}
const ARCH = [SPEC.wheelRadius + .052, SPEC.rearWheelRadius + .052];
/** Lower edge of the painted flank: the paint's own, or the wheel opening. */
function lowEdge(z: number) {
  let low = paintLow(z);
  [AXLE, -AXLE].forEach((axle, i) => { const d = Math.abs(warp(z, width(z), WHEEL_Y[i] + .2) - axle); if (d < ARCH[i]) low = Math.max(low, WHEEL_Y[i] + Math.sqrt(ARCH[i] ** 2 - d * d)); });
  return low;
}
/** A surface moved `off` along its own normal, on the side `out` points to. */
const raised = (point: Surface, off: number, out: P): Surface => (u, v) => {
  const e = 2e-3, a = point(u, v), b = point(u + (u > .5 ? -e : e), v), c = point(u, v + (v > .5 ? -e : e));
  const n = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).cross(new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2])).normalize();
  if (n.x * out[0] + n.y * out[1] + n.z * out[2] < 0) n.negate();
  return [a[0] + n.x * off, a[1] + n.y * off, a[2] + n.z * off];
};
/** A point of a walked-round end (t, height) moved `off` out of its surface. Where the walk stands still (the panel
 * has reached the shoulder it ends on) the normal is taken square to the surface's rise alone. */
function proud(wrap: (t: number, y: number) => P, t: number, y: number, off: number, out: P): P {
  const a = wrap(t, y); if (!off) return a;
  const e = 4e-3, v = (p: P, q: P) => new THREE.Vector3(p[0] - q[0], p[1] - q[1], p[2] - q[2]), up = v(wrap(t, y + e), wrap(t, y - e)).normalize();
  let along = v(wrap(t + e, y), a); if (along.lengthSq() < 1e-12) along = v(a, wrap(t - e, y));
  const o = new THREE.Vector3(...out), n = along.lengthSq() < 1e-12 ? o.clone().addScaledVector(up, -o.dot(up)) : along.cross(up);
  n.normalize(); if (n.dot(o) < 0) n.negate();
  return [a[0] + n.x * off, a[1] + n.y * off, a[2] + n.z * off];
}

const steps = (n: Steps) => typeof n === 'number' ? Array.from({ length: n + 1 }, (_, i) => i / n) : n;
/** Samples from one value to another no further apart than `step`, with the given marks among them. */
const span = (from: number, to: number, step: number, ...marks: number[]) => {
  const n = Math.max(1, Math.ceil((to - from) / step)), list = Array.from({ length: n + 1 }, (_, i) => lerp(from, to, i / n));
  for (const m of marks) if (m > from + 1e-4 && m < to - 1e-4 && !list.some(x => Math.abs(x - m) < 1e-4)) list.push(m);
  return list.sort((a, b) => a - b);
};
/** A grid of points as one smooth-shaded piece. Columns and rows are counts (0 to 1) or the values themselves. */
function patch(parts: Parts, material: VehicleSurface, columns: Steps, rows: Steps, point: Surface, reverse = false) {
  const us = steps(columns), vs = steps(rows), nu = us.length, vertices: number[] = [], indices: number[] = [];
  for (const v of vs) for (const u of us) vertices.push(...point(u, v));
  for (let j = 0; j < vs.length - 1; j++) for (let i = 0; i < nu - 1; i++) {
    const a = j * nu + i, b = a + nu;
    if (reverse) indices.push(a, b, a + 1, a + 1, b, b + 1); else indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); g.setIndex(indices); g.computeVertexNormals();
  if (material === 'carbon') weave(g);
  parts.add(material, g);
}
/** Texture coordinates for the carbon weave: metres across the panel's own plane, at the scale of the shared twill texture. */
function weave(g: THREE.BufferGeometry) {
  const position = g.getAttribute('position'), normal = g.getAttribute('normal'), n = new THREE.Vector3(), uv = new Float32Array(position.count * 2);
  for (let i = 0; i < normal.count; i++) n.x += Math.abs(normal.getX(i)), n.y += Math.abs(normal.getY(i)), n.z += Math.abs(normal.getZ(i));
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i), [a, b] = n.y >= n.x && n.y >= n.z ? [x, z] : n.x >= n.z ? [z, y] : [x, y];
    uv[i * 2] = a / 1.15; uv[i * 2 + 1] = b / .12;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
/** A patch for a single-sided material, drawn from both sides. */
const lens = (parts: Parts, material: VehicleSurface, columns: Steps, rows: Steps, point: Surface) => { patch(parts, material, columns, rows, point); patch(parts, material, columns, rows, point, true); };
/** A panel laid on the upper skin between two plan curves x(z), `off` proud of it. */
const topPanel = (p: Parts, material: VehicleSurface, s: number, z0: number, z1: number, inner: (z: number) => number, outer: (z: number) => number, off = .004, columns = 8) =>
  patch(p, material, columns, Math.max(2, Math.ceil(Math.abs(z1 - z0) / .035)), raised((u, v) => { const z = lerp(z0, z1, v); return onTop(s, lerp(inner(z), outer(z), u), z); }, off, [0, 1, 0]), s > 0);
/** A panel laid on the flank between two heights y(z). */
const sidePanel = (p: Parts, material: VehicleSurface, s: number, z0: number, z1: number, low: (z: number) => number, high: (z: number) => number, off = .004, rows = 6) =>
  patch(p, material, Math.max(2, Math.ceil(Math.abs(z1 - z0) / .035)), rows, raised((u, v) => { const z = lerp(z0, z1, u); return onSide(s, lerp(low(z), high(z), v), z); }, off, [s, 0, 0]), s < 0);
/** A panel on the nose or tail between two heights y(x), `depth` behind the face. */
const endPanel = (p: Parts, material: VehicleSurface, sign: number, x0: number, x1: number, low: (x: number) => number, high: (x: number) => number, depth = 0, rows = 5) =>
  patch(p, material, Math.max(2, Math.ceil(Math.abs(x1 - x0) / .03)), rows, (u, v) => { const x = lerp(x0, x1, u), y = lerp(low(x), high(x), v), reach = side(sign > 0 ? FRONT : REAR, y); return onEnd(sign, Math.max(-reach, Math.min(reach, x)), y, depth); }, sign < 0);
/** A panel on a walked-round end between two heights that vary round it, `off` proud of it (a number or one that varies too). */
const wrapPanel = (p: Parts, material: VehicleSurface, wrap: (t: number, y: number) => P, ts: number[], rows: Steps, low: (t: number) => number, high: (t: number) => number, off: number | ((t: number) => number), out: P) =>
  patch(p, material, ts, rows, (t, v) => proud(wrap, t, lerp(low(t), high(t), v), typeof off === 'number' ? off : off(t), out));
/** A rhombic lattice of thin bars, as the mesh of an opening: across a panel between two heights, `depth` behind its face. */
function lattice(p: Parts, sign: number, x0: number, x1: number, low: number, high: number, depth: number, pitch = .04) {
  const lean = (high - low) * .75, n = Math.ceil((x1 - x0 + lean) / pitch);
  for (let k = 0; k <= n; k++) for (const d of [1, -1]) {
    let a = x0 - (d > 0 ? lean : 0) + k * pitch, b = a + d * lean, ya = low, yb = high;
    // Each bar is cut to the opening's sides.
    if (a < x0) { ya = lerp(low, high, (x0 - a) / (b - a)); a = x0; } if (b < x0) { yb = lerp(high, low, (x0 - b) / (a - b)); b = x0; }
    if (a > x1) { ya = lerp(low, high, (a - x1) / (a - b)); a = x1; } if (b > x1) { yb = lerp(high, low, (b - x1) / (b - a)); b = x1; }
    if (Math.abs(a - b) < 1e-4 && Math.abs(ya - yb) < 1e-4) continue;
    p.beam('rubber', onEnd(sign, a, ya, depth), onEnd(sign, b, yb, depth), .0035, 3);
  }
}
/** The second set of parts holds the details in colours of their own, filed under borrowed names. */
const GRAPHITE: VehicleSurface = 'trim', BLUE: VehicleSurface = 'amber', TIP: VehicleSurface = 'chrome', SATIN: VehicleSurface = 'plate';

// The glasshouse: its crown, the roof rail, and its base on the body.
const CABIN = [-1.80, 1.05], HEADER = .43, DECK = -.52;
const roof = heights([[-1.80, .886], [-1.6, .936], [-1.35, 1.0], [-.9, 1.088], [-.45, 1.172], [-.05, 1.222], [.2, 1.212], [HEADER, 1.150], [.7, 1.018], [.95, .894], [1.05, .846]]);
const baseWidth = curve([[-1.80, .62], [-1.3, .675], [-.8, .72], [-.3, .738], [.3, .735], [.8, .70], [1.05, .60]]);
const railWidth = curve([[-1.80, .46], [-1.0, .485], [-.5, .51], [0, .535], [HEADER, .53], [1.05, .53]]);
const railDrop = curve([[-1.80, .010], [-.9, .028], [0, .055], [HEADER, .05], [1.05, .012]]);
/** Canopy section: q runs 0 to 1 up the side glass to the rail, 1 to 2 round the rail, 2 to 3 across the roof to the centre line. */
function canopy(s: number, z: number, q: number): P {
  const wb = baseWidth(z), wr = Math.min(railWidth(z), wb - .02), yb = upper(z, wb) - .012, yc = roof(z), yr = Math.max(yb + .01, yc - railDrop(z));
  const a: [number, number] = [wb, yb], b: [number, number] = [wr + .03, yr], f = .2;
  const m1: [number, number] = [lerp(a[0], b[0], 1 - f), lerp(a[1], b[1], 1 - f)], m2: [number, number] = [b[0] * (1 - f * 1.4), yr + (yc - yr) * (1 - (1 - f * 1.4) ** 2)];
  let x: number, y: number;
  if (q <= 1) { x = lerp(a[0], m1[0], q) + .016 * Math.sin(q * Math.PI * .9); y = lerp(a[1], m1[1], q); }
  else if (q <= 2) { const t = q - 1; x = (1 - t) ** 2 * m1[0] + 2 * t * (1 - t) * b[0] + t * t * m2[0]; y = (1 - t) ** 2 * m1[1] + 2 * t * (1 - t) * (b[1] + .004) + t * t * m2[1]; }
  else { x = m2[0] * (3 - q); y = yr + (yc - yr) * (1 - (x / b[0]) ** 2); }
  return [s * x, y, z];
}
/** How far each walked-round end runs onto the flank as one piece with its panel. */
const WRAP = .16;

function shell(p: Parts, a: Parts) {
  for (const s of [-1, 1]) {
    // The top, with an opening under the glasshouse, then the shoulder, and the flank between the two ends that are
    // walked round their corners.
    patch(p, 'paint', 14, 160, (u, v) => {
      const z = lerp(REAR, FRONT, v), open = .9 * baseWidth(z) / (crownAt(z) * width(z)) * smooth(z, CABIN[0] - .02, CABIN[0] + .12) * (1 - smooth(z, CABIN[1] - .12, CABIN[1] + .02));
      return skin(s, z, lerp(Math.min(.97, open), 1, u));
    }, s > 0);
    patch(p, 'paint', 12, 160, (u, v) => skin(s, lerp(REAR, FRONT, v), 1 + u), s > 0);
    patch(p, 'paint', 12, 190, (u, v) => { const z = lerp(REAR + WRAP, FRONT - WRAP, v); return skin(s, z, 2 + u, lowEdge(z)); }, s > 0);
    // Wheel housings.
    [AXLE, -AXLE].forEach((axle, i) => {
      const rim = (angle: number): P => { const z = axle + Math.cos(angle) * ARCH[i], y = WHEEL_Y[i] + Math.sin(angle) * ARCH[i]; return [side(z, Math.max(y, paintLow(z))), y, z]; };
      patch(p, 'trim', 32, 3, (u, v) => { const [x, y, z] = rim(lerp(-.5, Math.PI + .5, u)); return [s * lerp(x - .002, Math.min(x - .30, .62), v), y, z]; }, s > 0);
    });
    // Sill: a blade under the door from the paint's edge, flaring out to a lip, and its return under the floor.
    const from = -AXLE + ARCH[1] - .02, to = AXLE - ARCH[0] + .02, flare = (z: number) => .014 + .03 * (1 - smooth(z, -.9, .2));
    patch(a, GRAPHITE, 44, 4, (u, v) => { const z = lerp(from, to, u), y0 = paintLow(z); return [s * Math.min(.972, side(z, y0) + flare(z) * v + .003), lerp(y0 + .004, H(.13), v), z]; });
    patch(a, GRAPHITE, 44, 1, (u, v) => { const z = lerp(from, to, u); return [s * lerp(Math.min(.972, side(z, paintLow(z)) + flare(z) + .003), .55, v), H(.13) - .01 * v, z]; });
    patch(a, SATIN, 44, 1, (u, v) => { const z = lerp(from + .01, to - .03, u), y0 = paintLow(z), fin = .11 * (1 - smooth(z, -.90, -.62)); return [s * Math.min(.976, side(z, y0) + flare(z) + .006), lerp(H(.128), H(.165) + fin, v), z]; });
  }
  // Nose and tail cavities, set back behind the faces that are laid over them.
  for (const sign of [-1, 1]) {
    const z = sign > 0 ? FRONT : REAR, crest = sign > 0 ? H(.40) : H(.60);
    patch(p, 'trim', 40, 14, (u, v) => { const t = 2 * u - 1, y = lerp(H(.13), Math.min(crest, upper(z, t * width(z)) - .004), v), x = t * Math.max(.3, side(z, y) - .008); return onEnd(sign, x, y, (sign > 0 ? .07 : .06) * (1 - Math.abs(t) ** 6)); }, sign < 0);
  }
  // Floor, between the wheels and under each end.
  p.box('trim', [1.36, .012, 4.1], [0, H(.125), 0]); p.box('trim', [1.84, .012, 1.72], [0, H(.127), 0]);
}

/** Height of the valance's lower edge across the tail, where the diffuser's ramp ends and its fins hang. */
const SKIRT = .265;
function tail(p: Parts, a: Parts) {
  const out = (s: number): P => [s * .6, .25, -.75], xn = (t: number) => W_R * Math.sin(Math.min(1, t) * Math.PI / 2), C_R = crownAt(REAR) * W_R;
  const T_IN = across(.31, W_R), LAMP_END = 1.44;
  // The lamp: its upper edge under the ledge, and its lower one, which leaves the upper edge at the pointed inner end,
  // runs level round the corner and climbs back to it along the flank.
  const lampTop = (t: number) => H(.748 + .004 * smooth(t, .3, 1) - .022 * smooth(t, 1.1, LAMP_END) ** 2);
  const lampLow = (t: number) => lampTop(t) - .012 - .104 * smooth(t, T_IN, across(.5, W_R)) * (1 - smooth(t, 1.04, LAMP_END) ** 1.3);
  // The ledge over it: from the lamp up to the deck's edge across the tail, a blade along the wing's crown beyond the corner.
  const ledgeTop = (t: number) => t > 1 ? Math.min(crown(REAR + t - 1), lampTop(t) + .05) : Math.min(upper(REAR, Math.min(xn(t), C_R)) + .002, lampTop(t) + .066);
  const ledgeLow = (t: number) => lerp(lampTop(t), ledgeTop(t), smooth(t, 1.1, 1.5));
  const ledgeOut = (t: number) => lerp(.020, .010, smooth(t, .9, 1.2)) * (1 - smooth(t, 1.38, 1.5));
  // Paint: under the deck's edge down to the plate's panel in the middle, to the mesh outlet under each lamp, and
  // to the valance at the corner, where it runs on as the flank.
  const capTop = (t: number) => t > 1 ? belt(REAR + t - 1) : upper(REAR, xn(t));
  const paintEdge = (t: number) => { if (t > 1) return lowEdge(REAR + t - 1); const x = xn(t); return H(x <= .33 ? .645 : x <= .42 ? lerp(.645, .56, (x - .33) / .09) : x <= .70 ? .56 : x <= .76 ? lerp(.56, .455, (x - .70) / .06) : .455); };
  // Valance: from the paint's edge and the outlets down to the diffuser, a wedge under the paint's diagonal behind the wheel.
  const valanceTop = (t: number) => t > 1 ? lowEdge(REAR + t - 1) : H(lerp(.446, .455, smooth(xn(t), .70, .76)));
  const valanceLow = (t: number) => H(t > 1 ? lerp(SKIRT, .135, Math.min(1, (t - 1) / .44)) : SKIRT);
  for (const s of [-1, 1]) {
    const wrap = (t: number, y: number) => aft(s, t, y), o = out(s);
    patch(p, 'paint', span(0, 1 + WRAP, .02, across(.33, W_R), across(.42, W_R), across(.70, W_R), across(.76, W_R), 1), 12, (t, v) => aft(s, t, lerp(capTop(t), paintEdge(t), v)), s > 0);
    wrapPanel(a, GRAPHITE, wrap, span(0, 1.445, .02, 1), 5, t => Math.min(valanceTop(t), valanceLow(t)), valanceTop, .001, o);
    // Lamp: a smoked lens with a blade of light along each edge, the lower one hooked up at its inner end.
    wrapPanel(p, 'glass', wrap, span(T_IN, LAMP_END, .02, 1), 4, lampLow, lampTop, .004, o);
    p.path('taillight', span(T_IN + .012, LAMP_END - .03, .02, 1).map(t => proud(wrap, t, lampTop(t) - .012, .009, o)), .0065);
    p.path('taillight', [proud(wrap, across(.435, W_R), lampTop(.3) - .04, .009, o), proud(wrap, across(.45, W_R), lampLow(across(.45, W_R)) + .03, .009, o), ...span(across(.47, W_R), LAMP_END - .12, .02, 1).map(t => proud(wrap, t, lampLow(t) + .012, .009, o))], .0065);
    // Ledge: its face, its top carrying the deck on, and its underside over the lamp.
    const ts = span(0, 1.5, .02, 1);
    patch(p, 'carbon', ts, 3, (t, v) => proud(wrap, t, lerp(ledgeLow(t), ledgeTop(t), v), ledgeOut(t), o));
    for (const edge of [ledgeTop, ledgeLow]) patch(p, 'carbon', ts, 1, (t, v) => proud(wrap, t, edge(t), ledgeOut(t) * v, o));
    // Mesh outlet under the lamp with the marker lamp at its top.
    lattice(p, -1, s > 0 ? .44 : -.70, s > 0 ? .70 : -.44, H(.462), H(.556), .045);
    lens(p, 'taillight', 6, 1, (u, v) => onEnd(-1, s * lerp(.43, .62, u), H(lerp(.538, .554, v)), .006));
    // Exhaust: a dark bore in the valance, with its tip among the details.
    const tip = warp(REAR, EXHAUST[0], H(EXHAUST[1]));
    const bore = new THREE.CylinderGeometry(.05, .05, .10, 24, 1, true); bore.rotateX(Math.PI / 2); bore.translate(s * EXHAUST[0], H(EXHAUST[1]), tip + .05); p.add('trim', bore);
    const back = new THREE.CircleGeometry(.05, 20); back.rotateY(Math.PI); back.translate(s * EXHAUST[0], H(EXHAUST[1]), tip + .09); p.add('rubber', back);
    const ring = new THREE.TorusGeometry(.054, .009, 8, 28); ring.translate(s * EXHAUST[0], H(EXHAUST[1]), tip - .004); a.add(TIP, ring);
    const sleeve = new THREE.CylinderGeometry(.052, .052, .06, 24, 1, true); sleeve.rotateX(Math.PI / 2); sleeve.translate(s * EXHAUST[0], H(EXHAUST[1]), tip + .026); a.add(TIP, sleeve);
    const surround = new THREE.TorusGeometry(.072, .012, 6, 28); surround.translate(s * EXHAUST[0], H(EXHAUST[1]), tip + .004); a.add(GRAPHITE, surround);
    // Shut line of the deck lid.
    p.path('trim', [...span(-1.74, REAR + .10, .06).map(z => raised((u, v) => onTop(s, u, v), .002, [0, 1, 0])(.60, z)), ...span(0, .60, .06).reverse().map(x => raised((u, v) => onTop(s, u, v), .002, [0, 1, 0])(x, REAR + .10))], .003);
  }
  // The plate's panel between the outlets.
  patch(p, 'carbon', 28, 4, (u, v) => { const x = lerp(-.42, .42, u), w = Math.abs(x), high = w <= .33 ? .645 : lerp(.645, .56, (w - .33) / .09), low = w <= .30 ? .47 : lerp(.47, .56, (w - .30) / .12); return onEnd(-1, x, H(lerp(low, high, v)), -.002); });
  // Diffuser: a ramp up from the floor to the valance's lower edge, and its fins.
  const ramp = (f: number) => H(lerp(.118, SKIRT, Math.max(0, Math.min(1, f)) ** 1.5)), rampFrom = -1.62;
  patch(a, GRAPHITE, 30, 5, (u, v) => { const x = lerp(-.70, .70, u), end = warp(REAR, x, H(SKIRT)); return [x, ramp(v), lerp(rampFrom, end, v)]; });
  for (const x of [-.62, -.47, -.31, -.12, .12, .31, .47, .62]) {
    const end = warp(REAR, x, H(SKIRT));
    patch(a, GRAPHITE, 12, 1, (u, v) => { const z = lerp(end + .50, end - .012, u); return [x, lerp(H(lerp(.095, .19, smooth(u, .72, 1))), ramp((z - rampFrom) / (end - rampFrom)) + .004, v), z]; });
  }
}

function nose(p: Parts, a: Parts) {
  const xn = (t: number) => W_F * Math.sin(Math.min(1, t) * Math.PI / 2), up: P = [0, 1, 0];
  // Paint: from the bonnet's edge down to the mouth, to the blade that parts the mouth from each corner inlet, and
  // at the corner itself down to the splitter, where it runs on as the flank.
  const mouthTop = (x: number) => H(.385 + .045 * (x / .80) ** 2);
  const capTop = (t: number) => t > 1 ? belt(FRONT - t + 1) : upper(FRONT, xn(t));
  const paintEdge = (t: number) => { if (t > 1) return lowEdge(FRONT - t + 1); const x = xn(t); return x <= .80 ? mouthTop(x) : x <= .84 ? lerp(mouthTop(.80), paintLow(FRONT), (x - .80) / .04) : paintLow(FRONT); };
  for (const s of [-1, 1]) {
    patch(p, 'paint', span(0, 1 + WRAP, .02, across(.80, W_F), across(.84, W_F), 1), 12, (t, v) => fore(s, t, lerp(capTop(t), paintEdge(t), v)), s < 0);
    // The blade from the foot of the mouth up to the corner, and the mesh of the inlet under it.
    patch(a, SATIN, 12, 2, (u, v) => onEnd(1, s * lerp(.36, .80, u), H(lerp(.168, .405, u) + (v - .5) * .062 * (1 - .3 * u)), .004));
    lattice(p, 1, s > 0 ? .50 : -.82, s > 0 ? .82 : -.50, H(.175), H(.34), .05);
    // Headlamp: a long drop on the wing pointing at the nose, bright inside, with a blade of light along its inner edge.
    const eye: Surface = (u, v) => { const z = lerp(1.74, 2.32, u), mid = lerp(.80, .70, u), half = .013 + .072 * Math.sin(Math.PI * Math.min(1, .08 + u * .95)) ** .55 * (1 - .45 * u); return onTop(s, Math.min(mid + (2 * v - 1) * half, width(z) * .985), z); };
    patch(p, 'trim', 16, 6, raised(eye, .004, up), s > 0);
    lens(p, 'chrome', 12, 3, raised((u, v) => eye(lerp(.10, .86, u), lerp(.24, .82, v)), .006, up));
    lens(p, 'headlight', 14, 1, raised((u, v) => eye(lerp(.04, .95, u), lerp(.03, .17, v)), .008, up));
    lens(p, 'headlight', 1, 4, raised((u, v) => eye(lerp(.03, .09, u), lerp(.10, .80, v)), .008, up));
    for (const u of [.36, .60]) { const c = raised(eye, .011, up)(u, .55), g = new THREE.SphereGeometry(.021, 10, 6); g.scale(1, .5, 1.25); g.translate(...c); p.add('headlight', g); }
    // Bonnet: a carbon panel between the wings with two louvred outlets, and the louvres over each front wheel.
    topPanel(p, 'carbon', s, 1.07, 2.16, () => 0, bonnet, .004, 10);
    topPanel(p, 'trim', s, 1.30, 1.88, () => .05, z => bonnet(z) - .09, .0065, 6);
    for (const z of [1.39, 1.57, 1.75]) patch(p, 'carbon', 8, 1, (u, v) => { const q = onTop(s, lerp(.055, bonnet(z) - .095, u), z + .10 * v); return [q[0], q[1] + .009 + .036 * v, q[2]]; }, s > 0);
    topPanel(p, 'carbon', s, 1.04, 1.44, () => .70, () => .845, .004, 4);
    for (const z of [1.12, 1.23, 1.34]) topPanel(p, 'trim', s, z, z + .06, () => .715, () => .83, .007, 3);
  }
  // Mouth: its mesh and the lip under it.
  lattice(p, 1, -.60, .60, H(.172), H(.385), .05);
  endPanel(a, SATIN, 1, -.82, .82, () => H(.148), () => H(.176), .012, 1);
  // Splitter: a carbon blade under the whole nose, following its plan.
  const outline = (t: number, y: number): [number, number] => {
    const w = Math.abs(t), s = Math.sign(t) || 1, reach = side(FRONT, y);
    if (w <= .6) { const x = s * reach * w / .6; return [x, warp(FRONT, x, y)]; }
    const z = lerp(FRONT, 1.76, (w - .6) / .4), x = side(z, y); return [s * x, warp(z, x, y)];
  };
  const lip = (t: number, out: number, h: number): P => {
    const [x, z] = outline(t, H(.40)), [x0, z0] = outline(t - .004, H(.40)), [x1, z1] = outline(t + .004, H(.40)), length = Math.hypot(x1 - x0, z1 - z0);
    return [x + (z0 - z1) / length * out, H(h), z + (x1 - x0) / length * out];
  };
  const reach = (t: number) => SPLITTER * (1 - .5 * smooth(Math.abs(t), .72, 1));
  patch(p, 'carbon', 72, 3, (u, v) => lip(2 * u - 1, lerp(-.03, reach(2 * u - 1), v), lerp(.150, .128, v)), true);
  patch(p, 'carbon', 72, 1, (u, v) => lip(2 * u - 1, reach(2 * u - 1), lerp(.128, .108, v)), true);
  patch(p, 'carbon', 72, 2, (u, v) => lip(2 * u - 1, lerp(reach(2 * u - 1), -.22, v), .108), true);
  patch(p, 'trim', 72, 2, (u, v) => lip(2 * u - 1, -.012, lerp(.15, .245, v)), true);
  // Oval badge on the nose, and the Trident standing in the mouth.
  const badge = new THREE.SphereGeometry(1, 12, 6); badge.scale(.028, .019, .006); badge.translate(...onEnd(1, 0, H(.432), -.004)); p.add('chrome', badge);
  const grille = trident(.15); grille.translate(0, H(.278), warp(FRONT, 0, H(.278)) - .035); a.add(BLUE, grille);
  p.beam('trim', [0, H(.185), warp(FRONT, 0, H(.2)) - .04], [0, H(.215), warp(FRONT, 0, H(.2)) - .04], .008, 4);
}

function glasshouse(p: Parts) {
  const [rear, front] = CABIN;
  for (const s of [-1, 1]) {
    const band = (material: VehicleSurface, z0: number | ((q: number) => number), z1: number | ((q: number) => number), q0: number, q1: number, columns = 8, rows = 0) => {
      const from = typeof z0 === 'number' ? () => z0 : z0, to = typeof z1 === 'number' ? () => z1 : z1;
      patch(p, material, columns, rows || Math.max(2, Math.ceil((to(0) - from(0)) / .04)), (u, v) => { const q = lerp(q0, q1, u); return canopy(s, lerp(from(q), to(q), v), q); }, s < 0);
    };
    // Screen, carbon roof and engine screen across the top; pillars, rails and buttresses round the corner.
    band('cabinGlass', HEADER, front, 2, 3); band('carbon', DECK, HEADER, 2, 3); band('glass', rear, DECK, 2, 3);
    band('trim', HEADER, front, 1, 2, 5); band('carbon', DECK, HEADER, 1, 2, 5); band('paint', rear, DECK, 1, 2, 5);
    // Side: the painted pillar behind the door, the small fixed light, the door glass and the foot of the screen pillar.
    const light = (q: number) => -.56 + .14 * q, glassEnd = (q: number) => -.32 + .04 * q, pillar = (q: number) => .86 + .10 * q;
    band('paint', rear, light, 0, 1, 6); band('glass', light, glassEnd, 0, 1, 6, 5); band('cabinGlass', glassEnd, pillar, 0, 1, 6); band('trim', pillar, front, 0, 1, 6, 4);
    p.path('trim', Array.from({ length: 9 }, (_, i) => canopy(s, glassEnd(i / 8), i / 8)), .010);
    p.path('trim', Array.from({ length: 9 }, (_, i) => canopy(s, light(i / 8), i / 8)), .006);
    // The Trident on the pillar, and on the right the round flap of the filler behind it.
    const at = canopy(s, -.80, .55), sign = trident(.082); sign.rotateY(s * Math.PI / 2); sign.translate(at[0] + s * .008, at[1], at[2]); p.add('trim', sign);
    if (s < 0) p.path('trim', Array.from({ length: 25 }, (_, i) => { const angle = i / 24 * Math.PI * 2, q = canopy(s, -1.06 + .075 * Math.cos(angle), .45 + .38 * Math.sin(angle)); return [q[0] + s * .003, q[1], q[2]] as P; }), .0028);
    // Engine screen: its frame, the openings cut in it, and the stack of slats on the buttress beside it.
    p.path('carbon', Array.from({ length: 30 }, (_, i) => { const q = canopy(s, lerp(rear + .02, DECK, i / 29), 2.02); return [q[0], q[1] + .006, q[2]] as P; }), .012);
    const slot = (z0: number, z1: number, u0: number, u1: number) => patch(p, 'trim', 4, 1, (u, v) => { const q = canopy(s, lerp(z0, z1, v), 3 - lerp(u0, u1, u)); return [q[0], q[1] + .004, q[2]]; }, s < 0);
    slot(-.84, -.775, .14, .36); slot(-.865, -.80, .50, .70); slot(-1.02, -.945, 0, .24); slot(-1.045, -.97, .36, .66); slot(-1.22, -1.135, .06, .56); slot(-1.62, -1.50, 0, .64);
    for (let k = 0; k < 5; k++) { const z = -.88 - k * .15; patch(p, 'trim', 3, 1, (u, v) => { const q = canopy(s, z - .09 * v, lerp(1.30, 1.92, u)); return [q[0] + s * .004, q[1] + .005 + .012 * (1 - v), q[2]]; }, s < 0); }
    // The glasshouse is closed at both ends down to the skin under it.
    for (const z of [rear, front]) patch(p, 'trim', 12, 1, (u, v) => { const q = canopy(s, z, 3 * u), base = onTop(s, Math.abs(q[0]), z); return [q[0], lerp(q[1], base[1] - .01, v), z]; }, s < 0);
    // Mirror on a blade from the door.
    const foot = canopy(s, .80, .12); p.beam('trim', foot, [s * .955, foot[1] + .075, .74], .014);
    const cap = new THREE.SphereGeometry(1, 14, 10); cap.scale(.085, .05, .06); cap.translate(s * 1.0, foot[1] + .088, .735); p.add('carbon', cap);
    const glass = new THREE.CircleGeometry(1, 14); glass.scale(.07, .04, 1); glass.rotateY(Math.PI); glass.translate(s * 1.0, foot[1] + .088, .692); p.add('chrome', glass);
  }
  p.box('trim', [.5, .012, .03], [0, roof(HEADER) - .004, HEADER + .01]);
  // Third brake lamp in the opening at the foot of the engine screen.
  lens(p, 'taillight', 8, 1, (u, v) => { const q = canopy(1, -1.56 - .02 * v, 3 - Math.abs(lerp(-.5, .5, u))); return [Math.sign(lerp(-.5, .5, u)) * q[0], q[1] + .007, q[2]]; });
}

/** The intake on each haunch behind the door: a scoop standing on the wing's shoulder with its mouth forward. */
function pods(p: Parts) {
  for (const s of [-1, 1]) {
    const z0 = -.58, z1 = -1.22, centre = (f: number) => lerp(.755, .765, f), half = (f: number) => lerp(.125, .09, f), rise = (f: number) => .14 * (1 - smooth(f, 0, 1)) ** 1.2;
    const pod = (u: number, f: number, scale = 1): P => { const z = lerp(z0, z1, f), x = centre(f) + (2 * u - 1) * half(f) * scale; return [s * x, upper(z, x) + rise(f) * scale * Math.sin(Math.PI * u) ** lerp(.7, 2, smooth(f, 0, .5)), z]; };
    patch(p, 'paint', 14, 22, (u, v) => pod(u, v), s < 0);
    patch(p, 'trim', 14, 2, (u, v) => { const q = pod(u, .02, .9), base = pod(u, .02, 0); return [q[0], lerp(base[1], q[1], v), z0 - .014]; }, s < 0);
    p.path('carbon', Array.from({ length: 15 }, (_, i) => { const q = pod(i / 14, 0); return [q[0], q[1] + .003, z0 + .004] as P; }), .009);
    for (const u of [.3, .5, .7]) p.beam('rubber', [s * (centre(0) + (2 * u - 1) * half(0) * .9), upper(z0, centre(0)) + .002, z0 - .008], [s * (centre(0) + (2 * u - 1) * half(0) * .9), pod(u, .02, .9)[1], z0 - .008], .0035, 3);
  }
}

/** What is cut into and laid on each flank. */
function sides(p: Parts) {
  for (const s of [-1, 1]) {
    const line = (points: Row[], radius = .0018) => p.path('trim', points.map(([z, y]) => raised((u, v) => onSide(s, v, u), .002, [s, 0, 0])(z, y)), radius);
    // The outlet behind the front wheel and the channel ahead of the rear one, where the door's hollow runs out.
    sidePanel(p, 'trim', s, .895, .947, z => paintLow(z) + .012, () => H(.60), .003, 6);
    patch(p, 'trim', 3, 8, raised((u, v) => { const z = lerp(-.938, lerp(-.868, -.93, v ** 1.6), u); return onSide(s, lerp(paintLow(z) + .012, H(.66), v), z); }, .003, [s, 0, 0]), s < 0);
    // Door: its shut lines, the strip that carries the car's name, and the handle.
    line(span(H(.31), belt(.80) - .004, .05).map(y => [.80, y] as Row));
    line([[-.40, belt(-.40) - .004], [-.43, H(.60)], [-.50, H(.47)], [-.58, H(.36)], [-.61, paintLow(-.61) + .004]]);
    sidePanel(p, 'trim', s, .30, .79, () => H(.572), () => H(.588), .003, 1);
    sidePanel(p, 'trim', s, -.36, -.20, () => H(.696), () => H(.724), .003, 1);
  }
}

function cockpit(p: Parts) {
  // A dark tub under the glass with two shell seats, the dashboard and the wheel.
  p.box('trim', [1.36, .02, 1.75], [0, H(.30), .20]); p.box('trim', [1.40, .62, .04], [0, H(.62), -.50]);
  for (const s of [-1, 1]) p.box('trim', [.04, .5, 1.6], [s * .70, H(.56), .25]);
  p.box('trim', [1.30, .16, .30], [0, H(.705), .74], [-.25, 0, 0]);
  p.box('carbon', [.30, .30, .9], [0, H(.46), .20]);
  for (const x of [-.37, .37]) {
    const seat = new THREE.SphereGeometry(1, 12, 8); seat.scale(.21, .09, .25); seat.translate(x, H(.42), .12); p.add('carbon', seat);
    const back = new THREE.SphereGeometry(1, 12, 8); back.scale(.215, .34, .075); back.rotateX(-.28); back.translate(x, H(.74), -.25); p.add('carbon', back);
    const head = new THREE.SphereGeometry(1, 10, 6); head.scale(.12, .09, .05); head.translate(x, H(1.04), -.33); p.add('carbon', head);
  }
  const wheel = new THREE.TorusGeometry(.165, .015, 6, 24); wheel.rotateX(-.35); wheel.translate(-.37, H(.80), .56); p.add('rubber', wheel);
  p.beam('trim', [-.37, H(.80), .56], [-.37, H(.76), .72], .03);
}

/** A fixed carbon wing with turned-down end plates, hung from two swan-neck pylons: flat plates with lightening
 * holes that stand on the deck, pass ahead of the leading edge and hook over onto the upper surface. */
function wing(p: Parts) {
  const span = .86, pylon = .40, crest = H(1.03), tail = REAR + .012;
  // Section of the plane: [chord fraction, height under the crest], closed, cambered, a Gurney lip at the trailing edge.
  const section: Row[] = [[0, -.014], [.04, -.004], [.18, 0], [.45, -.001], [.75, -.004], [.97, .004], [1, .016], [1, -.006], [.8, -.018], [.5, -.024], [.2, -.024], [.04, -.020]];
  const chord = (x: number) => .285 - .05 * (Math.abs(x) / span) ** 1.5, trail = (x: number) => tail + .03 * Math.max(0, 1 - Math.abs(x) / .07), lead = (x: number) => trail(x) + chord(x);
  const rise = (x: number) => .014 * (x / span) ** 2 - .045 * smooth(Math.abs(x), span - .07, span) ** 1.5;
  const columns = 64, vertices: number[] = [], indices: number[] = [], n = section.length;
  for (let i = 0; i <= columns; i++) { const x = lerp(-span, span, i / columns); for (const [c, h] of section) vertices.push(x, crest + rise(x) + h, lead(x) - c * chord(x)); }
  for (let i = 0; i < columns; i++) for (let j = 0; j < n; j++) { const a = i * n + j, b = i * n + (j + 1) % n; indices.push(a, a + n, b, b, a + n, b + n); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); g.setIndex(indices); g.computeVertexNormals(); weave(g); p.add('carbon', g);
  for (const s of [-1, 1]) {
    // End plate: shapes are drawn in the car's side view (z, y) and stood across it.
    const stand = (shape: THREE.Shape, depth: number, x: number) => { const solid = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 }); solid.rotateY(-Math.PI / 2); solid.translate(x + depth / 2, 0, 0); return solid; };
    const z0 = lead(span), zt = trail(span), yt = crest + rise(span), plate = new THREE.Shape();
    plate.moveTo(z0 + .03, yt + .012); plate.quadraticCurveTo((z0 + zt) / 2, yt + .045, zt, yt + .03); plate.lineTo(zt, yt - .07);
    plate.quadraticCurveTo(zt + .01, yt - .145, z0 - .13, yt - .15); plate.quadraticCurveTo(z0 + .03, yt - .145, z0 + .045, yt - .05); plate.closePath();
    p.add('carbon', stand(plate, .012, s * (span + .004)));
    // Pylon.
    const le = lead(pylon), top = crest + rise(pylon), deck = upper(le + .09, pylon), neck = new THREE.Shape();
    neck.moveTo(le + .17, deck - .01); neck.lineTo(le + .02, deck - .01); neck.lineTo(le + .035, top - .05); neck.quadraticCurveTo(le + .05, top - .005, le + .02, top + .012);
    neck.lineTo(le - .10, top + .008); neck.lineTo(le - .10, top + .030); neck.lineTo(le + .03, top + .045); neck.lineTo(le + .085, top); neck.closePath();
    const hole = (points: Row[]) => { const path = new THREE.Path(); path.moveTo(...points[0]); for (const q of points.slice(1)) path.lineTo(...q); path.closePath(); neck.holes.push(path); };
    hole([[le + .14, deck + .025], [le + .05, deck + .025], [le + .05, deck + .085]]); hole([[le + .125, deck + .06], [le + .06, deck + .12], [le + .095, deck + .125]]);
    p.add('trim', stand(neck, .014, s * pylon)); p.box('trim', [.05, .012, .17], [s * pylon, deck + .002, le + .095]);
  }
}

/** The whole body by surface, and the details that have colours of their own. */
export function createGt2StradaleParts() {
  const p = geometryParts(), a = geometryParts();
  shell(p, a); nose(p, a); tail(p, a); glasshouse(p); pods(p); sides(p); cockpit(p); wing(p);
  const details = a.finish();
  return { body: p.finish(), accents: { graphite: details.get(GRAPHITE)!, blue: details.get(BLUE)!, tips: details.get(TIP)!, satin: details.get(SATIN)! } };
}

/** Forged 20-inch centre-lock wheel: nine slim spokes in a shallow dish, a carbon-ceramic disc behind them. The nut is
 * filed under 'amber', which the car draws in the accent blue. */
export function createGt2StradaleWheelGeometry(side: number, front: boolean) {
  const p = geometryParts(), radius = front ? SPEC.wheelRadius : SPEC.rearWheelRadius, width = front ? .245 : .305, half = width / 2, rim = .254, face = half - .012, hub = half - (front ? .05 : .075);
  const radial = (x: number, r: number, a: number): P => [side * x, Math.cos(a) * r, Math.sin(a) * r];
  const ring = (surface: VehicleSurface, r: number, tube: number, x: number, sides = 5) => { const g = new THREE.TorusGeometry(r, tube, sides, 56); g.rotateY(Math.PI / 2); g.translate(side * x, 0, 0); p.add(surface, g); };
  const disc = (surface: VehicleSurface, r: number, depth: number, x: number, segments = 40) => { const g = new THREE.CylinderGeometry(r, r, depth, segments); g.rotateZ(Math.PI / 2); g.translate(side * x, 0, 0); p.add(surface, g); };
  // Low-profile tyre with square shoulders and two grooves.
  const profile: Row[] = [[rim + .004, -half * .9], [rim + .028, -half], [radius - .03, -half * .985], [radius - .008, -half * .88], [radius, -half * .72], [radius, -half * .30], [radius - .004, -half * .27], [radius, -half * .24], [radius, half * .24], [radius - .004, half * .27], [radius, half * .30], [radius, half * .72], [radius - .008, half * .88], [radius - .03, half * .985], [rim + .028, half], [rim + .004, half * .9]];
  const tyre = new THREE.LatheGeometry(profile.map(([r, x]) => new THREE.Vector2(r, x)), 56); tyre.rotateZ(Math.PI / 2); p.add('rubber', tyre);
  const barrel = new THREE.CylinderGeometry(rim - .004, rim - .014, width * .86, 56, 1, true); barrel.rotateZ(Math.PI / 2); p.add('trim', barrel);
  ring('trim', rim, .007, half - .006); ring('trim', rim - .012, .004, half - .014, 4); ring('trim', rim - .004, .005, -half * .86, 4);
  // Carbon-ceramic disc and its bell.
  const rotor = front ? .195 : .180; disc('carbon', rotor, .034, half - .105); disc('trim', .085, .05, half - .10, 24);
  for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2, r = rotor * (.62 + .1 * (i % 3)); const g = new THREE.CircleGeometry(.0045, 5); g.rotateY(side * Math.PI / 2); g.translate(...radial(half - .0875, r, a)); p.add('rubber', g); }
  // Spokes: closed tapered blades from the hub out to the rim, sunk toward the centre.
  const stations = 8, across: Row[] = [[-1, -.012], [-.7, .004], [.7, .004], [1, -.012], [.6, -.02], [-.6, -.02]], n = across.length;
  for (let spoke = 0; spoke < 9; spoke++) {
    const base = spoke / 9 * Math.PI * 2, positions: number[] = [], indices: number[] = [];
    for (let i = 0; i <= stations; i++) {
      const t = i / stations, r = lerp(.052, rim - .006, t), x = lerp(hub, face, t ** .7), wide = lerp(.017, .0105, t) + .012 * t ** 6;
      for (const [w, d] of across) positions.push(side * (x + d), Math.cos(base) * r - Math.sin(base) * w * wide, Math.sin(base) * r + Math.cos(base) * w * wide);
    }
    for (let i = 0; i < stations; i++) for (let j = 0; j < n; j++) { const a = i * n + j, b = i * n + (j + 1) % n, c = a + n, d = b + n; if (side > 0) indices.push(a, c, b, b, c, d); else indices.push(a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setIndex(indices); g.computeVertexNormals(); p.add('trim', g);
  }
  // Hub and centre-lock nut.
  disc('trim', .062, .03, hub - .004, 24);
  const nut = new THREE.CylinderGeometry(.034, .04, .03, 6); nut.rotateZ(side * -Math.PI / 2); nut.translate(side * (hub + .022), 0, 0); p.add('amber', nut);
  return p.finish();
}

/** Fixed brake caliper, carried by the upright while the wheel turns inside it: an arc of housing over the disc's edge. */
export function createGt2StradaleCaliperGeometry(side: number, front: boolean) {
  const half = (front ? .245 : .305) / 2, outer = front ? .212 : .196, inner = outer - .068, sweep = front ? 1.1 : .85, shape = new THREE.Shape(), centre = front ? Math.PI : 0;
  shape.absarc(0, 0, outer, centre - sweep / 2, centre + sweep / 2, false); shape.absarc(0, 0, inner, centre + sweep / 2, centre - sweep / 2, true); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: .058, bevelEnabled: true, bevelSize: .004, bevelThickness: .004, bevelSegments: 1, curveSegments: 10 });
  // The shape lies in the wheel's plane (x forward, y up); stand it across the axle.
  g.rotateY(-Math.PI / 2); g.translate(side * (half - .098) + .029, 0, 0); return g;
}

/** A Trident: three tines on a shaft, drawn flat in the XY plane, `size` tall. */
function trident(size: number) {
  const parts: THREE.BufferGeometry[] = [], bar = (x0: number, y0: number, x1: number, y1: number, w: number) => {
    const g = new THREE.BoxGeometry(w * size, Math.hypot(x1 - x0, y1 - y0) * size, .004); g.rotateZ(-Math.atan2(x1 - x0, y1 - y0)); g.translate((x0 + x1) / 2 * size, (y0 + y1) / 2 * size, 0); parts.push(g);
  };
  bar(0, -.5, 0, .5, .07); bar(-.2, -.5, .2, -.5, .05); bar(-.17, -.12, .17, -.12, .05);
  for (const s of [-1, 1]) { bar(s * .13, -.12, s * .27, .05, .06); bar(s * .27, .05, s * .30, .34, .055); bar(s * .30, .34, s * .22, .46, .045); bar(s * .30, .30, s * .40, .20, .04); }
  bar(-.07, .40, 0, .52, .04); bar(.07, .40, 0, .52, .04);
  const merged = mergeGeometries(parts, false)!; parts.forEach(g => g.dispose()); return merged;
}
/** Giallo Genio, Maserati's yellow with a blue mica in it, and the other colours of the car; where the road lies under
 * it; and where the plates and the rear script sit. */
export const GT2_STRADALE = {
  ground: GROUND,
  paint: 0xf4c400, sheen: 0x8fd0ff, wheel: 0x1c1d20, caliper: 0x1f4fd0, blue: 0x2a55d8, graphite: 0x2a2c2f, satin: 0x8d9094, tips: 0x6f6253,
  plates: { front: onEnd(1, -.31, H(.272), -.03), rear: onEnd(-1, 0, H(.57), -.006), wordmark: onEnd(-1, 0, H(.735), -.004) },
};
