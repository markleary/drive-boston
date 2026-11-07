import * as THREE from 'three';
import type { Building, CityData, Point2 } from '../types';
import { TriangleWriter } from './geometry-writer.ts';
import { canvasTexture, seeded } from './materials.ts';
import { closestRoad } from '../simulation/roads.ts';

/** Hand-modelled park and Main Street landmarks of the northern towns, built
 * in place of their OpenStreetMap extrusions when their tile streams in.
 *
 * - The Melrose YMCA, 497 Main Street (Hartwell, Richardson & Driver,
 *   cornerstone 1894, dedicated 1895; Goss, History of Melrose, 1902): a
 *   three-storey red pressed-brick block, 70 by 50 feet, with three wall
 *   dormers under steep slate pyramids, copper cornices and finials, corbelled
 *   belt courses, the YOUNG MENS CHRISTIAN ASSOCIATION panel and a green
 *   cast-iron storefront with two arched entrances; the gymnasium annex behind
 *   it under a slate gable; the 1960 Dooley pool addition and later wings fill
 *   the rest of the mapped footprint as flat-roofed brick. Measured from a 2020
 *   Melrose Public Library photograph of the facade; the rear is interpretive.
 * - The Ell Pond gazebo: an open iron bandstand with a lattice dome on a
 *   stepped octagonal platform.
 * - The Slayton Memorial Tower on Mount Hood: a round fieldstone tower with a
 *   corbelled parapet and an iron railing.
 * - Wright's Tower on Pine Hill in the Middlesex Fells: a squat crenellated
 *   fieldstone tower on its mapped square footprint (interpretive). */
export const MELROSE_YMCA_ID = 'osm-way-29803654', ELL_POND_GAZEBO_ID = 'osm-way-1090238612', SLAYTON_TOWER_ID = 'osm-way-181201049', WRIGHTS_TOWER_ID = 'osm-way-31364672';
type V3 = [number, number, number];
type UV = [number, number];
export interface ParkLandmark { group: THREE.Group; collisions: { vertices: Float32Array; indices: Uint32Array }[]; }
const BUILDERS: Record<string, (city: CityData, b: Building, kit: Kit) => Shapes> = {
  [MELROSE_YMCA_ID]: (_city, b, kit) => ymca(b, kit),
  [ELL_POND_GAZEBO_ID]: (_city, b, kit) => gazebo(b, kit),
  [SLAYTON_TOWER_ID]: (city, b, kit) => stoneTower(city, b, kit, { height: 12.2, round: true }),
  [WRIGHTS_TOWER_ID]: (city, b, kit) => stoneTower(city, b, kit, { height: 7.6, round: false }),
};
/** The tile builder skips the extruded shell (and its hull) of these buildings. */
export const replacesTileShell = (b?: Building) => !!b && b.id in BUILDERS;

// ------------------------------------------------------------------ materials
interface Kit {
  brick: THREE.MeshStandardMaterial; corbel: THREE.MeshStandardMaterial; sill: THREE.MeshStandardMaterial; slate: THREE.MeshStandardMaterial; copper: THREE.MeshStandardMaterial;
  deck: THREE.MeshStandardMaterial; glass: THREE.MeshStandardMaterial; shopGlass: THREE.MeshStandardMaterial; sash: THREE.MeshStandardMaterial; iron: THREE.MeshStandardMaterial;
  storefront: THREE.MeshStandardMaterial; door: THREE.MeshStandardMaterial; panel: THREE.MeshStandardMaterial; letters: THREE.MeshStandardMaterial; stone: THREE.MeshStandardMaterial;
  lattice: THREE.MeshStandardMaterial; platform: THREE.MeshStandardMaterial; fieldstone: THREE.MeshStandardMaterial; granite: THREE.MeshStandardMaterial; opening: THREE.MeshStandardMaterial;
}
let kit: Kit | undefined, night = false;
/** Window glow by night (main.ts calls it with the other night switches). */
export function setMelroseNight(value: boolean) { night = value; if (kit) applyNight(kit); }
function applyNight(k: Kit) { k.glass.emissiveIntensity = night ? .8 : 0; k.shopGlass.emissiveIntensity = night ? 1 : .04; }

const canvas = (size: number) => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
/** Running-bond pressed brick, 2 m square: 30 courses of ten bricks, colours wrapping so the tile repeats. */
function brickTexture(size: number) {
  const c = canvas(size), x = c.getContext('2d')!, rows = 30, cols = 10, ch = size / rows, cw = size / cols, colours = ['#a8503a', '#9e4834', '#b0583f', '#934331', '#b6604a', '#a54e39', '#9a4632', '#ab5540'];
  x.fillStyle = '#b4a491'; x.fillRect(0, 0, size, size);
  for (let i = 0; i < rows; i++) for (let j = -1; j <= cols; j++) {
    const k = ((j % cols) + cols) % cols, r = seeded(9173 + i * 131 + k * 17), left = j * cw + (i % 2) * cw / 2;
    x.fillStyle = colours[Math.floor(r() * colours.length)]; x.fillRect(left + .9, i * ch + .7, cw - 1.8, ch - 1.4);
    x.fillStyle = `rgba(30,10,5,${.04 + r() * .1})`; x.fillRect(left + .9, i * ch + ch * .62, cw - 1.8, ch * .3);
  }
  return canvasTexture(c, true);
}
/** Grey-green slate, 2 m square: twelve staggered courses of seven slates with their shadow lines. */
function slateTexture(size: number) {
  const c = canvas(size), x = c.getContext('2d')!, rows = 12, cols = 7, ch = size / rows, cw = size / cols, colours = ['#5c6560', '#56605c', '#616a64', '#4f5955', '#666e68', '#5a625f', '#535c5a'];
  x.fillStyle = '#2b302e'; x.fillRect(0, 0, size, size);
  for (let i = 0; i < rows; i++) for (let j = -1; j <= cols; j++) {
    const k = ((j % cols) + cols) % cols, r = seeded(3301 + i * 97 + k * 29), left = j * cw + (i % 2) * cw / 2;
    x.fillStyle = colours[Math.floor(r() * colours.length)]; x.fillRect(left + 1, i * ch, cw - 2, ch - 1.5);
    x.fillStyle = 'rgba(0,0,0,.28)'; x.fillRect(left + 1, i * ch + ch - 4, cw - 2, 2.5);
    x.fillStyle = `rgba(255,255,255,${r() * .06})`; x.fillRect(left + 1, i * ch, cw - 2, ch * .35);
  }
  return canvasTexture(c, true);
}
/** Rounded fieldstone in dark mortar, 2 m square; every stone is drawn at its wrapped copies so the tile repeats. */
function fieldstoneTexture(size: number) {
  const c = canvas(size), x = c.getContext('2d')!, r = seeded(5521), colours = ['#8b847a', '#7c766d', '#9b9083', '#6e6a64', '#a18b74', '#8d7b67', '#b1a698', '#79654f', '#958d82'];
  x.fillStyle = '#4b4741'; x.fillRect(0, 0, size, size);
  const cell = size / 6;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    const cx = (j + .5 + (r() - .5) * .35) * cell, cy = (i + .5 + (r() - .5) * .35) * cell, rx = cell * (.42 + r() * .16), ry = cell * (.34 + r() * .14), angle = r() * Math.PI, colour = colours[Math.floor(r() * colours.length)];
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
      x.fillStyle = colour; x.beginPath(); x.ellipse(cx + dx, cy + dy, rx, ry, angle, 0, Math.PI * 2); x.fill();
      x.fillStyle = 'rgba(255,255,255,.1)'; x.beginPath(); x.ellipse(cx + dx - rx * .2, cy + dy - ry * .25, rx * .55, ry * .4, angle, 0, Math.PI * 2); x.fill();
      x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 2; x.beginPath(); x.ellipse(cx + dx, cy + dy, rx, ry, angle, .2, 2.6); x.stroke();
    }
  }
  return canvasTexture(c, true);
}
/** Diamond lattice for the gazebo dome: white bars on black, read as an alpha map. */
function latticeTexture(size: number) {
  const c = canvas(size), x = c.getContext('2d')!; x.fillStyle = '#000'; x.fillRect(0, 0, size, size); x.strokeStyle = '#fff'; x.lineWidth = size * .07;
  for (const k of [-1, 0, 1]) { x.beginPath(); x.moveTo(k * size, 0); x.lineTo(k * size + size, size); x.stroke(); x.beginPath(); x.moveTo(k * size + size, 0); x.lineTo(k * size, size); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
/** Raised terracotta letters on the panel between the second and third floors, with the 18 and 94 date blocks. */
function panelTexture() {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 144; const x = c.getContext('2d')!;
  x.fillStyle = '#b5603f'; x.fillRect(0, 0, 2048, 144); x.strokeStyle = '#8c4128'; x.lineWidth = 8; x.strokeRect(6, 6, 2036, 132);
  x.font = '600 84px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (const [text, at] of [['YOUNG MENS CHRISTIAN ASSOCIATION', 1024], ['18', 78], ['94', 1970]] as [string, number][]) {
    if (text.length === 2) { x.strokeStyle = '#d99a62'; x.lineWidth = 5; x.strokeRect(at - 52, 22, 104, 100); }
    x.fillStyle = '#6e2f1c'; x.fillText(text, at + 4, 78, text.length > 2 ? 1700 : 90); x.fillStyle = '#e3a36c'; x.fillText(text, at, 74, text.length > 2 ? 1700 : 90);
  }
  return canvasTexture(c);
}
function lettersTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d')!;
  x.fillStyle = '#20382c'; x.fillRect(0, 0, 256, 64); x.fillStyle = '#f2efe6'; x.font = '700 44px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('Y M C A', 128, 34);
  return canvasTexture(c);
}
function materials(mobile: boolean): Kit {
  if (kit) return kit;
  const size = mobile ? 256 : 512, standard = (color: string, roughness: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  kit = {
    brick: standard('#ffffff', .9, { map: brickTexture(size) }), corbel: standard('#c06a4c', .9, { map: brickTexture(size) }), sill: standard('#a7654c', .85),
    slate: standard('#ffffff', .68, { map: slateTexture(size) }), copper: standard('#6fa48d', .5, { metalness: .3 }), deck: standard('#47494b', .95),
    glass: standard('#2a3740', .14, { metalness: .45, emissive: '#f4c784', emissiveIntensity: 0 }), shopGlass: standard('#33434a', .1, { metalness: .4, emissive: '#f7d29a', emissiveIntensity: .04 }),
    sash: standard('#3d2a20', .7), iron: standard('#1c1e1f', .45, { metalness: .6 }), storefront: standard('#22392e', .55, { metalness: .2 }), door: standard('#2c2a26', .6),
    panel: standard('#ffffff', .85, { map: panelTexture() }), letters: standard('#ffffff', .6, { map: lettersTexture() }), stone: standard('#c9c2b4', .85),
    lattice: standard('#1c1e1f', .45, { metalness: .6, alphaMap: latticeTexture(64), alphaTest: .5, side: THREE.DoubleSide }), platform: standard('#7d3e31', .85),
    fieldstone: standard('#ffffff', .95, { map: fieldstoneTexture(size) }), granite: standard('#a9a59d', .8), opening: standard('#15140f', .95),
  };
  applyNight(kit); return kit;
}

// ------------------------------------------------------------------ geometry
const ONE = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0), SIDE = new THREE.Vector3(1, 0, 0), matrix = new THREE.Matrix4(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), euler = new THREE.Euler(), eye = new THREE.Vector3(), target = new THREE.Vector3();
/** Triangles per material, plus the solid ones the collider keeps. */
class Shapes {
  private writers = new Map<THREE.Material, TriangleWriter>(); readonly solid: number[] = [];
  writer(m: THREE.Material) { let w = this.writers.get(m); if (!w) this.writers.set(m, w = new TriangleWriter()); return w; }
  tri(m: THREE.Material, a: V3, b: V3, c: V3, ua: UV, ub: UV, uc: UV, solid: boolean) {
    this.writer(m).triangle(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
    if (solid) this.solid.push(...a, ...b, ...c);
  }
  /** A planar convex polygon turned to face `toward`, fan-triangulated. */
  poly(m: THREE.Material, pts: V3[], toward: V3, uv: (p: V3) => UV, solid = false) {
    if (pts.length < 3) return;
    let nx = 0, ny = 0, nz = 0;
    for (let i = 1; i + 1 < pts.length; i++) { const a = pts[0], b = pts[i], c = pts[i + 1], ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; nx += uy * vz - uz * vy; ny += uz * vx - ux * vz; nz += ux * vy - uy * vx; }
    const list = nx * toward[0] + ny * toward[1] + nz * toward[2] < 0 ? [...pts].reverse() : pts;
    for (let i = 1; i + 1 < list.length; i++) this.tri(m, list[0], list[i], list[i + 1], uv(list[0]), uv(list[i]), uv(list[i + 1]), solid);
  }
  box(m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, yaw = 0, pitch = 0) {
    matrix.compose(position.set(x, y, z), quaternion.setFromEuler(euler.set(pitch, yaw, 0, 'YXZ')), ONE); this.writer(m).box({ w, h, d }, matrix);
  }
  /** A box from a to b (its depth axis), w wide and h high. */
  beam(m: THREE.Material, a: V3, b: V3, w: number, h: number) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); if (length < 1e-3) return;
    matrix.lookAt(eye.set(...a), target.set(...b), Math.abs(b[1] - a[1]) / length > .98 ? SIDE : UP); matrix.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    this.writer(m).box({ w, h, d: length }, matrix);
  }
  place(m: THREE.Material, geometry: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0) {
    matrix.compose(position.set(x, y, z), quaternion.setFromEuler(euler.set(pitch, yaw, roll, 'YXZ')), ONE); this.writer(m).append(geometry, matrix); geometry.dispose();
  }
  /** A vertical wall from a to b, its tops at ya and yb, facing `out`; brick courses follow world height. */
  wall(m: THREE.Material, a: Point2, b: Point2, bottom: number, ya: number, yb: number, out: Point2, solid = true) {
    const uv = (p: V3): UV => [(p[0] * out[1] - p[2] * out[0]) / 2, p[1] / 2];
    this.poly(m, [[a[0], bottom, a[1]], [b[0], bottom, b[1]], [b[0], yb, b[1]], [a[0], ya, a[1]]], [out[0], 0, out[1]], uv, solid);
  }
  meshes(name: string) {
    const out: THREE.Mesh[] = [];
    for (const [material, writer] of this.writers) if (!writer.empty) { const mesh = new THREE.Mesh(writer.geometry(), material); mesh.name = name; mesh.castShadow = mesh.receiveShadow = true; out.push(mesh); }
    return out;
  }
}
/** Sutherland-Hodgman: the part of `poly` where f >= 0 (f linear). */
function clip(poly: Point2[], f: (p: Point2) => number): Point2[] {
  const out: Point2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
const signedArea = (p: Point2[]) => p.reduce((s, a, i) => { const c = p[(i + 1) % p.length]; return s + a[0] * c[1] - c[0] * a[1]; }, 0) / 2;
const centroid = (p: Point2[]): Point2 => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
/** Outward unit normal of edge i of a polygon. */
const outward = (p: Point2[], i: number): Point2 => { const a = p[i], b = p[(i + 1) % p.length], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, s = signedArea(p) > 0 ? 1 : -1; return [dz / l * s, -dx / l * s]; };
/** A flat roof or floor over a convex polygon. */
function cap(S: Shapes, m: THREE.Material, poly: Point2[], y: number, up = true, solid = true) {
  S.poly(m, poly.map(p => [p[0], y, p[1]] as V3), [0, up ? 1 : -1, 0], p => [p[0] / 2, p[2] / 2], solid);
}
/** Placement on a wall: s metres along it from `a`, at height y, `out` metres proud of it; yaw turns a part's +Z out of the wall. */
interface WallFrame { a: Point2; t: Point2; n: Point2; yaw: number; length: number; at(s: number, out?: number): Point2; }
const wallFrame = (a: Point2, b: Point2, n: Point2): WallFrame => {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]), t: Point2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  return { a, t, n, length, yaw: Math.atan2(n[0], n[1]), at: (s, out = 0) => [a[0] + t[0] * s + n[0] * out, a[1] + t[1] * s + n[1] * out] };
};
function archShape(width: number, spring: number) {
  const s = new THREE.Shape(); s.moveTo(-width / 2, 0); s.lineTo(width / 2, 0); s.lineTo(width / 2, spring); s.absarc(0, spring, width / 2, 0, Math.PI, false); s.lineTo(-width / 2, 0); return s;
}
/** A sash window: glass, frame, meeting rail and muntin, sill and a brick jack arch. */
function rectWindow(S: Shapes, k: Kit, f: WallFrame, s: number, sill: number, w: number, h: number, transom = false) {
  const [x, z] = f.at(s, .03), [fx, fz] = f.at(s, .07);
  S.place(k.glass, new THREE.PlaneGeometry(w - .12, h - .12), x, sill + h / 2, z, f.yaw);
  for (const side of [-1, 1]) S.box(k.sash, .1, h, .1, fx + f.t[0] * side * (w / 2 - .05), sill + h / 2, fz + f.t[1] * side * (w / 2 - .05), f.yaw);
  for (const y of [sill + .05, sill + h - .05, transom ? sill + h * .78 : sill + h * .5]) S.box(k.sash, w, .08, .1, fx, y, fz, f.yaw);
  S.box(k.sash, .05, h - .1, .06, fx, sill + h / 2, fz, f.yaw);
  const [sx, sz] = f.at(s, .1); S.box(k.sill, w + .22, .1, .2, sx, sill - .05, sz, f.yaw);
  const [lx, lz] = f.at(s, .04); S.box(k.corbel, w + .3, .3, .08, lx, sill + h + .15, lz, f.yaw);
}
/** A round-arched window with radiating glazing bars and a projecting brick arch. */
function archWindow(S: Shapes, k: Kit, f: WallFrame, s: number, sill: number, w: number, spring: number, glass: THREE.Material, surround: THREE.Material) {
  const [x, z] = f.at(s, .03), [fx, fz] = f.at(s, .07), r = w / 2;
  S.place(glass, new THREE.ShapeGeometry(archShape(w - .1, spring), 10), x, sill, z, f.yaw);
  for (const side of [-1, 1]) S.box(k.sash, .09, spring, .1, fx + f.t[0] * side * (r - .045), sill + spring / 2, fz + f.t[1] * side * (r - .045), f.yaw);
  S.box(k.sash, w, .08, .1, fx, sill + .04, fz, f.yaw); S.box(k.sash, w, .07, .1, fx, sill + spring, fz, f.yaw); S.box(k.sash, .05, spring, .07, fx, sill + spring / 2, fz, f.yaw);
  for (let i = 1; i < 4; i++) S.box(k.sash, w, .04, .07, fx, sill + spring * i / 4, fz, f.yaw);
  S.place(k.sash, new THREE.RingGeometry(r - .09, r, 14, 1, 0, Math.PI), fx, sill + spring, fz, f.yaw);
  for (let i = 1; i < 4; i++) { const a = Math.PI * i / 4, [bx, bz] = f.at(s + Math.cos(a) * r * .5, .07); S.box(k.sash, .04, r, .05, bx, sill + spring + Math.sin(a) * r * .5, bz, f.yaw, 0); }
  const [ax, az] = f.at(s, .05); S.place(surround, new THREE.RingGeometry(r + .02, r + .3, 14, 1, 0, Math.PI), ax, sill + spring, az, f.yaw);
  const [sx, sz] = f.at(s, .1); S.box(k.sill, w + .2, .1, .2, sx, sill - .05, sz, f.yaw);
}

// ------------------------------------------------------------------ YMCA
/** Facade measures, metres above the sidewalk: storefront beam top, belt courses, window bands, the panel, cornice and roofs. */
const Y = { beam: 4.05, belt1: [4.05, 4.5], second: [4.5, 7.25], panel: [7.75, 8.4], belt2: [8.65, 9.1], third: [9.15, 10.15], cornice: [10.75, 11.3], wall: 11.25, deck: 14, dormerTop: 12.75, pyramid: [13.3, 15.9], gymEave: 11, pool: 7.2 };
function ymca(b: Building, k: Kit) {
  const S = new Shapes(), base = b.baseElevation ?? 0, footing = base - 1.4, fp = b.footprint;
  const near = (p: Point2) => fp.reduce((best, q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(best[0] - p[0], best[1] - p[1]) ? q : best, fp[0]);
  // The 1895 block's front runs from its south corner o to its north corner f (the footprint's two northern Main Street vertices).
  const o = near([731.268, -11654.4]), f = near([739.443, -11673.926]), L = Math.hypot(f[0] - o[0], f[1] - o[1]), U: Point2 = [(f[0] - o[0]) / L, (f[1] - o[1]) / L];
  let V: Point2 = [-U[1], U[0]]; const c0 = centroid(fp); if ((c0[0] - o[0]) * V[0] + (c0[1] - o[1]) * V[1] < 0) V = [-V[0], -V[1]];
  const W = (u: number, v: number): Point2 => [o[0] + U[0] * u + V[0] * v, o[1] + U[1] * u + V[1] * v];
  const uOf = (p: Point2) => (p[0] - o[0]) * U[0] + (p[1] - o[1]) * U[1], vOf = (p: Point2) => (p[0] - o[0]) * V[0] + (p[1] - o[1]) * V[1];
  const D = 15, y = (h: number) => base + h, mid = L / 2;
  const front = wallFrame(W(L, 0), W(0, 0), [-V[0], -V[1]]);  // left to right for a viewer on Main Street: north to south
  // Main block walls and hipped slate roof with its flat deck.
  const corners = [W(0, 0), W(L, 0), W(L, D), W(0, D)];
  for (let i = 0; i < 4; i++) S.wall(k.brick, corners[i], corners[(i + 1) % 4], footing, y(Y.wall), y(Y.wall), outward(corners, i));
  const run = (Y.deck - Y.cornice[1]) / Math.tan(Math.PI / 3), inner = [W(run, run), W(L - run, run), W(L - run, D - run), W(run, D - run)];
  for (let i = 0; i < 4; i++) {
    const a = corners[i], c = corners[(i + 1) % 4], ia = inner[i], ic = inner[(i + 1) % 4], n = outward(corners, i), along: Point2 = [c[0] - a[0], c[1] - a[1]], len = Math.hypot(...along);
    const uv = (p: V3): UV => [((p[0] - a[0]) * along[0] + (p[2] - a[1]) * along[1]) / len / 2, -((p[0] - a[0]) * n[0] + (p[2] - a[1]) * n[1]) * 2 / 2];
    S.poly(k.slate, [[a[0], y(Y.cornice[1]), a[1]], [c[0], y(Y.cornice[1]), c[1]], [ic[0], y(Y.deck), ic[1]], [ia[0], y(Y.deck), ia[1]]], [n[0], 1, n[1]], uv, true);
    S.beam(k.copper, [a[0], y(Y.cornice[1]) + .05, a[1]], [ia[0], y(Y.deck) + .05, ia[1]], .16, .14);
  }
  cap(S, k.deck, inner, y(Y.deck));
  for (let i = 0; i < 4; i++) S.beam(k.copper, [inner[i][0], y(Y.deck) + .06, inner[i][1]], [inner[(i + 1) % 4][0], y(Y.deck) + .06, inner[(i + 1) % 4][1]], .2, .14);
  // Copper eave cornice on all four sides, broken by the three wall dormers on the front.
  const dormers = [mid - 6, mid, mid + 6], dormerHalf = 1.55;
  for (let i = 0; i < 4; i++) {
    const a = corners[i], c = corners[(i + 1) % 4], n = outward(corners, i), fr = wallFrame(a, c, n), spans: [number, number][] = [];
    if (i === 0) { let from = -.45; for (const d of dormers) { spans.push([from, d - dormerHalf]); from = d + dormerHalf; } spans.push([from, L + .45]); } else spans.push([-.45, fr.length + .45]);
    for (const [s0, s1] of spans) { const s = (s0 + s1) / 2, w = s1 - s0, [cx, cz] = fr.at(s, .22), [bx, bz] = fr.at(s, .1); S.box(k.copper, w, Y.cornice[1] - Y.cornice[0], .5, cx, y((Y.cornice[0] + Y.cornice[1]) / 2), cz, fr.yaw); S.box(k.copper, w, .14, .22, bx, y(Y.cornice[0] - .1), bz, fr.yaw); }
  }
  // The dormers: brick faces rising from the facade, cheeks back to the slope, copper cornices, slate pyramids and finials.
  const slope = Math.tan(Math.PI / 3), cheek = (Y.dormerTop - Y.cornice[1]) / slope;
  for (const d of dormers) {
    const l = W(d - dormerHalf, 0), r = W(d + dormerHalf, 0);
    S.wall(k.brick, r, l, y(Y.wall) - .02, y(Y.dormerTop), y(Y.dormerTop), [-V[0], -V[1]]);
    for (const side of [-1, 1]) {
      const p0 = W(d + side * dormerHalf, 0), p1 = W(d + side * dormerHalf, cheek), n: Point2 = [U[0] * side, U[1] * side];
      S.poly(k.brick, [[p0[0], y(Y.cornice[1]) - .05, p0[1]], [p0[0], y(Y.dormerTop), p0[1]], [p1[0], y(Y.dormerTop), p1[1]]], [n[0], 0, n[1]], p => [(p[0] * n[1] - p[2] * n[0]) / 2, p[1] / 2], true);
      const [cx, cz] = W(d + side * (dormerHalf + .2), (cheek - .35) / 2); S.box(k.copper, .5, Y.pyramid[0] - Y.dormerTop, cheek + .45, cx, y((Y.dormerTop + Y.pyramid[0]) / 2), cz, Math.atan2(U[0], U[1]) + Math.PI / 2);
    }
    const [fx, fz] = W(d, -.22); S.box(k.copper, 2 * dormerHalf + .9, Y.pyramid[0] - Y.dormerTop, .5, fx, y((Y.dormerTop + Y.pyramid[0]) / 2), fz, front.yaw);
    const half = 1.85, back = 3.35, apex = W(d, (back - .35) / 2 - .2), top: V3 = [apex[0], y(Y.pyramid[1]), apex[1]];
    const quad = [W(d - half, -.35), W(d + half, -.35), W(d + half, back), W(d - half, back)];
    for (let i = 0; i < 4; i++) {
      const a = quad[i], c = quad[(i + 1) % 4], n = outward(quad, i), A: V3 = [a[0], y(Y.pyramid[0]), a[1]], C: V3 = [c[0], y(Y.pyramid[0]), c[1]];
      S.poly(k.slate, [A, C, top], [n[0], .6, n[1]], p => [((p[0] - a[0]) * (c[0] - a[0]) + (p[2] - a[1]) * (c[1] - a[1])) / 2 / 3.7, (p[1] - y(Y.pyramid[0])) / 2 * 1.3], true);
      S.beam(k.copper, A, top, .12, .12);
    }
    S.place(k.copper, new THREE.ConeGeometry(.09, 1, 6), top[0], top[1] + .45, top[2]); S.place(k.copper, new THREE.SphereGeometry(.14, 8, 6), top[0], top[1] + .08, top[2]);
    archWindow(S, k, wallFrame(r, l, [-V[0], -V[1]]), dormerHalf, y(Y.third[0]), 1.2, Y.dormerTop - .9 - Y.third[0] - .6, k.glass, k.corbel);
    // Diagonal brick panel above the arch.
    const [px, pz] = W(d, -.04); S.box(k.corbel, 1.6, .5, .06, px, y(Y.dormerTop - .55), pz, front.yaw);
  }
  // Facade bands: corbelled belt courses with dentils, the terracotta panel, downspouts.
  for (const [lo, hi] of [Y.belt1, Y.belt2]) {
    const [bx, bz] = front.at(L / 2, .07); S.box(k.corbel, L + .1, hi - lo, .14, bx, y((lo + hi) / 2), bz, front.yaw);
    for (let s = .25; s < L; s += .32) { const [dx, dz] = front.at(s, .17); S.box(k.corbel, .14, .11, .08, dx, y(lo + .07), dz, front.yaw); }
  }
  { const [px, pz] = front.at(L / 2, .05); S.place(k.panel, new THREE.PlaneGeometry(8.6, Y.panel[1] - Y.panel[0]), px, y((Y.panel[0] + Y.panel[1]) / 2), pz, front.yaw); }
  for (const s of [.3, 6.1, L - 6.1, L - .3]) { const [dx, dz] = front.at(s, .1); S.box(k.copper, .12, Y.cornice[0], .12, dx, y(Y.cornice[0] / 2), dz, front.yaw); }
  // Windows: seven on the second floor, four small ones between the dormers on the third, the arched dormer windows above.
  for (let i = 0; i < 7; i++) {
    const s = mid + (i - 3) * 3;
    rectWindow(S, k, front, s, y(Y.second[0]), 1.33, Y.second[1] - Y.second[0], true);
    if (i % 2 === 0) rectWindow(S, k, front, s, y(Y.third[0]), 1.24, Y.third[1] - Y.third[0]);
  }
  // Third-floor hall windows on both side walls, above the neighbours.
  for (const [a, c, n] of [[W(L, 0), W(L, D), U], [W(0, D), W(0, 0), [-U[0], -U[1]] as Point2]] as [Point2, Point2, Point2][]) {
    const side = wallFrame(a, c, n); for (const s of [3, 6.2, 9.4, 12.4]) rectWindow(S, k, side, s, y(Y.third[0]), 1.2, 1.25);
  }
  storefront(S, k, front, L, base);
  // The gymnasium annex behind the block: brick under a slate gable running north and south, clipped to the footprint.
  const gym = clip(clip(clip(clip(fp, p => uOf(p) - (L - 15.2)), p => L + 2 - uOf(p)), p => vOf(p) - D), p => D + 12.2 - vOf(p));
  const ridgeV = D + 6.1, pitch = 1.19, gymTop = (p: Point2) => y(Y.gymEave) + pitch * Math.max(0, 6.1 - Math.abs(vOf(p) - ridgeV));
  for (let i = 0; i < gym.length; i++) {
    const a = gym[i], c = gym[(i + 1) % gym.length], n = outward(gym, i), va = vOf(a), vc = vOf(c);
    if ((va - ridgeV) * (vc - ridgeV) < 0) { const t = (ridgeV - va) / (vc - va), m: Point2 = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t]; S.wall(k.brick, a, m, footing, gymTop(a), gymTop(m), n); S.wall(k.brick, m, c, footing, gymTop(m), gymTop(c), n); }
    else S.wall(k.brick, a, c, footing, gymTop(a), gymTop(c), n);
    // Copper coping where the gable rakes cross this wall.
    if (Math.abs(gymTop(a) - gymTop(c)) > .5 || (va - ridgeV) * (vc - ridgeV) < 0) {
      const m: Point2 = (va - ridgeV) * (vc - ridgeV) < 0 ? (() => { const t = (ridgeV - va) / (vc - va); return [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t] as Point2; })() : c;
      S.beam(k.copper, [a[0], gymTop(a) + .1, a[1]], [m[0], gymTop(m) + .1, m[1]], .45, .18); if (m !== c) S.beam(k.copper, [m[0], gymTop(m) + .1, m[1]], [c[0], gymTop(c) + .1, c[1]], .45, .18);
    }
  }
  for (const side of [-1, 1]) {
    const half = clip(gym, p => side * (vOf(p) - ridgeV));
    S.poly(k.slate, half.map(p => [p[0], gymTop(p) + .02, p[1]] as V3), [V[0] * side, 1, V[1] * side], p => [uOf([p[0], p[2]]) / 2, Math.abs(vOf([p[0], p[2]]) - ridgeV) * 1.55 / 2], true);
  }
  { const along = gym.map(uOf), lo = Math.min(...along), hi = Math.max(...along); S.beam(k.copper, [...W(lo, ridgeV), 0].map((v, i) => i === 1 ? y(Y.gymEave) + pitch * 6.1 + .08 : v) as V3, [...W(hi, ridgeV), 0].map((v, i) => i === 1 ? y(Y.gymEave) + pitch * 6.1 + .08 : v) as V3, .25, .16); }
  { const [cx, cz] = W(L - 13.2, D + 9.6), foot = gymTop([cx, cz]) - .4; S.box(k.brick, 1.4, y(17.2) - foot, .9, cx, (foot + y(17.2)) / 2, cz, Math.atan2(U[0], U[1])); S.box(k.granite, 1.6, .2, 1.1, cx, y(17.3), cz, Math.atan2(U[0], U[1])); }
  for (const s of [3, 6.4, 9.8, 13.2]) { const east = wallFrame(W(L - 15.2, D + 12.2), W(L, D + 12.2), V); if (s < east.length) archWindow(S, k, east, s, y(8), 1.3, 1.6, k.glass, k.corbel); }
  // The pool addition and later wings: flat-roofed brick filling the rest of the footprint.
  const pieces = [clip(fp, p => -uOf(p)), clip(clip(fp, p => uOf(p)), p => vOf(p) - D - 12.2), clip(clip(clip(clip(fp, p => uOf(p)), p => L - 15.2 - uOf(p)), p => vOf(p) - D), p => D + 12.2 - vOf(p))];
  const onFootprint = (a: Point2, c: Point2) => fp.some((p, i) => { const q = fp[(i + 1) % fp.length], m: Point2 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz); return Math.abs((m[0] - p[0]) * dz - (m[1] - p[1]) * dx) / l < .05; });
  for (const piece of pieces) {
    if (piece.length < 3 || Math.abs(signedArea(piece)) < 1) continue;
    for (let i = 0; i < piece.length; i++) {
      const a = piece[i], c = piece[(i + 1) % piece.length], n = outward(piece, i); S.wall(k.brick, a, c, footing, y(Y.pool), y(Y.pool), n);
      if (!onFootprint(a, c)) continue;
      S.beam(k.copper, [a[0] + n[0] * .1, y(Y.pool) + .12, a[1] + n[1] * .1], [c[0] + n[0] * .1, y(Y.pool) + .12, c[1] + n[1] * .1], .42, .26);
      const fr = wallFrame(a, c, n); if (fr.length < 6) continue;
      for (let s = 2.5; s < fr.length - 2; s += 3.4) { const [wx, wz] = fr.at(s, .03); S.place(k.glass, new THREE.PlaneGeometry(1.8, 1), wx, y(5.6), wz, fr.yaw); const [sx, sz] = fr.at(s, .08); S.box(k.stone, 2, .12, .16, sx, y(5.04), sz, fr.yaw); }
    }
    cap(S, k.deck, piece, y(Y.pool));
  }
  // The pool's Main Street front: a glazed entrance and a cast-stone panel.
  const poolFront = wallFrame(near([728.889, -11632.028]), o, [-V[0], -V[1]]);
  { const n = poolFront.n, along = poolFront.t; const e = Math.atan2(n[0], n[1]); void along;
    const [gx, gz] = poolFront.at(poolFront.length * .42, .04); S.place(k.shopGlass, new THREE.PlaneGeometry(6, 3.3), gx, y(1.95), gz, e);
    for (let s = -3; s <= 3; s += 1.2) { const [mx, mz] = poolFront.at(poolFront.length * .42 + s, .08); S.box(k.storefront, .1, 3.4, .1, mx, y(1.95), mz, e); }
    const [hx, hz] = poolFront.at(poolFront.length * .42, .1); S.box(k.storefront, 6.3, .2, .2, hx, y(3.65), hz, e);
    const [px, pz] = poolFront.at(poolFront.length * .75, .06); S.box(k.stone, 4.2, 4.2, .12, px, y(4.4), pz, e);
  }
  return S;
}
/** The green cast-iron storefront: riveted beam, pilasters, panelled transoms, display windows and the two arched entrances. */
function storefront(S: Shapes, k: Kit, front: WallFrame, L: number, base: number) {
  const y = (h: number) => base + h, at = (s: number, out: number) => front.at(s, out), yaw = front.yaw, mirror = (u: number) => L - u;
  { const [bx, bz] = at(L / 2, .12); S.box(k.storefront, L - .3, .5, .24, bx, y(3.8), bz, yaw); for (let s = .4; s < L - .2; s += .28) { const [rx, rz] = at(s, .25); S.box(k.iron, .05, .05, .03, rx, y(3.68), rz, yaw); S.box(k.iron, .05, .05, .03, rx, y(3.93), rz, yaw); } }
  for (const u of [.6, 3.15, 5.75, 9.15, 11.8, 14.95, 20.6]) { const [px, pz] = at(mirror(u), .1); S.box(k.storefront, .38, 3.55, .2, px, y(1.78), pz, yaw); S.box(k.storefront, .5, .16, .26, px, y(3.48), pz, yaw); }
  // Display bays (u along the front from the south end), each with base panel, glass and transom panels.
  for (const [u0, u1] of [[3.4, 5.6], [5.95, 8.95], [12.0, 14.75], [15.15, 17.6], [17.8, 20.4]]) {
    const s = mirror((u0 + u1) / 2), w = u1 - u0, [gx, gz] = at(s, .04), [px, pz] = at(s, .07);
    S.place(k.shopGlass, new THREE.PlaneGeometry(w, 2.15), gx, y(1.68), gz, yaw);
    S.box(k.storefront, w, .55, .1, px, y(.3), pz, yaw); S.box(k.storefront, w, .1, .14, px, y(.6), pz, yaw); S.box(k.storefront, w, .12, .14, px, y(2.78), pz, yaw);
    S.box(k.storefront, w, .62, .08, px, y(3.15), pz, yaw);
    for (let j = 1; j < Math.round(w / .75); j++) { const [qx, qz] = at(s - w / 2 + j * w / Math.round(w / .75), .12); S.box(k.storefront, .06, .62, .06, qx, y(3.15), qz, yaw); }
    const [mx, mz] = at(s, .1); S.box(k.storefront, .07, 2.15, .08, mx, y(1.68), mz, yaw);
  }
  // Arched entrances: the central one with YMCA over its doors, and a second at the south end.
  for (const [u, letters] of [[10.48, true], [1.9, false]] as [number, boolean][]) {
    const s = mirror(u), w = 2.1, [dx, dz] = at(s, .02);
    S.place(k.door, new THREE.PlaneGeometry(w, 2.6), dx, y(1.3), dz, yaw);
    S.place(k.glass, new THREE.ShapeGeometry(archShape(w, 0), 10), dx, y(2.65), dz, yaw);
    for (let i = 1; i < 6; i++) { const a = Math.PI * i / 6, [rx, rz] = at(s + Math.cos(a) * w * .25, .05); S.box(k.storefront, .035, w / 2, .04, rx, y(2.65) + Math.sin(a) * w * .25, rz, yaw, 0); }
    const [ax, az] = at(s, .06); S.place(k.storefront, new THREE.RingGeometry(w / 2, w / 2 + .18, 14, 1, 0, Math.PI), ax, y(2.65), az, yaw);
    for (const side of [-1, 1]) { const [jx, jz] = at(s + side * (w / 2 + .09), .08); S.box(k.storefront, .18, 2.65, .16, jx, y(1.33), jz, yaw); const [px, pz] = at(s + side * w / 4, .05); S.box(k.storefront, .08, 2.5, .06, px, y(1.25), pz, yaw); S.place(k.glass, new THREE.PlaneGeometry(w / 2 - .35, 1.5), px, y(1.55), pz + 0, yaw); }
    if (letters) { const [lx, lz] = at(s, .07); S.place(k.letters, new THREE.PlaneGeometry(1.3, .3), lx, y(2.45), lz, yaw); }
  }
  // Granite step along the entrances and a sidewalk-height base.
  const [gx, gz] = at(L / 2, .25); S.box(k.granite, L, .16, .45, gx, y(-.02), gz, yaw);
}

// ------------------------------------------------------------------ gazebo
function gazebo(b: Building, k: Kit) {
  const S = new Shapes(), c = centroid(b.footprint), R = b.footprint.reduce((s, p) => s + Math.hypot(p[0] - c[0], p[1] - c[1]), 0) / b.footprint.length, base = (b.baseElevation ?? 0) - .1;
  const phase = Math.atan2(b.footprint[0][1] - c[1], b.footprint[0][0] - c[0]), ring = (r: number, i: number): Point2 => [c[0] + Math.cos(phase + i * Math.PI / 4) * r, c[1] + Math.sin(phase + i * Math.PI / 4) * r];
  // Three octagonal steps of red composite decking.
  for (let step = 0; step < 3; step++) {
    const r = R - step * .34, top = base + .18 * (step + 1), poly = Array.from({ length: 8 }, (_, i) => ring(r, i));
    for (let i = 0; i < 8; i++) S.wall(k.platform, poly[i], poly[(i + 1) % 8], base - .6, top, top, outward(poly, i));
    cap(S, k.platform, poly, top);
  }
  const floor = base + .54, rp = R - 1.05, posts = Array.from({ length: 8 }, (_, i) => ring(rp, i)), height = 3.05;
  for (const [x, z] of posts) { S.box(k.iron, .09, height, .09, x, floor + height / 2, z); S.box(k.iron, .2, .1, .2, x, floor + .05, z); S.box(k.iron, .16, .12, .16, x, floor + height, z); }
  for (let i = 0; i < 8; i++) {
    const a = posts[i], d = posts[(i + 1) % 8], span = Math.hypot(d[0] - a[0], d[1] - a[1]), yaw = Math.atan2(d[1] - a[1], d[0] - a[0]);
    S.beam(k.iron, [a[0], floor + height, a[1]], [d[0], floor + height, d[1]], .08, .16); S.beam(k.iron, [a[0], floor + height - .42, a[1]], [d[0], floor + height - .42, d[1]], .04, .04);
    // A scroll arch under each beam and a ring of scrolls in the frieze.
    const r = span * .45, mx = (a[0] + d[0]) / 2, mz = (a[1] + d[1]) / 2;
    S.place(k.iron, new THREE.TorusGeometry(r, .022, 4, 16, Math.PI), mx, floor + height - .42 - r * .55, mz, -yaw, 0, 0);
    for (const t of [-.3, 0, .3]) S.place(k.iron, new THREE.TorusGeometry(.13, .016, 4, 12), mx + Math.cos(yaw) * span * t, floor + height - .21, mz + Math.sin(yaw) * span * t, -yaw);
  }
  // The bell-shaped lattice dome, its rim and the finial.
  const profile = [[1, 0], [.99, .35], [.93, .75], [.8, 1.15], [.6, 1.55], [.38, 1.85], [.16, 2.05], [.04, 2.13]].map(([r, h]) => new THREE.Vector2(r * (rp + .08), h));
  const dome = new THREE.LatheGeometry(profile, 24); const uv = dome.getAttribute('uv'); for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 22, uv.getY(i) * 7);
  S.place(k.lattice, dome, c[0], floor + height + .02, c[1]);
  S.place(k.iron, new THREE.TorusGeometry(rp + .08, .045, 5, 28), c[0], floor + height + .03, c[1], 0, Math.PI / 2);
  for (let i = 0; i < 8; i++) { const p = ring(rp + .08, i), q = ring(.05, i); S.beam(k.iron, [p[0], floor + height + .03, p[1]], [(p[0] + q[0]) / 2, floor + height + 1.6, (p[1] + q[1]) / 2], .035, .035); }
  S.place(k.iron, new THREE.CylinderGeometry(.03, .05, 1, 6), c[0], floor + height + 2.6, c[1]); S.place(k.iron, new THREE.SphereGeometry(.11, 8, 6), c[0], floor + height + 2.3, c[1]); S.place(k.iron, new THREE.SphereGeometry(.06, 8, 6), c[0], floor + height + 3.12, c[1]);
  return S;
}

// ------------------------------------------------------------------ stone towers
function stoneTower(city: CityData, b: Building, k: Kit, o: { height: number; round: boolean }) {
  const S = new Shapes(), fp = b.footprint, c = centroid(fp), base = b.baseElevation ?? 0, footing = base - 1.6, H = o.height;
  const road = closestRoad(city, c[0], c[1], true), facing = Math.atan2(road.x - c[0], road.z - c[1]);  // yaw toward the street the door faces
  const stoneUV = (p: V3, n: Point2): UV => [(p[0] * n[1] - p[2] * n[0]) / 2, p[1] / 2];
  if (o.round) {
    const R = fp.reduce((s, p) => s + Math.hypot(p[0] - c[0], p[1] - c[1]), 0) / fp.length, sides = 28, top = R * .9, reps = Math.max(1, Math.round(Math.PI * R));
    const shaft = (r0: number, r1: number, y0: number, y1: number, inward = false) => {
      for (let i = 0; i < sides; i++) {
        const a0 = i / sides * Math.PI * 2, a1 = (i + 1) / sides * Math.PI * 2, P = (r: number, a: number, h: number): V3 => [c[0] + Math.sin(a) * r, h, c[1] + Math.cos(a) * r];
        const n: V3 = [Math.sin((a0 + a1) / 2) * (inward ? -1 : 1), 0, Math.cos((a0 + a1) / 2) * (inward ? -1 : 1)];
        const uv = (p: V3): UV => { let a = Math.atan2(p[0] - c[0], p[2] - c[1]); if (a < 0) a += Math.PI * 2; if (i === sides - 1 && a < .1) a = Math.PI * 2; return [a / (Math.PI * 2) * reps, p[1] / 2]; };
        S.poly(k.fieldstone, [P(r0, a0, y0), P(r0, a1, y0), P(r1, a1, y1), P(r1, a0, y1)], n, uv, true);
      }
    };
    const annulus = (r0: number, r1: number, h: number, up: boolean) => { for (let i = 0; i < sides; i++) { const a0 = i / sides * Math.PI * 2, a1 = (i + 1) / sides * Math.PI * 2, P = (r: number, a: number): V3 => [c[0] + Math.sin(a) * r, h, c[1] + Math.cos(a) * r]; S.poly(k.fieldstone, [P(r0, a0), P(r0, a1), P(r1, a1), P(r1, a0)], [0, up ? 1 : -1, 0], p => [p[0] / 2, p[2] / 2], true); } };
    const corbel = H - 1.5, parapet = H - .75, outer = top + .25;
    shaft(R, top, footing, base + corbel); annulus(top, outer, base + corbel, false); shaft(outer, outer, base + corbel, base + H);
    shaft(outer - .38, outer - .38, base + parapet, base + H, true); annulus(outer - .38, outer, base + H, true);
    S.poly(k.stone, Array.from({ length: sides }, (_, i) => [c[0] + Math.sin(i / sides * Math.PI * 2) * (outer - .38), base + parapet, c[1] + Math.cos(i / sides * Math.PI * 2) * (outer - .38)] as V3), [0, 1, 0], p => [p[0] / 2, p[2] / 2], true);
    // Iron railing on the parapet.
    for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2; S.box(k.iron, .05, 1.05, .05, c[0] + Math.sin(a) * (outer - .2), base + H + .52, c[1] + Math.cos(a) * (outer - .2)); }
    for (const h of [.55, 1.05]) S.place(k.iron, new THREE.TorusGeometry(outer - .2, .025, 4, 32), c[0], base + H + h, c[1], 0, Math.PI / 2);
    // Arched door toward the street with its steps, and slit windows on three levels.
    const radialAt = (a: number, r: number): Point2 => [c[0] + Math.sin(a) * r, c[1] + Math.cos(a) * r];
    { const [dx, dz] = radialAt(facing, R + .02); S.place(k.opening, new THREE.ShapeGeometry(archShape(1.05, 1.75), 8), dx, base, dz, facing); const [ax, az] = radialAt(facing, R + .06); S.place(k.granite, new THREE.RingGeometry(.53, .75, 10, 1, 0, Math.PI), ax, base + 1.75, az, facing);
      for (let step = 0; step < 3; step++) { const [sx, sz] = radialAt(facing, R + .45 + step * .38); S.box(k.granite, 1.8 - step * .1, .2, .4, sx, base - .1 - step * .2 + .1, sz, facing); } }
    for (let level = 0; level < 3; level++) for (const turn of [Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const a = facing + turn + level * .6, r = R - (R - top) * (3 + level * 3) / corbel, [wx, wz] = radialAt(a, r + .03);
      S.place(k.opening, new THREE.ShapeGeometry(archShape(.42, .7), 6), wx, base + 3 + level * 3, wz, a);
    }
  } else {
    // Square: the mapped walls up to a crenellated parapet.
    const poly = signedArea(fp) > 0 ? fp : [...fp].reverse(), parapet = H - .9;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], d = poly[(i + 1) % poly.length], n = outward(poly, i), fr = wallFrame(a, d, n);
      S.poly(k.fieldstone, [[a[0], footing, a[1]], [d[0], footing, d[1]], [d[0], base + H, d[1]], [a[0], base + H, a[1]]], [n[0], 0, n[1]], p => stoneUV(p, n), true);
      const ia: Point2 = [a[0] - n[0] * .4, a[1] - n[1] * .4], id: Point2 = [d[0] - n[0] * .4, d[1] - n[1] * .4];
      S.poly(k.fieldstone, [[ia[0], base + parapet, ia[1]], [id[0], base + parapet, id[1]], [id[0], base + H, id[1]], [ia[0], base + H, ia[1]]], [-n[0], 0, -n[1]], p => stoneUV(p, n), true);
      S.poly(k.stone, [[a[0], base + H, a[1]], [d[0], base + H, d[1]], [id[0], base + H, id[1]], [ia[0], base + H, ia[1]]], [0, 1, 0], p => [p[0] / 2, p[2] / 2], true);
      const merlons = Math.max(2, Math.round(fr.length / 1.3));
      for (let m = 0; m < merlons; m += 2) { const s = (m + .5) * fr.length / merlons, [mx, mz] = fr.at(s, -.2); S.box(k.fieldstone, fr.length / merlons, .65, .42, mx, base + H + .32, mz, fr.yaw); }
      for (const s of [fr.length / 2]) { const [wx, wz] = fr.at(s, .03); S.place(k.opening, new THREE.ShapeGeometry(archShape(.5, .8), 6), wx, base + 3.8, wz, fr.yaw); }
    }
    const floor = poly.map(p => { const q: Point2 = [p[0] + (c[0] - p[0]) * .12, p[1] + (c[1] - p[1]) * .12]; return q; });
    cap(S, k.stone, floor, base + parapet);
    // The door on the wall facing the street.
    let best = 0, score = -Infinity; for (let i = 0; i < poly.length; i++) { const n = outward(poly, i), v = Math.sin(facing) * n[0] + Math.cos(facing) * n[1]; if (v > score) { score = v; best = i; } }
    const a = poly[best], d = poly[(best + 1) % poly.length], fr = wallFrame(a, d, outward(poly, best)), [dx, dz] = fr.at(fr.length / 2, .03);
    S.place(k.opening, new THREE.ShapeGeometry(archShape(1.1, 1.8), 8), dx, base, dz, fr.yaw);
    for (let step = 0; step < 2; step++) { const [sx, sz] = fr.at(fr.length / 2, .35 + step * .38); S.box(k.granite, 1.8, .2, .4, sx, base - step * .2, sz, fr.yaw); }
  }
  return S;
}

/** The model for one of BUILDERS' buildings, its meshes in a group and its collider triangles. */
export function buildMelroseLandmark(city: CityData, b: Building, mobile: boolean): ParkLandmark | undefined {
  const builder = BUILDERS[b.id]; if (!builder) return undefined;
  const k = materials(mobile), S = builder(city, b, k), group = new THREE.Group(); group.name = `Northern landmark ${b.name ?? b.id}`; group.userData.buildingId = b.id;
  for (const mesh of S.meshes(group.name)) group.add(mesh);
  const vertices = new Float32Array(S.solid), indices = new Uint32Array(vertices.length / 3); for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { group, collisions: indices.length ? [{ vertices, indices }] : [] };
}
