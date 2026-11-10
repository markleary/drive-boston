import * as THREE from 'three';
import type { CityData, Point2 } from '../types';
import { sampleElevation, terrainGrid, terrainVertexNormal, type ElevationGrid } from '../simulation/terrain.ts';
import { clipTunnelPortalSteps, tunnelPortalBoundsIntersect } from '../simulation/tunnels.ts';
import { computeBounds } from './fast-bounds.ts';
import { due, type Pace } from './pacing.ts';

/** Ground polygons (street pavement, sidewalks, driveways, lawns) draped on the
 * terrain as shared-vertex meshes.
 *
 * The surface is the polygon cut along every terrain triangle: each earcut
 * triangle is clipped against the grid cells it covers and their diagonals, so
 * the result lies exactly on the DEM. Drawn as they fall (`parkSurfaceSteps`
 * does), those fragments are about fifteen slivers per terrain triangle, each
 * with three private vertices. Here every intersection is computed from the
 * same numbers wherever it is met (an earcut edge against a grid line from the
 * edge's own endpoints in a fixed order, two grid lines from their constants),
 * so coincident points are bit-identical and weld by exact comparison. The
 * fragments inside one terrain triangle then cancel their shared edges, the
 * outline that remains is cleared of vertices no outline turns at (where an
 * earcut diagonal crossed a grid line) and triangulated again: the same
 * coverage on the same plane, in about a fifth of the triangles and a tenth of
 * the bytes. A terrain triangle whose outline does not close or keep its area
 * is drawn from its fragments instead, and a cell no boundary comes near is
 * its two terrain triangles.
 *
 * Normals are the terrain mesh's own vertex normals interpolated across each
 * terrain triangle, so pavement shades like the ground it lies on rather than
 * showing every grid crease as a shading line. */
export interface DrapeBounds { minX: number; maxX: number; minZ: number; maxZ: number; }
export interface DrapeOptions {
  /** Height over the terrain. */ offset?: number;
  /** A streamed tile keeps only its own part of a polygon that spans several tiles. */ bounds?: DrapeBounds;
  /** Metres per texture repeat of the planar UVs. */ uvScale?: number;
  /** Cut the surface out of tunnel portals, as the terrain is (default true). */ portals?: boolean;
  pace?: Pace;
}
export interface DrapeStats { polygons: number; fragments: number; faces: number; fallbacks: number; fullCells: number; triangles: number; vertices: number; /** Terrain triangles drawn from their fragments, by cause: an outline that does not chain or close (`chain`, `loop`), one that loses area (`area`), one that cannot be triangulated (`ear`). */ reasons: Record<string, number>; }

interface Triangulation { x: Float64Array; z: Float64Array; faces: Uint32Array; rings: Uint32Array; }
const triangulations = new WeakMap<Point2[][], Triangulation>();
/** Earcut of a polygon with holes as flat arrays; cached, since a park spanning several tiles is draped once per tile. */
function triangulate(rings: Point2[][]): Triangulation {
  let t = triangulations.get(rings); if (t) return t;
  // Copies: triangulateShape drops a ring's repeated end point in place.
  const loops = rings.map(r => r.map(p => new THREE.Vector2(p[0], p[1]))).filter((r, i) => i === 0 || r.length >= 3);
  const faces = loops[0]?.length >= 3 ? THREE.ShapeUtils.triangulateShape(loops[0], loops.slice(1)) : [];
  const count = loops.reduce((n, r) => n + r.length, 0), x = new Float64Array(count), z = new Float64Array(count), ends = new Uint32Array(loops.length);
  let n = 0; loops.forEach((r, i) => { for (const p of r) { x[n] = p.x; z[n++] = p.y; } ends[i] = n; });
  const flat = new Uint32Array(faces.length * 3); faces.forEach((f, i) => { flat[i * 3] = f[0]; flat[i * 3 + 1] = f[1]; flat[i * 3 + 2] = f[2]; });
  triangulations.set(rings, t = { x, z, faces: flat, rings: ends }); return t;
}

/** Exact-coordinate vertex welding: an open-addressing table over the bits of (x, z). */
class Welder {
  x = new Float64Array(1024); z = new Float64Array(1024); count = 0;
  private table = new Int32Array(4096).fill(-1); private mask = 4095;
  private f = new Float64Array(2); private u = new Uint32Array(this.f.buffer);
  reset() { this.count = 0; this.table.fill(-1); }
  id(px: number, pz: number): number {
    const f = this.f, u = this.u; f[0] = px + 0; f[1] = pz + 0; // -0 welds with 0
    let h = Math.imul(u[0] ^ Math.imul(u[1], 0x9E3779B1), 0x85EBCA6B) ^ Math.imul(u[2] ^ Math.imul(u[3], 0xC2B2AE35), 0x27D4EB2F); h ^= h >>> 15;
    const table = this.table, mask = this.mask, x = this.x, z = this.z;
    let slot = h & mask;
    for (let i = table[slot]; i >= 0; i = table[slot = (slot + 1) & mask]) if (x[i] === px && z[i] === pz) return i;
    const id = this.count++;
    if (id === x.length) { const nx = new Float64Array(id * 2), nz = new Float64Array(id * 2); nx.set(x); nz.set(z); this.x = nx; this.z = nz; }
    this.x[id] = px; this.z[id] = pz; table[slot] = id;
    if (this.count * 2 > table.length) this.grow();
    return id;
  }
  private grow() {
    const size = this.table.length * 2, table = new Int32Array(size).fill(-1), mask = size - 1, f = this.f, u = this.u;
    for (let i = 0; i < this.count; i++) {
      f[0] = this.x[i] + 0; f[1] = this.z[i] + 0;
      let h = Math.imul(u[0] ^ Math.imul(u[1], 0x9E3779B1), 0x85EBCA6B) ^ Math.imul(u[2] ^ Math.imul(u[3], 0xC2B2AE35), 0x27D4EB2F); h ^= h >>> 15;
      let slot = h & mask; while (table[slot] >= 0) slot = (slot + 1) & mask; table[slot] = i;
    }
    this.table = table; this.mask = mask;
  }
}

class IntList {
  data: Int32Array; length = 0;
  constructor(capacity = 1024) { this.data = new Int32Array(capacity); }
  push(v: number) { if (this.length === this.data.length) { const next = new Int32Array(this.length * 2); next.set(this.data); this.data = next; } this.data[this.length++] = v; }
}
class FloatList {
  data: Float64Array; length = 0;
  constructor(capacity = 1024) { this.data = new Float64Array(capacity); }
  push(v: number) { if (this.length === this.data.length) { const next = new Float64Array(this.length * 2); next.set(this.data); this.data = next; } this.data[this.length++] = v; }
}

// Fragments thinner than this (m²) carry no surface; the old tessellation culled the same slivers per triangle.
const AREA_EPS = 1e-9;
// A boundary this close to a cell makes it a boundary cell (clipped), never one taken whole.
const MARGIN = 1e-6;
// An intersection this close to a grid line lies on it: an edge through a grid corner meets both lines in one point.
const SNAP = 1e-9;
// Clip lines by slot: 0-2 are the earcut triangle's own edges, then the tile bounds, the row, the column and the cell diagonal.
const BOUND = 3, ROW = 7, COLUMN = 9, DIAGONAL = 11, MAX_POLY = 24;

/** One layer of draped ground: add its polygons, then take the merged geometry. */
export class DrapedSurface {
  readonly stats: DrapeStats = { polygons: 0, fragments: 0, faces: 0, fallbacks: 0, fullCells: 0, triangles: 0, vertices: 0, reasons: {} };
  private readonly city: CityData; private readonly grid: ElevationGrid | undefined;
  private readonly offset: number; private readonly bounds: DrapeBounds | undefined; private readonly uvScale: number; private readonly portals: boolean; private readonly pace: Pace | undefined;
  // The layer so far: welded positions (x, z in double precision until the end) and triangles.
  private readonly vx = new FloatList(4096); private readonly vz = new FloatList(4096); private readonly index = new IntList(8192);
  private readonly welder = new Welder(); private readonly shared = new Welder();
  // Per-polygon scratch, kept between polygons: fragments (face, start and length in `pool`, area) and outlines.
  private readonly pieceFace = new IntList(); private readonly pieceStart = new IntList(); private readonly pieceLen = new IntList(); private readonly pieceArea = new FloatList(); private readonly pool = new IntList(4096);
  private readonly loops = new IntList(4096); private readonly loopStart = new IntList(); private readonly loopLen = new IntList(); private readonly loopFace = new IntList(); private readonly full = new IntList(256);
  private eu = new Int32Array(256); private ev = new Int32Array(256); private alive = new Uint8Array(256); private next = new Int32Array(256); private link = new Int32Array(256);
  private head = new Int32Array(1024); private stamp = new Int32Array(1024); private turn = new Uint8Array(1024); private remap = new Int32Array(1024);
  // Scratch polygons of the clipper: coordinates and the tag of the edge leaving each vertex.
  private readonly px = [0, 1, 2, 3, 4].map(() => new Float64Array(MAX_POLY)); private readonly pz = [0, 1, 2, 3, 4].map(() => new Float64Array(MAX_POLY)); private readonly pt = [0, 1, 2, 3, 4].map(() => new Int8Array(MAX_POLY));
  private readonly la = new Float64Array(12); private readonly lb = new Float64Array(12); private readonly lc = new Float64Array(12);
  // The earcut triangle being clipped: each edge's endpoints in a fixed order.
  private readonly ex0 = new Float64Array(3); private readonly ez0 = new Float64Array(3); private readonly ex1 = new Float64Array(3); private readonly ez1 = new Float64Array(3);
  // The current cell's diagonal ends (where it meets the column and row lines).
  private cornerLoX = 0; private cornerLoZ = 0; private cornerHiX = 0; private cornerHiZ = 0;
  private originX = 0; private originZ = 0; private cell = 6;

  constructor(city: CityData, options: DrapeOptions = {}) {
    this.city = city; this.grid = terrainGrid(city); this.offset = options.offset ?? .024; this.bounds = options.bounds; this.uvScale = options.uvScale ?? 7; this.portals = options.portals ?? true; this.pace = options.pace;
    this.originX = this.grid?.originX ?? 0; this.originZ = this.grid?.originZ ?? 0; this.cell = this.grid?.cellSize ?? 6;
  }

  /** Where slot `line` meets the edge tagged `tag`: an earcut edge from its own endpoints, another clip line from the two constants. */
  private meet(tag: number, line: number, out: Float64Array, at: number, outZ: Float64Array) {
    const a = this.la[line], b = this.lb[line], c = this.lc[line];
    let x: number, z: number;
    if (tag < 3) {
      const x0 = this.ex0[tag], z0 = this.ez0[tag], x1 = this.ex1[tag], z1 = this.ez1[tag], d0 = a * x0 + b * z0 - c, d1 = a * x1 + b * z1 - c, t = d0 / (d0 - d1);
      // An endpoint on the line is the crossing itself (x0 + (x1 - x0) * 1 need not give x1 back). So is the nearer
      // endpoint when both lie on one side: the clipped piece's ends, rounded, can straddle a line the edge only
      // touches, and d0 / (d0 - d1) is then anywhere along the edge's line, or infinite.
      if (d0 === 0 || (d0 < 0 === d1 < 0 && d1 !== 0 && Math.abs(d0) <= Math.abs(d1))) { out[at] = x0; outZ[at] = z0; return; }
      if (d1 === 0 || d0 < 0 === d1 < 0) { out[at] = x1; outZ[at] = z1; return; }
      x = x0 + (x1 - x0) * t; z = z0 + (z1 - z0) * t;
      const cs = this.cell;
      if (b === 0) { x = c / a; const k = Math.round((z - this.originZ) / cs), g = this.originZ + k * cs; if (Math.abs(z - g) < SNAP) z = g; }
      else if (a === 0) { z = c / b; const k = Math.round((x - this.originX) / cs), g = this.originX + k * cs; if (Math.abs(x - g) < SNAP) x = g; }
      else if (line === DIAGONAL) { if (Math.abs(x - this.cornerLoX) < SNAP) { x = this.cornerLoX; z = this.cornerLoZ; } else if (Math.abs(x - this.cornerHiX) < SNAP) { x = this.cornerHiX; z = this.cornerHiZ; } }
    } else if (line === DIAGONAL && tag >= ROW) {
      // The diagonal ends on the cell's corners: (low x, high z) on the low column and high row lines, (high x, low z) on the others.
      if (tag === COLUMN || tag === ROW + 1) { x = this.cornerLoX; z = this.cornerLoZ; } else { x = this.cornerHiX; z = this.cornerHiZ; }
    } else {
      const a2 = this.la[tag], b2 = this.lb[tag], c2 = this.lc[tag], det = a * b2 - a2 * b;
      x = (c * b2 - c2 * b) / det; z = (a * c2 - a2 * c) / det;
    }
    out[at] = x; outZ[at] = z;
  }

  /** Whether the earcut edge tagged `tag` runs along slot `line`: both its ends within SNAP of it. */
  private along(tag: number, line: number) {
    if (tag >= 3) return false;
    const a = this.la[line], b = this.lb[line], c = this.lc[line];
    return Math.abs(a * this.ex0[tag] + b * this.ez0[tag] - c) < SNAP && Math.abs(a * this.ex1[tag] + b * this.ez1[tag] - c) < SNAP;
  }

  /** Sutherland-Hodgman against slot `line` (inside where a x + b z <= c), carrying edge tags; returns the vertex count. */
  private clip(n: number, from: number, to: number, line: number): number {
    if (n < 3) return 0;
    const sx = this.px[from], sz = this.pz[from], st = this.pt[from], dx = this.px[to], dz = this.pz[to], dt = this.pt[to], a = this.la[line], b = this.lb[line], c = this.lc[line];
    let m = 0, prev = n - 1, dp = a * sx[prev] + b * sz[prev] - c;
    // A vertex a rounding error outside, on an earcut edge that runs along the line, is on the line: both sides keep
    // it, and no crossing is asked of an edge that has none (a pavement edge down a cell diagonal: x + z rounds).
    if (dp > 0 && dp < 2 * SNAP && (this.along(st[prev], line) || this.along(st[n - 2], line))) dp = 0;
    for (let cur = 0; cur < n; cur++) {
      let dc = a * sx[cur] + b * sz[cur] - c;
      if (dc > 0 && dc < 2 * SNAP && (this.along(st[cur], line) || this.along(st[prev], line))) dc = 0;
      if ((dp <= 0) !== (dc <= 0)) {
        if (m >= MAX_POLY - 1) return -1;
        this.meet(st[prev], line, dx, m, dz); dt[m++] = dp <= 0 ? line : st[prev];
      }
      if (dc <= 0) { if (m >= MAX_POLY - 1) return -1; dx[m] = sx[cur]; dz[m] = sz[cur]; dt[m++] = st[cur]; }
      prev = cur; dp = dc;
    }
    return m;
  }

  /** Drape one polygon (outer ring, then holes). */
  *add(rings: Point2[][]): Generator<void, void> {
    const tri = triangulate(rings); if (!tri.faces.length) return;
    this.stats.polygons++;
    const { x: tx, z: tz, faces } = tri, bounds = this.bounds, cs = this.cell, ox = this.originX, oz = this.originZ, pace = this.pace;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < tx.length; i++) { const x = tx[i], z = tz[i]; if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
    if (bounds) { minX = Math.max(minX, bounds.minX); maxX = Math.min(maxX, bounds.maxX); minZ = Math.max(minZ, bounds.minZ); maxZ = Math.min(maxZ, bounds.maxZ); }
    if (!(minX < maxX) || !(minZ < maxZ)) return;
    // The window of grid cells the polygon can touch. Cells outside the grid are fine: heights clamp there.
    const i0 = Math.floor((minX - ox) / cs), i1 = Math.floor((maxX - ox) / cs), j0 = Math.floor((minZ - oz) / cs), j1 = Math.floor((maxZ - oz) / cs), cols = i1 - i0 + 1, rows = j1 - j0 + 1;
    // 1 where the polygon's boundary (or the tile bounds) comes within reach of a cell; 2 added once an unmarked cell is known covered.
    const state = new Uint8Array(cols * rows);
    const markRow = (r: number, xLo: number, xHi: number) => {
      const c0 = Math.max(0, Math.floor((xLo - MARGIN - ox) / cs) - i0), c1 = Math.min(cols - 1, Math.floor((xHi + MARGIN - ox) / cs) - i0);
      for (let c = c0; c <= c1; c++) state[r * cols + c] = 1;
    };
    let ring = 0, first = 0;
    for (let i = 0; i < tx.length; i++) {
      if (i === tri.rings[ring]) first = tri.rings[ring++];
      const j = i + 1 === tri.rings[ring] ? first : i + 1, ax = tx[i], az = tz[i], bx = tx[j], bz = tz[j];
      if (Math.max(ax, bx) < minX - MARGIN || Math.min(ax, bx) > maxX + MARGIN || Math.max(az, bz) < minZ - MARGIN || Math.min(az, bz) > maxZ + MARGIN) continue;
      const zLo = Math.min(az, bz) - MARGIN, zHi = Math.max(az, bz) + MARGIN, r0 = Math.max(0, Math.floor((zLo - oz) / cs) - j0), r1 = Math.min(rows - 1, Math.floor((zHi - oz) / cs) - j0), dz = bz - az;
      for (let r = r0; r <= r1; r++) {
        if (Math.abs(dz) < 1e-12) { markRow(r, Math.min(ax, bx), Math.max(ax, bx)); continue; }
        const s0 = Math.max(zLo, oz + (j0 + r) * cs - MARGIN), s1 = Math.min(zHi, oz + (j0 + r + 1) * cs + MARGIN);
        const t0 = Math.min(1, Math.max(0, (s0 - az) / dz)), t1 = Math.min(1, Math.max(0, (s1 - az) / dz)), xa = ax + (bx - ax) * t0, xb = ax + (bx - ax) * t1;
        markRow(r, Math.min(xa, xb), Math.max(xa, xb));
      }
      if ((i & 1023) === 1023 && due(pace)) yield;
    }
    if (bounds) {
      // The bounds cut the polygon too: no cell on the window's rim is taken whole.
      for (let c = 0; c < cols; c++) { state[c] = 1; state[(rows - 1) * cols + c] = 1; }
      for (let r = 0; r < rows; r++) { state[r * cols] = 1; state[r * cols + cols - 1] = 1; }
      this.la[BOUND] = -1; this.lb[BOUND] = 0; this.lc[BOUND] = -bounds.minX; this.la[BOUND + 1] = 1; this.lb[BOUND + 1] = 0; this.lc[BOUND + 1] = bounds.maxX;
      this.la[BOUND + 2] = 0; this.lb[BOUND + 2] = -1; this.lc[BOUND + 2] = -bounds.minZ; this.la[BOUND + 3] = 0; this.lb[BOUND + 3] = 1; this.lc[BOUND + 3] = bounds.maxZ;
    }

    // Fragments: convex pieces of earcut triangles inside one terrain triangle, as welded vertex loops.
    const welder = this.welder; welder.reset();
    const pieceFace = this.pieceFace, pieceStart = this.pieceStart, pieceLen = this.pieceLen, pieceArea = this.pieceArea, pool = this.pool;
    pieceFace.length = 0; pieceStart.length = 0; pieceLen.length = 0; pieceArea.length = 0; pool.length = 0;
    const ex0 = this.ex0, ez0 = this.ez0, ex1 = this.ex1, ez1 = this.ez1, la = this.la, lb = this.lb, lc = this.lc;
    const record = (n: number, slot: number, face: number) => {
      const x = this.px[slot], z = this.pz[slot], start = pool.length;
      // Clipping through a vertex that lies on a grid line leaves the point several times over: once each, around the loop.
      let area = 0, last = -1, count = 0;
      for (let k = 0; k < n; k++) { const id = welder.id(x[k], z[k]); if (id === last) continue; pool.push(id); last = id; count++; }
      while (count > 1 && pool.data[start + count - 1] === pool.data[start]) { count--; pool.length--; }
      if (count >= 3) { const wx = welder.x, wz = welder.z, d = pool.data; for (let k = 0; k < count; k++) { const a = d[start + k], b = d[start + (k + 1) % count]; area += wx[a] * wz[b] - wx[b] * wz[a]; } area /= 2; }
      if (count < 3 || area < AREA_EPS) { pool.length = start; return; }
      pieceFace.push(face); pieceStart.push(start); pieceLen.push(count); pieceArea.push(area);
    };
    for (let f = 0; f < faces.length; f += 3) {
      if ((f & 255) === 0 && f && due(pace)) yield;
      let a = faces[f], b = faces[f + 1], c = faces[f + 2];
      const twice = (tx[b] - tx[a]) * (tz[c] - tz[a]) - (tz[b] - tz[a]) * (tx[c] - tx[a]);
      if (twice === 0) continue; if (twice < 0) { const s = b; b = c; c = s; }
      const tMinX = Math.min(tx[a], tx[b], tx[c]), tMaxX = Math.max(tx[a], tx[b], tx[c]), tMinZ = Math.min(tz[a], tz[b], tz[c]), tMaxZ = Math.max(tz[a], tz[b], tz[c]);
      if (tMaxX < minX || tMinX > maxX || tMaxZ < minZ || tMinZ > maxZ) continue;
      // Each edge's endpoints, lower vertex number first: the neighbouring triangle computes the same crossings.
      for (let k = 0; k < 3; k++) { const p = k === 0 ? a : k === 1 ? b : c, q = k === 0 ? b : k === 1 ? c : a, lo = p < q ? p : q, hi = p < q ? q : p; ex0[k] = tx[lo]; ez0[k] = tz[lo]; ex1[k] = tx[hi]; ez1[k] = tz[hi]; }
      let n = 3, slot = 0;
      const p0x = this.px[0], p0z = this.pz[0], p0t = this.pt[0];
      p0x[0] = tx[a]; p0z[0] = tz[a]; p0t[0] = 0; p0x[1] = tx[b]; p0z[1] = tz[b]; p0t[1] = 1; p0x[2] = tx[c]; p0z[2] = tz[c]; p0t[2] = 2;
      if (bounds) for (let k = 0; k < 4 && n >= 3; k++) { n = this.clip(n, slot, 1 - slot, BOUND + k); slot = 1 - slot; }
      if (n < 3) continue;
      // The (possibly bounds-clipped) triangle now sits in scratch polygon `slot`; rows use 2, columns 3, halves 4.
      const qx = this.px[slot], qz = this.pz[slot];
      let qMinZ = Infinity, qMaxZ = -Infinity; for (let k = 0; k < n; k++) { if (qz[k] < qMinZ) qMinZ = qz[k]; if (qz[k] > qMaxZ) qMaxZ = qz[k]; }
      const r0 = Math.max(0, Math.floor((qMinZ - oz) / cs) - j0), r1 = Math.min(rows - 1, Math.floor((qMaxZ - oz) / cs) - j0);
      for (let r = r0; r <= r1; r++) {
        const zLo = oz + (j0 + r) * cs, zHi = oz + (j0 + r + 1) * cs;
        la[ROW] = 0; lb[ROW] = -1; lc[ROW] = -zLo; la[ROW + 1] = 0; lb[ROW + 1] = 1; lc[ROW + 1] = zHi;
        // The triangle stays in `slot` for the next row; its part in this row ends up in the other low scratch polygon.
        let m = this.clip(n, slot, 2, ROW); if (m < 3) continue;
        const mid = 1 - slot; m = this.clip(m, 2, mid, ROW + 1); if (m < 3) continue;
        const rx = this.px[mid];
        let rMinX = Infinity, rMaxX = -Infinity; for (let k = 0; k < m; k++) { if (rx[k] < rMinX) rMinX = rx[k]; if (rx[k] > rMaxX) rMaxX = rx[k]; }
        const c0 = Math.max(0, Math.floor((rMinX - ox) / cs) - i0), c1 = Math.min(cols - 1, Math.floor((rMaxX - ox) / cs) - i0);
        for (let col = c0; col <= c1; col++) {
          const cellId = r * cols + col, s = state[cellId];
          if (!(s & 1)) { state[cellId] = 2; continue; }
          const xLo = ox + (i0 + col) * cs, xHi = ox + (i0 + col + 1) * cs;
          la[COLUMN] = -1; lb[COLUMN] = 0; lc[COLUMN] = -xLo; la[COLUMN + 1] = 1; lb[COLUMN + 1] = 0; lc[COLUMN + 1] = xHi;
          let k = this.clip(m, mid, 2, COLUMN); if (k < 3) continue;
          k = this.clip(k, 2, 3, COLUMN + 1); if (k < 3) continue;
          this.cornerLoX = xLo; this.cornerLoZ = zHi; this.cornerHiX = xHi; this.cornerHiZ = zLo;
          // The cell's diagonal runs from (xHi, zLo) to (xLo, zHi); the first terrain triangle is the side holding (xLo, zLo).
          la[DIAGONAL] = 1; lb[DIAGONAL] = 1; lc[DIAGONAL] = xHi + zLo;
          const lower = this.clip(k, 3, 4, DIAGONAL); if (lower >= 3) record(lower, 4, cellId * 2);
          la[DIAGONAL] = -1; lb[DIAGONAL] = -1; lc[DIAGONAL] = -(xHi + zLo);
          const upper = this.clip(k, 3, 4, DIAGONAL); if (upper >= 3) record(upper, 4, cellId * 2 + 1);
        }
      }
    }
    this.stats.fragments += pieceFace.length;
    yield* this.assemble(state, cols, rows, i0, j0);
  }

  private fallback(reason: string) { this.stats.fallbacks++; this.stats.reasons[reason] = (this.stats.reasons[reason] ?? 0) + 1; }

  /** Merge the fragments of each terrain triangle into its outline and triangulate it. */
  private *assemble(state: Uint8Array, cols: number, rows: number, i0: number, j0: number): Generator<void, void> {
    const welder = this.welder, pace = this.pace, cs = this.cell, ox = this.originX, oz = this.originZ;
    const pieceFace = this.pieceFace, pieceStart = this.pieceStart, pieceLen = this.pieceLen, pieceArea = this.pieceArea, pool = this.pool;
    const pieces = pieceFace.length, faceCount = cols * rows * 2;
    // Fragments in face order (counting sort).
    const firstOf = new Int32Array(faceCount + 1);
    for (let p = 0; p < pieces; p++) firstOf[pieceFace.data[p] + 1]++;
    for (let f = 0; f < faceCount; f++) firstOf[f + 1] += firstOf[f];
    const order = new Int32Array(pieces), cursor = firstOf.slice(0, faceCount);
    for (let p = 0; p < pieces; p++) order[cursor[pieceFace.data[p]]++] = p;
    // Outlines: each loop's vertices in the pool `loops`, and the face it belongs to (a face's loops are consecutive).
    const loops = this.loops, loopStart = this.loopStart, loopLen = this.loopLen, loopFace = this.loopFace;
    loops.length = 0; loopStart.length = 0; loopLen.length = 0; loopFace.length = 0;
    const ids = pool.data, wx0 = welder.x, wz0 = welder.z;
    // Edges leaving each vertex within the face being merged, as lists threaded through `link` (stamped per face).
    if (this.head.length < welder.count) { let size = this.head.length; while (size < welder.count) size *= 2; this.head = new Int32Array(size); this.stamp = new Int32Array(size); }
    const head = this.head, stamp = this.stamp; stamp.fill(0, 0, welder.count);
    for (let face = 0; face < faceCount; face++) {
      const from = firstOf[face], to = firstOf[face + 1]; if (from === to) continue;
      if ((face & 1023) === 0 && due(pace)) yield;
      this.stats.faces++;
      const emitPieces = () => { for (let o = from; o < to; o++) { const p = order[o], s = pieceStart.data[p], l = pieceLen.data[p]; loopStart.push(loops.length); loopLen.push(l); loopFace.push(face); for (let k = 0; k < l; k++) loops.push(ids[s + k]); } };
      if (to - from === 1) { emitPieces(); continue; }
      let edges = 0, area = 0;
      for (let o = from; o < to; o++) { const p = order[o]; edges += pieceLen.data[p]; area += pieceArea.data[p]; }
      if (edges > this.eu.length) { let size = this.eu.length; while (size < edges) size *= 2; this.eu = new Int32Array(size); this.ev = new Int32Array(size); this.alive = new Uint8Array(size); this.next = new Int32Array(size); this.link = new Int32Array(size); }
      const eu = this.eu, ev = this.ev, alive = this.alive, next = this.next, link = this.link, mine = face + 1;
      let e = 0;
      for (let o = from; o < to; o++) {
        const p = order[o], s = pieceStart.data[p], l = pieceLen.data[p];
        for (let k = 0; k < l; k++) { const u = ids[s + k]; eu[e] = u; ev[e] = ids[s + (k + 1 === l ? 0 : k + 1)]; alive[e] = 1; if (stamp[u] !== mine) { stamp[u] = mine; head[u] = -1; } link[e] = head[u]; head[u] = e++; }
      }
      // Cancel each edge against its reverse from the neighbouring fragment.
      let remaining = edges;
      for (let a = 0; a < edges; a++) {
        if (!alive[a]) continue; const u = eu[a], v = ev[a]; if (stamp[v] !== mine) continue;
        for (let b = head[v]; b >= 0; b = link[b]) if (alive[b] && ev[b] === u) { alive[a] = 0; alive[b] = 0; remaining -= 2; break; }
      }
      // Chain what remains. Where two outlines touch in a vertex, an arriving edge leaves by the first edge
      // clockwise from the way it came: that keeps the region it bounds on its left.
      let ok = remaining >= 3;
      for (let a = 0; a < edges && ok; a++) {
        if (!alive[a]) continue;
        let found = -1, several = false; const v = ev[a];
        if (stamp[v] === mine) for (let b = head[v]; b >= 0; b = link[b]) if (alive[b]) { if (found >= 0) several = true; found = b; }
        if (found < 0) { ok = false; break; }
        if (several) {
          const back = Math.atan2(wz0[eu[a]] - wz0[v], wx0[eu[a]] - wx0[v]); let best = Infinity;
          for (let b = head[v]; b >= 0; b = link[b]) if (alive[b]) {
            let swing = back - Math.atan2(wz0[ev[b]] - wz0[v], wx0[ev[b]] - wx0[v]); while (swing <= 1e-12) swing += 2 * Math.PI;
            if (swing < best) { best = swing; found = b; }
          }
        }
        next[a] = found;
      }
      if (!ok) { this.fallback('chain'); emitPieces(); continue; }
      // Walk the loops: counter-clockwise outlines, and clockwise ones around a hole that lies inside this terrain triangle.
      const mark = loopStart.length, poolMark = loops.length; let outlineArea = 0, walked = 0;
      for (let a = 0; a < edges && ok; a++) {
        if (alive[a] !== 1) continue;
        const start = loops.length; let b = a, loopArea = 0;
        do { alive[b] = 2; const u = eu[b], v = ev[b]; loops.push(u); loopArea += wx0[u] * wz0[v] - wx0[v] * wz0[u]; b = next[b]; walked++; } while (b !== a && alive[b] === 1);
        if (b !== a) { ok = false; this.fallback('loop'); break; }
        if (Math.abs(loopArea) < 2 * AREA_EPS) { loops.length = start; continue; } // a spike without surface
        loopStart.push(start); loopLen.push(loops.length - start); loopFace.push(face); outlineArea += loopArea / 2;
      }
      if (!ok || walked !== remaining || Math.abs(outlineArea - area) > 1e-7 + area * 1e-9) { if (ok) this.fallback('area'); loopStart.length = mark; loopLen.length = mark; loopFace.length = mark; loops.length = poolMark; emitPieces(); }
    }
    // Cells taken whole draw their two terrain triangles; their corners join the welded set before the per-vertex tables are sized.
    const full = this.full; full.length = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (state[r * cols + c] !== 2) continue; this.stats.fullCells++;
      const x0 = ox + (i0 + c) * cs, x1 = ox + (i0 + c + 1) * cs, z0 = oz + (j0 + r) * cs, z1 = oz + (j0 + r + 1) * cs;
      full.push(welder.id(x0, z0)); full.push(welder.id(x1, z0)); full.push(welder.id(x0, z1)); full.push(welder.id(x1, z1));
    }
    if (this.turn.length < welder.count) { let size = this.turn.length; while (size < welder.count) size *= 2; this.turn = new Uint8Array(size); this.remap = new Int32Array(size); }
    // A vertex stays wherever any outline turns at it; one every outline passes straight through goes from all of them.
    const turn = this.turn, remap = this.remap, wx = welder.x, wz = welder.z, lp = loops.data;
    turn.fill(0, 0, welder.count); remap.fill(-1, 0, welder.count);
    for (let l = 0; l < loopStart.length; l++) {
      const s = loopStart.data[l], n = loopLen.data[l];
      let p = lp[s + n - 2], v = lp[s + n - 1];
      for (let k = 0; k < n; k++) {
        const q = lp[s + k], ax = wx[v] - wx[p], az = wz[v] - wz[p], bx = wx[q] - wx[v], bz = wz[q] - wz[v], cross = ax * bz - az * bx, dot = ax * bx + az * bz;
        if (dot <= 0 || cross * cross > 1e-14 * (ax * ax + az * az) * (bx * bx + bz * bz)) turn[v] = 1;
        p = v; v = q;
      }
      if ((l & 4095) === 4095 && due(pace)) yield;
    }
    // Output vertices are shared by their Float32 position, across the layer's polygons too: crossings a few
    // microns apart (an edge passing just beside a grid corner) are one point once stored.
    const vx = this.vx, vz = this.vz, index = this.index, shared = this.shared;
    const vertex = (id: number) => { let n = remap[id]; if (n < 0) { n = remap[id] = shared.id(Math.fround(wx[id]), Math.fround(wz[id])); if (n === vx.length) { vx.push(wx[id]); vz.push(wz[id]); } } return n; };
    // Triangles leave facing up: clockwise in (x, z), as the old surfaces were wound, without the slivers Float32 collapses.
    const triangle = (a: number, b: number, c: number) => {
      const ax = Math.fround(wx[a]), az = Math.fround(wz[a]), cross = (Math.fround(wx[b]) - ax) * (Math.fround(wz[c]) - az) - (Math.fround(wz[b]) - az) * (Math.fround(wx[c]) - ax);
      if (Math.abs(cross) < 1e-7) return;
      index.push(vertex(a)); if (cross > 0) { index.push(vertex(c)); index.push(vertex(b)); } else { index.push(vertex(b)); index.push(vertex(c)); }
    };
    for (let k = 0; k < full.length; k += 4) { const d = full.data; triangle(d[k], d[k + 2], d[k + 1]); triangle(d[k + 1], d[k + 2], d[k + 3]); }
    const pending: number[] = [], kept: number[] = [];
    for (let l = 0; l < loopStart.length;) {
      if ((l & 1023) === 0 && due(pace)) yield;
      const face = loopFace.data[l]; let end = l + 1; while (end < loopStart.length && loopFace.data[end] === face) end++;
      let ok = true; pending.length = 0;
      if (end === l + 1) {
        // One outline (nearly every face): its kept vertices, as a fan when convex.
        const s = loopStart.data[l], n = loopLen.data[l]; kept.length = 0;
        for (let k = 0; k < n; k++) { const v = lp[s + k]; if (turn[v]) kept.push(v); }
        if (kept.length >= 3) ok = signedArea(kept, wx, wz) > 0 && triangulateLoop(kept, wx, wz, pending);
      } else {
        // Several outlines in one face: separate patches, or a hole (a tree pit, an island) inside the terrain triangle.
        const outlines: number[][] = []; let holes = false;
        for (let o = l; o < end; o++) {
          const s = loopStart.data[o], n = loopLen.data[o], list: number[] = [];
          for (let k = 0; k < n; k++) { const v = lp[s + k]; if (turn[v]) list.push(v); }
          if (list.length < 3) continue; if (signedArea(list, wx, wz) < 0) holes = true; outlines.push(list);
        }
        if (holes) ok = triangulateWithHoles(outlines, wx, wz, pending);
        else for (const outline of outlines) if (!(ok = triangulateLoop(outline, wx, wz, pending))) break;
      }
      // All outlines of one face, or none: a face whose outline cannot be triangulated draws its fragments whole.
      if (ok) for (let k = 0; k < pending.length; k += 3) triangle(pending[k], pending[k + 1], pending[k + 2]);
      else {
        this.fallback('ear');
        for (let o = firstOf[face]; o < firstOf[face + 1]; o++) { const p = order[o], s = pieceStart.data[p], n = pieceLen.data[p]; for (let k = 1; k + 1 < n; k++) triangle(ids[s], ids[s + k], ids[s + k + 1]); }
      }
      l = end;
    }
  }

  /** The layer as one indexed geometry (position, normal, uv), cut out of tunnel portals; empty attributes when nothing was added. */
  *geometrySteps(): Generator<void, THREE.BufferGeometry> {
    const pace = this.pace, city = this.city, count = this.vx.length, vx = this.vx.data, vz = this.vz.data, offset = this.offset;
    let positions: Float32Array = new Float32Array(count * 3), indices: Uint32Array = Uint32Array.from(this.index.data.subarray(0, this.index.length));
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      if ((i & 16383) === 16383 && due(pace)) yield;
      const x = vx[i], z = vz[i]; positions[i * 3] = x; positions[i * 3 + 1] = sampleElevation(city, x, z) + offset; positions[i * 3 + 2] = z;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    if (count && this.portals && tunnelPortalBoundsIntersect(city, minX, maxX, minZ, maxZ)) {
      const steps = clipTunnelPortalSteps(city, positions, indices); let step = steps.next(); while (!step.done) { if (due(pace)) yield; step = steps.next(); }
      if (step.value.vertices !== positions) ({ vertices: positions, indices } = compact(step.value.vertices, step.value.indices));
    }
    const total = positions.length / 3, normals = new Float32Array(total * 3), uv = new Float32Array(total * 2), scale = this.uvScale, grid = this.grid, n = [0, 1, 0];
    for (let i = 0; i < total; i++) {
      if ((i & 16383) === 16383 && due(pace)) yield;
      const x = positions[i * 3], z = positions[i * 3 + 2];
      if (grid) surfaceNormal(grid, x, z, n);
      normals[i * 3] = n[0]; normals[i * 3 + 1] = n[1]; normals[i * 3 + 2] = n[2]; uv[i * 2] = x / scale; uv[i * 2 + 1] = z / scale;
    }
    this.stats.vertices = total; this.stats.triangles = indices.length / 3;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3)); geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(new THREE.BufferAttribute(total > 65535 ? indices : Uint16Array.from(indices), 1));
    if (total) { if (due(pace)) yield; computeBounds(geometry, false); }
    return geometry;
  }
  geometry(): THREE.BufferGeometry { const steps = this.geometrySteps(); let r = steps.next(); while (!r.done) r = steps.next(); return r.value; }
}

/** Drop vertices no triangle uses (portal clipping strands the corners of the triangles it replaced). */
function compact(vertices: Float32Array, indices: Uint32Array): { vertices: Float32Array; indices: Uint32Array } {
  const remap = new Int32Array(vertices.length / 3).fill(-1), out = new Uint32Array(indices.length); let n = 0;
  for (let i = 0; i < indices.length; i++) { const v = indices[i]; if (remap[v] < 0) remap[v] = n++; out[i] = remap[v]; }
  if (n === remap.length) { let same = true; for (let i = 0; i < remap.length && same; i++) same = remap[i] === i; if (same) return { vertices, indices }; }
  const packed = new Float32Array(n * 3);
  for (let v = 0; v < remap.length; v++) { const t = remap[v]; if (t < 0) continue; packed[t * 3] = vertices[v * 3]; packed[t * 3 + 1] = vertices[v * 3 + 1]; packed[t * 3 + 2] = vertices[v * 3 + 2]; }
  return { vertices: packed, indices: out };
}

/** The terrain mesh's shading normal at a point: its vertex normals interpolated across the terrain triangle. */
export function surfaceNormal(grid: ElevationGrid, x: number, z: number, out: number[]) {
  const fx = Math.max(0, Math.min(grid.width - 1, (x - grid.originX) / grid.cellSize)), fz = Math.max(0, Math.min(grid.height - 1, (z - grid.originZ) / grid.cellSize));
  const i = Math.min(grid.width - 2, Math.floor(fx)), j = Math.min(grid.height - 2, Math.floor(fz)), tx = fx - i, tz = fz - j;
  let nx = 0, ny = 0, nz = 0;
  const add = (gi: number, gj: number, w: number) => { if (w === 0) return; terrainVertexNormal(grid, gi, gj, corner); nx += corner[0] * w; ny += corner[1] * w; nz += corner[2] * w; };
  if (tx + tz <= 1) { add(i, j, 1 - tx - tz); add(i + 1, j, tx); add(i, j + 1, tz); }
  else { add(i + 1, j + 1, tx + tz - 1); add(i, j + 1, 1 - tx); add(i + 1, j, 1 - tz); }
  const length = Math.hypot(nx, ny, nz) || 1; out[0] = nx / length; out[1] = ny / length; out[2] = nz / length;
}
const corner = [0, 1, 0];

function signedArea(loop: number[], x: Float64Array, z: Float64Array) {
  let area = 0; for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; area += x[a] * z[b] - x[b] * z[a]; } return area / 2;
}

/** Outlines with holes inside one terrain triangle (a tree pit, an island): each hole joins the outline around it
 * and earcut triangulates the pair. False, with nothing added, unless the triangles keep the outlines' area. */
function triangulateWithHoles(outlines: number[][], x: Float64Array, z: Float64Array, out: number[]): boolean {
  const mark = out.length, outers = outlines.filter(l => signedArea(l, x, z) > 0), holes = outlines.filter(l => signedArea(l, x, z) < 0);
  const inside = (px: number, pz: number, loop: number[]) => { let hit = false; for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) { const a = loop[i], b = loop[j]; if ((z[a] > pz) !== (z[b] > pz) && px < (x[b] - x[a]) * (pz - z[a]) / (z[b] - z[a]) + x[a]) hit = !hit; } return hit; };
  const owned = outers.map(() => [] as number[][]);
  for (const hole of holes) { const owner = outers.findIndex(outer => inside(x[hole[0]], z[hole[0]], outer)); if (owner < 0) return false; owned[owner].push(hole); }
  let expected = 0, got = 0;
  for (const outline of outlines) expected += signedArea(outline, x, z);
  for (let i = 0; i < outers.length; i++) {
    if (!owned[i].length) { if (!triangulateLoop(outers[i], x, z, out)) { out.length = mark; return false; } continue; }
    const all = [outers[i], ...owned[i]].flat(), point = (id: number) => new THREE.Vector2(x[id], z[id]);
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(outers[i].map(point), owned[i].map(hole => hole.map(point)))) out.push(all[a], all[b], all[c]);
  }
  for (let k = mark; k < out.length; k += 3) { const a = out[k], b = out[k + 1], c = out[k + 2]; got += Math.abs((x[b] - x[a]) * (z[c] - z[a]) - (z[b] - z[a]) * (x[c] - x[a])) / 2; }
  if (Math.abs(got - expected) > 1e-7 + expected * 1e-9) { out.length = mark; return false; }
  return true;
}

/** Triangulate a simple counter-clockwise outline into `out` (vertex triples): a fan when convex, ear clipping
 * otherwise. False, with nothing added, when no ear is found. */
function triangulateLoop(loop: number[], x: Float64Array, z: Float64Array, out: number[]): boolean {
  const n = loop.length;
  if (n === 3) { out.push(loop[0], loop[1], loop[2]); return true; }
  let convex = true;
  for (let i = 0; i < n && convex; i++) {
    const a = loop[i], b = loop[(i + 1) % n], c = loop[(i + 2) % n];
    convex = (x[b] - x[a]) * (z[c] - z[b]) - (z[b] - z[a]) * (x[c] - x[b]) > 0;
  }
  if (convex) { for (let i = 1; i + 1 < n; i++) out.push(loop[0], loop[i], loop[i + 1]); return true; }
  const ring = loop.slice(), mark = out.length; let guard = n * n + 8;
  while (ring.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < ring.length; i++) {
      const m = ring.length, a = ring[(i + m - 1) % m], b = ring[i], c = ring[(i + 1) % m];
      const ax = x[a], az = z[a], bx = x[b], bz = z[b], cx = x[c], cz = z[c];
      if ((bx - ax) * (cz - az) - (bz - az) * (cx - ax) <= 0) continue; // reflex or straight
      let empty = true;
      for (let k = 0; k < m && empty; k++) {
        const p = ring[k]; if (p === a || p === b || p === c) continue;
        const qx = x[p], qz = z[p];
        empty = !((bx - ax) * (qz - az) - (bz - az) * (qx - ax) >= 0 && (cx - bx) * (qz - bz) - (cz - bz) * (qx - bx) >= 0 && (ax - cx) * (qz - cz) - (az - cz) * (qx - cx) >= 0);
      }
      if (!empty) continue;
      out.push(a, b, c); ring.splice(i, 1); clipped = true; break;
    }
    if (!clipped) { out.length = mark; return false; }
  }
  if (ring.length !== 3) { out.length = mark; return false; }
  out.push(ring[0], ring[1], ring[2]); return true;
}

/** Drape several polygons as one layer. */
export function* drapedSurfaceSteps(city: CityData, polygons: Iterable<Point2[][]>, options: DrapeOptions = {}): Generator<void, THREE.BufferGeometry> {
  const surface = new DrapedSurface(city, options);
  for (const rings of polygons) { if (due(options.pace)) yield; yield* surface.add(rings); }
  return yield* surface.geometrySteps();
}
export function drapedSurface(city: CityData, polygons: Iterable<Point2[][]>, options: DrapeOptions = {}): THREE.BufferGeometry {
  const steps = drapedSurfaceSteps(city, polygons, options); let r = steps.next(); while (!r.done) r = steps.next(); return r.value;
}
