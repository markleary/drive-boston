import * as THREE from 'three';
import type { Building, CityData, Point2 } from '../types';
import { TriangleWriter } from './geometry-writer.ts';

/** The modelling kit of the hand-built site landmarks (src/render/sites/*.ts): triangles per material with the solid
 * ones kept for the collider, masonry and roofing materials whose textures tile every 2 m of wall, and the parts a
 * building is put together from (walls on any outline, gable, hip and pyramid roofs, windows, doors, columns,
 * pediments, stairs, railings). Everything is written in world metres; a `Frame` gives a model its own axes.
 * Geometry is DOM-free: `siteKit()` paints its textures only where a document exists, so node tests build every model. */
export type V3 = [number, number, number];
export type UV = [number, number];
export type M = THREE.MeshStandardMaterial;

// ------------------------------------------------------------------ materials
const rand = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
type Paint = (x: CanvasRenderingContext2D, size: number) => void;
const hasDocument = typeof document !== 'undefined';
const TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
const toSRGB = (l: number) => Math.round(255 * (l <= .0031308 ? l * 12.92 : 1.055 * Math.min(1, l) ** (1 / 2.4) - .055));
/** A painted 2 m tile, rescaled so that its mean is mid grey in linear light: the material's colour is then the
 * finish's mean colour (returned), and a tint gives the same pattern any other colour. */
function texture(size: number, paint: Paint): { map: THREE.CanvasTexture; mean: [number, number, number] } | undefined {
  if (!hasDocument) return undefined;
  const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d', { willReadFrequently: true })!; paint(x, size);
  const image = x.getImageData(0, 0, size, size), d = image.data, mean: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) { mean[0] += TO_LINEAR[d[i]]; mean[1] += TO_LINEAR[d[i + 1]]; mean[2] += TO_LINEAR[d[i + 2]]; }
  for (let k = 0; k < 3; k++) mean[k] = Math.max(1e-3, mean[k] / (d.length / 4));
  const lut = [0, 1, 2].map(k => Uint8Array.from({ length: 256 }, (_, i) => toSRGB(TO_LINEAR[i] * MID / mean[k])));
  for (let i = 0; i < d.length; i += 4) { d[i] = lut[0][d[i]]; d[i + 1] = lut[1][d[i + 1]]; d[i + 2] = lut[2][d[i + 2]]; }
  x.putImageData(image, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; return { map: t, mean };
}
/** The linear grey every finish texture averages. */
const MID = .5;
/** Staggered courses of rectangular units (bricks, slates, ashlar blocks, shingles), colours wrapping so the tile repeats. */
const courses = (rows: number, cols: number, colours: string[], joint: string, seed: number, o: { gap?: number; shade?: number; lip?: number; jitter?: number } = {}): Paint => (x, size) => {
  const ch = size / rows, cw = size / cols, gap = (o.gap ?? .06) * ch;
  x.fillStyle = joint; x.fillRect(0, 0, size, size);
  for (let i = 0; i < rows; i++) for (let j = -1; j <= cols; j++) {
    const k = ((j % cols) + cols) % cols, r = rand(seed + i * 131 + k * 17), left = j * cw + (i % 2) * cw / 2, w = cw - gap, jit = (o.jitter ?? 0) * ch * (r() - .5);
    x.fillStyle = colours[Math.floor(r() * colours.length)]; x.fillRect(left + gap / 2, i * ch + gap / 2 + jit, w, ch - gap);
    x.fillStyle = `rgba(0,0,0,${(o.shade ?? .1) * r()})`; x.fillRect(left + gap / 2, i * ch + gap / 2, w, ch - gap);
    x.fillStyle = `rgba(255,255,255,${.07 * r()})`; x.fillRect(left + gap / 2, i * ch + gap / 2, w, (ch - gap) * .3);
    if (o.lip) { x.fillStyle = `rgba(0,0,0,${o.lip})`; x.fillRect(left + gap / 2, (i + 1) * ch - ch * .16, w, ch * .16); }
  }
};
const speckle = (base: string, seed: number, amount = 2600, lines = 0): Paint => (x, size) => {
  const r = rand(seed); x.fillStyle = base; x.fillRect(0, 0, size, size);
  for (let i = 0; i < amount; i++) { x.fillStyle = r() < .5 ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.08)'; x.fillRect(r() * size, r() * size, 1 + r() * 4, 1 + r() * 3); }
  for (let i = 0; i < lines; i++) { x.fillStyle = 'rgba(0,0,0,.16)'; x.fillRect(0, Math.round(i * size / lines), size, 1); }
};
const stripes = (base: string, line: string, n: number, vertical: boolean, seed: number, width = .08): Paint => (x, size) => {
  speckle(base, seed, 900)(x, size); x.fillStyle = line; const step = size / n;
  for (let i = 0; i < n; i++) vertical ? x.fillRect(i * step, 0, step * width, size) : x.fillRect(0, i * step, size, step * width);
  x.fillStyle = 'rgba(255,255,255,.1)'; for (let i = 0; i < n; i++) vertical ? x.fillRect(i * step + step * width, 0, step * width, size) : x.fillRect(0, i * step + step * width, size, step * width);
};
const rubble = (colours: string[], mortar: string, seed: number): Paint => (x, size) => {
  const r = rand(seed), cell = size / 6; x.fillStyle = mortar; x.fillRect(0, 0, size, size);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    const cx = (j + .5 + (r() - .5) * .35) * cell, cy = (i + .5 + (r() - .5) * .35) * cell, rx = cell * (.42 + r() * .16), ry = cell * (.34 + r() * .14), angle = r() * Math.PI, colour = colours[Math.floor(r() * colours.length)];
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
      x.fillStyle = colour; x.beginPath(); x.ellipse(cx + dx, cy + dy, rx, ry, angle, 0, Math.PI * 2); x.fill();
      x.fillStyle = 'rgba(255,255,255,.1)'; x.beginPath(); x.ellipse(cx + dx - rx * .2, cy + dy - ry * .25, rx * .55, ry * .4, angle, 0, Math.PI * 2); x.fill();
    }
  }
};
interface Recipe { color?: string; rough: number; metal?: number; paint?: Paint; emissive?: string; glow?: number; side?: THREE.Side; transparent?: number; }
/** Every finish by name. A texture is one 2 m square of wall or roof. */
const RECIPES = {
  brick: { rough: .9, paint: courses(30, 10, ['#a8503a', '#9e4834', '#b0583f', '#934331', '#b6604a', '#a54e39', '#9a4632', '#ab5540'], '#b4a491', 9173) },
  darkBrick: { rough: .9, paint: courses(30, 10, ['#7a3a2c', '#703427', '#84402f', '#6a3025', '#8a4634', '#763829'], '#9a8c7c', 4471) },
  buffBrick: { rough: .9, paint: courses(30, 10, ['#c9a777', '#c29f6f', '#d1b081', '#b9966a', '#cfae86', '#c4a274'], '#b9ab95', 2207) },
  whiteBrick: { rough: .88, paint: courses(30, 10, ['#e6e1d6', '#dfd9cc', '#ebe6dc', '#d8d2c5'], '#bdb6a8', 6113) },
  granite: { rough: .86, paint: courses(5, 2, ['#a9a59d', '#a19d96', '#b2aea6', '#9a968f', '#aeaaa3'], '#6f6c66', 811, { gap: .05, shade: .08 }) },
  limestone: { rough: .84, paint: courses(5, 2, ['#d8d0bb', '#d2c9b3', '#ddd6c3', '#cdc4ae'], '#a59d8a', 1543, { gap: .035, shade: .05 }) },
  brownstone: { rough: .9, paint: courses(6, 3, ['#7d5a48', '#765341', '#86624f', '#6f4d3d'], '#4f3a2f', 3301, { gap: .04 }) },
  sandstone: { rough: .9, paint: courses(6, 3, ['#c9a77c', '#c19e73', '#d0b088', '#b8966c'], '#8f7757', 3917, { gap: .04 }) },
  /** Roxbury puddingstone and seam-faced rubble. */
  fieldstone: { rough: .95, paint: rubble(['#8b847a', '#7c766d', '#9b9083', '#6e6a64', '#a18b74', '#8d7b67', '#b1a698', '#79654f', '#958d82'], '#6a655d', 5521) },
  /** Coursed rock-faced rubble in uneven blocks (slate stone, seam-faced granite). */
  rubble: { rough: .93, paint: courses(7, 3, ['#8f979f', '#868e96', '#9aa1a8', '#7d858d', '#a3a9ae', '#8a9097', '#949ba3'], '#666b70', 5527, { gap: .07, shade: .16, jitter: .1 }) },
  puddingstone: { rough: .95, paint: rubble(['#8a6f5f', '#7b6355', '#96796a', '#6d5a50', '#a08672', '#84705f', '#9b8f84', '#755c4a'], '#665a52', 7717) },
  slate: { rough: .68, paint: courses(12, 7, ['#5c6560', '#56605c', '#616a64', '#4f5955', '#666e68', '#5a625f', '#535c5a'], '#2b302e', 3301, { gap: .12, lip: .28 }) },
  redSlate: { rough: .7, paint: courses(12, 7, ['#7c4a40', '#74443b', '#844f44', '#6c3f37', '#80524a'], '#3a2420', 3359, { gap: .12, lip: .28 }) },
  shingle: { rough: .92, paint: courses(14, 9, ['#6f6457', '#675c50', '#776b5d', '#5f5549', '#7c7062'], '#3b342c', 6007, { gap: .14, lip: .3, jitter: .12 }) },
  asphaltShingle: { rough: .95, paint: courses(14, 6, ['#4b4a48', '#454442', '#51504d', '#403f3d'], '#2c2b2a', 6011, { gap: .1, lip: .2 }) },
  tile: { rough: .8, paint: courses(10, 8, ['#b0623f', '#a85a3a', '#b96a45', '#9f5335'], '#5e3423', 6029, { gap: .16, lip: .3 }) },
  copper: { rough: .5, metal: .3, paint: stripes('#7fb09a', '#5f917b', 5, true, 8111) },
  copperPlain: { color: '#6fa48d', rough: .5, metal: .3 },
  seam: { rough: .5, metal: .45, paint: stripes('#8d9296', '#6d7276', 5, true, 8123) },
  redSeam: { rough: .55, metal: .3, paint: stripes('#8d3b30', '#6f2c24', 5, true, 8147) },
  clapboard: { rough: .82, paint: stripes('#ebe7dc', '#bdb8ac', 16, false, 8209, .1) },
  stucco: { rough: .93, paint: speckle('#e2dccb', 8231) },
  concrete: { rough: .9, paint: speckle('#b6b2a7', 8243, 2600, 3) },
  castStone: { rough: .85, paint: speckle('#d6cfbe', 8263, 1400) },
  planks: { rough: .8, paint: stripes('#6b4a2f', '#3f2a1a', 10, false, 8273, .06) },
  paleDeck: { rough: .85, paint: stripes('#b59a72', '#7d6747', 12, true, 8287, .05) },
  paving: { rough: .92, paint: courses(8, 8, ['#a79f92', '#a0988b', '#aea699', '#99917f'], '#7c766b', 8291, { gap: .04, shade: .06 }) },
  brickPaving: { rough: .92, paint: courses(20, 10, ['#9c5a45', '#93523e', '#a5624c', '#8a4c3a'], '#6b5a4e', 8293, { gap: .05 }) },
  timber: { color: '#3d2a1e', rough: .8 }, trim: { color: '#ece8dd', rough: .7 }, cream: { color: '#d9cfb4', rough: .8 }, sash: { color: '#2b2622', rough: .7 }, whiteSash: { color: '#ece9e0', rough: .6 },
  deck: { color: '#47494b', rough: .95 }, gravel: { color: '#8b877d', rough: 1 }, iron: { color: '#1c1e1f', rough: .45, metal: .6 }, steel: { color: '#9aa1a6', rough: .4, metal: .7 }, bronze: { color: '#5b4a35', rough: .45, metal: .65 }, verdigris: { color: '#5d8f7c', rough: .6, metal: .3 },
  gold: { color: '#dcb643', rough: .29, metal: .76 }, redPaint: { color: '#a3261d', rough: .55 }, greenPaint: { color: '#22392e', rough: .55, metal: .2 }, blackPaint: { color: '#17191a', rough: .5 }, whitePaint: { color: '#f1eee6', rough: .55 }, bluePaint: { color: '#2c4a6e', rough: .55 },
  door: { color: '#3a2a20', rough: .6 }, redDoor: { color: '#7a231c', rough: .55 }, opening: { color: '#15140f', rough: .95 }, canvas: { color: '#e8e2d2', rough: .9, side: THREE.DoubleSide }, rope: { color: '#3b3226', rough: .9 },
  glass: { color: '#2a3740', rough: .14, metal: .45, emissive: '#f4c784', glow: 0 }, shopGlass: { color: '#33434a', rough: .1, metal: .4, emissive: '#f7d29a', glow: .04 },
  curtainWall: { color: '#4f6a78', rough: .12, metal: .6, emissive: '#cfe0ea', glow: 0 }, stained: { color: '#5a3b5e', rough: .3, metal: .1, emissive: '#b5527a', glow: .12 },
  lamp: { color: '#fff3d2', rough: .4, emissive: '#ffd58a', glow: .15 }, neon: { color: '#ffffff', rough: .4, emissive: '#ff5a3c', glow: .5 }, bulb: { color: '#fff7dd', rough: .4, emissive: '#ffe2a0', glow: .35 },
  grass: { color: '#5f7d45', rough: 1 }, water: { color: '#2f4d5c', rough: .2, metal: .3 },
} satisfies Record<string, Recipe>;
export type Finish = keyof typeof RECIPES;
export type SiteKit = Record<Finish, M> & {
  /** A named finish in another colour: the pattern of its texture (courses, joints, grain) about that mean colour. */ tint(base: Finish, color: string): M;
  /** Painted lettering on a board: one material per text and colour scheme. `aspect` is the board's width over its height. */
  sign(text: string, o?: { color?: string; background?: string; aspect?: number; font?: string; border?: boolean; lit?: boolean }): M;
  /** A clock dial showing ten past ten. */ clock: M;
};
const NIGHT: Partial<Record<Finish, [number, number]>> = { glass: [0, .8], shopGlass: [.04, 1], curtainWall: [0, .55], stained: [.12, .9], lamp: [.15, 2.4], neon: [.5, 2.6], bulb: [.35, 2.2] };
let kit: SiteKit | undefined, night = false; const lit: M[] = [], glowing: [M, [number, number]][] = [];
function applyNight(k: SiteKit) { for (const [name, [day, dark]] of Object.entries(NIGHT) as [Finish, [number, number]][]) k[name].emissiveIntensity = night ? dark : day; for (const [m, [day, dark]] of glowing) m.emissiveIntensity = night ? dark : day; for (const m of lit) m.emissiveIntensity = night ? 1.5 : .12; }
/** Window, lamp and sign glow by night (main.ts calls it with the other night switches). */
export function setSiteNight(value: boolean) { night = value; if (kit) applyNight(kit); }
export function siteKit(mobile = false): SiteKit {
  if (kit) return kit;
  const size = mobile ? 256 : 512, made = {} as Record<string, M>, tints = new Map<string, M>(), signs = new Map<string, M>();
  // Each finish is painted the first time a model asks for it (a few milliseconds a texture), not all thirty at once in
  // the frame that builds the first model.
  for (const [name, r] of Object.entries(RECIPES) as [Finish, Recipe][]) {
    let m: M | undefined;
    Object.defineProperty(made, name, { enumerable: true, get: () => {
      if (m) return m;
      const painted = r.paint ? texture(size, r.paint) : undefined;
      m = new THREE.MeshStandardMaterial({ color: r.color ?? '#999999', roughness: r.rough, metalness: r.metal ?? 0, ...(painted ? { map: painted.map } : {}), ...(r.emissive ? { emissive: r.emissive, emissiveIntensity: r.glow ?? 0 } : {}), ...(r.side ? { side: r.side } : {}) });
      if (painted) { m.color.setRGB(painted.mean[0] / MID, painted.mean[1] / MID, painted.mean[2] / MID, THREE.LinearSRGBColorSpace); m.userData.textured = true; }
      m.name = `site ${name}`; const glow = NIGHT[name]; if (glow) m.emissiveIntensity = night ? glow[1] : glow[0];
      return m;
    } });
  }
  const k = made as SiteKit;
  k.tint = (base, color) => { const key = base + color; let m = tints.get(key); if (!m) { m = k[base].clone(); m.color.set(color); if (m.userData.textured) m.color.multiplyScalar(1 / MID); m.name = `site ${base} ${color}`; const glow = NIGHT[base]; if (glow) { glowing.push([m, glow]); m.emissiveIntensity = night ? glow[1] : glow[0]; } tints.set(key, m); } return m; };
  k.sign = (text, o = {}) => {
    const color = o.color ?? '#efe6cf', background = o.background ?? '#1f2b2a', aspect = o.aspect ?? Math.max(2, text.length * .62), key = [text, color, background, aspect, o.font, o.border, o.lit].join('|'); let m = signs.get(key); if (m) return m;
    m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .7 }); m.name = `site sign ${text}`;
    if (hasDocument) {
      const c = document.createElement('canvas'), h = mobile ? 96 : 160, w = Math.min(2048, Math.round(h * aspect)); c.width = w; c.height = h; const x = c.getContext('2d')!;
      x.fillStyle = background; x.fillRect(0, 0, w, h); if (o.border) { x.strokeStyle = color; x.lineWidth = h * .04; x.strokeRect(h * .06, h * .06, w - h * .12, h - h * .12); }
      x.fillStyle = color; x.font = o.font ?? `600 ${Math.round(h * .62)}px Georgia, serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, w / 2, h * .53, w - h * .3);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; m.map = t;
      if (o.lit) { m.emissive.set('#ffffff'); m.emissiveMap = t; m.emissiveIntensity = night ? 1.5 : .12; lit.push(m); }
    } else m.color.set(background);
    signs.set(key, m); return m;
  };
  k.clock = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .5 }); k.clock.name = 'site clock';
  if (hasDocument) {
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d')!; x.fillStyle = '#f3efe2'; x.beginPath(); x.arc(128, 128, 126, 0, Math.PI * 2); x.fill(); x.strokeStyle = '#1b1b1b'; x.lineWidth = 8; x.stroke();
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; x.lineWidth = i % 3 ? 4 : 9; x.beginPath(); x.moveTo(128 + Math.sin(a) * 98, 128 - Math.cos(a) * 98); x.lineTo(128 + Math.sin(a) * 116, 128 - Math.cos(a) * 116); x.stroke(); }
    const hand = (a: number, l: number, w: number) => { x.lineWidth = w; x.lineCap = 'round'; x.beginPath(); x.moveTo(128, 128); x.lineTo(128 + Math.sin(a) * l, 128 - Math.cos(a) * l); x.stroke(); };
    hand(-Math.PI / 3 + .09, 58, 10); hand(Math.PI / 3, 92, 6);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; k.clock.map = t; k.clock.emissive.set('#ffffff'); k.clock.emissiveMap = t; k.clock.emissiveIntensity = .12; lit.push(k.clock);
  }
  kit = k; applyNight(k); return k;
}

// ------------------------------------------------------------------ plan geometry
export const signedArea = (p: Point2[]) => p.reduce((s, a, i) => { const c = p[(i + 1) % p.length]; return s + a[0] * c[1] - c[0] * a[1]; }, 0) / 2;
export const centroid = (p: Point2[]): Point2 => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
/** Outward unit normal of edge i of a simple polygon. */
export const outward = (p: Point2[], i: number): Point2 => { const a = p[i], b = p[(i + 1) % p.length], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, s = signedArea(p) > 0 ? 1 : -1; return [dz / l * s, -dx / l * s]; };
/** Sutherland-Hodgman: the part of a convex `poly` where f >= 0 (f linear). */
export function clip(poly: Point2[], f: (p: Point2) => number): Point2[] {
  const out: Point2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
/** A polygon grown (or shrunk, d < 0) by d on every edge; mitred corners. Convex outlines only for large d. */
export function inset(poly: Point2[], d: number): Point2[] {
  const n = poly.length;
  return poly.map((p, i) => {
    const a = outward(poly, (i + n - 1) % n), b = outward(poly, i), k = 1 + a[0] * b[0] + a[1] * b[1];
    return k < 1e-6 ? [p[0] + b[0] * d, p[1] + b[1] * d] as Point2 : [p[0] + (a[0] + b[0]) * d / k, p[1] + (a[1] + b[1]) * d / k] as Point2;
  });
}
/** A model's own axes: u along the front from `o`, v into the building. Boxes turned by `yaw` lie with their width along u. */
export interface Frame { o: Point2; U: Point2; V: Point2; yaw: number; W(u: number, v: number): Point2; uOf(p: Point2): number; vOf(p: Point2): number; }
/** Axes from `o` toward `along`; v points to the side `inside` lies on (to the left of u when it is left out). */
export function frame(o: Point2, along: Point2, inside?: Point2): Frame {
  const l = Math.hypot(along[0] - o[0], along[1] - o[1]) || 1, U: Point2 = [(along[0] - o[0]) / l, (along[1] - o[1]) / l]; let V: Point2 = [-U[1], U[0]];
  if (inside && (inside[0] - o[0]) * V[0] + (inside[1] - o[1]) * V[1] < 0) V = [-V[0], -V[1]];
  return { o, U, V, yaw: Math.atan2(-U[1], U[0]), W: (u, v) => [o[0] + U[0] * u + V[0] * v, o[1] + U[1] * u + V[1] * v], uOf: p => (p[0] - o[0]) * U[0] + (p[1] - o[1]) * U[1], vOf: p => (p[0] - o[0]) * V[0] + (p[1] - o[1]) * V[1] };
}
/** The frame of a footprint: u along its longest edge (or the edge nearest `front`), v into the footprint; `size` is its extent. */
export function footprintFrame(fp: Point2[], front?: Point2): Frame & { size: [number, number] } {
  let best = 0, score = -Infinity;
  for (let i = 0; i < fp.length; i++) { const a = fp[i], b = fp[(i + 1) % fp.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]); const value = front ? -Math.hypot((a[0] + b[0]) / 2 - front[0], (a[1] + b[1]) / 2 - front[1]) + Math.min(len, 12) : len; if (value > score) { score = value; best = i; } }
  const a = fp[best], b = fp[(best + 1) % fp.length], f0 = frame(a, b, centroid(fp)), us = fp.map(f0.uOf), vs = fp.map(f0.vOf), u0 = Math.min(...us), v0 = Math.min(...vs), f = frame(f0.W(u0, v0), f0.W(u0 + 1, v0), f0.W(u0, v0 + 1));
  return { ...f, size: [Math.max(...us) - u0, Math.max(...vs) - v0] };
}
export interface Rect { u0: number; u1: number; v0: number; v1: number; }
export const rectPoly = (f: Frame, r: Rect): Point2[] => [f.W(r.u0, r.v0), f.W(r.u1, r.v0), f.W(r.u1, r.v1), f.W(r.u0, r.v1)];
/** Placement on a wall: s metres along it from `a`, `out` metres proud of it; a part turned by `yaw` faces out of the wall. */
export interface WallFrame { a: Point2; b: Point2; t: Point2; n: Point2; yaw: number; length: number; at(s: number, out?: number): Point2; }
export const wallFrame = (a: Point2, b: Point2, n: Point2): WallFrame => {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, t: Point2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  return { a, b, t, n, length, yaw: Math.atan2(n[0], n[1]), at: (s, out = 0) => [a[0] + t[0] * s + n[0] * out, a[1] + t[1] * s + n[1] * out] };
};
/** The wall frames of a polygon's edges, each running left to right for a viewer outside. */
export function wallFrames(poly: Point2[]): WallFrame[] {
  return poly.map((a, i) => { const b = poly[(i + 1) % poly.length], n = outward(poly, i), leftToRight = (b[0] - a[0]) * n[1] - (b[1] - a[1]) * n[0] > 0; return leftToRight ? wallFrame(a, b, n) : wallFrame(b, a, n); });
}
/** The four walls of a rectangle: front (v0), right (u1), back (v1), left (u0). */
export function rectWalls(f: Frame, r: Rect): { front: WallFrame; right: WallFrame; back: WallFrame; left: WallFrame } {
  const p = rectPoly(f, r), w = wallFrames(p); return { front: w[0], right: w[1], back: w[2], left: w[3] };
}
/** n positions evenly spread over from..to (centres of n equal bays). */
export const spread = (from: number, to: number, n: number) => Array.from({ length: n }, (_, i) => from + (to - from) * (i + .5) / n);

// ------------------------------------------------------------------ shapes
const ONE = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0), SIDE = new THREE.Vector3(1, 0, 0), matrix = new THREE.Matrix4(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), euler = new THREE.Euler(), eye = new THREE.Vector3(), target = new THREE.Vector3();
/** Triangles per material, plus the solid ones the collider keeps. */
export class Shapes {
  private writers = new Map<THREE.Material, TriangleWriter>(); readonly solid: number[] = [];
  writer(m: THREE.Material) { let w = this.writers.get(m); if (!w) this.writers.set(m, w = new TriangleWriter()); return w; }
  get triangles() { let n = 0; for (const w of this.writers.values()) n += w.count / 3; return n; }
  tri(m: THREE.Material, a: V3, b: V3, c: V3, ua: UV, ub: UV, uc: UV, solid: boolean) {
    this.writer(m).triangle(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
    if (solid) this.solid.push(...a, ...b, ...c);
  }
  /** A planar polygon turned to face `toward`: fan-triangulated when convex, ear-cut otherwise. UVs default to 2 m world tiles. */
  poly(m: THREE.Material, pts: V3[], toward: V3, uv?: (p: V3) => UV, solid = false) {
    if (pts.length < 3) return;
    let nx = 0, ny = 0, nz = 0;
    for (let i = 1; i + 1 < pts.length; i++) { const a = pts[0], b = pts[i], c = pts[i + 1], ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; nx += uy * vz - uz * vy; ny += uz * vx - ux * vz; nz += ux * vy - uy * vx; }
    const flip = nx * toward[0] + ny * toward[1] + nz * toward[2] < 0, list = flip ? [...pts].reverse() : pts, l = Math.hypot(nx, ny, nz) || 1, N: V3 = [nx / l * (flip ? -1 : 1), ny / l * (flip ? -1 : 1), nz / l * (flip ? -1 : 1)];
    const map = uv ?? planarUV(N);
    if (list.length < 5 || convex3(list, N)) { for (let i = 1; i + 1 < list.length; i++) this.tri(m, list[0], list[i], list[i + 1], map(list[0]), map(list[i]), map(list[i + 1]), solid); return; }
    // Ear-cut in the plane's own axes.
    const ax: V3 = Math.abs(N[1]) > .9 ? [1, 0, 0] : [-N[2] / Math.hypot(N[0], N[2]), 0, N[0] / Math.hypot(N[0], N[2])], ay: V3 = [N[1] * ax[2] - N[2] * ax[1], N[2] * ax[0] - N[0] * ax[2], N[0] * ax[1] - N[1] * ax[0]];
    const flat = list.map(p => new THREE.Vector2(p[0] * ax[0] + p[1] * ax[1] + p[2] * ax[2], p[0] * ay[0] + p[1] * ay[1] + p[2] * ay[2]));
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(flat, [])) {
      const a = list[i], b = list[j], c = list[k], cx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), cz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cx * N[0] + cy * N[1] + cz * N[2] >= 0) this.tri(m, a, b, c, map(a), map(b), map(c), solid); else this.tri(m, a, c, b, map(a), map(c), map(b), solid);
    }
  }
  /** A decorative box (unit UVs per face): w along its yaw's x, d out of a wall of that yaw. */
  box(m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0) {
    matrix.compose(position.set(x, y, z), quaternion.setFromEuler(euler.set(pitch, yaw, roll, 'YXZ')), ONE); this.writer(m).box({ w, h, d }, matrix);
  }
  /** A box from a to b (its depth axis), w wide and h high. */
  beam(m: THREE.Material, a: V3, b: V3, w: number, h = w) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); if (length < 1e-3) return;
    matrix.lookAt(eye.set(...a), target.set(...b), Math.abs(b[1] - a[1]) / length > .98 ? SIDE : UP); matrix.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    this.writer(m).box({ w, h, d: length }, matrix);
  }
  /** A round bar or spar from a to b (radius ra at a, rb at b). */
  rod(m: THREE.Material, a: V3, b: V3, ra: number, rb = ra, segments = 8) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); if (length < 1e-3) return;
    const g = new THREE.CylinderGeometry(rb, ra, length, segments, 1); quaternion.setFromUnitVectors(UP, target.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize());
    matrix.compose(position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), quaternion, ONE); this.writer(m).append(g, matrix); g.dispose();
  }
  /** Any three.js geometry, placed and turned (smooth normals and its own UVs kept). */
  place(m: THREE.Material, geometry: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0, scale?: V3) {
    matrix.compose(position.set(x, y, z), quaternion.setFromEuler(euler.set(pitch, yaw, roll, 'YXZ')), scale ? eye.set(...scale) : ONE); this.writer(m).append(geometry, matrix); geometry.dispose();
  }
  /** A vertical wall from a to b, its tops at ya and yb, facing `out`; courses follow world height. */
  wall(m: THREE.Material, a: Point2, b: Point2, bottom: number, ya: number, yb: number, out: Point2, solid = true) {
    const uv = (p: V3): UV => [(p[0] * out[1] - p[2] * out[0]) / 2, p[1] / 2];
    this.poly(m, [[a[0], bottom, a[1]], [b[0], bottom, b[1]], [b[0], yb, b[1]], [a[0], ya, a[1]]], [out[0], 0, out[1]], uv, solid);
  }
  /** A flat roof, floor or soffit over a polygon. */
  cap(m: THREE.Material, poly: Point2[], y: number, up = true, solid = true) { this.poly(m, poly.map(p => [p[0], y, p[1]] as V3), [0, up ? 1 : -1, 0], p => [p[0] / 2, p[2] / 2], solid); }
  /** Walls round a polygon from y0 to y1, with a flat top in `top` (the wall material when left out; null for none). Returns its wall frames. */
  prism(m: THREE.Material, poly: Point2[], y0: number, y1: number, o: { top?: THREE.Material | null; bottom?: THREE.Material; solid?: boolean } = {}): WallFrame[] {
    const solid = o.solid ?? true;
    for (let i = 0; i < poly.length; i++) this.wall(m, poly[i], poly[(i + 1) % poly.length], y0, y1, y1, outward(poly, i), solid);
    if (o.top !== null) this.cap(o.top ?? m, poly, y1, true, solid); if (o.bottom) this.cap(o.bottom, poly, y0, false, false);
    return wallFrames(poly);
  }
  /** A textured solid block: w along the yaw's x, d along its z, centred on (x, z), from y0 to y1. */
  block(m: THREE.Material, w: number, d: number, x: number, z: number, y0: number, y1: number, yaw = 0, o: { top?: THREE.Material | null; solid?: boolean } = {}): WallFrame[] {
    const c = Math.cos(yaw), s = Math.sin(yaw), P = (u: number, v: number): Point2 => [x + c * u + s * v, z - s * u + c * v];
    return this.prism(m, [P(-w / 2, -d / 2), P(w / 2, -d / 2), P(w / 2, d / 2), P(-w / 2, d / 2)], y0, y1, o);
  }
  /** A faceted round (or n-sided) shaft with world-scaled UVs: radius r0 at y0, r1 at y1. `turn` rotates its first corner. */
  drum(m: THREE.Material, x: number, z: number, r0: number, r1: number, y0: number, y1: number, sides = 20, o: { solid?: boolean; turn?: number; top?: THREE.Material | null } = {}) {
    const turn = o.turn ?? 0, solid = o.solid ?? true, P = (r: number, i: number, y: number): V3 => [x + Math.sin(i / sides * Math.PI * 2 + turn) * r, y, z + Math.cos(i / sides * Math.PI * 2 + turn) * r], girth = Math.PI * (r0 + r1) / sides;
    for (let i = 0; i < sides; i++) {
      const a = (i + .5) / sides * Math.PI * 2 + turn, uv = (p: V3): UV => [(i + (p === q1 || p === q2 ? 1 : 0)) * girth / 2, p[1] / 2], q0 = P(r0, i, y0), q1 = P(r0, i + 1, y0), q2 = P(r1, i + 1, y1), q3 = P(r1, i, y1);
      this.poly(m, r1 > 1e-4 ? [q0, q1, q2, q3] : [q0, q1, q2], [Math.sin(a), (r0 - r1) / Math.max(.01, y1 - y0), Math.cos(a)], uv, solid);
    }
    if (o.top !== null && r1 > 1e-4) this.poly(o.top ?? m, Array.from({ length: sides }, (_, i) => P(r1, i, y1)), [0, 1, 0], p => [p[0] / 2, p[2] / 2], solid);
  }
  /** An invisible solid box for the collider only. */
  solidBox(w: number, d: number, x: number, z: number, y0: number, y1: number, yaw = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw), P = (u: number, v: number, y: number): V3 => [x + c * u + s * v, y, z - s * u + c * v], q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [P(u * w / 2, v * d / 2, y0), P(u * w / 2, v * d / 2, y1)]);
    for (let i = 0; i < 4; i++) { const [a0, a1] = q[i], [b0, b1] = q[(i + 1) % 4]; this.solid.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1); }
    this.solid.push(...q[0][1], ...q[1][1], ...q[2][1], ...q[0][1], ...q[2][1], ...q[3][1]);
  }
  meshes(name: string) {
    const out: THREE.Mesh[] = [];
    for (const [material, writer] of this.writers) if (!writer.empty) { const mesh = new THREE.Mesh(writer.geometry(), material); mesh.name = name; mesh.castShadow = mesh.receiveShadow = true; out.push(mesh); }
    return out;
  }
  /** Bounds of everything written: [minX, minY, minZ, maxX, maxY, maxZ]. */
  bounds() {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const w of this.writers.values()) for (let i = 0; i < w.count * 3; i++) { const v = w.position[i], k = i % 3; if (v < b[k]) b[k] = v; if (v > b[k + 3]) b[k + 3] = v; }
    return b;
  }
}
const planarUV = (n: V3) => Math.abs(n[1]) > .7 ? (p: V3): UV => [p[0] / 2, p[2] / 2] : (p: V3): UV => [(p[0] * n[2] - p[2] * n[0]) / (2 * (Math.hypot(n[0], n[2]) || 1)), p[1] / 2];
function convex3(p: V3[], n: V3) {
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length], ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - b[0], vy = c[1] - b[1], vz = c[2] - b[2]; if ((uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] < -1e-7) return false; }
  return true;
}

// ------------------------------------------------------------------ roofs
/** One roof slope over a plan polygon whose height is given per point; `along` is the plan direction of its eave, and the
 * texture runs up the slope from its lowest point. */
export function slope(S: Shapes, m: THREE.Material, poly: Point2[], height: (p: Point2) => number, along: Point2, toward: V3, solid = true) {
  if (poly.length < 3) return; const across: Point2 = [-along[1], along[0]], low = poly.reduce((a, p) => height(p) < height(a) ? p : a, poly[0]), y0 = height(low), c0 = low[0] * across[0] + low[1] * across[1];
  S.poly(m, poly.map(p => [p[0], height(p), p[1]] as V3), toward, p => [(p[0] * along[0] + p[2] * along[1]) / 2, Math.hypot(p[0] * across[0] + p[2] * across[1] - c0, p[1] - y0) / 2], solid);
}
export interface RoofOptions { /** Ridge direction: along u (default) or v. */ axis?: 'u' | 'v'; /** Eaves beyond the walls. */ overhang?: number; /** Gable-end wall material (the triangles under the rakes); none when left out. */ wall?: THREE.Material; /** Fascia and rake trim. */ trim?: THREE.Material; solid?: boolean; }
/** A gable roof over a rectangle of a frame: two slopes from `eave` up `rise` to the ridge. Returns the ridge ends. */
export function gable(S: Shapes, f: Frame, r: Rect, eave: number, rise: number, m: THREE.Material, o: RoofOptions = {}): [V3, V3] {
  const along = o.axis !== 'v', g = along ? f : frame(f.W(r.u0, r.v0), f.W(r.u0, r.v1), f.W(r.u1, r.v0)), q: Rect = along ? r : { u0: 0, u1: r.v1 - r.v0, v0: 0, v1: r.u1 - r.u0 };
  const over = o.overhang ?? .3, half = (q.v1 - q.v0) / 2, mid = (q.v0 + q.v1) / 2, pitch = rise / half, solid = o.solid ?? true;
  const P = (u: number, v: number): V3 => { const [x, z] = g.W(u, v); return [x, eave + pitch * (half - Math.abs(v - mid)), z]; };
  for (const side of [-1, 1]) {
    const v0 = mid + side * (half + over), a = P(q.u0 - over, v0), b = P(q.u1 + over, v0), c = P(q.u1 + over, mid), d = P(q.u0 - over, mid), len = Math.hypot(half + over, pitch * (half + over));
    const uv = (p: V3): UV => [g.uOf([p[0], p[2]]) / 2, (1 - Math.abs(g.vOf([p[0], p[2]]) - mid) / (half + over)) * len / 2];
    S.poly(m, [a, b, c, d], [g.V[0] * side, 1, g.V[1] * side], uv, solid);
    if (o.trim) { S.beam(o.trim, [a[0], a[1] - .09, a[2]], [b[0], b[1] - .09, b[2]], .06, .2); for (const [p, e] of [[a, d], [b, c]] as [V3, V3][]) S.beam(o.trim, [p[0], p[1] - .09, p[2]], [e[0], e[1] - .09, e[2]], .2, .08); }
  }
  if (o.wall) for (const u of [q.u0, q.u1]) { const a = g.W(u, q.v0), b = g.W(u, q.v1), c = g.W(u, mid), n: Point2 = u === q.u0 ? [-g.U[0], -g.U[1]] : g.U; S.poly(o.wall, [[a[0], eave, a[1]], [b[0], eave, b[1]], [c[0], eave + rise, c[1]]], [n[0], 0, n[1]], p => [(p[0] * n[1] - p[2] * n[0]) / 2, p[1] / 2], solid); }
  return [P(q.u0 - over, mid), P(q.u1 + over, mid)];
}
/** A hipped roof over a rectangle: all four sides slope at the pitch that reaches `rise` over the shorter half-span;
 * `deck` leaves a flat top that far in from the eaves (a mansard or truncated hip), covered in `o.deckMaterial`. */
export function hip(S: Shapes, f: Frame, r: Rect, eave: number, rise: number, m: THREE.Material, o: { overhang?: number; deck?: number; deckMaterial?: THREE.Material; trim?: THREE.Material; solid?: boolean } = {}) {
  const over = o.overhang ?? .3, u0 = r.u0 - over, u1 = r.u1 + over, v0 = r.v0 - over, v1 = r.v1 + over, span = Math.min(u1 - u0, v1 - v0) / 2, run = Math.min(o.deck ?? span, span), top = eave + rise, solid = o.solid ?? true;
  const outer = [f.W(u0, v0), f.W(u1, v0), f.W(u1, v1), f.W(u0, v1)], inner = [f.W(u0 + run, v0 + run), f.W(u1 - run, v0 + run), f.W(u1 - run, v1 - run), f.W(u0 + run, v1 - run)], len = Math.hypot(run, rise);
  for (let i = 0; i < 4; i++) {
    const a = outer[i], b = outer[(i + 1) % 4], ia = inner[i], ib = inner[(i + 1) % 4], n = outward(outer, i), t: Point2 = [b[0] - a[0], b[1] - a[1]], tl = Math.hypot(...t), same = Math.hypot(ia[0] - ib[0], ia[1] - ib[1]) < 1e-4;
    const uv = (p: V3): UV => [((p[0] - a[0]) * t[0] + (p[2] - a[1]) * t[1]) / tl / 2, (p[1] - eave) / rise * len / 2];
    S.poly(m, same ? [[a[0], eave, a[1]], [b[0], eave, b[1]], [ia[0], top, ia[1]]] : [[a[0], eave, a[1]], [b[0], eave, b[1]], [ib[0], top, ib[1]], [ia[0], top, ia[1]]], [n[0], 1, n[1]], uv, solid);
    if (o.trim) { S.beam(o.trim, [a[0], eave - .08, a[1]], [b[0], eave - .08, b[1]], .08, .2); S.beam(o.trim, [a[0], eave + .04, a[1]], [ia[0], top + .04, ia[1]], .12, .1); }
  }
  if (run < span - 1e-4) S.cap(o.deckMaterial ?? m, inner, top, true, solid);
  return { top, inner };
}
/** Slopes from each edge of a plan polygon at `y` up to an apex (the centroid when left out): a pyramid, spire or tent roof. */
export function pyramid(S: Shapes, m: THREE.Material, poly: Point2[], y: number, apexY: number, apex: Point2 = centroid(poly), o: { trim?: THREE.Material; solid?: boolean } = {}) {
  const top: V3 = [apex[0], apexY, apex[1]];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], n = outward(poly, i), t: Point2 = [b[0] - a[0], b[1] - a[1]], tl = Math.hypot(...t) || 1, run = Math.abs((apex[0] - a[0]) * n[0] + (apex[1] - a[1]) * n[1]), len = Math.hypot(run, apexY - y);
    S.poly(m, [[a[0], y, a[1]], [b[0], y, b[1]], top], [n[0], .5, n[1]], p => [((p[0] - a[0]) * t[0] + (p[2] - a[1]) * t[1]) / tl / 2, (p[1] - y) / (apexY - y) * len / 2], o.solid ?? true);
    if (o.trim) S.beam(o.trim, [a[0], y, a[1]], top, .1, .1);
  }
  return top;
}
/** A dome or any surface of revolution from a profile of [radius, height above y] pairs (smooth). */
export function lathe(S: Shapes, m: THREE.Material, profile: [number, number][], x: number, y: number, z: number, segments = 32) {
  S.place(m, new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), segments), x, y, z);
}
export const dome = (S: Shapes, m: THREE.Material, x: number, y: number, z: number, r: number, rise = r, segments = 32) =>
  lathe(S, m, Array.from({ length: 13 }, (_, i) => [Math.cos(i / 12 * Math.PI / 2) * r, Math.sin(i / 12 * Math.PI / 2) * rise] as [number, number]), x, y, z, segments);

// ------------------------------------------------------------------ openings
export function archShape(width: number, spring: number, pointed = 0) {
  const s = new THREE.Shape(), r = width / 2; s.moveTo(-r, 0); s.lineTo(r, 0); s.lineTo(r, spring);
  if (pointed > 0) { const h = r * pointed; s.quadraticCurveTo(r, spring + h * .62, 0, spring + h); s.quadraticCurveTo(-r, spring + h * .62, -r, spring); } else s.absarc(0, spring, r, 0, Math.PI, false);
  s.lineTo(-r, 0); return s;
}
export interface WindowStyle { glass?: THREE.Material; frame?: THREE.Material; /** Sill and lintel or arch surround; null for none. */ sill?: THREE.Material | null; head?: THREE.Material | null; /** Panes across and up. */ panes?: [number, number]; /** How far the glass sits behind the wall face (a reveal box is drawn when > 0). */ reveal?: number; shutters?: THREE.Material; }
/** A rectangular window centred s along the wall with its sill at y: glass, frame, glazing bars, sill and lintel. */
export function rectWindow(S: Shapes, k: SiteKit, f: WallFrame, s: number, y: number, w: number, h: number, o: WindowStyle = {}) {
  const glass = o.glass ?? k.glass, fr = o.frame ?? k.whiteSash, [x, z] = f.at(s, .03), [fx, fz] = f.at(s, .06), [cols, rows] = o.panes ?? [2, 2];
  S.place(glass, new THREE.PlaneGeometry(w - .08, h - .08), x, y + h / 2, z, f.yaw);
  for (const side of [-1, 1]) S.box(fr, .08, h, .09, fx + f.t[0] * side * (w / 2 - .04), y + h / 2, fz + f.t[1] * side * (w / 2 - .04), f.yaw);
  for (const yy of [y + .04, y + h - .04]) S.box(fr, w, .08, .09, fx, yy, fz, f.yaw);
  for (let i = 1; i < cols; i++) { const [mx, mz] = f.at(s - w / 2 + w * i / cols, .06); S.box(fr, .04, h - .1, .05, mx, y + h / 2, mz, f.yaw); }
  for (let i = 1; i < rows; i++) S.box(fr, w - .1, i === Math.round(rows / 2) ? .06 : .04, .05, fx, y + h * i / rows, fz, f.yaw);
  if (o.sill !== null) { const [sx, sz] = f.at(s, .1); S.box(o.sill ?? k.castStone, w + .24, .1, .2, sx, y - .05, sz, f.yaw); }
  if (o.head !== null && o.head) { const [lx, lz] = f.at(s, .05); S.box(o.head, w + .3, .28, .1, lx, y + h + .14, lz, f.yaw); }
  if (o.shutters) for (const side of [-1, 1]) { const [hx, hz] = f.at(s + side * (w / 2 + w * .26), .05); S.box(o.shutters, w * .48, h, .05, hx, y + h / 2, hz, f.yaw); }
}
/** A round-arched (or, with `pointed`, a lancet) window: sill at y, the arch springing `spring` above it. */
export function archWindow(S: Shapes, k: SiteKit, f: WallFrame, s: number, y: number, w: number, spring: number, o: WindowStyle & { pointed?: number; tracery?: boolean } = {}) {
  const glass = o.glass ?? k.glass, fr = o.frame ?? k.whiteSash, [x, z] = f.at(s, .03), [fx, fz] = f.at(s, .06), r = w / 2, pointed = o.pointed ?? 0, [cols, rows] = o.panes ?? [2, 3];
  S.place(glass, new THREE.ShapeGeometry(archShape(w - .08, spring, pointed), 10), x, y, z, f.yaw);
  for (const side of [-1, 1]) S.box(fr, .08, spring, .09, fx + f.t[0] * side * (r - .04), y + spring / 2, fz + f.t[1] * side * (r - .04), f.yaw);
  S.box(fr, w, .08, .09, fx, y + .04, fz, f.yaw);
  for (let i = 1; i < cols; i++) { const [mx, mz] = f.at(s - r + w * i / cols, .06); S.box(fr, .045, spring + (pointed ? r * pointed * .8 : r * .9), .05, mx, y + (spring + (pointed ? r * pointed * .8 : r * .9)) / 2, mz, f.yaw); }
  for (let i = 1; i <= rows; i++) S.box(fr, w - .1, .04, .05, fx, y + spring * i / rows, fz, f.yaw);
  const head = o.head === undefined ? k.castStone : o.head;
  if (pointed) { if (head) { const hgt = r * pointed, P = (side: number, t: number): [number, number] => [side * (r + .08) * (1 - t * t), 1.24 * hgt * (1 - t) * t + (hgt + .08) * t * t]; for (const side of [-1, 1]) for (let i = 0; i < 6; i++) { const [u0, h0] = P(side, i / 6), [u1, h1] = P(side, (i + 1) / 6), [ax, az] = f.at(s + u0, .07), [bx, bz] = f.at(s + u1, .07); S.beam(head, [ax, y + spring + h0, az], [bx, y + spring + h1, bz], .1, .16); } } }
  else { S.place(fr, new THREE.RingGeometry(r - .08, r, 14, 1, 0, Math.PI), fx, y + spring, fz, f.yaw); if (head) { const [ax, az] = f.at(s, .05); S.place(head, new THREE.RingGeometry(r + .02, r + .26, 16, 1, 0, Math.PI), ax, y + spring, az, f.yaw); } }
  if (o.sill !== null) { const [sx, sz] = f.at(s, .1); S.box(o.sill ?? k.castStone, w + .22, .1, .2, sx, y - .05, sz, f.yaw); }
}
/** A round window centred at height y. */
export function oculus(S: Shapes, k: SiteKit, f: WallFrame, s: number, y: number, r: number, o: WindowStyle = {}) {
  const [x, z] = f.at(s, .03), [fx, fz] = f.at(s, .06); S.place(o.glass ?? k.glass, new THREE.CircleGeometry(r, 20), x, y, z, f.yaw);
  S.place(o.frame ?? k.castStone, new THREE.RingGeometry(r, r + .18, 24), fx, y, fz, f.yaw); for (const a of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) S.box(o.frame ?? k.castStone, r * 2, .05, .05, fx, y, fz, f.yaw, 0, a);
}
/** A door with its frame, centred s along the wall, threshold at y; `arch` adds a fanlight of that spring above the leaf. */
export function door(S: Shapes, k: SiteKit, f: WallFrame, s: number, y: number, w: number, h: number, o: { leaf?: THREE.Material; frame?: THREE.Material; glazed?: boolean; fan?: boolean; double?: boolean } = {}) {
  const leaf = o.leaf ?? k.door, fr = o.frame ?? k.trim, [x, z] = f.at(s, .04), [fx, fz] = f.at(s, .08);
  S.place(o.glazed ? k.shopGlass : leaf, new THREE.PlaneGeometry(w, h), x, y + h / 2, z, f.yaw);
  if (o.glazed) S.box(leaf, w, .25, .05, fx, y + .13, fz, f.yaw); else for (const [du, dv] of [[-.25, .68], [.25, .68], [-.25, .28], [.25, .28]]) { const [px, pz] = f.at(s + du * w, .06); S.box(k.tint('door', '#2a1d16'), w * .32, h * .26, .03, px, y + h * dv, pz, f.yaw); }
  if (o.double !== false && w > 1.3) S.box(fr, .05, h, .06, fx, y + h / 2, fz, f.yaw);
  for (const side of [-1, 1]) S.box(fr, .14, h + .14, .14, fx + f.t[0] * side * (w / 2 + .07), y + (h + .14) / 2, fz + f.t[1] * side * (w / 2 + .07), f.yaw);
  S.box(fr, w + .28, .16, .16, fx, y + h + .08, fz, f.yaw);
  if (o.fan) { const [ax, az] = f.at(s, .04); S.place(k.glass, new THREE.CircleGeometry(w / 2, 14, 0, Math.PI), ax, y + h + .16, az, f.yaw); S.place(fr, new THREE.RingGeometry(w / 2, w / 2 + .14, 14, 1, 0, Math.PI), fx, y + h + .16, fz, f.yaw); for (const a of [Math.PI / 4, Math.PI / 2, Math.PI * 3 / 4]) { const [bx, bz] = f.at(s + Math.cos(a) * w / 4, .08); S.box(fr, .04, w / 2, .04, bx, y + h + .16 + Math.sin(a) * w / 4, bz, f.yaw, 0, a - Math.PI / 2); } }
}
/** A glazed shopfront from s0 to s1: bulkhead, plate glass between mullions, a fascia with an optional sign. */
export function shopfront(S: Shapes, k: SiteKit, f: WallFrame, s0: number, s1: number, y: number, h: number, o: { frame?: THREE.Material; bay?: number; sign?: string; signColors?: [string, string]; door?: number } = {}) {
  const fr = o.frame ?? k.blackPaint, w = s1 - s0, mid = (s0 + s1) / 2, [gx, gz] = f.at(mid, .04), [bx, bz] = f.at(mid, .09), fascia = Math.min(.7, h * .2);
  S.place(k.shopGlass, new THREE.PlaneGeometry(w, h - fascia - .5), gx, y + .5 + (h - fascia - .5) / 2, gz, f.yaw); S.box(fr, w, .5, .14, bx, y + .25, bz, f.yaw);
  const n = Math.max(1, Math.round(w / (o.bay ?? 2.4))); for (let i = 0; i <= n; i++) { const [mx, mz] = f.at(s0 + w * i / n, .09); S.box(fr, .1, h - fascia, .12, mx, y + (h - fascia) / 2, mz, f.yaw); }
  S.box(fr, w + .1, fascia, .2, bx, y + h - fascia / 2, bz, f.yaw);
  if (o.sign) { const [sx, sz] = f.at(mid, .2), sw = Math.min(w * .8, o.sign.length * fascia * .5); S.place(k.sign(o.sign, { color: o.signColors?.[0], background: o.signColors?.[1] ?? '#17191a', aspect: sw / (fascia * .8) }), new THREE.PlaneGeometry(sw, fascia * .8), sx, y + h - fascia / 2, sz, f.yaw); }
  if (o.door !== undefined) door(S, k, f, o.door, y, 1.8, Math.min(2.4, h - fascia - .1), { glazed: true, leaf: fr, frame: fr });
}

// ------------------------------------------------------------------ trim and classical parts
/** A projecting band (belt course, cornice, water table) along a wall from s0 to s1, centred on height y. */
export function band(S: Shapes, m: THREE.Material, f: WallFrame, s0: number, s1: number, y: number, h: number, out = .12) {
  const [x, z] = f.at((s0 + s1) / 2, out / 2); S.box(m, s1 - s0, h, out, x, y, z, f.yaw);
}
/** A band round a whole polygon. */
export function course(S: Shapes, m: THREE.Material, poly: Point2[], y: number, h: number, out = .12) {
  const grown = inset(poly, out); for (let i = 0; i < grown.length; i++) { const a = grown[i], b = grown[(i + 1) % grown.length]; S.beam(m, [a[0], y, a[1]], [b[0], y, b[1]], Math.max(out * 2, .1), h); }
}
/** A classical cornice round a polygon: bed mould, dentils and a projecting crown, its top at y. */
export function cornice(S: Shapes, m: THREE.Material, poly: Point2[], y: number, h = .7, out = .45, dentils = true) {
  course(S, m, poly, y - h * .75, h * .5, out * .35); course(S, m, poly, y - h * .2, h * .4, out);
  if (dentils) for (const f of wallFrames(poly)) for (let s = .2; s < f.length; s += .36) { const [x, z] = f.at(s, out * .5); S.box(m, .16, h * .2, .16, x, y - h * .5, z, f.yaw); }
}
/** A parapet wall round a flat roof: t thick, rising h above y, with a coping. */
export function parapet(S: Shapes, m: THREE.Material, poly: Point2[], y: number, h: number, t = .3, coping?: THREE.Material) {
  const inner = inset(poly, -t);
  for (let i = 0; i < poly.length; i++) { const j = (i + 1) % poly.length, n = outward(poly, i); S.wall(m, poly[i], poly[j], y, y + h, y + h, n); S.wall(m, inner[i], inner[j], y, y + h, y + h, [-n[0], -n[1]], false); S.poly(coping ?? m, [[poly[i][0], y + h, poly[i][1]], [poly[j][0], y + h, poly[j][1]], [inner[j][0], y + h, inner[j][1]], [inner[i][0], y + h, inner[i][1]]], [0, 1, 0]); }
  if (coping) course(S, coping, poly, y + h + .05, .1, .06);
}
/** A column standing on y: shaft with entasis, base and a Doric, Ionic or Corinthian-proportioned capital. */
export function column(S: Shapes, m: THREE.Material, x: number, z: number, y: number, h: number, r: number, o: { order?: 'doric' | 'ionic' | 'corinthian' | 'plain'; yaw?: number; square?: boolean } = {}) {
  const order = o.order ?? 'doric', yaw = o.yaw ?? 0, base = order === 'plain' ? 0 : r * .5, cap = order === 'plain' ? 0 : order === 'corinthian' ? r * 2.2 : r * .7, shaft = h - base - cap;
  if (base) { S.box(m, r * 2.7, base * .5, r * 2.7, x, y + base * .25, z, yaw); S.place(m, new THREE.CylinderGeometry(r * 1.12, r * 1.25, base * .5, 16), x, y + base * .75, z); }
  if (o.square) S.box(m, r * 2, shaft, r * 2, x, y + base + shaft / 2, z, yaw); else S.place(m, new THREE.CylinderGeometry(r * .85, r, shaft, 18), x, y + base + shaft / 2, z);
  if (!cap) return;
  const top = y + h;
  if (order === 'corinthian') { S.place(m, new THREE.CylinderGeometry(r * 1.35, r * .88, cap * .85, 14), x, top - cap * .57, z); S.box(m, r * 2.9, cap * .15, r * 2.9, x, top - cap * .075, z, yaw); }
  else { S.place(m, new THREE.CylinderGeometry(r * 1.2, r * .86, cap * .5, 16), x, top - cap * .75, z); S.box(m, r * 2.7, cap * .5, r * 2.7, x, top - cap * .25, z, yaw);
    if (order === 'ionic') for (const side of [-1, 1]) S.place(m, new THREE.CylinderGeometry(r * .42, r * .42, r * 2.5, 10), x + Math.cos(yaw) * side * r * 1.2, top - cap * .62, z - Math.sin(yaw) * side * r * 1.2, yaw, Math.PI / 2); }
}
/** A row of columns in front of a wall: at each s, `out` metres from it. Returns their plan positions. */
export function colonnade(S: Shapes, m: THREE.Material, f: WallFrame, at: number[], out: number, y: number, h: number, r: number, o: Parameters<typeof column>[7] = {}): Point2[] {
  return at.map(s => { const [x, z] = f.at(s, out); column(S, m, x, z, y, h, r, { ...o, yaw: f.yaw }); return [x, z] as Point2; });
}
/** A triangular pediment standing on y over s0..s1 of a wall, its face `out` metres proud: raking cornices, tympanum and its roof back to the wall. */
export function pediment(S: Shapes, m: THREE.Material, f: WallFrame, s0: number, s1: number, y: number, rise: number, out: number, o: { tympanum?: THREE.Material; roof?: THREE.Material; oculus?: THREE.Material } = {}) {
  const mid = (s0 + s1) / 2, A = (s: number, h: number, d: number): V3 => { const [x, z] = f.at(s, d); return [x, y + h, z]; }, face = out - .12;
  S.poly(o.tympanum ?? m, [A(s0, 0, face), A(s1, 0, face), A(mid, rise, face)], [f.n[0], 0, f.n[1]]);
  S.beam(m, A(s0 - .2, .12, out / 2), A(s1 + .2, .12, out / 2), out + .2, .3);
  for (const s of [s0 - .2, s1 + .2]) S.beam(m, A(s, .22, out / 2), A(mid, rise + .22, out / 2), out + .2, .3);
  for (const [a, b] of [[s0 - .2, mid], [mid, s1 + .2]]) S.poly(o.roof ?? m, [A(a, a === mid ? rise + .38 : .38, out + .1), A(b, b === mid ? rise + .38 : .38, out + .1), A(b, b === mid ? rise + .38 : .38, -.02), A(a, a === mid ? rise + .38 : .38, -.02)], [0, 1, 0]);
  if (o.oculus) { const [x, z] = f.at(mid, face + .02); S.place(o.oculus, new THREE.CircleGeometry(rise * .28, 16), x, y + rise * .42, z, f.yaw); }
}
/** A flight of n steps against a wall: w wide, centred s along it, its top landing at height `top`; solid. Returns the run. */
export function stairs(S: Shapes, m: THREE.Material, f: WallFrame, s: number, w: number, top: number, n: number, o: { rise?: number; tread?: number; landing?: number; cheeks?: THREE.Material } = {}) {
  const rise = o.rise ?? .17, tread = o.tread ?? .32, landing = o.landing ?? 0;
  for (let i = 0; i < n; i++) { const depth = landing + (i + 1) * tread, [x, z] = f.at(s, depth / 2); S.block(m, w, depth, x, z, top - (i + 1) * rise - (i === n - 1 ? 1.2 : 0), top - i * rise, f.yaw); }
  if (o.cheeks) for (const side of [-1, 1]) { const depth = landing + n * tread, [x, z] = f.at(s + side * (w / 2 + .2), depth / 2); S.block(o.cheeks, .4, depth + .2, x, z, top - n * rise - 1.2, top + .25, f.yaw); }
  return landing + n * tread;
}
/** A railing or fence through points: posts every `spacing`, top and bottom rails, pickets when `pickets` is set. */
export function railing(S: Shapes, m: THREE.Material, pts: V3[], h = 1, o: { spacing?: number; pickets?: number; post?: number } = {}) {
  const post = o.post ?? .06;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.max(1, Math.round(len / (o.spacing ?? 1.6))), at = (t: number, up: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + up, a[2] + (b[2] - a[2]) * t];
    for (let j = 0; j <= n; j++) { const p = at(j / n, 0); S.box(m, post, h, post, p[0], p[1] + h / 2, p[2]); }
    S.beam(m, at(0, h), at(1, h), post * .9, post * .9); S.beam(m, at(0, h * .12), at(1, h * .12), post * .6, post * .6);
    if (o.pickets) { const k = Math.max(1, Math.round(len / o.pickets)); for (let j = 1; j < k; j++) { const p = at(j / k, 0); S.box(m, post * .35, h * .88, post * .35, p[0], p[1] + h * .56, p[2]); } }
  }
}
/** A chimney stack on a w by d plan from y0 to y1, with a corbelled cap and pots. */
export function chimney(S: Shapes, m: THREE.Material, x: number, z: number, y0: number, y1: number, w = .9, d = .6, yaw = 0, cap?: THREE.Material) {
  S.block(m, w, d, x, z, y0, y1, yaw); S.box(cap ?? m, w + .16, .14, d + .16, x, y1 + .07, z, yaw); S.box(cap ?? m, w + .06, .1, d + .06, x, y1 - .25, z, yaw);
}
/** A flagpole with a ball finial; `flag` hangs a flag of that material from it. */
export function flagpole(S: Shapes, k: SiteKit, x: number, y: number, z: number, h: number, flag?: THREE.Material, yaw = 0) {
  S.rod(k.whitePaint, [x, y, z], [x, y + h, z], .07, .04); S.place(k.gold, new THREE.SphereGeometry(.1, 10, 8), x, y + h + .08, z);
  if (flag) { const w = Math.min(2.4, h * .22), g = new THREE.PlaneGeometry(w, w * .58, 6, 1), p = g.getAttribute('position'); for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 2.4) * .08); g.computeVertexNormals(); S.place(flag, g, x + Math.cos(yaw) * (w / 2 + .05), y + h - w * .35, z - Math.sin(yaw) * (w / 2 + .05), yaw); }
}
/** A clock dial of radius r on a wall, with its bezel. */
export function clock(S: Shapes, k: SiteKit, f: WallFrame, s: number, y: number, r: number, bezel?: THREE.Material) {
  const [x, z] = f.at(s, .08), [bx, bz] = f.at(s, .05); S.place(k.clock, new THREE.CircleGeometry(r, 28), x, y, z, f.yaw); S.place(bezel ?? k.castStone, new THREE.RingGeometry(r, r * 1.14, 28), bx, y, bz, f.yaw);
}
/** A sign board on a wall: w by h, centred s along it at height y. */
export function signBoard(S: Shapes, k: SiteKit, f: WallFrame, s: number, y: number, w: number, h: number, text: string, o: Parameters<SiteKit['sign']>[1] & { out?: number; frame?: THREE.Material } = {}) {
  const out = o.out ?? .12, [x, z] = f.at(s, out), [bx, bz] = f.at(s, out / 2); S.place(k.sign(text, { ...o, aspect: w / h }), new THREE.PlaneGeometry(w, h), x, y, z, f.yaw); if (o.frame) S.box(o.frame, w + .16, h + .16, out - .02, bx, y, bz, f.yaw);
}
/** A free-standing sign or plaque facing `yaw`. */
export function plaque(S: Shapes, k: SiteKit, x: number, y: number, z: number, yaw: number, w: number, h: number, text: string, o: Parameters<SiteKit['sign']>[1] = {}) {
  S.place(k.sign(text, { ...o, aspect: w / h }), new THREE.PlaneGeometry(w, h), x + Math.sin(yaw) * .04, y, z + Math.cos(yaw) * .04, yaw); S.box(k.iron, w + .1, h + .1, .06, x, y, z, yaw);
}
/** A lamp post with a glowing lantern. */
export function lampPost(S: Shapes, k: SiteKit, x: number, y: number, z: number, h = 3.4) {
  S.rod(k.iron, [x, y, z], [x, y + h, z], .07, .045); S.place(k.iron, new THREE.CylinderGeometry(.12, .16, .3, 8), x, y + .15, z); S.place(k.lamp, new THREE.SphereGeometry(.2, 10, 8), x, y + h + .16, z); S.place(k.iron, new THREE.ConeGeometry(.2, .16, 8), x, y + h + .42, z);
}

// ------------------------------------------------------------------ site models
export interface SiteContext { city: CityData; k: SiteKit; mobile: boolean; /** Terrain height at a point. */ ground(x: number, z: number): number; /** Water surface height at a point, if it lies in mapped water. */ water(x: number, z: number): number | undefined; }
/** One hand-built structure. With `building` it stands in place of that tile building's shell when its tile streams in
 * (and of every id in `replaces`); without one it is an addition at `at`, built with its tile. */
export interface SiteModel {
  id: string; name: string; /** The Places to explore entry it belongs to. */ place: string;
  /** Key of the tile that builds it (the owner building's tile). */ tile: string; building?: string; replaces?: string[]; /** Where an addition stands. */ at?: Point2;
  /** Ground street trees, lamps, signs and park planting keep off for it: a circle of this radius about `at` (additions take 4 m
   * when it is left out), and any plan polygons a model paves or stands on beyond that (a forecourt, a flight of steps). */
  clear?: number; reserved?: Point2[][];
  /** Surveyed shells that stay but are painted in one plain colour instead of a generic windowed facade (a museum's granite, a
   * station's concrete), by building id: the model then dresses them (porticoes, windows, lettering) as its own geometry. */
  finish?: Record<string, { wall?: string; roof?: string }>;
  /** Kept shells collided by their own triangles instead of their convex hull, so that a forecourt or courtyard the hull would
   * fill can be driven and walked into (runtime only: the helicopter's hull index and the far box still take the hull). */
  exact?: string[];
  /** What it is modelled from: dates, architect, the features drawn and what is interpretive. */ note: string;
  build(ctx: SiteContext, b: Building | undefined): Shapes;
}
