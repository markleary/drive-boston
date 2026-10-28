import * as THREE from 'three';
import { loadTile, tilesNear, type CityTile, type Reader } from '../simulation/city-tiles.ts';
import type { PlacedSignal } from '../simulation/signal-placement.ts';
import type { FarCityView } from './far-city';
import { createTileBuilder, type BuiltTile, type PartialTile, type TileContext, type TileStage } from './tile-builder';

export interface TileStreamer {
  group: THREE.Group;
  /** Live arrays: the world's update loop iterates them every frame. */
  buildingChunks: THREE.Mesh[]; lampPositions: THREE.Vector3[]; signals: PlacedSignal[];
  update(position: THREE.Vector3, altitude: number): void;
  /** Download and fully build every tile within `radius` of a point before resolving (teleports, boot). */
  ensureAround(x: number, z: number, radius?: number): Promise<void>;
  readonly loaded: ReadonlyMap<string, BuiltTile>;
  stats(): { exactMeshes: number } & Record<string, unknown>;
}

const LOAD_RADIUS = 1150, UNLOAD_RADIUS = 1650, SYNC_RADIUS = 170, FRAME_BUDGET_MS = 7, MAX_FETCHES = 4;

/** Streams 1 km tiles around the observer. Tiles download a few at a time,
 * nearest first; one tile builds at a time through its stage generator, a few
 * milliseconds per frame, except tiles the observer is practically on, which
 * finish at once. Built tiles beyond the unload radius are disposed. */
export function createTileStreamer(ctx: TileContext, read: Reader, far?: FarCityView): TileStreamer {
  const { scene, city } = ctx, builder = createTileBuilder(ctx);
  const group = new THREE.Group(); group.name = 'Streamed tiles'; scene.add(group);
  const loaded = new Map<string, BuiltTile>(), fetched = new Map<string, CityTile>(), fetching = new Map<string, Promise<CityTile>>(), failed = new Set<string>();
  type Active = { key: string; tile: CityTile; generator: Generator<TileStage, BuiltTile>; partial: PartialTile; stage?: TileStage };
  let active: Active | undefined, focus: { x: number; z: number; until: number } | undefined, version = 0;
  const buildingChunks: THREE.Mesh[] = [], lampPositions: THREE.Vector3[] = [], signals: PlacedSignal[] = [];
  const refreshLive = () => {
    buildingChunks.length = 0; lampPositions.length = 0; signals.length = 0;
    for (const t of loaded.values()) { buildingChunks.push(...t.meshes); lampPositions.push(...t.lamps); signals.push(...t.signals); }
    scene.userData.version = ++version;
  };
  const distanceTo = (built: { bounds: BuiltTile['bounds'] }, x: number, z: number) => Math.hypot(Math.max(built.bounds.minX - x, 0, x - built.bounds.maxX), Math.max(built.bounds.minZ - z, 0, z - built.bounds.maxZ));
  const fetch = (tx: number, tz: number, key: string) => {
    if (fetching.has(key) || fetched.has(key) || loaded.has(key) || failed.has(key)) return fetching.get(key);
    const promise = loadTile(city, tx, tz, read).then(tile => { fetched.set(key, tile); return tile; }, error => { console.error(`Tile ${key} failed to load`, error); failed.add(key); throw error; }).finally(() => fetching.delete(key));
    fetching.set(key, promise); return promise;
  };
  const start = (key: string, tile: CityTile): Active => {
    fetched.delete(key);
    // The tile's group joins the scene at once so finished stages show while later ones build.
    const partial: PartialTile = { group: new THREE.Group(), colliders: [], key, tile }; group.add(partial.group);
    return { key, tile, generator: builder.build(tile, partial), partial };
  };
  const step = (entry: Active): BuiltTile | undefined => {
    const result = entry.generator.next();
    if (result.done) return result.value;
    entry.stage = result.value;
    return undefined;
  };
  const finish = (entry: Active, built: BuiltTile) => { loaded.set(entry.key, built); far?.setChunkDetailed(entry.key, true); refreshLive(); };
  const runToCompletion = (entry: Active) => { let built: BuiltTile | undefined; while (!(built = step(entry))); finish(entry, built); return built; };
  const unload = (key: string) => { const built = loaded.get(key); if (!built) return; loaded.delete(key); built.dispose(); far?.setChunkDetailed(key, false); refreshLive(); };
  const abandon = () => { if (!active) return; active.generator.return(undefined as never); builder.abandon(active.partial); active = undefined; };

  function update(position: THREE.Vector3, altitude: number) {
    const reach = LOAD_RADIUS + Math.max(0, altitude) * .6, drop = UNLOAD_RADIUS + Math.max(0, altitude) * .6, now = performance.now();
    if (focus && focus.until < now) focus = undefined;
    const wanted = tilesNear(city, position.x, position.z, reach);
    // Unload at most one far tile per frame; disposal walks the tile's objects.
    for (const [key, built] of loaded) {
      if (distanceTo(built, position.x, position.z) <= drop || (focus && distanceTo(built, focus.x, focus.z) <= drop)) continue;
      unload(key); break;
    }
    if (active && distanceTo({ bounds: boundsOf(active.tile) }, position.x, position.z) > drop && !(focus && distanceTo({ bounds: boundsOf(active.tile) }, focus.x, focus.z) <= drop)) abandon();
    for (const t of wanted) { if (fetching.size >= MAX_FETCHES) break; fetch(t.tx, t.tz, t.key)?.catch(() => undefined); }
    if (!active) {
      let best: { key: string; distance: number } | undefined;
      for (const t of wanted) { if (!fetched.has(t.key)) continue; if (!best || t.distance < best.distance) best = { key: t.key, distance: t.distance }; }
      if (best) active = start(best.key, fetched.get(best.key)!);
    }
    if (!active) return;
    const distance = distanceTo({ bounds: boundsOf(active.tile) }, position.x, position.z), began = performance.now();
    while (true) {
      const built = step(active);
      if (built) { finish(active, built); active = undefined; break; }
      if (distance > SYNC_RADIUS && performance.now() - began > FRAME_BUDGET_MS) break;
    }
  }

  async function ensureAround(x: number, z: number, radius = 350) {
    focus = { x, z, until: performance.now() + 8000 };
    const wanted = tilesNear(city, x, z, radius);
    await Promise.all(wanted.map(t => loaded.has(t.key) || (active?.key === t.key) || fetched.has(t.key) ? undefined : fetch(t.tx, t.tz, t.key)?.catch(() => undefined)));
    for (const t of wanted) {
      if (loaded.has(t.key)) continue;
      if (active?.key === t.key) { runToCompletion(active); active = undefined; continue; }
      const tile = fetched.get(t.key); if (!tile) continue;
      if (active) { const pending = active; active = undefined; runToCompletion(pending); }
      runToCompletion(start(t.key, tile));
    }
  }

  function boundsOf(tile: CityTile) { return { minX: tile.tx * tile.size, maxX: (tile.tx + 1) * tile.size, minZ: tile.tz * tile.size, maxZ: (tile.tz + 1) * tile.size }; }
  function stats() {
    const totals = { buildings: 0, exactMeshes: 0, triangles: 0, roads: 0, structures: 0, trees: 0, lamps: 0, signs: 0, signals: 0, parkTrees: 0, storefronts: 0, facades: 0, rooftops: 0, porches: 0, colliders: 0, buildMs: 0 };
    for (const t of loaded.values()) for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += t.stats[k];
    return { loaded: loaded.size, keys: [...loaded.keys()], fetching: fetching.size, pending: fetched.size, failed: failed.size, building: active?.key, stage: active?.stage, tileSize: city.tiles.size, available: city.tiles.keys.length, farBuildings: city.tiles.buildingCount, ...totals };
  }
  return { group, buildingChunks, lampPositions, signals, update, ensureAround, loaded, stats };
}
