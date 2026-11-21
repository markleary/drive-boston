import * as THREE from 'three';
import type { Point2 } from '../../types';
import { archWindow, band, chimney, clock, column, course, door, frame, gable, hip, inset, lathe, oculus, outward, parapet, pyramid, railing, rectPoly, rectWalls, rectWindow, Shapes, shopfront, signBoard, spread, stairs, wallFrame, wallFrames, type Frame, type SiteKit, type SiteModel, type V3, type WallFrame } from '../site-kit.ts';

type Mat = THREE.Material;
/** A timber on a wall face: from (sa, ya) to (sb, yb) in the wall's own plane, t wide and d proud. */
function timberBar(S: Shapes, m: Mat, f: WallFrame, sa: number, ya: number, sb: number, yb: number, t = .16, d = .07) {
  const [x, z] = f.at((sa + sb) / 2, d / 2); S.box(m, Math.hypot(sb - sa, yb - ya), t, d, x, (ya + yb) / 2, z, f.yaw, 0, Math.atan2(yb - ya, sb - sa));
}
/** Half-timbering over s0..s1 of a wall between y0 and y1: plates top and bottom, studs about `step` apart, rails at the
 * given fractions of the height and, with `brace`, a raking brace in each end panel. */
function timbering(S: Shapes, m: Mat, f: WallFrame, s0: number, s1: number, y0: number, y1: number, o: { step?: number; rails?: number[]; brace?: boolean; t?: number } = {}) {
  const t = o.t ?? .16, n = Math.max(1, Math.round((s1 - s0) / (o.step ?? 1.15))), w = (s1 - s0) / n, h = y1 - y0;
  for (let i = 0; i <= n; i++) timberBar(S, m, f, s0 + i * w, y0, s0 + i * w, y1, t);
  for (const r of [0, ...(o.rails ?? []), 1]) timberBar(S, m, f, s0 - t / 2, y0 + h * r, s1 + t / 2, y0 + h * r, r === 0 || r === 1 ? t * 1.25 : t);
  if (o.brace && n > 1) { timberBar(S, m, f, s0, y0, s0 + w, y0 + h * (o.rails?.[0] ?? 1), t); timberBar(S, m, f, s1, y0, s1 - w, y0 + h * (o.rails?.[0] ?? 1), t); }
}
/** The timbers of a gable end over s0..s1 standing on y: studs up to the rakes, a collar rail and the bargeboards, which hang `over` proud. */
function gableTimbers(S: Shapes, m: Mat, f: WallFrame, s0: number, s1: number, y: number, rise: number, over = .32, step = .95) {
  const mid = (s0 + s1) / 2, half = (s1 - s0) / 2, top = (s: number) => rise * (1 - Math.abs(s - mid) / half);
  for (let s = mid; s < s1 - .3; s += step) for (const q of s === mid ? [s] : [s, 2 * mid - s]) timberBar(S, m, f, q, y, q, y + top(q) - .05);
  const c = .46, cw = half * (1 - c); timberBar(S, m, f, mid - cw, y + rise * c, mid + cw, y + rise * c);
  for (const side of [-1, 1]) { const [ax, az] = f.at(mid + side * (half + over), over), [bx, bz] = f.at(mid, over); S.beam(m, [ax, y - rise * over / half + .06, az], [bx, y + rise + .06, bz], .1, .3); }
}
/** A cross gable of a pitched range: a bay standing `proj` proud of the wall from `floor` up to the eave, under its own
 * roof running back `depth` into the main roof, half-timbered, with a bank of casements and an attic light. */
function crossGable(S: Shapes, k: SiteKit, f: Frame, u0: number, u1: number, proj: number, depth: number, floor: number, eave: number, rise: number, m: { wall: Mat; timber: Mat; roof: Mat }, o: { lights?: number; attic?: boolean } = {}) {
  const bay = { u0, u1, v0: -proj, v1: .4 }, w = u1 - u0, front = rectWalls(f, bay).front;
  S.prism(m.wall, rectPoly(f, bay), floor, eave, { top: null, bottom: m.timber });
  gable(S, f, { u0, u1, v0: -proj, v1: depth }, eave, rise, m.roof, { axis: 'v', wall: m.wall, overhang: .35 });
  timbering(S, m.timber, front, 0, w, floor, eave, { step: 1.2, rails: [.3], brace: true }); gableTimbers(S, m.timber, front, 0, w, eave, rise);
  const lights = o.lights ?? 4, ww = lights * .62;
  rectWindow(S, k, front, w / 2, floor + (eave - floor) * .3 + .1, ww, (eave - floor) * .7 - .35, { frame: m.timber, sill: m.timber, panes: [lights, 2] });
  if (o.attic !== false && rise > 3) rectWindow(S, k, front, w / 2, eave + rise * .14, 1.1, rise * .3, { frame: m.timber, sill: m.timber, panes: [2, 2] });
  for (const s of [.12, w / 2, w - .12]) { const [x, z] = front.at(s, -proj / 2); S.box(m.timber, .18, .3, proj, x, floor - .15, z, front.yaw); }
}
/** A small gabled dormer on a slope of a range whose eave line is v = 0: its face stands `back` up the slope. */
function dormer(S: Shapes, k: SiteKit, f: Frame, u: number, back: number, depth: number, w: number, sill: number, m: { wall: Mat; timber: Mat; roof: Mat }, o: { glass?: Mat; h?: number } = {}) {
  const r = { u0: u - w / 2, u1: u + w / 2, v0: back, v1: back + .6 }, front = rectWalls(f, r).front, h = o.h ?? 1.15;
  S.prism(m.wall, rectPoly(f, { ...r, v1: depth }), sill - .6, sill + h, { top: null, solid: false });
  gable(S, f, { ...r, v1: depth }, sill + h, w * .42, m.roof, { axis: 'v', wall: m.wall, overhang: .22, solid: false });
  rectWindow(S, k, front, w / 2, sill, w - .5, h - .1, { frame: m.timber, sill: m.timber, panes: [2, 2], glass: o.glass });
  for (const side of [-1, 1]) { const [ax, az] = front.at(w / 2 + side * (w / 2 + .2), .2), [bx, bz] = front.at(w / 2, .2); S.beam(m.timber, [ax, sill + h - .1, az], [bx, sill + h + w * .42 + .06, bz], .08, .2); }
}
/** Walls round a plan between two heights, each in the material `pick` gives its edge. */
function walls(S: Shapes, plan: Point2[], y0: number, y1: number, pick: (i: number) => Mat) {
  for (let i = 0; i < plan.length; i++) S.wall(pick(i), plan[i], plan[(i + 1) % plan.length], y0, y1, y1, outward(plan, i));
}

/** How far along a wall a plan point lies. */
const along = (w: WallFrame, p: Point2) => (p[0] - w.a[0]) * w.t[0] + (p[1] - w.a[1]) * w.t[1];
/** A round tower under a bellcast cone: shaft from y0 to `top`, a water table at `floor`, a corbelled eaves ring, and
 * narrow lights given as [bearing, sill above the floor, height]. */
function roundTower(S: Shapes, k: SiteKit, x: number, z: number, r: number, y0: number, floor: number, top: number, cone: number, m: { wall: Mat; trim: Mat; roof: Mat }, lights: [number, number, number][]) {
  S.drum(m.wall, x, z, r, r, y0, top, 20, { top: null });
  for (const [h, t, out] of [[.15, .3, .1], [(top - floor) * .52, .22, .08]]) S.drum(m.trim, x, z, r + out, r + out, floor + h - t / 2, floor + h + t / 2, 20, { solid: false, top: null });
  S.drum(m.trim, x, z, r + .05, r + .34, top - .95, top - .5, 20, { solid: false, top: null }); S.drum(m.trim, x, z, r + .34, r + .34, top - .5, top, 20, { solid: false, top: null });
  for (let i = 0; i < 20; i++) { const a = (i + .5) / 20 * Math.PI * 2; S.box(m.trim, .2, .4, .3, x + Math.sin(a) * (r + .12), top - 1.15, z + Math.cos(a) * (r + .12), a); }
  S.drum(m.roof, x, z, r + .62, r * .78, top, top + cone * .16, 20, { top: null }); S.drum(m.roof, x, z, r * .78, 0, top + cone * .16, top + cone, 20);
  S.rod(k.iron, [x, top + cone - .2, z], [x, top + cone + 1.3, z], .05, .02); S.place(k.copperPlain, new THREE.SphereGeometry(.16, 8, 6), x, top + cone + .1, z);
  for (const [a, sill, h] of lights) { const n: Point2 = [Math.sin(a), Math.cos(a)], t: Point2 = [n[1], -n[0]], c: Point2 = [x + n[0] * r, z + n[1] * r]; rectWindow(S, k, wallFrame([c[0] - t[0], c[1] - t[1]], [c[0] + t[0], c[1] + t[1]], n), 1, floor + sill, .75, h, { frame: k.sash, sill: m.trim, head: m.trim, panes: [1, 3] }); }
}

/** The S. S. Pierce Building at Coolidge Corner (Winslow and Wetherell, 1898-99): a Tudor Revival block on the acute
 * corner of Beacon and Harvard streets, shops under a tall half-timbered upper floor and steep slate roofs with cross
 * gables, and the polygonal clock tower over the rounded street corner, in the lower form it was rebuilt to in 1945.
 * The mapped outline also takes in the 1913 block that carries the Beacon Street front on to the west (Page and
 * Frothingham), drawn lower and plainer. The outline, the 7.4 m radius of the corner and the party wall are the
 * package's; storey heights, the number of gables, the tower's stages and all colours are interpretive. */
const pierce: SiteModel = {
  id: 's-s-pierce-building', name: 'S. S. Pierce Building', place: 'coolidge-corner', tile: '-4_0', building: 'osm-way-29823727',
  note: 'Winslow and Wetherell, 1898-99, Tudor Revival; mapped outline with its rounded street corner, octagonal clock tower in its 1945 form, 1913 block to the west; storey heights, gable count, tower stages and colours interpretive',
  build({ k, ground }, b) {
    const S = new Shapes(), base = b!.baseElevation ?? 0, foot = base - 1.5, y = (h: number) => base + h;
    // B: u east along the Beacon Street front from the south-west corner, v north into the block. H: u north-west along the Harvard Street front from the corner, v into the block.
    const B = frame([-3935.58, 923.39], [-3858.47, 896.3], [-3945.44, 895.33]), H = frame([-3857.08, 882.92], [-3887.83, 860.07], [-3884.2, 890.17]);
    const stucco = k.tint('stucco', '#d8cdb2'), timber = k.tint('timber', '#3b2a1f'), stone = k.tint('buffBrick', '#b39a76'), trim = k.tint('cream', '#c8bca0'), roof = k.tint('redSlate', '#6d4a42'), shop = k.tint('blackPaint', '#27302c'), brick = k.tint('brick', '#8f5645');
    const tudor = { wall: stucco, timber, roof }, shopH = 4.5, eave = 8.9, rise = 6, X = 44.23, at = (p: Point2) => Math.min(base + 1, Math.max(base - 1.2, ground(p[0], p[1])));
    /** Shopfronts in n bays between piers along a street front. */
    const shops = (f: WallFrame, s0: number, s1: number, n: number, top: number) => {
      const w = (s1 - s0) / n;
      for (let i = 0; i < n; i++) { const g = at(f.at(s0 + (i + .5) * w, .4)) + .04; shopfront(S, k, f, s0 + i * w + .45, s0 + (i + 1) * w - .45, g, top - g - .25, { frame: shop, bay: 2.2, door: i % 2 ? s0 + (i + .5) * w : undefined }); }
      for (let i = 0; i <= n; i++) { const [x, z] = f.at(s0 + i * w, .1); S.box(trim, .9, top - foot, .24, x, (top + foot) / 2, z, f.yaw); const [cx, cz] = f.at(s0 + i * w, .14); S.box(trim, 1.1, .3, .34, cx, top - .5, cz, f.yaw); }
    };
    // ---- the Pierce block: Beacon front, the rounded corner, Harvard front, the back with its small annex.
    const C = B.W(81.67, 7.44), R = 7.44, arc = Array.from({ length: 7 }, (_, i) => { const a = (-90 + 129.1 * i / 6) * Math.PI / 180; return B.W(81.67 + Math.cos(a) * R, 7.44 + Math.sin(a) * R); });
    const plan: Point2[] = [B.W(X, 0), ...arc, [-3887.83, 860.07], [-3891.25, 864.34], [-3895.74, 861.35], [-3900.65, 868.18], [-3896.8, 871.18], [-3901.08, 876.73], [-3884.2, 890.17], B.W(X, 14.32)], wf = wallFrames(plan), street = (i: number) => i < 8;
    walls(S, plan, foot, y(shopH), i => street(i) ? stone : brick); walls(S, plan, y(shopH), y(eave), i => street(i) ? stucco : brick); S.cap(k.deck, plan, y(eave));
    const beacon = wf[0], harvard = wf[7];
    for (const f of wf.slice(0, 8)) { band(S, trim, f, 0, f.length, y(shopH), .32, .16); band(S, timber, f, 0, f.length, y(shopH + .3), .22, .1); }
    shops(beacon, 0, beacon.length, 7, y(shopH - .16)); shops(harvard, 0, harvard.length, 7, y(shopH - .16));
    // The two roof ranges, each one room deep behind its street front, running into the tower.
    gable(S, B, { u0: X, u1: 81.5, v0: 0, v1: 14.32 }, y(eave), rise, roof, { wall: stucco, overhang: .4, trim: timber });
    gable(S, H, { u0: -.5, u1: 38.5, v0: 0, v1: 13.4 }, y(eave), rise * 13.4 / 14.32, roof, { wall: stucco, overhang: .4, trim: timber });
    { const g = rectWalls(H, { u0: -.5, u1: 38.5, v0: 0, v1: 13.4 }).right; gableTimbers(S, timber, g, 0, 13.4, y(eave), rise * 13.4 / 14.32, .4, 1.2); timbering(S, timber, g, 0, 13.4, y(shopH + .3), y(eave), { step: 1.3, rails: [.4] }); }
    // Beacon Street: three cross gables with casement banks between them.
    for (const s of [5.5, 16, 26.5]) crossGable(S, k, B, X + s - 3.8, X + s + 3.8, .45, 7.16, y(shopH + .3), y(eave), 4.5, tudor);
    for (const [s, w] of [[10.75, 2], [21.25, 2], [33.7, 4.6]]) { timbering(S, timber, beacon, s - w / 2 - .7, s + w / 2 + .7, y(shopH + .3), y(eave), { step: w > 3 ? 1.2 : 3.4, rails: [.3] }); rectWindow(S, k, beacon, s, y(shopH + 1.8), w, 2.1, { frame: timber, sill: timber, panes: [w > 3 ? 6 : 3, 2] }); }
    for (const s of [10.75, 21.25]) dormer(S, k, B, X + s, 1.6, 6, 1.9, y(eave + 1.9), tudor);
    // Harvard Street: three more, and a plainer end bay toward the passage.
    for (const s of [8.5, 19.5, 30.5]) crossGable(S, k, H, s - 3.8, s + 3.8, .45, 6.7, y(shopH + .3), y(eave), 4.5, tudor);
    for (const [s, w] of [[2.6, 2.6], [14, 2], [25, 2], [36.2, 2.6]]) { timbering(S, timber, harvard, s - w / 2 - .6, s + w / 2 + .6, y(shopH + .3), y(eave), { step: 3.4, rails: [.3] }); rectWindow(S, k, harvard, s, y(shopH + 1.8), w, 2.1, { frame: timber, sill: timber, panes: [w > 2.2 ? 4 : 3, 2] }); }
    for (const s of [14, 25]) dormer(S, k, H, s, 1.6, 6, 1.9, y(eave + 1.9), tudor);
    chimney(S, brick, ...B.W(X + 12, 9.6), y(eave + 3), y(eave + rise + 1.6), 1.5, .9, B.yaw, trim); chimney(S, brick, ...H.W(24, 9), y(eave + 3), y(eave + rise + 1.4), 1.5, .9, H.yaw, trim);
    // ---- the rounded corner: shop windows and the corner door below, casements in the timbered upper floor, a skirt of slate up to the tower.
    for (let i = 1; i <= 6; i++) {
      const f = wf[i], g = at(f.at(f.length / 2, .4)) + .04;
      if (i === 3 || i === 4) { door(S, k, f, f.length / 2, g, 1.7, 2.5, { leaf: k.tint('door', '#3a2a1e'), frame: trim, glazed: true }); rectWindow(S, k, f, f.length / 2, g + 2.85, 1.7, .8, { frame: shop, sill: null, panes: [3, 1], glass: k.shopGlass }); }
      else shopfront(S, k, f, .35, f.length - .35, g, y(shopH - .4) - g, { frame: shop, bay: 1.2 });
      for (const s of [0, f.length]) { const [x, z] = f.at(s, .06); S.box(trim, .5, y(shopH) - foot, .3, x, (y(shopH) + foot) / 2, z, f.yaw); }
      timbering(S, timber, f, 0, f.length, y(shopH + .3), y(eave), { step: .95, rails: [.3] }); rectWindow(S, k, f, f.length / 2, y(shopH + 1.75), 1.75, 2.1, { frame: timber, sill: timber, panes: [3, 2] });
    }
    S.drum(roof, C[0], C[1], R + .45, 4.5, y(eave), y(eave + 2.3), 20, { top: null });
    for (let i = 1; i <= 6; i++) band(S, timber, wf[i], -.1, wf[i].length + .1, y(eave - .1), .24, .3);
    // ---- the clock tower: an octagon of stucco and timber, a clock on every other face, a bellcast slate roof.
    const TR = 4.8, bis = (-90 + 39.1) / 2 * Math.PI / 180, toward: Point2 = [B.U[0] * Math.cos(bis) + B.V[0] * Math.sin(bis), B.U[1] * Math.cos(bis) + B.V[1] * Math.sin(bis)], turn = Math.atan2(toward[0], toward[1]) - Math.PI / 8;
    const oct = (r: number): Point2[] => Array.from({ length: 8 }, (_, i) => [C[0] + Math.sin(i * Math.PI / 4 + turn) * r, C[1] + Math.cos(i * Math.PI / 4 + turn) * r]);
    const tower = S.prism(stucco, oct(TR), y(eave), y(18.4), { top: k.deck }), tw = tower[0].length;
    tower.forEach((f, i) => {
      timbering(S, timber, f, 0, tw, y(eave + 2), y(14.6), { step: .9, rails: [.34] }); timbering(S, timber, f, 0, tw, y(14.6), y(18.4), { step: i % 2 ? .9 : tw, rails: i % 2 ? [.5] : [] });
      if (i < 3 || i > 5) rectWindow(S, k, f, tw / 2, y(eave + 3.3), 1.7, 1.7, { frame: timber, sill: timber, panes: [3, 2] });
      if (i % 2 === 0) clock(S, k, f, tw / 2, y(16.5), 1.4, timber);
      for (const s of [.1, tw / 2, tw - .1]) { const [x, z] = f.at(s, .25); S.box(timber, .2, .45, .5, x, y(18.15), z, f.yaw); }
    });
    S.drum(timber, C[0], C[1], TR + .5, TR + .5, y(18.4), y(18.6), 8, { turn, solid: false, top: null });
    S.drum(roof, C[0], C[1], TR + .7, 3.5, y(18.6), y(20), 8, { turn, top: null }); S.drum(roof, C[0], C[1], 3.5, 0, y(20), y(26.2), 8, { turn });
    S.rod(k.iron, [C[0], y(26), C[1]], [C[0], y(28), C[1]], .07, .03); S.place(k.gold, new THREE.SphereGeometry(.22, 10, 8), C[0], y(26.6), C[1]); S.box(k.gold, 1.1, .06, .04, C[0], y(27.6), C[1], B.yaw); S.box(k.gold, .3, .3, .04, C[0] - B.U[0] * .5, y(27.6), C[1] - B.U[1] * .5, B.yaw);
    // ---- the 1913 block: brick shops under a lower half-timbered floor, five small gables on Beacon Street, flat roofs behind.
    const west: Point2[] = [B.W(0, 0), B.W(X, 0), B.W(X, 19.63), B.W(12.93, 19.63), B.W(12.93, 29.75), B.W(0, 29.75)], ww = wallFrames(west), eaveW = 8, front = ww[0];
    walls(S, west, foot, y(shopH), () => brick); walls(S, west, y(shopH), y(eaveW), i => i === 0 ? stucco : brick); S.cap(k.deck, west, y(eaveW));
    band(S, trim, front, 0, X, y(shopH), .32, .16); band(S, timber, front, 0, X, y(shopH + .3), .22, .1); shops(front, 0, X, 8, y(shopH - .16));
    gable(S, B, { u0: 0, u1: X, v0: 0, v1: 11 }, y(eaveW), 4.6, roof, { wall: brick, overhang: .4, trim: timber });
    const centres = spread(1.2, X - 1.2, 5);
    for (const u of centres) crossGable(S, k, B, u - 2.9, u + 2.9, .35, 5.5, y(shopH + .3), y(eaveW), 3.3, tudor, { lights: 3, attic: false });
    for (let i = 0; i + 1 < centres.length; i++) { const s = (centres[i] + centres[i + 1]) / 2; timbering(S, timber, front, s - 1.35, s + 1.35, y(shopH + .3), y(eaveW), { step: 2.7, rails: [.3] }); rectWindow(S, k, front, s, y(shopH + 1.5), 1.5, 1.7, { frame: timber, sill: timber, panes: [2, 2] }); }
    chimney(S, brick, ...B.W(22, 8), y(eaveW + 2), y(eaveW + 6), 1.3, .8, B.yaw, trim);
    return S;
  },
};

/** The Anderson carriage house, now the Larz Anderson Auto Museum (Edmund M. Wheelwright, 1888-89, after the Chateau
 * de Chaumont): buff brick with stone trim under a massive hipped slate roof with many dormers, round towers with
 * conical roofs at its corners and gabled carriage entrances. It stands on a slope: the north side is at the level
 * of the main hall, the south side a storey lower, where the later garage level opens. The outline (39.7 by 21 m with
 * a wing at the south-east) is the package's; the tower count and sizes, the pavilions, the window rhythm and all
 * heights are interpretive. */
const museum: SiteModel = {
  id: 'larz-anderson-auto-museum', name: 'Larz Anderson Auto Museum', place: 'larz-anderson-park', tile: '-5_4', building: 'osm-way-29887963',
  note: 'Edmund M. Wheelwright, 1888-89, after Chaumont: buff brick, stone trim, hipped slate roof, round corner towers with conical roofs; mapped outline, towers, pavilions, windows and heights interpretive',
  build({ k, ground }, b) {
    const S = new Shapes(), base = b!.baseElevation ?? 0, foot = base - 5, y = (h: number) => base + h;
    // u east-south-east along the north wall from the north-west corner, v down the slope to the south wall.
    const f = frame([-4935.29, 4404.06], [-4900.4, 4422.99], [-4945.3, 4422.5]), L = 39.7, D = 21, WU = 25.09, WV = 27.41, eave = 8, rise = 8.5, over = .45, pitch = rise / (D / 2 + over);
    const brick = k.tint('buffBrick', '#bba37c'), trim = k.tint('cream', '#d3c9ae'), slate = k.slate, wood = k.tint('door', '#4a3626'), dark = k.tint('door', '#2b1f17'), m = { wall: brick, trim, roof: slate }, dm = { wall: brick, timber: trim, roof: slate };
    const plan: Point2[] = [f.W(0, 0), f.W(L, 0), f.W(L, WV), f.W(WU, WV), f.W(WU, D), f.W(0, D)], [north, east, wingSouth, wingWest, south, west] = wallFrames(plan), at = (p: Point2) => Math.max(foot + 1, Math.min(base, ground(p[0], p[1])));
    S.prism(brick, plan, foot, y(eave), { top: null });
    for (const [h, t, out] of [[.15, .34, .12], [4.3, .26, .1], [eave - .2, .4, .24]]) course(S, trim, plan, y(h), t, out);
    hip(S, f, { u0: 0, u1: L, v0: 0, v1: D }, y(eave), rise, slate, { overhang: over }); hip(S, f, { u0: WU, u1: L, v0: D - 8, v1: WV }, y(eave), 6.2, slate, { overhang: over });
    const light = (w: WallFrame, p: Point2, sill: number, ww = 1.2, hh = 2) => rectWindow(S, k, w, along(w, p), y(sill), ww, hh, { frame: k.sash, sill: trim, head: trim, panes: [2, 3] });
    for (const u of [5.6, 8.9, 12.2, L - 12.2, L - 8.9, L - 5.6]) { light(north, f.W(u, 0), 1.2); light(north, f.W(u, 0), 5.2, 1.1, 1.6); }
    for (const u of [5.9, 18.9, 21.8]) { light(south, f.W(u, D), 1.2); light(south, f.W(u, D), 5.2, 1.1, 1.6); light(south, f.W(u, D), -2.1, 1.2, 1.4); }
    for (const v of [5.2, 8.6, 12, 15.4]) { light(west, f.W(0, v), 1.2); light(west, f.W(0, v), 5.2, 1.1, 1.6); }
    for (const v of [5, 8.6, 12.2, 15.8, 19.4, 22.8]) { light(east, f.W(L, v), 1.2); light(east, f.W(L, v), 5.2, 1.1, 1.6); }
    for (const u of [29.2, 34.4]) { light(wingSouth, f.W(u, WV), 1.2); light(wingSouth, f.W(u, WV), 5.2, 1.1, 1.6); }
    light(wingWest, f.W(WU, 23.3), 1.2); light(wingWest, f.W(WU, 23.3), 5.2, 1.1, 1.6);
    // The garage level opens under the wing: a wide arched door at the foot of the slope.
    { const p = f.W(31.8, WV), g = at(wingSouth.at(along(wingSouth, p), 1)) + .05; archWindow(S, k, wingSouth, along(wingSouth, p), g, 3.2, 1.7, { glass: wood, frame: dark, head: trim, sill: null, panes: [2, 2] }); }
    // Gabled carriage pavilions in the middle of the north front and of the south front west of the wing.
    const pavilion = (fr: Frame, u0: number, u1: number, lower: boolean) => {
      const r = { u0, u1, v0: -1, v1: .4 }, front = rectWalls(fr, r).front, w = u1 - u0, pr = 5.4, g = lower ? at(front.at(w / 2, 1)) + .05 : y(.05);
      S.prism(brick, rectPoly(fr, r), foot, y(eave), { top: null }); gable(S, fr, { u0, u1, v0: -1, v1: 9 }, y(eave), pr, slate, { axis: 'v', wall: brick, overhang: .12 });
      for (const side of [-1, 1]) { const [ax, az] = front.at(w / 2 + side * (w / 2 + .15), .12), [bx, bz] = front.at(w / 2, .12); S.beam(trim, [ax, y(eave) + .1, az], [bx, y(eave) + pr + .12, bz], .5, .28); const [kx, kz] = front.at(w / 2 + side * (w / 2 - .1), .1); S.box(trim, .7, .5, .5, kx, y(eave) + .05, kz, front.yaw); }
      const [px, pz] = front.at(w / 2, -.1); S.box(trim, .5, 1.1, .5, px, y(eave) + pr + .6, pz, front.yaw); S.place(trim, new THREE.SphereGeometry(.26, 8, 6), px, y(eave) + pr + 1.3, pz);
      for (const [h, t] of [[.15, .34], [4.3, .26], [eave - .2, .4]]) band(S, trim, front, 0, w, y(h), t, .14);
      archWindow(S, k, front, w / 2, g, 3.6, 2.5, { glass: wood, frame: dark, head: trim, sill: null, panes: [2, 3] });
      for (const s of [w / 2 - 2.6, w / 2 + 2.6]) { const [x, z] = front.at(s, .12); S.box(trim, .5, 4.6, .24, x, g + 2.3, z, front.yaw); }
      for (const s of [w / 2 - 1.5, w / 2, w / 2 + 1.5]) rectWindow(S, k, front, s, y(5.1), 1.1, 1.9, { frame: k.sash, sill: trim, head: trim, panes: [2, 3] });
      if (lower) for (const s of [w / 2 - 2.4, w / 2 + 2.4]) rectWindow(S, k, front, s, y(1.2), 1.1, 2, { frame: k.sash, sill: trim, head: trim, panes: [2, 3] });
      oculus(S, k, front, w / 2, y(eave + 1.9), .75, { frame: trim });
    };
    const fS = frame(f.W(L, D), f.W(0, D), f.W(L, 0)), fW = frame(f.W(0, D), f.W(0, 0), f.W(5, 10)), fE = frame(f.W(L, 0), f.W(L, D), f.W(L - 5, 10));
    pavilion(f, L / 2 - 4.5, L / 2 + 4.5, false); pavilion(fS, L - 12.55 - 4.2, L - 12.55 + 4.2, true);
    // Dormers: hoist doors over the hayloft on the north and west, lights elsewhere, and a second row higher up the roof.
    const depth = (top: number) => top / pitch - over + .3, wallDormer = (fr: Frame, u: number, hoist: boolean) => dormer(S, k, fr, u, -.04, depth(3.5), 2.3, y(eave + .25), dm, { h: 2.2, glass: hoist ? wood : undefined }), roofDormer = (fr: Frame, u: number) => dormer(S, k, fr, u, 4.6, depth(6.3), 1.6, y(eave + 4.35), dm, { h: 1.1 });
    for (const u of [7.2, 10.6, L - 10.6, L - 7.2]) wallDormer(f, u, true); for (const u of [8.9, L / 2 - 6.2, L / 2 + 6.2, L - 8.9]) roofDormer(f, u);
    for (const u of [L - 5.9, L - 20.3]) wallDormer(fS, u, false); for (const u of [L - 3.6, L - 20.3]) roofDormer(fS, u);
    for (const u of [6.9, 14.1]) wallDormer(fW, u, true); for (const u of [6.8, 13.9, 21]) wallDormer(fE, u, false);
    for (const [u, v] of [[9.5, 7], [L - 9.5, 7], [9.5, D - 7], [L - 9.5, D - 7]]) chimney(S, brick, ...f.W(u, v), y(eave + 4), y(eave + rise + 1.5), 1.9, 1.1, f.yaw, trim);
    // Round towers at the corners, the largest at the south-west, and a turret in the angle of the wing.
    const out = (u: number, v: number) => { const c = f.W(u, v), o = f.W(L / 2, D / 2); return Math.atan2(c[0] - o[0], c[1] - o[1]); };
    for (const [u, v, r, top, cone] of [[0, 0, 3.1, 10.2, 7], [L, 0, 3.1, 10.2, 7], [0, D, 3.7, 11.6, 8.4], [L, WV, 3.1, 10.2, 7], [WU, WV, 1.7, 9.4, 4.4]]) {
      const [x, z] = f.W(u, v), a = out(u, v), small = r < 2;
      roundTower(S, k, x, z, r, foot, y(0), y(top), cone, m, small ? [[a, 5.6, 1.4]] : [[a, 1.6, 1.7], [a - .9, 5.3, 1.5], [a + .9, 5.3, 1.5], [a, top - 3, 1.2], [a - 1.5, 1.6, 1.7], [a + 1.5, 1.6, 1.7]]);
    }
    return S;
  },
};

/** The Coolidge Corner Theatre, 290 Harvard Street: the 1906 Beacon Universalist Church made over in 1933 as an Art
 * Deco cinema. A street front of cream brick in vertical bands with a patterned top over the shops, the neon marquee
 * of about 2002 with its sunburst crown, the auditorium behind and the 2024 addition toward the car park at the back.
 * The outline is the package's; where the theatre's bay stands in the frontage, its height, the form of the marquee
 * and of its upright sign are interpretive. */
const theatre: SiteModel = {
  id: 'coolidge-corner-theatre', name: 'Coolidge Corner Theatre', place: 'coolidge-corner', tile: '-4_0', building: 'osm-way-29681045',
  note: 'Church of 1906 (C. Howard Walker) converted 1933 to an Art Deco cinema; cream brick banded front, neon sunburst marquee (Mark Favermann, about 2002), auditorium, 2024 rear addition; position of the bay, marquee and upright sign interpretive',
  build({ k, ground }, b) {
    const S = new Shapes(), base = b!.baseElevation ?? 0, foot = base - 1.5, y = (h: number) => base + h;
    // u north-west along the Harvard Street front, v back into the block.
    const T = frame([-3894.23, 853.7], [-3922.97, 832.74], [-3942.05, 858.69]), W = 35.57, D = 32.3, c = 17.8, shopH = 5.2, hall = 12.4;
    const cream = k.tint('whiteBrick', '#e1d7b9'), tan = k.tint('cream', '#c9b48c'), pale = k.tint('cream', '#ece4cd'), common = k.tint('buffBrick', '#baa684'), black = k.tint('blackPaint', '#1d1f22'), teal = k.tint('bluePaint', '#1f4a55'), red = k.tint('neon', '#ff4a36'), yellow = k.tint('bulb', '#ffd45a'), blue = k.tint('neon', '#6fd0ff');
    const shops = { u0: 0, u1: W, v0: 0, v1: 7 }, bay = { u0: c - 7.5, u1: c + 7.5, v0: -.15, v1: 7 }, house = { u0: 2.2, u1: W - 2.2, v0: 7, v1: D }, rear = { u0: 4.9, u1: 37, v0: D, v1: 45.5 };
    S.prism(cream, rectPoly(T, shops), foot, y(shopH), { top: k.deck }); S.prism(common, rectPoly(T, house), foot, y(hall), { top: k.deck }); parapet(S, common, rectPoly(T, house), y(hall), .6, .3, pale);
    // The old church's side walls: brick piers between the bays, a band under the parapet.
    { const hw = rectWalls(T, house), pier = k.tint('cream', '#a8946f'); for (const w of [hw.left, hw.right]) { for (const s of spread(-2.5, w.length + 2.5, 6)) { const [x, z] = w.at(s, .08); S.box(pier, .7, hall + 1.4, .18, x, y(hall / 2 - .7), z, w.yaw); } band(S, pier, w, 0, w.length, y(hall - .5), .5, .12); } }
    const front = rectWalls(T, shops).front, g = Math.min(base + .6, Math.max(base - .8, ground(...front.at(c, 1)))) + .04;
    for (const [s0, s1] of [[.5, c - 8], [c + 8, W - .5]]) { shopfront(S, k, front, s0, s1, g, y(shopH - .7) - g, { frame: black, bay: 2.4, door: (s0 + s1) / 2 }); }
    band(S, pale, front, 0, W, y(shopH - .2), .4, .14);
    // The theatre's bay: stepped up to the middle, brick piers between recessed bands, a chevron frieze under the coping.
    const face = S.prism(cream, rectPoly(T, bay), foot, y(11.2), { top: k.deck })[0], mid = { u0: c - 3.7, u1: c + 3.7, v0: -.3, v1: 5 }, crown = S.prism(cream, rectPoly(T, mid), y(shopH), y(13), { top: k.deck })[0];
    for (const s of spread(.2, 14.8, 10)) { const edge = Math.abs(s - 7.5) > 3.9, top = edge ? 11.2 : 13, fr = edge ? face : crown, ss = edge ? s : s - 3.8; if (!edge && Math.abs(s - 7.5) > 3.6) continue;
      const [x, z] = fr.at(ss, .09); S.box(tan, .5, top - shopH + .5, .18, x, y((top + shopH + .5) / 2), z, fr.yaw); const [tx, tz] = fr.at(ss, .12); S.box(pale, .62, .3, .26, tx, y(top + .65), tz, fr.yaw); }
    for (const [fr, w, top] of [[face, 15, 11.2], [crown, 7.4, 13]] as [WallFrame, number, number][]) {
      band(S, pale, fr, 0, w, y(top + .1), .24, .16); band(S, tan, fr, 0, w, y(top - 1.25), .1, .08);
      for (let s = .35; s < w - .5; s += .7) for (const side of [-1, 1]) timberBar(S, tan, fr, s + (side > 0 ? 0 : .35), y(top - (side > 0 ? 1.1 : .35)), s + .35 + (side > 0 ? 0 : .35), y(top - (side > 0 ? .35 : 1.1)), .09, .06);
    }
    for (const s of [2.1, 12.9]) rectWindow(S, k, face, s, y(6.8), 1, 3, { frame: black, sill: pale, head: pale, panes: [2, 5] });
    // Entrance under the marquee: glazed doors between poster cases.
    for (const s of [7.5 - 1.9, 7.5 + 1.9]) door(S, k, face, s, g, 1.8, 2.4, { glazed: true, leaf: black, frame: black });
    for (const s of [7.5 - 4.6, 7.5 + 4.6]) { const [x, z] = face.at(s, .06); S.box(black, 1.5, 2.1, .12, x, g + 1.75, z, face.yaw); const [px, pz] = face.at(s, .13); S.place(k.tint('lamp', '#efe6cf'), new THREE.PlaneGeometry(1.3, 1.9), px, g + 1.75, pz, face.yaw); }
    // The marquee: a wedge over the sidewalk with a reader board on each face under the name in neon.
    const my0 = g + 3.5, my1 = my0 + 1.5, wedge: Point2[] = [front.at(c - 5, 0), front.at(c + 5, 0), front.at(c + .7, 3.9), front.at(c - .7, 3.9)], mf = S.prism(black, wedge, my0, my1, { top: black, bottom: pale, solid: false });
    for (const i of [1, 3]) { const fr = mf[i]; signBoard(S, k, fr, fr.length / 2, (my0 + my1) / 2 - .1, fr.length - .9, 1.05, ' ', { background: '#f3eedd', color: '#f3eedd', lit: true, out: .08, frame: teal });
      for (const h of [-.35, 0, .35]) timberBar(S, black, fr, .55, (my0 + my1) / 2 - .1 + h + .17, fr.length - .55, (my0 + my1) / 2 - .1 + h + .17, .025, .11);
      signBoard(S, k, fr, fr.length / 2, my1 + .55, 4.4, .95, 'COOLIDGE', { color: '#ff5540', background: '#15171a', lit: true, out: .1, font: '700 118px Futura, "Century Gothic", Arial, sans-serif' });
      timberBar(S, yellow, fr, .2, my0 + .06, fr.length - .2, my0 + .06, .07, .1); timberBar(S, blue, fr, .2, my1 - .06, fr.length - .2, my1 - .06, .07, .1); }
    for (let i = 0; i < 5; i++) for (const side of [-1, 1]) { const [x, z] = front.at(c + side * (.9 + i * .8), .6 + (4 - i) * .7 * .9); S.box(yellow, .12, .06, .12, x, my0 - .03, z, front.yaw); }
    // The upright sign: a fin over the nose of the marquee, the name reading down both sides, under a sunburst crown.
    const P = (out: number, h: number): V3 => { const [x, z] = front.at(c, out); return [x, h, z]; }, fy0 = my1, fy1 = y(14.4), fo = 2.1, [fx, , fz] = P(fo, 0), side: Point2 = front.t;
    S.box(teal, .5, fy1 - fy0, 1.5, fx, (fy0 + fy1) / 2, fz, front.yaw);
    const lh = (fy1 - fy0 - 1.5) / 8; 'COOLIDGE'.split('').forEach((ch, i) => { const h = fy1 - .2 - (i + .5) * lh; for (const q of [-1, 1]) S.place(k.sign(ch, { color: '#ff5540', background: '#1f4a55', aspect: 1, lit: true, font: '700 132px Futura, "Century Gothic", Arial, sans-serif' }), new THREE.PlaneGeometry(1, lh - .06), fx + side[0] * q * .26, h, fz + side[1] * q * .26, front.yaw + q * Math.PI / 2); });
    for (const o of [fo - .78, fo + .78]) S.beam(yellow, P(o, fy0 + .1), P(o, fy1), .06, .06);
    for (let i = 0; i < 11; i++) { const a = (i - 5) * .29, len = i % 2 ? 2.3 : 3.3, n = front.n, p0 = P(fo, fy1 + .1), tip: V3 = [p0[0] + n[0] * Math.sin(a) * len, p0[1] + Math.cos(a) * len, p0[2] + n[1] * Math.sin(a) * len]; S.beam(i % 2 ? red : yellow, p0, tip, .09, .09); }
    S.place(yellow, new THREE.SphereGeometry(.34, 10, 8), ...P(fo, fy1 + .1));
    // The 2024 addition at the back: cream brick drawn in folds like a curtain over a glazed ground floor, a glazed top floor.
    const back = S.prism(cream, rectPoly(T, rear), foot, y(12.8), { top: k.deck })[2], bw = back.length, bg = Math.min(base + .6, Math.max(base - .8, ground(...back.at(bw / 2, 1)))) + .04;
    shopfront(S, k, back, 1, bw - 1, bg, 3.6, { frame: k.steel, bay: 2.6, door: bw / 2 });
    for (let s = .6; s < bw - .3; s += 1.2) { const [x, z] = back.at(s, .1); S.box(pale, .62, 4.4, .2, x, bg + 6.2, z, back.yaw); }
    { const [x, z] = back.at(bw / 2, .05); S.place(k.curtainWall, new THREE.PlaneGeometry(bw - 1.2, 3), x, y(10.9), z, back.yaw); for (const s of spread(.6, bw - .6, 13)) { const [mx, mz] = back.at(s + (bw - 1.2) / 26, .08); S.box(k.steel, .07, 3, .07, mx, y(10.9), mz, back.yaw); } const [cx, cz] = back.at(bw / 2, .9); S.box(k.steel, 8, .16, 1.8, cx, bg + 3.75, cz, back.yaw); }
    return S;
  },
};

/** Brookline Fire Station No. 1, 140 Washington Street (Freeman, Funk and Wilcox, 1908): three storeys of red brick
 * with white sandstone quoins, lintels and door surrounds, three engine doors on Washington Street, balconies at the
 * second-floor windows, a copper cornice under a brick parapet, and the square hose tower on the east side with a
 * clock on each face, a balcony, an arcaded top stage and bracketed eaves. The body is the mapped 19.4 by 21.9 m;
 * the tower's place and size in the east part of the outline, its roof, and the window rhythm are interpretive. */
const station: SiteModel = {
  id: 'brookline-fire-station-1', name: 'Brookline Fire Station No. 1', place: 'brookline-village', tile: '-4_2', building: 'osm-way-29919121',
  note: 'Freeman, Funk and Wilcox, 1908: red brick, white sandstone trim, copper cornice, three engine doors, hose tower with four clocks, balcony and arcaded top; tower position and size, its roof and the window rhythm interpretive',
  build({ k, ground }, b) {
    const S = new Shapes(), base = b!.baseElevation ?? 0, foot = base - 1.5, y = (h: number) => base + h;
    // u east along the Washington Street front from the north-west corner, v south.
    const f = frame([-3515.22, 2087.33], [-3495.79, 2086.9], [-3514.74, 2109.24]), W = 19.43, D = 21.9, top = 12.2;
    const brick = k.tint('brick', '#8e4b3c'), trim = k.tint('cream', '#e3ded0'), plinth = k.tint('cream', '#a5a299'), copper = k.copperPlain, panel = k.tint('redDoor', '#5e1a15');
    const at = (p: Point2) => Math.min(base + .3, Math.max(base - 1, ground(p[0], p[1]))) + .03;
    const quoins = (r: { u0: number; u1: number; v0: number; v1: number }, y0: number, y1: number) => { for (const [u, su] of [[r.u0, 1], [r.u1, -1]]) for (const [v, sv] of [[r.v0, 1], [r.v1, -1]]) for (let i = 0, h = y0; h < y1 - .3; i++, h += .72) { const sz = i % 2 ? .62 : .95, [x, z] = f.W(u + su * (sz / 2 - .07), v + sv * (sz / 2 - .07)); S.box(trim, sz, .36, sz, x, y(h), z, f.yaw); } };
    const light = (w: WallFrame, s: number, sill: number, ww: number, hh: number) => { rectWindow(S, k, w, s, y(sill), ww, hh, { frame: k.whiteSash, sill: trim, head: trim, panes: [2, 2] }); const [x, z] = w.at(s, .09); S.box(trim, .3, .42, .14, x, y(sill) + hh + .2, z, w.yaw); };
    /** An engine door: panelled red leaves with a row of lights, in a sandstone surround with a keystone. */
    const engineDoor = (w: WallFrame, s: number, dw: number, dh: number) => {
      const g = at(w.at(s, 1)), [x, z] = w.at(s, .05), [gx, gz] = w.at(s, .07), [tx, tz] = w.at(s, .1);
      S.place(k.redDoor, new THREE.PlaneGeometry(dw, dh), x, g + dh / 2, z, w.yaw); S.place(k.glass, new THREE.PlaneGeometry(dw - .5, .8), gx, g + dh * .64, gz, w.yaw);
      for (const h of [.08, .3, .5, .82]) S.box(panel, dw, .07, .05, tx, g + dh * h, tz, w.yaw); for (const q of spread(-dw / 2, dw / 2, 4)) { const [mx, mz] = w.at(s + q, .1); S.box(panel, .06, dh, .05, mx, g + dh / 2, mz, w.yaw); }
      for (const side of [-1, 1]) { const [jx, jz] = w.at(s + side * (dw / 2 + .25), .08); S.box(trim, .5, dh + .2, .22, jx, g + dh / 2, jz, w.yaw); }
      S.box(trim, dw + 1.3, .6, .26, tx, g + dh + .3, tz, w.yaw); S.box(trim, .5, .85, .32, tx, g + dh + .36, tz, w.yaw);
    };
    // ---- the body: three bays to the street.
    const body = { u0: 0, u1: W, v0: 0, v1: D }, bp = rectPoly(f, body), bw = rectWalls(f, body);
    S.prism(brick, bp, foot, y(top), { top: k.deck }); for (const w of [bw.left, bw.right, bw.back]) band(S, plinth, w, -.08, w.length + .08, y(.2), .9, .08); course(S, trim, bp, y(5.15), .3, .1); quoins(body, .95, top - .6);
    course(S, copper, bp, y(top - .8), .34, .22); course(S, copper, bp, y(top - .35), .5, .55); parapet(S, brick, bp, y(top), 1, .32, trim);
    for (const s of [W / 6, W / 2, W * 5 / 6]) {
      engineDoor(bw.front, s, 4.1, 4.2); light(bw.front, s, 6, 1.7, 2.5); light(bw.front, s, 9.5, 1.5, 1.8);
      // The balcony: a sandstone slab on two brackets with an iron rail.
      const P = (ds: number, out: number, h: number): V3 => { const [x, z] = bw.front.at(s + ds, out); return [x, y(h), z]; }, c = P(0, .4, 5.85);
      S.box(trim, 2.7, .14, .8, c[0], c[1], c[2], bw.front.yaw); for (const ds of [-1, 1]) { const q = P(ds, .3, 5.55); S.box(trim, .22, .5, .6, q[0], q[1], q[2], bw.front.yaw); }
      railing(S, k.iron, [P(-1.3, .05, 5.92), P(-1.3, .75, 5.92), P(1.3, .75, 5.92), P(1.3, .05, 5.92)], .85, { spacing: 1.3, pickets: .16, post: .05 });
    }
    for (const w of [bw.left, bw.right, bw.back]) for (const s of spread(1.6, w.length - 1.6, w === bw.back ? 4 : 5)) { if (w !== bw.right) light(w, s, 1.4, 1.3, 2.2); light(w, s, 6, 1.3, 2.2); light(w, s, 9.5, 1.3, 1.8); }
    // ---- the later truck bay on the east side, one storey.
    const wing = { u0: W, u1: 27.27, v0: 3.3, v1: D }, wp = rectPoly(f, wing), ww = rectWalls(f, wing), wingTop = 5.4;
    S.prism(brick, wp, foot, y(wingTop), { top: k.deck }); parapet(S, brick, wp, y(wingTop), .5, .28, trim); for (const w of [ww.right, ww.back]) band(S, plinth, w, -.08, w.length + .08, y(.2), .9, .08);
    engineDoor(ww.front, 27.27 - W - 2.05, 3.3, 3.7); for (const s of spread(8, ww.right.length - 1, 3)) light(ww.right, s, 1.4, 1.3, 2.2); light(ww.back, ww.back.length / 2, 1.4, 1.3, 2.2);
    // ---- the hose tower: brick shaft, a clock on each face, balcony, arcaded top stage, bracketed eaves and a low hipped roof.
    const TW = 6.4, tr = { u0: 29.85 - TW, u1: 29.85, v0: 3.3, v1: 3.3 + TW }, tp = rectPoly(f, tr), tf = S.prism(brick, tp, foot, y(20.6), { top: k.deck }), [mx, mz] = f.W(29.85 - TW / 2, 3.3 + TW / 2);
    quoins(tr, .95, 20.2); course(S, plinth, tp, y(.2), .9, .08); course(S, trim, tp, y(16.5), .3, .12);
    for (const w of tf) { for (const h of [6.5, 10.5, 14]) light(w, TW / 2, h, .8, 1.8); clock(S, k, w, TW / 2, y(18.55), 1.3, trim); }
    // Balcony on brackets.
    S.box(trim, TW + 1.9, .28, TW + 1.9, mx, y(20.6), mz, f.yaw); const ring = inset(tp, .85);
    for (const w of tf) for (const s of spread(-.3, TW + .3, 5)) { const [x, z] = w.at(s, .42); S.box(trim, .26, .7, .84, x, y(20.15), z, w.yaw); }
    railing(S, trim, [...ring, ring[0]].map(p => [p[0], y(20.74), p[1]] as V3), .95, { spacing: .7, post: .1 });
    // Belfry: corner piers, two arches a side on a column, the entablature above.
    const by0 = y(20.74), by1 = y(25.6), pier = 1.15;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { const [x, z] = f.W(tr.u0 + pier / 2 + u * (TW - pier), tr.v0 + pier / 2 + v * (TW - pier)); S.block(brick, pier, pier, x, z, by0, by1, f.yaw); }
    for (const w of tf) {
      const span = (TW - 2 * pier) / 2, [cx, cz] = w.at(TW / 2, -.3); column(S, trim, cx, cz, by0, 2.7, .17, { order: 'doric', yaw: w.yaw });
      for (const s of [TW / 2 - span / 2, TW / 2 + span / 2]) { const [x, z] = w.at(s, -.3); for (const turn of [0, Math.PI]) S.place(trim, new THREE.RingGeometry(span / 2 - .12, span / 2 + .7, 14, 1, 0, Math.PI), x, by0 + 2.7, z, w.yaw + turn); }
      const [hx, hz] = w.at(TW / 2, -.3); S.box(trim, TW - 2 * pier + .1, by1 - by0 - 2.7 - span / 2 - .1, .5, hx, (by0 + 2.7 + span / 2 + .1 + by1) / 2, hz, w.yaw);
      band(S, trim, w, -.1, TW + .1, by1 - .2, .4, .2); for (const s of spread(-.4, TW + .4, 6)) { const [x, z] = w.at(s, .5); S.box(trim, .28, .6, 1, x, by1 + .1, z, w.yaw); }
    }
    S.place(k.bronze, new THREE.CylinderGeometry(.3, .62, .9, 12, 1, true), mx, by0 + 2.2, mz);
    const eaves = inset(tp, 1.15); S.cap(k.tint('cream', '#cfc8b6'), eaves, by1 + .42, false, false); pyramid(S, k.copper, eaves, by1 + .44, by1 + 2.9); S.rod(k.iron, [mx, by1 + 2.8, mz], [mx, by1 + 4.4, mz], .05, .02); S.place(k.gold, new THREE.SphereGeometry(.16, 8, 6), mx, by1 + 3.1, mz);
    return S;
  },
};

/** The Temple of Love by the lagoon in Larz Anderson Park (1910, attributed to Little and Browne; rebuilt in kind
 * 2021-22): an open round temple of twelve 12 ft columns on a ring of base stones, an entablature banded with rough
 * granite, a shallow concrete dome with a balustrade round its oculus, and in front of it the basin with its mask
 * spout, wing walls with two flower urns and stairs down to the water. It stands on the mapped 6.3 m round roof at
 * the east end of the lagoon; the layout of the basin, walls and stairs and all sizes but the columns are interpretive. */
const temple: SiteModel = {
  id: 'temple-of-love', name: 'Temple of Love', place: 'larz-anderson-park', tile: '-6_4', building: 'osm-way-212273884',
  note: 'Tempietto of 1910 (attributed to Little and Browne), rebuilt in kind 2021-22: twelve 12 ft columns, granite-banded entablature, concrete dome with crown balustrade, basin, wing walls, urns and stairs to the lagoon; layout of the water stairs interpretive',
  build({ k, ground, water }, b) {
    const S = new Shapes(), cx = -5086.1, cz = 4380.87, base = b?.baseElevation ?? ground(cx, cz), floor = base + .5, foot = base - 1.8;
    const concrete = k.tint('castStone', '#b7ab94'), rough = k.tint('granite', '#8d877c'), terrazzo = k.tint('paving', '#b3a995');
    // d: toward the lagoon along its length; s to the side.
    const d: Point2 = [-.97, -.243], side: Point2 = [-d[1], d[0]], yaw = Math.atan2(d[0], d[1]), P = (a: number, s: number): Point2 => [cx + d[0] * a + side[0] * s, cz + d[1] * a + side[1] * s];
    const wl = water(...P(14, 0)) ?? base - 1.3, low = wl + .3, deck = floor - .34;
    // Stylobate of three risers and the terrazzo floor.
    S.drum(concrete, cx, cz, 3.8, 3.8, foot, deck, 28); S.drum(concrete, cx, cz, 3.5, 3.5, deck, floor - .17, 28); S.drum(concrete, cx, cz, 3.2, 3.2, floor - .17, floor, 28, { top: terrazzo });
    // Twelve columns, the entablature with its granite band, the dome with the balustrade round its oculus.
    const H = 3.66, e0 = floor + H, e1 = e0 + .8;
    for (let i = 0; i < 12; i++) { const a = (i + .5) / 12 * Math.PI * 2 + yaw, x = cx + Math.sin(a) * 2.72, z = cz + Math.cos(a) * 2.72; column(S, concrete, x, z, floor, H, .2, { order: 'doric', yaw: a }); S.solidBox(.42, .42, x, z, floor, e0, a); }
    lathe(S, concrete, [[2.4, 0], [3.02, 0], [3.06, .56], [3.2, .64], [3.2, .8], [2.4, .8], [2.4, 0]], cx, e0, cz, 36); S.drum(rough, cx, cz, 3.09, 3.09, e0 + .12, e0 + .5, 36, { solid: false, top: null });
    const arc = (r: number, h: number, from: number, to: number, n: number): [number, number][] => Array.from({ length: n + 1 }, (_, i) => { const t = (from + (to - from) * i / n) * Math.PI / 180; return [r * Math.cos(t), h * Math.sin(t)]; });
    lathe(S, concrete, [...arc(3.05, 1.75, 0, 72, 10), ...arc(2.87, 1.6, 72, 0, 10), [3.05, 0]], cx, e1, cz, 36);
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; S.box(concrete, .12, .46, .12, cx + Math.sin(a) * 1.02, e1 + 1.9, cz + Math.cos(a) * 1.02, a); }
    lathe(S, concrete, [[.94, 0], [1.12, 0], [1.12, .1], [.94, .1], [.94, 0]], cx, e1 + 1.58, cz, 24); lathe(S, concrete, [[.94, 0], [1.1, 0], [1.1, .1], [.94, .1], [.94, 0]], cx, e1 + 2.1, cz, 24);
    S.solidBox(4.4, 4.4, cx, cz, e0, e1 + 1.3, yaw);
    // The terrace before the temple, its parapet over the basin, the wing walls and their urns.
    const turn = yaw, apron = 2.2, a1 = 3.3 + apron, half = 4.6;
    S.block(concrete, half * 2, apron + .6, ...P(3.3 + apron / 2 - .3, 0), foot, deck, turn, { top: terrazzo });
    for (const q of [-1, 1]) { S.block(concrete, .45, apron + 1.2, ...P(a1 - (apron + 1.2) / 2, q * (half + .22)), foot, deck + .8, turn); S.block(concrete, .7, .7, ...P(a1, q * (half + .22)), foot, deck + 1.05, turn);
      const [ux, uz] = P(a1, q * (half + .22)); lathe(S, concrete, [[0, 0], [.2, 0], [.14, .1], [.1, .28], [.3, .5], [.4, .78], [.36, .86], [.42, .92], [0, .92]], ux, deck + 1.05, uz, 14); S.place(k.tint('grass', '#55713f'), new THREE.SphereGeometry(.36, 8, 6), ux, deck + 2.12, uz, 0, 0, 0, [1, .7, 1]); }
    S.block(concrete, 3.4, .4, ...P(a1 - .2, 0), foot, deck + .85, turn);
    // The basin under the mask spout, with runnel stones stepping down to it.
    S.block(concrete, 3, 1.5, ...P(a1 + .75, 0), foot, low + .55, turn); S.block(k.water, 2.4, .9, ...P(a1 + .75, 0), low + .3, low + .5, turn, { solid: false });
    { const [x, z] = P(a1 + .06, 0); S.box(k.bronze, .42, .46, .14, x, deck + .15, z, turn); S.box(k.bronze, .1, .1, .3, x + d[0] * .12, deck + .02, z + d[1] * .12, turn); for (let i = 0; i < 3; i++) S.block(rough, .7, .3, ...P(a1 + .15 + i * .1, 0), low + .5, deck - .2 - i * .38, turn, { solid: false }); }
    // The lower landing at the water and a flight down to it on each side.
    S.block(concrete, half * 2, 4.2, ...P(a1 + 2.1, 0), wl - 1.6, low, turn, { top: terrazzo });
    const wall = wallFrame(P(a1, half), P(a1, -half), d), n = Math.max(2, Math.round((deck - low) / .17));
    for (const s of [1.25, half * 2 - 1.25]) stairs(S, concrete, wall, s, 2.1, deck, n, { rise: (deck - low) / n, tread: .3 });
    return S;
  },
};

export const SITES: SiteModel[] = [pierce, theatre, station, museum, temple];
