import * as THREE from 'three';
import type { Road } from '../types';
import { loadTile, type CityTile, type Reader } from '../simulation/city-tiles.ts';
import { RoadTileCoverage } from '../simulation/road-tile-coverage.ts';
import type { PlacedSignal } from '../simulation/signal-placement.ts';
import type { FarCityView } from './far-city';
import { createTileBuilder, type BuiltTile, type Lamp, type PartialTile, type TileContext, type TileStage } from './tile-builder';
import type { Pace } from './pacing';
import { buildSlice, createMotion, orderTiles, pickTile, SYNC_RADIUS, type OrderedTile } from './stream-order.ts';
import { createUploadRelease } from './upload-release';

export interface TileStreamer {
  group: THREE.Group;
  /** Live arrays: the world's update loop iterates them every frame. */
  buildingChunks: THREE.Mesh[]; lampPositions: Lamp[]; signals: PlacedSignal[];
  /** `flying`: the observer is in the air, where no tile is ever finished in one frame for its colliders' sake. */
  update(position: THREE.Vector3, altitude: number, flying?: boolean): void;
  /** Build the neighborhood and its road owners; false if any required tile failed to load. */
  ensureAround(x: number, z: number, radius?: number): Promise<boolean>;
  /** True when a WebGL context restore must rebuild the tiles: their uploaded vertex arrays were freed. */
  readonly needsRebuildAfterRestore: boolean;
  /** Rebuild every resident tile (geometry and colliders) and the neighborhood around the observer. */
  rebuild(x: number, z: number): Promise<boolean>;
  /** Whether an elevated traffic route's supporting deck is in the scene. */
  deckDrawn(road: Road): boolean;
  readonly loaded: ReadonlyMap<string, BuiltTile>;
  stats(): { exactMeshes: number } & Record<string, unknown>;
}

const LOAD_RADIUS = 1150, UNLOAD_RADIUS = 1650, MAX_FETCHES = 4;
/** Within this distance a tile's scenery shows stage by stage as it is built; beyond it, when the tile is finished
 * (the fog is complete at 1,050 m, and the far city's boxes stand in until then). */
const SCENERY_RADIUS = 800;

/** Streams 1 km tiles around the observer and ahead of its travel (`stream-order.ts`). Tiles download a few at a
 * time, most pressing first. Several tiles can be under construction: every downloaded tile first gets its terrain
 * and road decks (bridges and viaducts show, and carry traffic, a kilometre out), then tiles are finished one at a
 * time, most pressing first. Each build is a paced stage generator that pauses whenever the frame's deadline has
 * passed; on the ground a tile the observer is practically on finishes at once, in the air no tile does (its slice
 * grows instead). Built tiles beyond the unload radius are disposed. */
export function createTileStreamer(ctx: TileContext, read: Reader, far?: FarCityView, mobile = false): TileStreamer {
  const { scene, city } = ctx, builder = createTileBuilder(ctx);
  const loadRadius = mobile ? 450 : LOAD_RADIUS, unloadRadius = mobile ? 700 : UNLOAD_RADIUS;
  const maxFetches = mobile ? 1 : MAX_FETCHES;
  // Phones free each finished tile's vertex arrays once they are on the GPU.
  const uploads = mobile ? createUploadRelease() : undefined;
  const coverage = new RoadTileCoverage(city, builder.roadsNear);
  // The desktop window covers procedural roads, but not every part of the
  // Zakim survey. Give the survey owner the priority of the visible viaduct.
  const wantedAround = (x: number, z: number, radius: number) => coverage.tilesNear(x, z, radius, { includeOrdinaryRoads: mobile });
  const group = new THREE.Group(); group.name = 'Streamed tiles'; scene.add(group);
  const loaded = new Map<string, BuiltTile>(), fetched = new Map<string, CityTile>(), fetching = new Map<string, Promise<CityTile>>(), failed = new Set<string>();
  type Active = { key: string; tile: CityTile; generator: Generator<TileStage, BuiltTile>; partial: PartialTile; stage?: TileStage; stageMs: Record<string, number>; structuresAt?: number };
  /** Tiles under construction, by key. */
  const builds = new Map<string, Active>();
  /** `finishing`: the tile whose scenery is being built. `working`: the tile the last frame worked on, if any. */
  let finishing: string | undefined, working: Active | undefined, queued: string | undefined, waiting = 0, focus: { x: number; z: number; until: number } | undefined, version = 0;
  const pace: Pace = { deadline: Infinity }, motion = createMotion(); let lastEnd = 0, budget = 0;
  const buildingChunks: THREE.Mesh[] = [], lampPositions: Lamp[] = [], signals: PlacedSignal[] = [];
  const refreshLive = () => {
    buildingChunks.length = 0; lampPositions.length = 0; signals.length = 0;
    for (const t of loaded.values()) { buildingChunks.push(...t.meshes); lampPositions.push(...t.lamps); signals.push(...t.signals); }
    scene.userData.version = ++version;
  };
  const size = city.tiles.size;
  const distanceTo = (bounds: BuiltTile['bounds'], x: number, z: number) => Math.hypot(Math.max(bounds.minX - x, 0, x - bounds.maxX), Math.max(bounds.minZ - z, 0, z - bounds.maxZ));
  const tileDistance = (tile: { tx: number; tz: number }, x: number, z: number) => Math.hypot(Math.max(tile.tx * size - x, 0, x - (tile.tx + 1) * size), Math.max(tile.tz * size - z, 0, z - (tile.tz + 1) * size));
  const fetch = (tx: number, tz: number, key: string) => {
    // A paced build can span many frames after its download leaves `fetched`.
    // Fetching it again during that interval queues a second build which would
    // replace the map entry and strand the first tile's scene and colliders.
    if (builds.has(key) || fetching.has(key) || fetched.has(key) || loaded.has(key) || failed.has(key)) return fetching.get(key);
    const promise = loadTile(city, tx, tz, read).then(tile => { fetched.set(key, tile); return tile; }, error => { console.error(`Tile ${key} failed to load`, error); failed.add(key); throw error; }).finally(() => fetching.delete(key));
    fetching.set(key, promise); return promise;
  };
  const start = (key: string, tile: CityTile): Active => {
    fetched.delete(key);
    // The tile's group joins the scene at once so finished stages show while later ones build.
    const partial: PartialTile = { group: new THREE.Group(), colliders: [], key, tile }; group.add(partial.group);
    const entry: Active = { key, tile, generator: builder.build(tile, partial, pace), partial, stageMs: {} }; builds.set(key, entry);
    return entry;
  };
  /** One generator step; its main-thread time is charged to the stage it completed. */
  const step = (entry: Active): BuiltTile | undefined => {
    const began = performance.now(), result = entry.generator.next(), stage = result.done ? 'finish' : result.value;
    entry.stageMs[stage] = (entry.stageMs[stage] ?? 0) + performance.now() - began;
    if (result.done) { result.value.stats.stageMs = entry.stageMs; result.value.stats.cpuMs = Math.round(Object.values(entry.stageMs).reduce((a, b) => a + b, 0)); return result.value; }
    entry.stage = result.value;
    return undefined;
  };
  const finish = (entry: Active, built: BuiltTile) => { builds.delete(entry.key); if (entry.partial.scenery) entry.partial.scenery.visible = true; if (finishing === entry.key) finishing = undefined; uploads?.release(built.group); loaded.set(entry.key, built); far?.setChunkDetailed(entry.key, true); refreshLive(); };
  const runToCompletion = (entry: Active) => { pace.deadline = Infinity; let built: BuiltTile | undefined; while (!(built = step(entry))); finish(entry, built); return built; };
  const unload = (key: string) => { const built = loaded.get(key); if (!built) return; loaded.delete(key); built.dispose(); far?.setChunkDetailed(key, false); refreshLive(); };
  const abandon = (entry: Active) => { entry.generator.return(undefined as never); builder.abandon(entry.partial); builds.delete(entry.key); if (finishing === entry.key) finishing = undefined; if (working === entry) working = undefined; };

  function update(position: THREE.Vector3, altitude: number, flying = false) {
    const began = performance.now(), outside = lastEnd ? began - lastEnd : 1000 / 60;
    motion.track(position.x, position.z, began);
    stream(position, altitude, flying, began, outside);
    lastEnd = performance.now();
  }
  function stream(position: THREE.Vector3, altitude: number, flying: boolean, began: number, outside: number) {
    const expansion = mobile ? Math.min(200, Math.max(0, altitude) * .2) : Math.max(0, altitude) * .6;
    const reach = loadRadius + expansion, drop = unloadRadius + expansion, now = began, x = position.x, z = position.z;
    if (focus && focus.until < now) focus = undefined;
    // A phone keeps its small window; elsewhere the window also covers where the observer is heading.
    const ahead = mobile ? undefined : motion.ahead(x, z);
    const wanted = orderTiles(wantedAround(x, z, reach), ahead ? wantedAround(ahead.x, ahead.z, reach) : [], motion.predict(x, z), size, x, z);
    const retained = new Set(wantedAround(x, z, drop).map(t => t.key));
    for (const t of wanted) retained.add(t.key);
    if (focus) for (const t of wantedAround(focus.x, focus.z, drop)) retained.add(t.key);
    // Unload at most one far tile per frame; disposal walks the tile's objects.
    for (const key of loaded.keys()) {
      if (retained.has(key)) continue;
      unload(key); break;
    }
    for (const entry of [...builds.values()]) if (!retained.has(entry.key)) abandon(entry);
    // Discard decoded downloads left behind by travel, including late arrivals.
    for (const key of fetched.keys()) if (!retained.has(key)) fetched.delete(key);
    for (const t of wanted) { if (fetching.size >= maxFetches) break; fetch(t.tx, t.tz, t.key)?.catch(() => undefined); }

    // A build that has asked for the next frame (it waits on a shader link, or has sent its slice to the GPU) rests
    // until then; the others share what is left of this one.
    const rested = new Set<string>(), ready = (key: string) => (builds.has(key) || fetched.has(key)) && !rested.has(key);
    // The wanted tiles that can be worked on set how much of the frame the builds may take: the nearest, and the
    // one due soonest. A tile still downloading has no claim yet.
    let nearest = Infinity, pressing = Infinity; for (const t of wanted) if (ready(t.key)) { nearest = Math.min(nearest, t.distance); pressing = Math.min(pressing, t.score); }
    budget = buildSlice(outside, motion.speed, nearest, pressing, mobile);
    // Scenery of a tile under construction shows as it is built only where it can be seen clearly (see PartialTile).
    // Set for every build now and again for each build worked on below: the builder creates the group, visible, in
    // the middle of a slice, and whatever it adds before the slice ends would draw for this one frame.
    const stageScenery = (entry: Active) => { if (!mobile && entry.partial.scenery) entry.partial.scenery.visible = tileDistance(entry.tile, x, z) <= SCENERY_RADIUS; };
    for (const entry of builds.values()) stageScenery(entry);
    const choose = (): OrderedTile | undefined => {
      const pick = pickTile(wanted, { ready, structured: key => !!builds.get(key)?.partial.structuresReady, distance: tile => tileDistance(tile, x, z), finishing: finishing !== undefined && builds.has(finishing) ? finishing : undefined, grounded: !flying });
      if (pick) return pick;
      // Nothing wanted is waiting: finish what travel left half-built inside the retained ring, nearest first.
      // (A download the window has left stays as it is until the window returns or the ring lets it go.)
      let rest: OrderedTile | undefined;
      for (const { key, tile } of builds.values()) { if (rested.has(key)) continue; const d = tileDistance(tile, x, z); if (!rest || d < rest.distance) rest = { tx: tile.tx, tz: tile.tz, key, distance: d, score: d }; }
      return rest;
    };
    const sliceEnd = began + budget; working = undefined; waiting = 0; for (const t of wanted) if (fetched.has(t.key)) waiting++;
    while (true) {
      const next = choose(); if (!next) break;
      const entry = builds.get(next.key) ?? start(next.key, fetched.get(next.key)!), structuring = !entry.partial.structuresReady;
      const physicalDistance = distanceTo(boundsOf(entry.tile), x, z);
      // A road gives its distant owner an earlier slot. A phone also builds the
      // tile unpaced while the observer is on one of its roads, but only until the
      // decks a car stands on are in (the Zakim shell comes first); the scenery of
      // a distant tile stays paced even when the observer is right on the trace.
      const roadDistance = mobile ? next.distance : physicalDistance;
      let paced = flying || (entry.partial.structuresReady ? physicalDistance : roadDistance) > SYNC_RADIUS, done = false;
      // The tile being finished keeps that place while it rests: another only borrows the remainder of the frame.
      if (!structuring && !(finishing && builds.has(finishing) && rested.has(finishing))) finishing = entry.key;
      pace.deadline = paced ? sliceEnd : Infinity; working = entry;
      while (true) {
        const built = step(entry);
        if (built) { built.stats.finishDistance = Math.round(physicalDistance); built.stats.structuresDistance = entry.structuresAt ?? built.stats.finishDistance; finish(entry, built); working = undefined; done = true; break; }
        if (entry.partial.structuresReady && entry.structuresAt === undefined) entry.structuresAt = Math.round(physicalDistance);
        // Its decks are in: the next tile gets its own before this one's scenery.
        if (structuring && entry.partial.structuresReady) break;
        if (!paced && entry.partial.structuresReady && physicalDistance > SYNC_RADIUS) { paced = true; pace.deadline = sliceEnd; }
        if (performance.now() > pace.deadline) break;
      }
      // The partial group draws this frame; note its uploads so finish() can free them.
      if (!done) { stageScenery(entry); uploads?.watch(entry.partial.group); }
      if (pace.deadline === -Infinity) rested.add(entry.key);
      if (performance.now() > sliceEnd) break;
    }
    queued = wanted.find(t => builds.has(t.key) || fetched.has(t.key))?.key;
  }

  async function ensureAround(x: number, z: number, radius = mobile ? 180 : 350) {
    focus = { x, z, until: performance.now() + 8000 };
    // A teleport/reload must install every supporting deck before placing the
    // vehicle. Even on desktop a long bridge's midpoint owner can lie outside
    // this smaller synchronous radius (the Chelsea end of Tobin is 371 m away).
    // The normal desktop frame loop keeps its cheaper, larger spatial window
    // for procedural roads.
    const wanted = coverage.tilesNear(x, z, radius);
    if (!mobile) await Promise.all(wanted.map(t => loaded.has(t.key) || builds.has(t.key) || fetched.has(t.key) ? undefined : fetch(t.tx, t.tz, t.key)?.catch(() => undefined)));
    for (const t of wanted) {
      if (mobile && !loaded.has(t.key) && !builds.has(t.key) && !fetched.has(t.key)) await fetch(t.tx, t.tz, t.key)?.catch(() => undefined);
      if (loaded.has(t.key)) continue;
      const tile = fetched.get(t.key), entry = builds.get(t.key) ?? (tile && start(t.key, tile)); if (!entry) continue;
      runToCompletion(entry);
      if (mobile) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return wanted.every(t=>loaded.has(t.key));
  }

  async function rebuild(x: number, z: number) {
    // Rebuild from the decoded tiles already held (a build never changes them):
    // downloading again could fail offline or after the cache expires, and a
    // failed key is never retried, leaving a hole in the ground.
    // Downloads not yet built stay queued in `fetched`.
    const resident = new Map([...loaded].map(([key, built]) => [key, built.tile])); for (const entry of builds.values()) resident.set(entry.key, entry.tile);
    for (const entry of [...builds.values()]) abandon(entry); for (const key of [...loaded.keys()]) unload(key);
    focus = { x, z, until: performance.now() + 8000 };
    for (const [key, tile] of resident) {
      if (loaded.has(key) || builds.has(key)) continue;
      runToCompletion(start(key, tile));
      if (mobile) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return ensureAround(x, z);
  }

  function boundsOf(tile: CityTile) { return { minX: tile.tx * tile.size, maxX: (tile.tx + 1) * tile.size, minZ: tile.tz * tile.size, maxZ: (tile.tz + 1) * tile.size }; }
  function stats() {
    const totals = { buildings: 0, exactMeshes: 0, triangles: 0, roads: 0, structures: 0, trees: 0, lamps: 0, signs: 0, signals: 0, parkTrees: 0, storefronts: 0, facades: 0, rooftops: 0, porches: 0, colliders: 0, buildMs: 0, cpuMs: 0 }, stageMs: Record<string, number> = {};
    for (const t of loaded.values()) { for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += t.stats[k]; for (const [stage, ms] of Object.entries(t.stats.stageMs ?? {})) stageMs[stage] = (stageMs[stage] ?? 0) + ms; }
    for (const stage of Object.keys(stageMs)) stageMs[stage] = Math.round(stageMs[stage]);
    const tiles = [...loaded.values()].map(t => ({ key: t.key, buildings: t.stats.buildings, triangles: t.stats.triangles, buildMs: t.stats.buildMs, cpuMs: t.stats.cpuMs, stageMs: t.stats.stageMs, finishDistance: t.stats.finishDistance, structuresDistance: t.stats.structuresDistance }));
    // `building` is the tile the last frame worked on (or the next one in line); `pending` the downloads the window
    // is waiting to build. Both are clear once everything wanted is built, whatever travel left downloaded outside it.
    const current = working ?? (queued ? builds.get(queued) : undefined);
    return { loadRadius, unloadRadius, maxFetches, releasedBytes: uploads?.releasedBytes ?? 0, releasedAttributes: uploads?.releasedAttributes ?? 0, loaded: loaded.size, residentGroups: group.children.length, keys: [...loaded.keys()], fetching: fetching.size, pending: waiting, downloaded: fetched.size, failed: failed.size, building: current?.key ?? queued, stage: current?.stage,
      underConstruction: builds.size, structured: [...builds.values()].filter(b => b.partial.structuresReady).map(b => b.key), speed: Math.round(motion.speed * 10) / 10,
      budgetMs: Math.round(budget * 10) / 10, tileSize: city.tiles.size, available: city.tiles.keys.length, farBuildings: city.tiles.buildingCount, ...totals, stageMs, tiles };
  }
  function deckDrawn(road: Road) {
    if (!road.surveyDeck && (!road.elevations || road.tunnel)) return true;
    const key = coverage.keyFor(road);
    if (!key || loaded.has(key)) return true;
    const partial = builds.get(key)?.partial;
    return !!partial && (road.surveyDeck ? partial.surveyDeck === road.surveyDeck : !!partial.structuresReady);
  }
  return { group, buildingChunks, lampPositions, signals, update, ensureAround, rebuild, deckDrawn, get needsRebuildAfterRestore() { return (uploads?.releasedAttributes ?? 0) > 0; }, loaded, stats };
}
