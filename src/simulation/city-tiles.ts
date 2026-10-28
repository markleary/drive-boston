import type { Building, CityData, Point2 } from '../types';
import { decodeElevation, gunzip, parseTile, tileFile, tileKey, tileOf, type CityTile, type TileBuilding } from './tile-format.ts';
import { parseFar, type FarBuilding, type FarCity } from './far-format.ts';

/** A metro city streams its buildings from 1 km tiles. `city.buildings` holds
 * the currently loaded detailed set; `far` holds every building's hull. */
export interface TileManifest { size: number; directory: string; keys: string[]; far: string; buildingCount: number; }
export interface MetroCity extends CityData { tiles: TileManifest; landmarkBuildings: Building[]; far: FarCity; index: BuildingIndex; }
export const isMetroCity = (city: CityData): city is MetroCity => !!(city as MetroCity).tiles && !!(city as MetroCity).far;
/** Buildings the landmark modules address before their tiles stream in. */
export const landmarkBuildings = (city: CityData): Building[] => (city as MetroCity).landmarkBuildings ?? city.buildings;

/** The building whose footprint contains a point, whether or not its tile is loaded. */
export function buildingAt(city: CityData, x: number, z: number): Building | FarBuilding | undefined {
  if (isMetroCity(city)) return city.index.at(x, z);
  return city.buildings.find(b => pointInPolygon(x, z, b.footprint));
}

export type Reader = (name: string) => Promise<ArrayBuffer>;

/** Resolve the sidecar files a metro city.json refers to. The elevation grid
 * becomes a Float32Array (graded offline when `elevation.graded` is set). */
export async function resolveCity(city: CityData, read: Reader): Promise<CityData> {
  const elevation = city.elevation as (CityData['elevation'] & { file?: string; scale?: number }) | undefined;
  const tiles = (city as Partial<MetroCity>).tiles;
  const [heights, far] = await Promise.all([
    elevation?.file ? read(elevation.file).then(gunzip).then(buffer => decodeElevation(buffer, elevation.scale ?? .01)) : undefined,
    tiles ? read(tiles.far).then(gunzip).then(parseFar) : undefined,
  ]);
  if (elevation && heights) elevation.heights = heights;
  if (!tiles || !far) return city;
  const metro = city as MetroCity; metro.far = far; metro.landmarkBuildings ??= []; metro.buildings = []; metro.curbs ??= []; metro.parkPaths ??= []; metro.index = new BuildingIndex(far);
  return metro;
}

export async function loadTile(city: MetroCity, tx: number, tz: number, read: Reader): Promise<CityTile> {
  return parseTile(await gunzip(await read(`${city.tiles.directory}/${tileFile(tx, tz)}`)));
}
export const hasTile = (city: MetroCity, tx: number, tz: number) => tileKeys(city).has(tileKey(tx, tz));
const keySets = new WeakMap<TileManifest, Set<string>>();
function tileKeys(city: MetroCity) { let set = keySets.get(city.tiles); if (!set) { set = new Set(city.tiles.keys); keySets.set(city.tiles, set); } return set; }
export { tileKey, tileOf };

/** Which tiles lie within `radius` metres of a point (by nearest tile edge). */
export function tilesNear(city: MetroCity, x: number, z: number, radius: number) {
  const size = city.tiles.size, result: { tx: number; tz: number; key: string; distance: number }[] = [];
  for (let tx = Math.floor((x - radius) / size); tx <= Math.floor((x + radius) / size); tx++) for (let tz = Math.floor((z - radius) / size); tz <= Math.floor((z + radius) / size); tz++) {
    const key = tileKey(tx, tz); if (!tileKeys(city).has(key)) continue;
    const dx = Math.max(tx * size - x, 0, x - (tx + 1) * size), dz = Math.max(tz * size - z, 0, z - (tz + 1) * size), distance = Math.hypot(dx, dz);
    if (distance <= radius) result.push({ tx, tz, key, distance });
  }
  return result.sort((a, b) => a.distance - b.distance);
}

export function pointInPolygon(x: number, z: number, polygon: Point2[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Spatial index over every building hull in the metro, so point and range
 * queries never depend on which detailed tiles are currently loaded. */
export class BuildingIndex {
  readonly cell: number;
  private readonly cells = new Map<number, FarBuilding[]>();
  private readonly stamps: Uint32Array; private stamp = 0;
  readonly all: FarBuilding[] = [];
  constructor(far: FarCity, cell = 100) {
    this.cell = cell;
    for (const tile of far.tiles.values()) for (const b of tile.buildings) this.all.push(b);
    this.stamps = new Uint32Array(this.all.length);
    this.all.forEach((b, n) => {
      (b as FarBuilding & { n: number }).n = n;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of b.footprint) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
      Object.assign(b, { minX, maxX, minZ, maxZ });
      for (let cx = Math.floor(minX / cell); cx <= Math.floor(maxX / cell); cx++) for (let cz = Math.floor(minZ / cell); cz <= Math.floor(maxZ / cell); cz++) {
        const key = this.key(cx, cz), list = this.cells.get(key); if (list) list.push(b); else this.cells.set(key, [b]);
      }
    });
  }
  private key(cx: number, cz: number) { return (cx + 32768) * 65536 + (cz + 32768); }
  /** Every hull whose bounding box touches the query box, each once. */
  query(minX: number, maxX: number, minZ: number, maxZ: number): IndexedBuilding[] {
    const stamp = ++this.stamp, result: IndexedBuilding[] = [];
    for (let cx = Math.floor(minX / this.cell); cx <= Math.floor(maxX / this.cell); cx++) for (let cz = Math.floor(minZ / this.cell); cz <= Math.floor(maxZ / this.cell); cz++) {
      for (const b of this.cells.get(this.key(cx, cz)) ?? []) {
        const e = b as IndexedBuilding; if (this.stamps[e.n] === stamp) continue; this.stamps[e.n] = stamp;
        if (e.maxX < minX || e.minX > maxX || e.maxZ < minZ || e.minZ > maxZ) continue;
        result.push(e);
      }
    }
    return result;
  }
  near(x: number, z: number, radius: number) { return this.query(x - radius, x + radius, z - radius, z + radius); }
  /** The hull containing a point, if any. */
  at(x: number, z: number): IndexedBuilding | undefined {
    for (const b of this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) ?? []) {
      const e = b as IndexedBuilding; if (x < e.minX || x > e.maxX || z < e.minZ || z > e.maxZ) continue;
      if (pointInPolygon(x, z, e.footprint)) return e;
    }
    return undefined;
  }
}
export interface IndexedBuilding extends FarBuilding { n: number; minX: number; maxX: number; minZ: number; maxZ: number; }

/** Live detailed building set of a metro city: the streamer adds and removes
 * tile buildings here, so legacy `city.buildings` consumers see what is loaded. */
export function addTileBuildings(city: MetroCity, tile: CityTile) { for (const b of tile.buildings) city.buildings.push(b); }
export function removeTileBuildings(city: MetroCity, tile: CityTile) {
  const ids = new Set(tile.buildings.map(b => b.id)); let n = 0;
  for (let i = 0; i < city.buildings.length; i++) { const b = city.buildings[i]; if (!ids.has(b.id)) city.buildings[n++] = b; }
  city.buildings.length = n;
}
export type { CityTile, TileBuilding };
