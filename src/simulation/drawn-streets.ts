import type { Point2 } from '../types';
import type { CityTile } from './tile-format.ts';
import { STALL_DEPTH, STALL_HALF, tileStalls, type Stall } from './parking-lots.ts';

/** What the planters read of a tile: the street pavement it draws, its lot asphalt and its parking stalls. */
export type StreetTile = Pick<CityTile, 'tx' | 'tz' | 'size' | 'streetPavement' | 'driveways' | 'parking'>;

/** The streets of one tile as it draws them: the compiled `streetPavement` polygons (the roadway measured between
 * the curbs, junction mouths and highway aprons included) indexed for the planters, which stand trees, posts and
 * walkers beside the roadway and so must know where it is, not where a ribbon of the street's median width about
 * its centre line would be (a roadway is locally wider than its median, and it is seldom centred on its line). A
 * tile knows its own ground only: the polygons are clipped at its border, and every answer ends there. */
export interface DrawnStreets {
  /** Whether (x, z) lies in the tile's street pavement (false beyond the tile). */
  paved(x: number, z: number): boolean;
  /** Whether street pavement of this tile lies within `margin` (CLEARANCE at most) of (x, z): a point of the tile, or
   * one up to CLEARANCE beyond its border (the neighbouring tile asks about a place beside the border). */
  near(x: number, z: number, margin: number): boolean;
  /** The paved stretches of the line (x + t nx, z + t nz), t from `from` to `to`, as far as it runs in the tile:
   * [start, end, start, end, ...] in t, ascending, and the part of [from, to] the tile holds (`known`, of no
   * length when the line misses the tile). (nx, nz) is a unit vector. */
  spans(x: number, z: number, nx: number, nz: number, from: number, to: number): { spans: number[]; known: [number, number] };
  /** Whether (x, z) lies within `margin` of the painted box of a parking stall of this tile (a stall is listed by
   * the tile its centre stands in, so within STALL_REACH of the border the next tile may hold one too). */
  stall(x: number, z: number, margin: number): boolean;
  /** Whether (x, z) lies on the asphalt the tile draws for lots and driveways, or within `margin` of it: every stall
   * stands on that asphalt, so ground off it holds no stall of any tile. */
  lot(x: number, z: number, margin: number): boolean;
  /** How far inside the tile (x, z) lies: the distance to its nearest border, negative beyond it. */
  inset(x: number, z: number): number;
  /** The stretch of the line (x + t nx, z + t nz) that lies at least `inset` inside the tile: [from, to] in t (from > to when none does). */
  within(x: number, z: number, nx: number, nz: number, inset: number): [number, number];
}
/** The widest margin `near` answers for, and how far beyond the tile it answers at all. */
export const CLEARANCE = 1.5;
/** Half the depth of a stall, and how far from its centre its painted box reaches. */
const STALL_LONG = STALL_DEPTH / 2;
export const STALL_REACH = Math.hypot(STALL_LONG, STALL_HALF);
const CELL = 8, PAD = 2 * CLEARANCE;

/** Whether the segment a-b touches the box. */
function touches(ax: number, az: number, bx: number, bz: number, minX: number, minZ: number, maxX: number, maxZ: number) {
  if (Math.max(ax, bx) < minX || Math.min(ax, bx) > maxX || Math.max(az, bz) < minZ || Math.min(az, bz) > maxZ) return false;
  // the part of the segment between the box's x sides must reach between its z sides
  const dx = bx - ax, dz = bz - az; let t0 = 0, t1 = 1;
  if (dx !== 0) { const p = (minX - ax) / dx, q = (maxX - ax) / dx; t0 = Math.max(t0, Math.min(p, q)); t1 = Math.min(t1, Math.max(p, q)); }
  if (dz !== 0) { const p = (minZ - az) / dz, q = (maxZ - az) / dz; t0 = Math.max(t0, Math.min(p, q)); t1 = Math.min(t1, Math.max(p, q)); }
  return t0 <= t1;
}
function inRings(x: number, z: number, rings: Point2[][]) {
  let hit = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit; }
  return hit;
}

const cache = new WeakMap<StreetTile, DrawnStreets>();
/** The drawn streets of a tile, indexed once and kept with it. */
export function drawnStreets(tile: StreetTile): DrawnStreets {
  const cached = cache.get(tile); if (cached) return cached;
  const size = tile.size, x0 = tile.tx * size, z0 = tile.tz * size, x1 = x0 + size, z1 = z0 + size, n = Math.ceil(size / CELL);
  const flat: number[] = [];
  for (const rings of tile.streetPavement ?? []) for (const ring of rings) for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; if (a[0] !== b[0] || a[1] !== b[1]) flat.push(a[0], a[1], b[0], b[1]); }
  const E = Float64Array.from(flat), edges = E.length / 4;
  // Each cell lists the edges within PAD of it, so that one cell answers `near` and a line's cells every edge the line
  // can meet; `mixed` cells are those an edge passes through, the others lie wholly in the pavement or wholly out of it.
  const lists: number[][] = [], mixed = new Uint8Array(n * n), crossings = new Uint16Array(n * n);
  const cellOf = (v: number, origin: number) => Math.max(0, Math.min(n - 1, Math.floor((v - origin) / CELL)));
  for (let e = 0; e < edges; e++) {
    const ax = E[e * 4], az = E[e * 4 + 1], bx = E[e * 4 + 2], bz = E[e * 4 + 3];
    for (let j = cellOf(Math.min(az, bz) - PAD, z0); j <= cellOf(Math.max(az, bz) + PAD, z0); j++) for (let i = cellOf(Math.min(ax, bx) - PAD, x0); i <= cellOf(Math.max(ax, bx) + PAD, x0); i++) {
      const cx = x0 + i * CELL, cz = z0 + j * CELL; if (!touches(ax, az, bx, bz, cx - PAD, cz - PAD, cx + CELL + PAD, cz + CELL + PAD)) continue;
      (lists[j * n + i] ??= []).push(e); if (touches(ax, az, bx, bz, cx, cz, cx + CELL, cz + CELL)) mixed[j * n + i] = 1;
    }
    // (where the edge crosses the middle line of each row of cells: the parity of the crossings left of a cell says whether an unmixed one is paved)
    for (let j = cellOf(Math.min(az, bz), z0); j <= cellOf(Math.max(az, bz), z0); j++) {
      const z = z0 + (j + .5) * CELL; if ((az > z) === (bz > z)) continue;
      const i = Math.floor((ax + (bx - ax) * (z - az) / (bz - az) - x0) / CELL); if (i < n) crossings[j * n + Math.max(0, i)]++;
    }
  }
  const start = new Int32Array(n * n + 1); for (let c = 0; c < n * n; c++) start[c + 1] = start[c] + (lists[c]?.length ?? 0);
  const items = new Int32Array(start[n * n]), whole = new Uint8Array(n * n);
  for (let c = 0; c < n * n; c++) if (lists[c]) items.set(lists[c], start[c]);
  for (let j = 0; j < n; j++) for (let i = 0, odd = 0; i < n; i++) { whole[j * n + i] = odd; odd ^= crossings[j * n + i] & 1; }

  const paved = (x: number, z: number) => {
    if (!(x >= x0 && x < x1 && z >= z0 && z < z1)) return false;
    // Count the edges a ray toward -x crosses, cell by cell, as far as the first cell no edge passes through.
    const j = cellOf(z, z0); let odd = 0, hi = x;
    for (let i = cellOf(x, x0); i >= 0; i--) {
      const c = j * n + i; if (!mixed[c]) return (whole[c] ^ odd) === 1;
      const lo = x0 + i * CELL;
      for (let k = start[c]; k < start[c + 1]; k++) {
        const e = items[k] * 4, az = E[e + 1], bz = E[e + 3]; if ((az > z) === (bz > z)) continue;
        const cx = E[e] + (E[e + 2] - E[e]) * (z - az) / (bz - az); if (cx >= lo && cx < hi) odd ^= 1;
      }
      hi = lo;
    }
    return odd === 1;
  };
  const near = (x: number, z: number, margin: number) => {
    if (paved(x, z)) return true;
    const c = cellOf(z, z0) * n + cellOf(x, x0), reach = margin * margin;
    for (let k = start[c]; k < start[c + 1]; k++) {
      const e = items[k] * 4, ax = E[e], az = E[e + 1], dx = E[e + 2] - ax, dz = E[e + 3] - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      if ((x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2 < reach) return true;
    }
    return false;
  };
  const seen = new Int32Array(edges); let stamp = 0;
  const spans = (x: number, z: number, nx: number, nz: number, from: number, to: number) => {
    // the part of the line inside the tile
    let a = from, b = to;
    if (nx === 0) { if (x < x0 || x >= x1) b = a; } else { const p = (x0 - x) / nx, q = (x1 - x) / nx; a = Math.max(a, Math.min(p, q)); b = Math.min(b, Math.max(p, q)); }
    if (nz === 0) { if (z < z0 || z >= z1) b = a; } else { const p = (z0 - z) / nz, q = (z1 - z) / nz; a = Math.max(a, Math.min(p, q)); b = Math.min(b, Math.max(p, q)); }
    if (!(b > a)) return { spans: [], known: [a, a] as [number, number] };
    const hits: number[] = []; stamp++;
    // (an edge the line meets lies within PAD of the cell of a point of the line no more than half a cell from the meeting)
    for (let t = a; ; t += CELL / 2) {
      const at = Math.min(t, b), c = cellOf(z + at * nz, z0) * n + cellOf(x + at * nx, x0);
      for (let k = start[c]; k < start[c + 1]; k++) {
        const e = items[k]; if (seen[e] === stamp) continue; seen[e] = stamp;
        const ax = E[e * 4] - x, az = E[e * 4 + 1] - z, bx = E[e * 4 + 2] - x, bz = E[e * 4 + 3] - z, sa = nx * az - nz * ax, sb = nx * bz - nz * bx;
        if ((sa > 0) === (sb > 0)) continue;
        const ta = ax * nx + az * nz, hit = ta + (bx * nx + bz * nz - ta) * sa / (sa - sb); if (hit > a + 1e-7 && hit < b - 1e-7) hits.push(hit);
      }
      if (at >= b) break;
    }
    hits.sort((p, q) => p - q);
    const out: number[] = []; let on = paved(x + (a + 1e-7) * nx, z + (a + 1e-7) * nz), begin = a;
    for (const hit of hits) { if (on) out.push(begin, hit); else begin = hit; on = !on; }
    if (on) out.push(begin, b);
    return { spans: out, known: [a, b] as [number, number] };
  };
  let stalls: Map<number, (Stall & { sin: number; cos: number })[]> | undefined;
  const stallKey = (i: number, j: number) => (i + 512) * 4096 + j + 512;
  const stall = (x: number, z: number, margin: number) => {
    if (!stalls) { stalls = new Map(); for (const s of tileStalls(tile)) { const k = stallKey(Math.floor((s.x - x0) / CELL), Math.floor((s.z - z0) / CELL)), entry = { ...s, sin: Math.sin(s.yaw), cos: Math.cos(s.yaw) }, list = stalls.get(k); if (list) list.push(entry); else stalls.set(k, [entry]); } }
    if (!stalls.size) return false;
    const ci = Math.floor((x - x0) / CELL), cj = Math.floor((z - z0) / CELL);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) { const list = stalls.get(stallKey(i, j)); if (list) for (const s of list) {
      const dx = x - s.x, dz = z - s.z;
      if (Math.abs(dx * s.sin + dz * s.cos) < STALL_LONG + margin && Math.abs(dx * s.cos - dz * s.sin) < STALL_HALF + margin) return true;
    } }
    return false;
  };
  let lots: { rings: Point2[][]; minX: number; maxX: number; minZ: number; maxZ: number }[] | undefined;
  const lot = (x: number, z: number, margin: number) => {
    lots ??= (tile.driveways ?? []).filter(rings => rings[0]?.length >= 3).map(rings => { let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity; for (const p of rings[0]) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); } return { rings, minX, maxX, minZ, maxZ }; });
    return lots.some(l => x >= l.minX - margin && x <= l.maxX + margin && z >= l.minZ - margin && z <= l.maxZ + margin && (inRings(x, z, l.rings) || l.rings.some(ring => ring.some((a, i) => {
      const b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
      return (x - a[0] - t * dx) ** 2 + (z - a[1] - t * dz) ** 2 < margin * margin;
    }))));
  };
  const within = (x: number, z: number, nx: number, nz: number, inset: number): [number, number] => {
    let a = -Infinity, b = Infinity;
    if (nx === 0) { if (x < x0 + inset || x > x1 - inset) return [1, 0]; } else { const p = (x0 + inset - x) / nx, q = (x1 - inset - x) / nx; a = Math.max(a, Math.min(p, q)); b = Math.min(b, Math.max(p, q)); }
    if (nz === 0) { if (z < z0 + inset || z > z1 - inset) return [1, 0]; } else { const p = (z0 + inset - z) / nz, q = (z1 - inset - z) / nz; a = Math.max(a, Math.min(p, q)); b = Math.min(b, Math.max(p, q)); }
    return [a, b];
  };
  const streets: DrawnStreets = { paved, near, spans, stall, lot, inset: (x, z) => Math.min(x - x0, x1 - x, z - z0, z1 - z), within };
  cache.set(tile, streets); return streets;
}
