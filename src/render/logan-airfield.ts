import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityData, Point2 } from '../types';
import { AIRCRAFT, AIRFIELD_LAYERS, LIVERIES, aircraftSolids, airfieldPaint, airfieldPaved, airfieldPolygons, isAirfieldData, rubberPatches, runwayFrame, type AircraftKind, type AirfieldData, type AirfieldLayer } from '../simulation/logan-airfield.ts';
import { sampleElevation } from '../simulation/terrain.ts';
import { DrapedSurface } from './draped-surface.ts';
import { PartBatches, TriangleWriter, box } from './geometry-writer.ts';
import type { Pace } from './pacing.ts';
import type { Upload } from './paced-upload.ts';

/** Logan's airfield (src/simulation/logan-airfield.ts, `airfield.json`): pavement and paint draped on the terrain a
 * 1 km tile at a time as the observer comes near, parked aircraft, jet bridges, wind cones and the field's lights.
 *
 * The pavement lies 2 cm over the ground, under every street surface (a service road across the apron stays
 * asphalt), with one polygon-offset unit so the order holds at any distance; the paint lies over it. Nothing here
 * collides but the aircraft and the bridges: the ground under the pavement is the terrain's own collider. */
export async function loadAirfieldData(url: string): Promise<AirfieldData | undefined> {
  try { const response = await fetch(url); if (!response.ok) return undefined; const data = JSON.parse(await response.text()); return isAirfieldData(data) ? data : undefined; } catch { return undefined; }
}

const PAVEMENT_OFFSET = .02, PAINT_OFFSET = .034, SLICE_MS = 2.5;
const noise = (size: number, base: [number, number, number], spread: number, draw?: (g: CanvasRenderingContext2D) => void) => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size; const g = canvas.getContext('2d')!, image = g.createImageData(size, size); let seed = 7;
  for (let i = 0; i < size * size; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; const v = (seed / 2 ** 32 - .5) * spread; image.data[i * 4] = base[0] + v; image.data[i * 4 + 1] = base[1] + v; image.data[i * 4 + 2] = base[2] + v; image.data[i * 4 + 3] = 255; }
  g.putImageData(image, 0, 0); draw?.(g);
  const texture = new THREE.CanvasTexture(canvas); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4; return texture;
};

function pavementMaterials() {
  const surface = (map: THREE.Texture, roughness: number) => { const m = new THREE.MeshStandardMaterial({ map, roughness, metalness: 0 }); m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1; return m; };
  // Concrete apron slabs: 7.5 m panels (the texture repeats every 15 m), darker joints, faint tyre scuffs.
  const slabs = noise(256, [168, 165, 156], 16, g => {
    g.strokeStyle = 'rgba(70,68,62,.55)'; g.lineWidth = 1.5; for (const p of [0, 128]) { g.beginPath(); g.moveTo(p + .5, 0); g.lineTo(p + .5, 256); g.moveTo(0, p + .5); g.lineTo(256, p + .5); g.stroke(); }
    g.fillStyle = 'rgba(60,58,54,.05)'; for (let i = 0; i < 40; i++) g.fillRect((i * 97) % 256, (i * 57) % 256, 18 + (i * 13) % 30, 2);
  });
  const paint = (color: string) => { const m = new THREE.MeshStandardMaterial({ color, roughness: .9 }); m.polygonOffset = true; m.polygonOffsetFactor = 0; m.polygonOffsetUnits = -1; return m; };
  return {
    layers: { runway: surface(noise(128, [62, 63, 66], 14), .96), taxiway: surface(noise(128, [92, 93, 94], 14), .95), apron: surface(slabs, .92), shoulder: surface(noise(128, [74, 75, 76], 10), .97) } as Record<AirfieldLayer, THREE.MeshStandardMaterial>,
    white: paint('#e6e5dd'), yellow: paint('#d9ad2b'),
    // Tyre rubber: a dark film over the asphalt and under the paint.
    rubber: (() => { const m = new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: .8, transparent: true, opacity: .3, depthWrite: false }); m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 0; return m; })(),
  };
}

/** A tapered slab between a root and a tip section (a wing half, a stabiliser, a fin): each section is its leading
 * and trailing edge points and a thickness; flat shaded. */
function slab(rootLE: THREE.Vector3, rootTE: THREE.Vector3, tipLE: THREE.Vector3, tipTE: THREE.Vector3, rootT: number, tipT: number, up: THREE.Vector3) {
  const c = (p: THREE.Vector3, t: number, s: number) => p.clone().addScaledVector(up, t * s / 2);
  const v = [c(rootLE, rootT, 1), c(rootTE, rootT, 1), c(tipTE, tipT, 1), c(tipLE, tipT, 1), c(rootLE, rootT, -1), c(rootTE, rootT, -1), c(tipTE, tipT, -1), c(tipLE, tipT, -1)];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]], positions: number[] = [];
  for (const [a, b, d, e] of quads) for (const k of [a, b, d, a, d, e]) positions.push(v[k].x, v[k].y, v[k].z);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.computeVertexNormals();
  // A slab mirrored through a plane winds inward: face every triangle away from the slab's middle.
  const mid = v.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / 8), p = g.attributes.position, n = g.attributes.normal, t = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    t.set((p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3 - mid.x, (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3 - mid.y, (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3 - mid.z);
    if (t.x * n.getX(i) + t.y * n.getY(i) + t.z * n.getZ(i) < 0) { const bx = p.getX(i + 1), by = p.getY(i + 1), bz = p.getZ(i + 1); p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)); p.setXYZ(i + 2, bx, by, bz); }
  }
  g.computeVertexNormals(); return g;
}
/** A body of revolution along x: stations of [x, radius, centre height], smooth shaded, closed at both ends. */
function revolve(stations: [number, number, number][], segments: number) {
  const positions: number[] = [], index: number[] = [];
  for (const [x, r, y] of stations) for (let s = 0; s < segments; s++) { const a = s / segments * Math.PI * 2; positions.push(x, y + Math.cos(a) * r, Math.sin(a) * r); }
  for (let i = 0; i + 1 < stations.length; i++) for (let s = 0; s < segments; s++) { const a = i * segments + s, b = i * segments + (s + 1) % segments, c = a + segments, d = b + segments; index.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setIndex(index); g.computeVertexNormals();
  // Normals must point outward whichever way the stations run.
  const p = g.attributes.position, n = g.attributes.normal, mid = stations[Math.floor(stations.length / 2)], k = Math.floor(stations.length / 2) * segments;
  if (n.getY(k) * (p.getY(k) - mid[2]) + n.getZ(k) * p.getZ(k) < 0) { for (let i = 0; i < index.length; i += 3) { const t = index[i + 1]; index[i + 1] = index[i + 2]; index[i + 2] = t; } g.setIndex(index); g.computeVertexNormals(); }
  return g.toNonIndexed();
}
const tinted = (g: THREE.BufferGeometry, color: string) => {
  const out = g.index ? g.toNonIndexed() : g, c = new THREE.Color(color), n = out.attributes.position.count, colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3)); out.deleteAttribute('uv'); return out;
};

/** One aircraft type in its own frame: nose at the origin, +x forward, y up from the ground, +z to its right.
 * `body` carries its colours per vertex; `livery` (fin, engine cowls, winglets) takes one colour an aircraft. */
export function aircraftGeometry(kind: AircraftKind): { body: THREE.BufferGeometry; livery: THREE.BufferGeometry } {
  const a = AIRCRAFT[kind], L = a.length, R = a.body / 2, Y = a.axis, S = a.span / 2, V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z), UP = V(0, 1, 0);
  const body: THREE.BufferGeometry[] = [], livery: THREE.BufferGeometry[] = [], white = '#eeeeea', grey = '#bfc3c6', dark = '#22262b', metal = '#8d9296';
  // Fuselage: a rounded nose, a constant section, and a tail cone whose underside sweeps up to the fin.
  const stations: [number, number, number][] = [], nose = R * 3.3, cone = R * 6.4;
  for (const t of [0, .04, .12, .25, .42, .62, .82, 1]) stations.push([-nose * t, Math.max(.05, R * Math.sqrt(1 - (1 - t) ** 2)), Y - R * .18 * (1 - t) ** 2]);
  stations.push([-(L - cone), R, Y]);
  for (const t of [.25, .5, .75, 1]) stations.push([-(L - cone) - cone * t, R * (1 - .86 * t), Y + R * .72 * t * t]);
  body.push(tinted(revolve(stations, 18), white));
  // Flight deck glazing and the cabin's window line, proud of the skin by a centimetre or two.
  const strip = (x0: number, x1: number, y: number, h: number, color: string) => { for (const side of [-1, 1]) { const z = Math.sqrt(Math.max(.01, R * R - (y - Y) ** 2)) + .015; body.push(tinted(slab(V(x0, y, side * z), V(x1, y, side * z), V(x0, y + h, side * (z - h * (y - Y + h / 2) / z)), V(x1, y + h, side * (z - h * (y - Y + h / 2) / z)), .03, .03, V(0, 0, side)), color)); } };
  strip(-nose * 1.05, -(L - cone * .9), Y + R * .22, R * .16, dark);
  body.push(tinted(slab(V(-nose * .34, Y + R * .5, -R * .62), V(-nose * .62, Y + R * .78, -R * .7), V(-nose * .34, Y + R * .5, R * .62), V(-nose * .62, Y + R * .78, R * .7), .06, .06, V(.5, .86, 0).normalize()), dark));
  // Wings: swept and tapered, with dihedral; a winglet at each tip in the livery colour.
  const rootChord = L * .19, tipChord = L * .045, wingX = -L * (kind === 'business' ? .46 : .37), wingY = Y - R * .62, sweep = Math.tan(a.sweep) * S, lift = S * .09;
  for (const side of [-1, 1]) {
    body.push(tinted(slab(V(wingX, wingY, side * R * .5), V(wingX - rootChord, wingY, side * R * .5), V(wingX - sweep, wingY + lift, side * S), V(wingX - sweep - tipChord, wingY + lift, side * S), rootChord * .12, tipChord * .1, UP), grey));
    livery.push(slab(V(wingX - sweep, wingY + lift, side * S), V(wingX - sweep - tipChord, wingY + lift, side * S), V(wingX - sweep - tipChord * .7, wingY + lift + L * .045, side * (S + .25)), V(wingX - sweep - tipChord * 1.15, wingY + lift + L * .045, side * (S + .25)), .14, .1, V(0, 0, side)));
  }
  // Tail: fin in the livery colour, stabilisers on the fuselage (on the fin's top for a T-tail).
  const finRoot = L * .17, finX = -L * .8, finTop = a.tail, finBase = Y + R * .55, tee = a.engines === 'tail';
  livery.push(slab(V(finX, finBase, 0), V(finX - finRoot, finBase + R * .3, 0), V(finX - finRoot * .72, finTop, 0), V(finX - finRoot * 1.12, finTop, 0), .42, .2, V(0, 0, 1)));
  const stabY = tee ? finTop - .1 : Y + R * .28, stabX = tee ? finX - finRoot * .7 : -L * .87, stabS = a.span * (tee ? .2 : .19), stabChord = L * .1;
  for (const side of [-1, 1]) body.push(tinted(slab(V(stabX, stabY, side * (tee ? 0 : R * .3)), V(stabX - stabChord, stabY, side * (tee ? 0 : R * .3)), V(stabX - stabS * .62, stabY + (tee ? 0 : stabS * .1), side * stabS), V(stabX - stabS * .62 - stabChord * .42, stabY + (tee ? 0 : stabS * .1), side * stabS), .3, .12, UP), grey));
  // Engines: cowls in the livery colour with a dark intake and exhaust, under the wing or on the rear fuselage.
  const cowlR = (kind === 'business' ? .42 : .6) * R, cowlL = cowlR * 3.6;
  for (const side of [-1, 1]) {
    const z = tee ? side * (R + cowlR * 1.15) : side * S * .33, x = tee ? -L * .68 : wingX - Math.tan(a.sweep) * Math.abs(z) + cowlL * .62, y = tee ? Y + R * .3 : wingY + Math.abs(z) / S * lift - cowlR * 1.12;
    const cowl = revolve([[x, cowlR * .86, y], [x - cowlL * .12, cowlR, y], [x - cowlL * .6, cowlR, y], [x - cowlL, cowlR * .62, y]], 12); cowl.translate(0, 0, z); livery.push(cowl);
    const core = revolve([[x - .05, cowlR * .78, y], [x - cowlL * .5, .05, y]], 10); core.translate(0, 0, z); body.push(tinted(core, dark));
    const exhaust = revolve([[x - cowlL * .98, cowlR * .5, y], [x - cowlL * 1.22, cowlR * .2, y]], 10); exhaust.translate(0, 0, z); body.push(tinted(exhaust, metal));
    body.push(tinted(tee ? slab(V(x - cowlL * .25, y, side * R * .8), V(x - cowlL * .8, y, side * R * .8), V(x - cowlL * .25, y, z - side * cowlR * .8), V(x - cowlL * .8, y, z - side * cowlR * .8), .3, .25, UP)
      : slab(V(x - cowlL * .3, y + cowlR * .8, z), V(x - cowlL * .95, y + cowlR * .8, z), V(x - cowlL * .45, y + cowlR * 1.45, z), V(x - cowlL * 1.1, y + cowlR * 1.45, z), .28, .28, V(0, 0, 1)), grey));
  }
  // Landing gear: struts and wheels, so the aircraft stands on the apron instead of floating over it.
  const wheel = (x: number, z: number, r: number, w: number) => { const g = new THREE.CylinderGeometry(r, r, w, 10).rotateX(Math.PI / 2).translate(x, r, z); body.push(tinted(g, dark)); };
  const strut = (x: number, z: number, top: number) => body.push(tinted(new THREE.BoxGeometry(.22, top - .3, .22).translate(x, (top + .3) / 2, z), metal));
  const noseGear = -L * .13, mainGear = wingX - rootChord * .62, track = a.span * .105, wr = Math.max(.32, R * .28);
  strut(noseGear, 0, Y - R * .8); for (const z of [-.22, .22]) wheel(noseGear, z * (R / 1.5), wr * .75, .2);
  for (const side of [-1, 1]) { strut(mainGear, side * track, wingY); for (const dx of kind === 'wide' ? [-.8, .8] : [0]) for (const dz of [-.3, .3]) wheel(mainGear + dx * wr * 1.5, side * track + dz * (R / 1.4), wr, .34); }
  return { body: mergeGeometries(body, false)!, livery: mergeGeometries(livery.map(g => { const out = g.index ? g.toNonIndexed() : g; out.deleteAttribute('uv'); return out; }), false)! };
}

export interface AirfieldOptions { mobile?: boolean; upload?: Upload; }
export function addLoganAirfield(scene: THREE.Object3D, city: CityData, data: AirfieldData | undefined, options: AirfieldOptions = {}) {
  const group = new THREE.Group(); group.name = 'Logan International Airport airfield';
  const collisions: { id: string; vertices: Float32Array; indices: Uint32Array }[] = [];
  if (!data) return { group, collisions, update: (_position: THREE.Vector3, _altitude: number) => {}, setLighting: (_night: boolean) => {}, stats: () => ({ cells: 0, built: 0, triangles: 0 }) };
  const materials = pavementMaterials(), paint = airfieldPaint(data), size = data.tileSize, ground = (x: number, z: number) => sampleElevation(city, x, z);
  const keys = [...new Set([...Object.keys(data.tiles), ...paint.keys()])];
  interface Cell { key: string; x0: number; z0: number; group?: THREE.Group; steps?: Generator<void, void>; triangles: number }
  const cells: Cell[] = keys.map(key => { const [tx, tz] = key.split('_').map(Number); return { key, x0: tx * size, z0: tz * size, triangles: 0 }; });
  const pace: Pace = { deadline: Infinity };
  // A rubber patch is drawn whole by the tile its middle lies in.
  const rubber: Point2[][][] = [[], []]; for (const runway of data.runways) rubberPatches(runway).forEach((patches, level) => rubber[level].push(...patches));
  const inCell = (cell: Cell, q: Point2[]) => { const x = q.reduce((s, p) => s + p[0], 0) / q.length, z = q.reduce((s, p) => s + p[1], 0) / q.length; return x >= cell.x0 && x < cell.x0 + size && z >= cell.z0 && z < cell.z0 + size; };
  function* build(cell: Cell): Generator<void, void> {
    const out = new THREE.Group(); out.name = `Airfield ${cell.key}`; const meshes: THREE.Mesh[] = [];
    const layer = function* (name: string, material: THREE.Material, polygons: Point2[][][], offset: number, uvScale: number): Generator<void, void> {
      if (!polygons.length) return;
      const surface = new DrapedSurface(city, { offset, uvScale, pace });
      for (const polygon of polygons) { yield* surface.add(polygon); if (performance.now() > pace.deadline) yield; }
      const geometry = yield* surface.geometrySteps(); if (!geometry.index!.count) { geometry.dispose(); return; }
      const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.receiveShadow = true; mesh.renderOrder = -2; mesh.matrixAutoUpdate = false; meshes.push(mesh); cell.triangles += geometry.index!.count / 3;
    };
    for (const name of AIRFIELD_LAYERS) yield* layer(`Airfield ${name}`, materials.layers[name], airfieldPolygons(data!, cell.key, name), name === 'shoulder' ? PAVEMENT_OFFSET - .004 : PAVEMENT_OFFSET, name === 'apron' ? 15 : 9);
    for (const [level, patches] of rubber.entries()) { const mine = patches.filter(q => inCell(cell, q)); const had = meshes.length; if (mine.length) yield* layer(`Airfield tyre rubber ${level}`, materials.rubber, mine.map(q => [q]), PAVEMENT_OFFSET + .004 + level * .002, 9); if (meshes.length > had) meshes[had].renderOrder = -1 + level * .1; }
    const marks = paint.get(cell.key);
    if (marks) { yield* layer('Airfield white paint', materials.white, marks.white.map(q => [q]), PAINT_OFFSET, 9); yield* layer('Airfield yellow paint', materials.yellow, marks.yellow.map(q => [q]), PAINT_OFFSET, 9); }
    // Shown whole: a tile's pavement without its paint, or half of its layers, would flash as it builds.
    out.add(...meshes); out.visible = false; group.add(out); cell.group = out;
    if (options.upload && meshes.length) yield* options.upload(meshes, pace);
    out.visible = true;
  }

  // Parked aircraft: two instanced meshes a type (the body's own colours, and the livery parts tinted per aircraft).
  const solids = new TriangleWriter(), matrix = new THREE.Matrix4(), bodyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .42, metalness: .18 }), liveryMaterial = new THREE.MeshStandardMaterial({ roughness: .4, metalness: .15 });
  const X = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(), tint = new THREE.Color(), kinds = new Map<AircraftKind, number>();
  for (const kind of Object.keys(AIRCRAFT) as AircraftKind[]) {
    const parked = data.aircraft.filter(a => a.kind === kind); if (!parked.length) continue; kinds.set(kind, parked.length);
    const shape = aircraftGeometry(kind), bodies = new THREE.InstancedMesh(shape.body, bodyMaterial, parked.length), liveries = new THREE.InstancedMesh(shape.livery, liveryMaterial, parked.length), spec = AIRCRAFT[kind];
    parked.forEach((plane, i) => {
      // The aircraft stands on the ground under its wing.
      const [hx, hz] = plane.heading, mx = plane.nose[0] - hx * spec.length * .47, mz = plane.nose[1] - hz * spec.length * .47, y = ground(mx, mz) + PAVEMENT_OFFSET;
      X.set(hx, 0, hz); Z.set(-hz, 0, hx); matrix.makeBasis(X, Y, Z).setPosition(plane.nose[0], y, plane.nose[1]);
      bodies.setMatrixAt(i, matrix); liveries.setMatrixAt(i, matrix); liveries.setColorAt(i, tint.set(LIVERIES[plane.livery % LIVERIES.length][0]));
      for (const part of aircraftSolids(kind)) { matrix.makeBasis(X, Y, Z).setPosition(plane.nose[0] - hx * part.along, y + part.y, plane.nose[1] - hz * part.along); solids.box(box(part.length, part.height, part.width), matrix); }
    });
    for (const mesh of [bodies, liveries]) { mesh.name = `Parked ${kind} aircraft`; mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere(); mesh.instanceMatrix.needsUpdate = true; group.add(mesh); }
  }

  // Jet bridges: a glazed tunnel from the terminal's second level to the aircraft's door, a rotunda at each bend,
  // and a wheeled column under the head. Cars pass beneath; the helicopter does not pass through.
  const batches = new PartBatches(400), shell = new THREE.MeshStandardMaterial({ color: '#c9ccca', roughness: .6, metalness: .25 }), glazing = new THREE.MeshStandardMaterial({ color: '#27343d', roughness: .25, metalness: .5 }), steel = new THREE.MeshStandardMaterial({ color: '#6c7377', roughness: .6, metalness: .5 });
  const unit = new THREE.Vector3(1, 1, 1), q = new THREE.Quaternion(), from = new THREE.Vector3(0, 0, 1), dir = new THREE.Vector3(), mid = new THREE.Vector3();
  const beam = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, h: number, material: THREE.Material, solid = false) => {
    dir.set(bx - ax, by - ay, bz - az); const length = dir.length(); if (length < .05) return;
    q.setFromUnitVectors(from, dir.normalize()); matrix.compose(mid.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, unit); batches.part(box(w, h, length), material, matrix); if (solid) solids.box(box(w, h, length), matrix);
  };
  const doors: Record<AircraftKind, number> = { wide: 4.9, narrow: 3.5, regional: 2.7, business: 1.6 }, planes = data.aircraft;
  for (const bridge of data.jetBridges) {
    const line: Point2[] = []; for (let i = 0; i < bridge.line.length; i += 2) line.push([bridge.line[i], bridge.line[i + 1]]);
    if (line.length < 2) continue;
    const head = line[line.length - 1], base = ground(line[0][0], line[0][1]);
    // A docked bridge comes down to its aircraft's door sill; an idle one stays level, parked at mid height.
    const docked = bridge.docked ? planes.reduce((best, p) => { const s = AIRCRAFT[p.kind], d = Math.hypot(p.nose[0] - p.heading[0] * s.length * .14 - head[0], p.nose[1] - p.heading[1] * s.length * .14 - head[1]); return !best || d < best.d ? { d, kind: p.kind } : best; }, undefined as { d: number; kind: AircraftKind } | undefined) : undefined;
    const floor0 = base + 4.3, floor1 = ground(head[0], head[1]) + (docked ? doors[docked.kind] : 3.6), lengths = line.map((p, i) => i ? Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]) : 0), total = lengths.reduce((s, v) => s + v, 0) || 1; let run = 0;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], y0 = floor0 + (floor1 - floor0) * run / total; run += lengths[i]; const y1 = floor0 + (floor1 - floor0) * run / total;
      beam(a[0], y0 + 1.35, a[1], b[0], y1 + 1.35, b[1], 2.5, 2.7, shell, true); beam(a[0], y0 + 1.6, a[1], b[0], y1 + 1.6, b[1], 2.56, 1.0, glazing);
      if (i < line.length - 1) { matrix.makeTranslation(b[0], y1 + 1.4, b[1]); batches.part(new THREE.CylinderGeometry(2.1, 2.1, 3.0, 12), shell, matrix); beam(b[0], ground(b[0], b[1]), b[1], b[0], y1, b[1], .7, .7, steel, true); }
    }
    const a = line[line.length - 2], len = lengths[lengths.length - 1] || 1, sx = head[0] - (head[0] - a[0]) / len * 3.2, sz = head[1] - (head[1] - a[1]) / len * 3.2, gy = ground(sx, sz);
    beam(sx, gy + .5, sz, sx, floor1, sz, .5, .5, steel, true); beam(sx - (head[1] - a[1]) / len * 1.6, gy + .45, sz + (head[0] - a[0]) / len * 1.6, sx + (head[1] - a[1]) / len * 1.6, gy + .45, sz - (head[0] - a[0]) / len * 1.6, .7, .9, steel);
    matrix.makeTranslation(head[0], floor1 + 1.4, head[1]); batches.part(new THREE.CylinderGeometry(1.7, 1.7, 2.9, 10), shell, matrix);
  }
  // Wind cones: a pole and an orange sleeve.
  const orange = new THREE.MeshStandardMaterial({ color: '#e0662a', roughness: .8 });
  for (const [x, z] of data.windsocks) { const y = ground(x, z); beam(x, y, z, x, y + 6, z, .16, .16, steel, true); matrix.makeRotationZ(Math.PI / 2).setPosition(x + 1.8, y + 5.8, z); batches.part(new THREE.CylinderGeometry(.45, .22, 3.4, 8, 1, true), orange, matrix); }
  for (const mesh of batches.meshes()) { mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'Jet bridges and wind cones'; group.add(mesh); }
  if (solids.count) { const g = solids.geometry(); collisions.push({ id: 'logan-airfield-aircraft', vertices: new Float32Array(g.attributes.position.array), indices: Uint32Array.from({ length: solids.count }, (_, i) => i) }); g.dispose(); }

  // The field's lights, drawn after dark: white along each runway's edges (amber over the last 600 m), green across
  // each threshold and red across each end, blue along the taxiways' edges (a taxilane across an apron has none).
  const paved = airfieldPaved(data);
  const lightPositions: number[] = [], lightColors: number[] = [], lamp = (x: number, z: number, r: number, g: number, b: number) => { lightPositions.push(x, ground(x, z) + .35, z); lightColors.push(r, g, b); };
  for (const runway of data.runways) for (const end of [0, 1] as const) {
    const f = runwayFrame(runway, end), half = runway.width / 2 + 1.5, t = runway.ends[end].displaced, p = (along: number, across: number): [number, number] => [f.origin[0] + f.u[0] * along + f.r[0] * across, f.origin[1] + f.u[1] * along + f.r[1] * across];
    for (let c = -half; c <= half; c += half / 5) { lamp(...p(t, c), .2, 1, .35); lamp(...p(-1, c), 1, .12, .1); }
    if (end === 0) for (let s = 0; s <= f.length; s += 60) for (const side of [-1, 1]) { const amber = s < 600 || s > f.length - 600; lamp(...p(s, side * half), 1, amber ? .72 : .95, amber ? .25 : .85); }
  }
  for (const line of data.taxiLines) for (let i = 2, carry = 0; i < line.length; i += 2) {
    const ax = line[i - 2], az = line[i - 1], bx = line[i], bz = line[i + 1], len = Math.hypot(bx - ax, bz - az); if (len < .1) continue;
    for (let s = carry; s < len; s += 45) for (const side of [-1, 1]) { const x = ax + (bx - ax) / len * s - (bz - az) / len * side * 12.4, z = az + (bz - az) / len * s + (bx - ax) / len * side * 12.4; if (paved(x, z) === 'shoulder') lamp(x, z, .2, .35, 1); }
    carry = (carry - len) % 45; if (carry < 0) carry += 45;
  }
  const lightGeometry = new THREE.BufferGeometry(); lightGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lightPositions, 3)); lightGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lightColors, 3));
  const lights = new THREE.Points(lightGeometry, new THREE.PointsMaterial({ size: options.mobile ? 3 : 2.6, sizeAttenuation: false, vertexColors: true, fog: true, toneMapped: false }));
  lights.name = 'Airfield lights'; lights.visible = false; lights.userData.noAO = true; lights.frustumCulled = false; group.add(lights);

  const reach = options.mobile ? 1250 : 1700, drop = reach + 600; let active: Cell | undefined;
  const distance = (cell: Cell, x: number, z: number) => Math.hypot(Math.max(cell.x0 - x, 0, x - cell.x0 - size), Math.max(cell.z0 - z, 0, z - cell.z0 - size));
  function update(position: THREE.Vector3, altitude: number) {
    const range = reach + Math.max(0, altitude) * (options.mobile ? .2 : .6);
    if (!active) { let best = Infinity; for (const cell of cells) { if (cell.group || cell.steps) continue; const d = distance(cell, position.x, position.z); if (d < range && d < best) { best = d; active = cell; } } if (active) active.steps = build(active); }
    if (active?.steps) { pace.deadline = performance.now() + SLICE_MS; if (active.steps.next().done) { active.steps = undefined; active = undefined; } }
    // A phone gives back the tiles it has left behind.
    if (options.mobile) for (const cell of cells) if (cell.group && cell !== active && distance(cell, position.x, position.z) > drop + Math.max(0, altitude) * .2) { for (const mesh of cell.group.children) (mesh as THREE.Mesh).geometry.dispose(); group.remove(cell.group); cell.group = undefined; cell.triangles = 0; }
  }
  scene.add(group);
  group.userData = { runways: data.runways.map(r => r.id), aircraft: Object.fromEntries(kinds), jetBridges: data.jetBridges.length, lights: lightPositions.length / 3, interpretation: 'FAA runway geometry and marking classes; OpenStreetMap taxiways, aprons, stands and jet bridges; generic aircraft with fictional tail colours' };
  return { group, collisions, update, setLighting: (night: boolean) => { lights.visible = night; }, stats: () => ({ cells: cells.length, built: cells.filter(c => c.group).length, triangles: cells.reduce((s, c) => s + c.triangles, 0) }) };
}
