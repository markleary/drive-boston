import type { Point2 } from '../types';

/** Whole-metro coarse building set (DBF2, written by scripts/build-metro.py
 * `write_far`): per 1 km tile, each building's convex footprint at decimetre
 * precision with its height, base elevation, flags and facade family.
 * Layout: 'DBF2' | uint32 header bytes | header JSON {size,tiles:[{key,offset,count}]}
 * | pad to 4 | per building <uint16 points, uint16 height cm, int16 base cm,
 * uint8 flags, uint8 style> then points as <int16 dx dm, int16 dz dm>
 * relative to the tile origin (tx*size, tz*size). Flags: bit 0 landmark, bit 1
 * exact-mesh complex, bit 2 hidden (no far box: a structure such as the Zakim
 * Bridge, or a complex drawn by its fragments), bit 3 massing fragment, a
 * terraced hull of the hidden primary before it rather than a building of its
 * own (`count` and the manifest's buildingCount exclude fragments). */
export interface FarBuilding { tx: number; tz: number; height: number; base: number; landmark: boolean; exactMesh: boolean; hidden: boolean; fragment: boolean; style: number; footprint: Point2[]; center: Point2; }
export interface FarTile { key: string; tx: number; tz: number; buildings: FarBuilding[]; }
export interface FarCity { size: number; tiles: Map<string, FarTile>; count: number; }

export function parseFar(buffer: ArrayBuffer): FarCity {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'DBF2') throw new Error('Not a Drive Boston far-building file');
  const length = view.getUint32(4, true), header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length)));
  let body = 8 + length; body += (4 - body % 4) % 4;
  const size: number = header.size, tiles = new Map<string, FarTile>(); let count = 0;
  for (const entry of header.tiles as { key: string; offset: number; count: number }[]) {
    const [tx, tz] = entry.key.split('_').map(Number), ox = tx * size, oz = tz * size, buildings: FarBuilding[] = [];
    let offset = body + entry.offset;
    for (let n = 0; n < entry.count; n++) {
      const points = view.getUint16(offset, true), height = view.getUint16(offset + 2, true) / 100, base = view.getInt16(offset + 4, true) / 100;
      const flags = bytes[offset + 6], landmark = (flags & 1) !== 0, exactMesh = (flags & 2) !== 0, hidden = (flags & 4) !== 0, fragment = (flags & 8) !== 0, style = bytes[offset + 7]; offset += 8;
      const footprint: Point2[] = []; let sx = 0, sz = 0;
      for (let i = 0; i < points; i++) { const x = ox + view.getInt16(offset, true) / 10, z = oz + view.getInt16(offset + 2, true) / 10; footprint.push([x, z]); sx += x; sz += z; offset += 4; }
      buildings.push({ tx, tz, height, base, landmark, exactMesh, hidden, fragment, style, footprint, center: [sx / (points || 1), sz / (points || 1)] }); if (!fragment) count++;
    }
    tiles.set(entry.key, { key: entry.key, tx, tz, buildings });
  }
  return { size, tiles, count };
}
