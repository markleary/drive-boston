import type { Building, CityArea, ParkPath, Point2 } from '../types';

/** One streamed world tile: building metadata and quantized geometry, plus the
 * context polygons clipped to the tile. Mirrors scripts/tileformat.py (DBT2). */
export interface TileBuildingGeometry { positions: Float32Array; facade: Uint16Array | Uint32Array; roof: Uint16Array | Uint32Array; }
export interface TileBuilding extends Building { district: string; source?: string; partOf?: string; sourceBaseOffset?: number; /** A bridge or viaduct carried as a survey mesh: exact collision, no foundation skirt, token footprint. */ structure?: boolean; anchor: [number, number, number]; v: number; f: number; r: number; /** Quantization step in metres when coarser than TILE_SCALE (extensive complexes). */ scale?: number; }
/** Curb-bounded roadway of one road the tile owns (scripts/street_surfaces.py):
 * `edges` runs [lx, lz, rx, rz, ...] in centimetres from the tile origin, one
 * left/right pair per station; `walk` says per side whether the Boston sidewalk
 * inventory has a polygon there (a missing side gets the fallback band). */
export interface TilePavement { road: string; edges: number[]; walk?: [number, number]; }
/** A sidewalk inventory polygon clipped to the tile; concrete unless `material` says brick. */
export interface TileSidewalk { rings: Point2[][]; material?: 'brick'; }
export interface CityTile {
  tx: number; tz: number; size: number; key: string;
  buildings: TileBuilding[]; geometry: Map<string, TileBuildingGeometry>;
  curbs: Point2[][]; parks: CityArea[]; water: (CityArea & { level?: number })[]; parkPaths: ParkPath[]; roads: string[];
  pavements: TilePavement[]; sidewalks: TileSidewalk[]; /** Closed curb faces filled with concrete (traffic islands, lane dividers, platforms). */ islands: Point2[][][];
  /** Closed curb faces an OSM service road or parking area explains (pull-offs, turnarounds, lots), filled with asphalt. */ driveways: Point2[][][];
}
export const TILE_SCALE = .01;
export const tileKey = (tx: number, tz: number) => `${tx}_${tz}`;
export const tileOf = (x: number, z: number, size: number): [number, number] => [Math.floor(x / size), Math.floor(z / size)];
export const tileFile = (tx: number, tz: number) => `t_${tx}_${tz}.bin`;

/** Parse a decompressed DBT2 buffer. Positions become absolute world metres. */
export function parseTile(buffer: ArrayBuffer): CityTile {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'DBT2') throw new Error('Not a Drive Boston tile');
  const length = view.getUint32(4, true), header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length)));
  let offset = 8 + length; offset += (4 - offset % 4) % 4;
  const vertexCount: number = header.vertexCount, wide = header.indexBytes === 4;
  let indexOffset = offset + vertexCount * 6; indexOffset += (4 - indexOffset % 4) % 4;
  const geometry = new Map<string, TileBuildingGeometry>();
  for (const entry of header.buildings as TileBuilding[]) {
    const count = entry.v, positions = new Float32Array(count * 3), [ax, ay, az] = entry.anchor, scale = entry.scale ?? TILE_SCALE;
    for (let i = 0; i < count * 3; i += 3) {
      positions[i] = ax + view.getInt16(offset + i * 2, true) * scale;
      positions[i + 1] = ay + view.getInt16(offset + i * 2 + 2, true) * scale;
      positions[i + 2] = az + view.getInt16(offset + i * 2 + 4, true) * scale;
    }
    offset += count * 6;
    const total = entry.f + entry.r, indices = wide ? new Uint32Array(total) : new Uint16Array(total);
    for (let i = 0; i < total; i++) indices[i] = wide ? view.getUint32(indexOffset + i * 4, true) : view.getUint16(indexOffset + i * 2, true);
    indexOffset += total * (wide ? 4 : 2);
    geometry.set(entry.id, { positions, facade: indices.subarray(0, entry.f), roof: indices.subarray(entry.f) });
  }
  return { tx: header.tx, tz: header.tz, size: header.size, key: tileKey(header.tx, header.tz), buildings: header.buildings, geometry,
    curbs: header.curbs ?? [], parks: header.parks ?? [], water: header.water ?? [], parkPaths: header.parkPaths ?? [], roads: header.roads ?? [],
    pavements: header.pavements ?? [], sidewalks: header.sidewalks ?? [], islands: header.islands ?? [], driveways: header.driveways ?? [] };
}

/** A pavement record's edges as world-metre left and right polylines. */
export function pavementEdges(tile: Pick<CityTile, 'tx' | 'tz' | 'size'>, pavement: TilePavement): { left: Point2[]; right: Point2[] } {
  const e = pavement.edges, ox = tile.tx * tile.size, oz = tile.tz * tile.size, left: Point2[] = [], right: Point2[] = [];
  for (let i = 0; i + 3 < e.length; i += 4) { left.push([ox + e[i] / 100, oz + e[i + 1] / 100]); right.push([ox + e[i + 2] / 100, oz + e[i + 3] / 100]); }
  return { left, right };
}

/** The crossing of an edge polyline with the perpendicular through `at`, a station along the unit direction (tx, tz),
 * nearest to `at`: its signed offset across that direction and how closely the edge runs with the road there (|cos|). */
function edgeCrossing(edge: Point2[], at: Point2, tx: number, tz: number): [number, number] | undefined {
  let best: [number, number] | undefined;
  for (let i = 1; i < edge.length; i++) {
    const s0 = (edge[i - 1][0] - at[0]) * tx + (edge[i - 1][1] - at[1]) * tz, s1 = (edge[i][0] - at[0]) * tx + (edge[i][1] - at[1]) * tz;
    if ((s0 <= 0) === (s1 <= 0)) continue;
    const t = s0 / (s0 - s1), x = edge[i - 1][0] + (edge[i][0] - edge[i - 1][0]) * t, z = edge[i - 1][1] + (edge[i][1] - edge[i - 1][1]) * t, offset = (z - at[1]) * tx - (x - at[0]) * tz;
    if (best && Math.abs(best[0]) <= Math.abs(offset)) continue;
    const dx = edge[i][0] - edge[i - 1][0], dz = edge[i][1] - edge[i - 1][1], len = Math.hypot(dx, dz) || 1;
    best = [offset, Math.abs(dx * tx + dz * tz) / len];
  }
  return best;
}

/** Where a pavement's edges cross the perpendicular through `at`, a station along the unit direction (tx, tz):
 * the signed offsets across that direction, lower first, or undefined where an edge does not reach the station. */
export function pavementSpan(edges: { left: Point2[]; right: Point2[] }, at: Point2, tx: number, tz: number): [number, number] | undefined {
  const l = edgeCrossing(edges.left, at, tx, tz), r = edgeCrossing(edges.right, at, tx, tz);
  return l === undefined || r === undefined ? undefined : [Math.min(l[0], r[0]), Math.max(l[0], r[0])];
}

/** `own` widened across every other record whose edges run with the road at this station (alignment at least .8, a span
 * under 40 m) and overlap or touch it within .5 m: where two one-way centerlines share one roadway (the Riverway at
 * Longwood, Huntington Avenue off the reservation) a crosswalk stripes the whole asphalt instead of stopping at the
 * record of the road that owns it. A reservation or median wider than .5 m keeps the spans apart. */
export function roadwaySpan(own: [number, number], others: { left: Point2[]; right: Point2[] }[], at: Point2, tx: number, tz: number): [number, number] {
  let [lo, hi] = own, grew = true;
  const spans = others.map(e => {
    const l = edgeCrossing(e.left, at, tx, tz), r = edgeCrossing(e.right, at, tx, tz);
    return l && r && l[1] >= .8 && r[1] >= .8 && Math.abs(l[0] - r[0]) <= 40 ? [Math.min(l[0], r[0]), Math.max(l[0], r[0])] as [number, number] : undefined;
  });
  while (grew) {
    grew = false;
    for (const s of spans) {
      if (!s || s[0] > hi + .5 || s[1] < lo - .5) continue;
      if (s[0] < lo) { lo = s[0]; grew = true; }
      if (s[1] > hi) { hi = s[1]; grew = true; }
    }
  }
  return [lo, hi];
}

/** Inflate a gzip-compressed tile or elevation file with the platform stream API. */
export async function gunzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/** Int16 centimetre heights (row-major) to the Float32 metre grid the terrain code samples. */
export function decodeElevation(buffer: ArrayBuffer, scale = TILE_SCALE): Float32Array {
  const source = new Int16Array(buffer), heights = new Float32Array(source.length);
  for (let i = 0; i < source.length; i++) heights[i] = source[i] * scale;
  return heights;
}
