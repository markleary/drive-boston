import type { Building, CityArea, ParkPath, Point2 } from '../types';

/** One streamed world tile: building metadata and quantized geometry, plus the
 * context polygons clipped to the tile. Mirrors scripts/tileformat.py (DBT2). */
export interface TileBuildingGeometry { positions: Float32Array; facade: Uint16Array | Uint32Array; roof: Uint16Array | Uint32Array; }
export interface TileBuilding extends Building { district: string; source?: string; partOf?: string; sourceBaseOffset?: number; /** A bridge or viaduct carried as a survey mesh: exact collision, no foundation skirt, token footprint. */ structure?: boolean; anchor: [number, number, number]; v: number; f: number; r: number; /** Quantization step in metres when coarser than TILE_SCALE (extensive complexes). */ scale?: number; }
export interface CityTile {
  tx: number; tz: number; size: number; key: string;
  buildings: TileBuilding[]; geometry: Map<string, TileBuildingGeometry>;
  curbs: Point2[][]; parks: CityArea[]; water: (CityArea & { level?: number })[]; parkPaths: ParkPath[]; roads: string[];
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
    curbs: header.curbs ?? [], parks: header.parks ?? [], water: header.water ?? [], parkPaths: header.parkPaths ?? [], roads: header.roads ?? [] };
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
