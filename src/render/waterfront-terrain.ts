import * as THREE from 'three';
import data from '../data/waterfront.json' with { type: 'json' };
import type { CityData, Point2 } from '../types.ts';
import { drain, due, type Pace } from './pacing.ts';
import { boundingSphereSteps } from './paced-geometry.ts';

/** Offline hydro ∩ hard-quay neighborhood, with ground-road approaches removed.
 * These are water-only polygons; holes retain land and road foundations. */
export const waterfrontTerrainCuts: Point2[][][] = data.waterCuts.map(rings => rings.map(ring => ring.map(([x, z]): Point2 => [x, z])));
type Plane = [number, number, number];
interface CutTriangle { planes: Plane[]; minX: number; maxX: number; minZ: number; maxZ: number; }
interface CutIndex { triangles: CutTriangle[]; cells: Map<number, number[]>; stamps: Uint32Array; stamp: number; }
const CELL = 48, key = (x: number, z: number) => (x + 32768) * 65536 + z + 32768;
const indexes = new WeakMap<Point2[][][], { steps: Generator<void, CutIndex>; value?: CutIndex }>();

function* createIndexSteps(polygons: Point2[][][]): Generator<void, CutIndex> {
  const triangles: CutTriangle[] = [], cells = new Map<number, number[]>();
  for (const rings of polygons) {
    if (!rings[0]?.length) continue;
    const contour = rings[0].map(p => new THREE.Vector2(...p)), holes = rings.slice(1).map(ring => ring.map(p => new THREE.Vector2(...p)));
    const vertices = [...contour, ...holes.flat()];
    for (const face of THREE.ShapeUtils.triangulateShape(contour, holes)) {
      let [a, b, c] = face.map(i => vertices[i]);
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(cross) < 1e-9) continue;
      if (cross < 0) [b, c] = [c, b];
      const points = [a, b, c];
      const planes: Plane[] = points.map((p, i) => {
        const q = points[(i + 1) % 3], length = p.distanceTo(q), nx = -(q.y - p.y) / length, nz = (q.x - p.x) / length;
        return [nx, nz, nx * p.x + nz * p.y];
      });
      const triangle = { planes, minX: Math.min(a.x, b.x, c.x), maxX: Math.max(a.x, b.x, c.x), minZ: Math.min(a.y, b.y, c.y), maxZ: Math.max(a.y, b.y, c.y) };
      const id = triangles.length; triangles.push(triangle);
      for (let x = Math.floor(triangle.minX / CELL); x <= Math.floor(triangle.maxX / CELL); x++) for (let z = Math.floor(triangle.minZ / CELL); z <= Math.floor(triangle.maxZ / CELL); z++) {
        const k = key(x, z), list = cells.get(k); if (list) list.push(id); else cells.set(k, [id]);
      }
      if (triangles.length % 128 === 0) yield;
    }
    yield;
  }
  return { triangles, cells, stamps: new Uint32Array(triangles.length), stamp: 0 };
}

/** Concurrent tile generators advance the same initializer, rather than each
 * retaining another triangulation while the first one yields to the renderer. */
function* indexSteps(polygons: Point2[][][], pace?: Pace): Generator<void, CutIndex> {
  let state = indexes.get(polygons);
  if (!state) { state = { steps: createIndexSteps(polygons) }; indexes.set(polygons, state); }
  while (!state.value) {
    const next = state.steps.next(); if (next.done) state.value = next.value;
    else if (due(pace)) yield;
  }
  return state.value;
}

function candidates(index: CutIndex, minX: number, maxX: number, minZ: number, maxZ: number) {
  const out: number[] = [], stamp = ++index.stamp;
  for (let x = Math.floor(minX / CELL); x <= Math.floor(maxX / CELL); x++) for (let z = Math.floor(minZ / CELL); z <= Math.floor(maxZ / CELL); z++) {
    for (const id of index.cells.get(key(x, z)) ?? []) {
      if (index.stamps[id] === stamp) continue; index.stamps[id] = stamp;
      const t = index.triangles[id];
      if (t.maxX >= minX && t.minX <= maxX && t.maxZ >= minZ && t.minZ <= maxZ) out.push(id);
    }
  }
  // A stable clipping order keeps independently built seam triangles identical.
  return out.sort((a, b) => a - b);
}

/** Water in these footprints must remain level even when the old DEM contains
 * a building return, or interpolates a pier shoulder tens of metres offshore. */
export function inWaterfrontTerrainCut(x: number, z: number, polygons = waterfrontTerrainCuts) {
  const index = indexes.get(polygons)?.value ?? drain(indexSteps(polygons));
  for (const id of index.cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
    const t = index.triangles[id];
    if (x < t.minX || x > t.maxX || z < t.minZ || z > t.maxZ) continue;
    if (t.planes.every(([nx, nz, limit]) => nx * x + nz * z - limit >= -1e-8)) return true;
  }
  return false;
}

// Payload follows position with the source's smoothly interpolated normal and UV.
interface Corner { values: [number, number, number, number, number, number, number, number]; id?: number; }
const signed = (p: Corner, [nx, nz, limit]: Plane) => nx * p.values[0] + nz * p.values[2] - limit;

/** Convex subject minus convex triangle. At each clip edge the outside piece
 * is final; only the inside remainder proceeds to the next half-plane. */
function subtract(subject: Corner[], triangle: CutTriangle): Corner[][] {
  if (triangle.planes.some(plane => subject.every(p => signed(p, plane) <= -1e-8))) return [subject];
  const outside: Corner[][] = []; let inside = subject;
  for (const plane of triangle.planes) {
    const next: Corner[] = [], removed: Corner[] = [];
    let a = inside.at(-1)!; if (!a) break;
    let da = signed(a, plane); if (Math.abs(da) < 1e-8) da = 0;
    for (const b of inside) {
      let db = signed(b, plane); if (Math.abs(db) < 1e-8) db = 0;
      if ((da < 0) !== (db < 0)) {
        const t = da / (da - db), values = a.values.map((value, i) => value + (b.values[i] - value) * t) as Corner['values'];
        const point: Corner = { values }; next.push(point); removed.push(point);
      }
      if (db >= 0) next.push(b); else removed.push(b);
      a = b; da = db;
    }
    if (removed.length >= 3) outside.push(removed);
    inside = next;
  }
  return outside;
}

/** Remove only mapped water from the visual and physical terrain. New shore
 * vertices lie on their original terrain triangle, so surviving land keeps its
 * exact height/normal/UV and both neighboring tiles produce the same seam.
 * `polygons` is injectable for geometry regression fixtures. */
export function* clipWaterfrontTerrainSteps(_city: CityData, geometry: THREE.BufferGeometry, pace?: Pace, polygons = waterfrontTerrainCuts): Generator<void, THREE.BufferGeometry> {
  const source = geometry.getAttribute('position'); if (!source?.count || !polygons.length) return geometry;
  const cuts = yield* indexSteps(polygons, pace);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < source.count; i++) {
    if (i % 8192 === 0 && due(pace)) yield;
    minX = Math.min(minX, source.getX(i)); maxX = Math.max(maxX, source.getX(i)); minZ = Math.min(minZ, source.getZ(i)); maxZ = Math.max(maxZ, source.getZ(i));
  }
  if (!candidates(cuts, minX, maxX, minZ, maxZ).length) return geometry;
  const normal = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv'), index = geometry.index;
  const count = index?.count ?? source.count, sourceCorners = new Map<number, Corner>();
  const corner = (id: number) => {
    let value = sourceCorners.get(id);
    if (!value) {
      value = { id, values: [source.getX(id), source.getY(id), source.getZ(id), normal?.getX(id) ?? 0, normal?.getY(id) ?? 1, normal?.getZ(id) ?? 0,
        uv?.getX(id) ?? source.getX(id) / 4, uv?.getY(id) ?? source.getZ(id) / 4] };
      sourceCorners.set(id, value);
    }
    return value;
  };
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  const originalIds = new Map<number, number>(), generatedIds = new Map<string, number>();
  const vertex = (p: Corner) => {
    const v = p.values, hash = p.id === undefined ? v.map(Math.fround).join(',') : undefined;
    let id = p.id === undefined ? generatedIds.get(hash!) : originalIds.get(p.id);
    if (id !== undefined) return id;
    id = positions.length / 3; positions.push(v[0], v[1], v[2]);
    const length = Math.hypot(v[3], v[4], v[5]) || 1; normals.push(v[3] / length, v[4] / length, v[5] / length); uvs.push(v[6], v[7]);
    if (p.id === undefined) generatedIds.set(hash!, id); else originalIds.set(p.id, id);
    return id;
  };
  let changed = false;
  for (let i = 0; i + 2 < count; i += 3) {
    if (i % 192 === 0 && due(pace)) yield;
    const triangle = [0, 1, 2].map(k => corner(index ? index.getX(i + k) : i + k));
    const x = triangle.map(p => p.values[0]), z = triangle.map(p => p.values[2]);
    let fragments = [triangle];
    for (const id of candidates(cuts, Math.min(...x), Math.max(...x), Math.min(...z), Math.max(...z))) {
      const next: Corner[][] = [];
      for (const fragment of fragments) next.push(...subtract(fragment, cuts.triangles[id]));
      if (next.length !== fragments.length || next.some((part, j) => part !== fragments[j])) changed = true;
      fragments = next; if (!fragments.length) break;
    }
    for (const polygon of fragments) for (let j = 1; j + 1 < polygon.length; j++) {
      const a = polygon[0], b = polygon[j], c = polygon[j + 1];
      const ax = Math.fround(a.values[0]), az = Math.fround(a.values[2]), bx = Math.fround(b.values[0]), bz = Math.fround(b.values[2]), cx = Math.fround(c.values[0]), cz = Math.fround(c.values[2]);
      if (Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) < 1e-7) continue;
      indices.push(vertex(a), vertex(b), vertex(c));
    }
  }
  if (!changed) return geometry;
  for (const name of Object.keys(geometry.attributes)) geometry.deleteAttribute(name);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(indices), 1));
  geometry.clearGroups(); geometry.setDrawRange(0, Infinity); geometry.boundingBox = null;
  yield* boundingSphereSteps(geometry, pace);
  return geometry;
}
