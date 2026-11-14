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
  curbs: Point2[][]; /** Stretches of `curbs` with no roadway, sidewalk, island, lot or path beside them (scripts/street_surfaces.py, bare_curbs), which are not drawn: [curb, from, to, ...], the curb's index and centimetres along it. */ bareCurbs?: number[]; parks: CityArea[]; water: (CityArea & { level?: number })[]; parkPaths: ParkPath[]; roads: string[];
  pavements: TilePavement[]; /** Records of other tiles' roads that run alongside this tile's roads at their crosswalk stations, read by `roadwaySpan` only; the owning tile draws them. */ borderPavements: TilePavement[]; sidewalks: TileSidewalk[]; /** Closed curb faces filled with concrete (traffic islands, lane dividers, platforms). */ islands: Point2[][][];
  /** Closed curb faces an OSM service road or parking area explains (pull-offs, turnarounds, lots), filled with asphalt. */ driveways: Point2[][][];
  /** Compiled unions, clipped to tile boundaries after resolving folds and junctions. */
  streetPavement?: Point2[][][]; streetSidewalks?: Point2[][][];
  /** Pavement on terrain only where an embankment reaches a deck. */
  deckPavement?: Point2[][][];
  /** Stalls of the tile's surface parking lots (scripts/parking_lots.py): [x, z, yaw, ...], centimetres from the tile origin and the
   * heading of a car parked nose in, in hundredths of a degree (vehicle yaw). src/simulation/parking-lots.ts reads them. */
  parking?: number[];
}
export const TILE_SCALE = .01;
export const tileKey = (tx: number, tz: number) => `${tx}_${tz}`;
export const tileOf = (x: number, z: number, size: number): [number, number] => [Math.floor(x / size), Math.floor(z / size)];
export const tileFile = (tx: number, tz: number) => `t_${tx}_${tz}.bin`;
/** The undrawn stretches of each curb of a tile, in metres along it: curb index to [from, to] pairs. */
export function bareCurbStretches(tile: Pick<CityTile, 'bareCurbs'>) {
  const out = new Map<number, [number, number][]>(), flat = tile.bareCurbs ?? [];
  for (let i = 0; i + 2 < flat.length; i += 3) { const list = out.get(flat[i]); if (list) list.push([flat[i + 1] / 100, flat[i + 2] / 100]); else out.set(flat[i], [[flat[i + 1] / 100, flat[i + 2] / 100]]); }
  return out;
}

/** The JSON header of a decompressed DBT2 buffer, and its length in bytes. */
function tileHeader(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'DBT2') throw new Error('Not a Drive Boston tile');
  const length = view.getUint32(4, true);
  return { header: JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length))), length };
}
/** A tile as its header lists it, around the given building geometry. */
function headerTile(header: any, geometry: Map<string, TileBuildingGeometry>): CityTile {
  return { tx: header.tx, tz: header.tz, size: header.size, key: tileKey(header.tx, header.tz), buildings: header.buildings, geometry,
    curbs: header.curbs ?? [], bareCurbs: header.bareCurbs, parks: header.parks ?? [], water: header.water ?? [], parkPaths: header.parkPaths ?? [], roads: header.roads ?? [],
    pavements: header.pavements ?? [], borderPavements: header.borderPavements ?? [], sidewalks: header.sidewalks ?? [], islands: header.islands ?? [], driveways: header.driveways ?? [], streetPavement: header.streetPavement, streetSidewalks: header.streetSidewalks, deckPavement: header.deckPavement, parking: header.parking };
}
/** A decompressed DBT2 buffer's tile without its buildings' shells (`geometry` is empty): the surfaces, curbs, paths
 * and stalls are all in the header, which is all an audit of every tile needs to read. */
export function parseTileHeader(buffer: ArrayBuffer): CityTile { return headerTile(tileHeader(buffer).header, new Map()); }

/** Parse a decompressed DBT2 buffer. Positions become absolute world metres. */
export function parseTile(buffer: ArrayBuffer): CityTile {
  const view = new DataView(buffer), { header, length } = tileHeader(buffer);
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
  return headerTile(header, geometry);
}

/** A pavement record's edges as world-metre left and right polylines. */
export function pavementEdges(tile: Pick<CityTile, 'tx' | 'tz' | 'size'>, pavement: TilePavement): { left: Point2[]; right: Point2[] } {
  const e = pavement.edges, ox = tile.tx * tile.size, oz = tile.tz * tile.size, left: Point2[] = [], right: Point2[] = [];
  for (let i = 0; i + 3 < e.length; i += 4) { left.push([ox + e[i] / 100, oz + e[i + 1] / 100]); right.push([ox + e[i + 2] / 100, oz + e[i + 3] / 100]); }
  return { left, right };
}

/** How closely an edge must run with a road (|cos|) for its record to share that road's roadway (roadwaySpan). */
const WITH_ROAD = .8;

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

/** `own` widened across the records of twin carriageways: a record whose edges run with the road at this station
 * (alignment at least .8, a span under 40 m), overlaps or touches `own` within .5 m, and adds at most one roadway of
 * the own width (plus 2 m) beyond it. Where two one-way centerlines share one roadway (the Riverway at Longwood,
 * Huntington Avenue off the reservation, Edwin H. Land Boulevard) a crosswalk stripes the whole asphalt instead of
 * stopping at the record of the road that owns it. A reservation or median wider than .5 m keeps the spans apart; a
 * cross street's junction mouth, a much wider street running alongside, or a record touching only a widened span
 * (Bothwell Road's start beside Faneuil and Arlington Streets) does not stretch the stripes.
 *
 * With `along`, the length of the stripes, an edge that only steps where the station's line meets it still runs with
 * the road if its offset has moved by less than that alignment allows where the stripes end (2.25 m over 3 m), and
 * the record then counts as far as the nearer of its two offsets, so the stripes stay on its pavement. The far edge
 * of a twin carriageway steps like that where a ramp's landing begins: the segment under the line is a 1.9 m jog at
 * 52 degrees, the edge itself has moved 7 cm where the stripes end, and without this Congress Street's crosswalk at
 * the eastbound landings of Exit 135 ended in the middle of its roadway. */
export function roadwaySpan(own: [number, number], others: { left: Point2[]; right: Point2[] }[], at: Point2, tx: number, tz: number, along = 0): [number, number] {
  let [lo, hi] = own;
  const allowance = own[1] - own[0] + 2, end: Point2 = [at[0] + tx * along, at[1] + tz * along], drift = along * Math.sqrt(1 - WITH_ROAD * WITH_ROAD) / WITH_ROAD;
  for (const e of others) {
    const l = edgeCrossing(e.left, at, tx, tz), r = edgeCrossing(e.right, at, tx, tz);
    if (!l || !r || Math.abs(l[0] - r[0]) > 40) continue;
    let s0 = Math.min(l[0], r[0]), s1 = Math.max(l[0], r[0]);
    if (l[1] < WITH_ROAD || r[1] < WITH_ROAD) {
      if (!along) continue;
      const l2 = edgeCrossing(e.left, end, tx, tz), r2 = edgeCrossing(e.right, end, tx, tz);
      if (!l2 || !r2 || (l[1] < WITH_ROAD && Math.abs(l2[0] - l[0]) > drift) || (r[1] < WITH_ROAD && Math.abs(r2[0] - r[0]) > drift)) continue;
      s0 = Math.max(s0, Math.min(l2[0], r2[0])); s1 = Math.min(s1, Math.max(l2[0], r2[0]));
    }
    if (s0 > own[1] + .5 || s1 < own[0] - .5 || Math.max(0, own[0] - s0) + Math.max(0, s1 - own[1]) > allowance) continue;
    lo = Math.min(lo, s0); hi = Math.max(hi, s1);
  }
  return [lo, hi];
}

/** The length of a polyline. */
export function polylineLength(points: Point2[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return length;
}

/** The point `distance` along a polyline from its first vertex and the unit direction of the segment it lies on, or
 * undefined where the polyline is shorter: a crosswalk station on a line whose first segment is short (a moved park-edge
 * centerline tapers through close vertices) follows the line instead of the first segment's bearing. */
export function stationAlong(points: Point2[], distance: number): { at: Point2; tx: number; tz: number } | undefined {
  let left = distance;
  for (let i = 1; i < points.length; i++) {
    const [x0, z0] = points[i - 1], [x1, z1] = points[i], l = Math.hypot(x1 - x0, z1 - z0);
    if (left <= l && l > 0) return { at: [x0 + (x1 - x0) * left / l, z0 + (z1 - z0) * left / l], tx: (x1 - x0) / l, tz: (z1 - z0) / l };
    left -= l;
  }
  return undefined;
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
