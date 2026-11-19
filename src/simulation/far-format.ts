import type { Point2 } from '../types';

/** Whole-metro coarse building set (DBF2, written by scripts/build-metro.py
 * `write_far`): per 1 km tile, each building's convex footprint at decimetre
 * precision with its height, base elevation, flags and facade family.
 * Layout: 'DBF2' | uint32 header bytes | header JSON {size,tiles:[{key,offset,count}]}
 * | pad to 4 | per building <uint16 points, uint16 height cm, int16 base cm,
 * uint8 flags, uint8 style> then points as <int16 dx dm, int16 dz dm>
 * relative to the tile origin (tx*size, tz*size). Flags: bit 0 landmark, bit 1
 * exact-mesh complex, bit 2 hidden (no far box: a structure such as the Zakim
 * Bridge, or a sprawling complex drawn by its fragments), bit 3 massing
 * fragment, a rectangle of the hidden complex before it rather than a building
 * of its own (`count` and the manifest's buildingCount exclude fragments).
 * Fragments repeat their complex's flags, bit 2 included, so test
 * `drawsFarMassing` rather than `hidden` (scripts/far_massing.py). */
export interface FarBuilding { tx: number; tz: number; height: number; base: number; landmark: boolean; exactMesh: boolean; hidden: boolean; fragment: boolean; style: number; footprint: Point2[]; center: Point2; }
/** Whether an entry draws on the far city and the map: every hull except a hidden one, whose fragments stand in for it. */
export const drawsFarMassing = (b: Pick<FarBuilding, 'hidden' | 'fragment'>) => !b.hidden || b.fragment;
export interface FarTile { key: string; tx: number; tz: number; buildings: FarBuilding[]; }
export interface FarCity { size: number; tiles: Map<string, FarTile>; count: number; }

/** The mobile index keeps the packed survey and expands only footprints actually used by
 * the minimap, skyline or collision queries. The ring bounds the decoded polygons even
 * after crossing the whole map. Hull objects keep their identity for landmark lookups. */
class PackedFootprints {
  readonly view: DataView;
  readonly #slots: (PackedHull | undefined)[] = new Array(4096);
  private next = 0;

  constructor(view: DataView) { this.view = view; }

  read(hull: PackedHull): Point2[] {
    const previous = this.#slots[this.next];
    if (previous) previous.decoded = undefined;
    this.#slots[this.next] = hull;
    this.next = (this.next + 1) % this.#slots.length;
    const points: Point2[] = [];
    const { ox, oz } = hull.tile;
    for (let i = 0; i < hull.points; i++) {
      const offset = hull.offset + 4 * i;
      points.push([ox + this.view.getInt16(offset, true) / 10, oz + this.view.getInt16(offset + 2, true) / 10]);
    }
    hull.decoded = points;
    return points;
  }
}

type PackedTile = { tx: number; tz: number; ox: number; oz: number; source: PackedFootprints };

export class PackedHull implements FarBuilding {
  readonly tile: PackedTile;
  readonly offset: number;
  readonly points: number;
  readonly height: number;
  readonly base: number;
  readonly style: number;
  readonly flags: number;
  readonly center: Point2;
  minX = Infinity; maxX = -Infinity; minZ = Infinity; maxZ = -Infinity;
  decoded?: Point2[];

  constructor(tile: PackedTile, offset: number, points: number, height: number, base: number, flags: number, style: number) {
    this.tile = tile; this.offset = offset; this.points = points; this.height = height; this.base = base;
    this.flags = flags; this.style = style;
    let sx = 0, sz = 0;
    for (let i = 0; i < points; i++, offset += 4) {
      const x = tile.ox + tile.source.view.getInt16(offset, true) / 10;
      const z = tile.oz + tile.source.view.getInt16(offset + 2, true) / 10;
      this.minX = Math.min(this.minX, x); this.maxX = Math.max(this.maxX, x);
      this.minZ = Math.min(this.minZ, z); this.maxZ = Math.max(this.maxZ, z);
      sx += x; sz += z;
    }
    this.center = [sx / (points || 1), sz / (points || 1)];
  }

  get tx() { return this.tile.tx; }
  get tz() { return this.tile.tz; }
  get landmark() { return (this.flags & 1) !== 0; }
  get exactMesh() { return (this.flags & 2) !== 0; }
  get hidden() { return (this.flags & 4) !== 0; }
  get fragment() { return (this.flags & 8) !== 0; }
  get footprint() { return this.decoded ?? this.tile.source.read(this); }
}

export function parseFar(buffer: ArrayBuffer, packed = false): FarCity {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'DBF2') throw new Error('Not a Drive Boston far-building file');
  const length = view.getUint32(4, true), header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length)));
  let body = 8 + length; body += (4 - body % 4) % 4;
  const size: number = header.size, tiles = new Map<string, FarTile>(); let count = 0;
  const source = packed ? new PackedFootprints(view) : undefined;
  for (const entry of header.tiles as { key: string; offset: number; count: number }[]) {
    const [tx, tz] = entry.key.split('_').map(Number), ox = tx * size, oz = tz * size, buildings: FarBuilding[] = [];
    const tile = source && { tx, tz, ox, oz, source };
    let offset = body + entry.offset;
    for (let n = 0; n < entry.count; n++) {
      const points = view.getUint16(offset, true), height = view.getUint16(offset + 2, true) / 100, base = view.getInt16(offset + 4, true) / 100;
      const flags = bytes[offset + 6], landmark = (flags & 1) !== 0, exactMesh = (flags & 2) !== 0, hidden = (flags & 4) !== 0, fragment = (flags & 8) !== 0, style = bytes[offset + 7]; offset += 8;
      if (!fragment) count++;
      if (tile) {
        buildings.push(new PackedHull(tile, offset, points, height, base, flags, style));
        offset += points * 4;
        continue;
      }
      const footprint: Point2[] = []; let sx = 0, sz = 0;
      for (let i = 0; i < points; i++) { const x = ox + view.getInt16(offset, true) / 10, z = oz + view.getInt16(offset + 2, true) / 10; footprint.push([x, z]); sx += x; sz += z; offset += 4; }
      buildings.push({ tx, tz, height, base, landmark, exactMesh, hidden, fragment, style, footprint, center: [sx / (points || 1), sz / (points || 1)] });
    }
    tiles.set(entry.key, { key: entry.key, tx, tz, buildings });
  }
  return { size, tiles, count };
}
