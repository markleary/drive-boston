import * as THREE from 'three';
import { IndexedSurfaceWriter, SurfaceBatches } from './indexed-surfaces.ts';
import { freezeTransforms, showBatches, staticDetailBatchSteps, type HeldBatches, type Warm } from './static-batches.ts';
import type { Upload } from './paced-upload.ts';
import { disposeTileResources } from './tile-resources.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Building, CityArea, CityData, Point2, Road } from '../types';
import type { DrivingPhysics } from '../physics/vehicle';
import { addTileBuildings, removeTileBuildings, type CityTile, type MetroCity } from '../simulation/city-tiles.ts';
import { addBuildingPlan, removeBuildingPlans } from '../simulation/building-plans.ts';
import { pavementEdges, type TilePavement } from '../simulation/tile-format.ts';
import { junctionIndexSteps, planCrosswalkSteps, STRIPE_LENGTH, type JunctionIndex } from '../simulation/crosswalks.ts';
import { curbRoadClearance } from '../simulation/road-curbs.ts';
import { WALK } from '../simulation/road-grading.ts';
import { roadMidpoint } from '../simulation/road-tile-coverage.ts';
import { sampleElevation, terrainGrid, terrainVertexNormal } from '../simulation/terrain.ts';
import { inTransitCorridor, shareTransitCorridors } from '../simulation/transit-corridors.ts';
import { planTrafficSignals, type PlacedSignal } from '../simulation/signal-placement.ts';
import { usesExactBuildingCollision } from '../simulation/building-collisions.ts';
import { pointInside } from '../simulation/roads.ts';
import { type createMaterials, facadeStyleIndex, hash, seeded } from './materials';
import { splitHouseRoof, tileCollisionIndices, tileShellGeometry, tileSourceGeometry } from './tile-geometry';
import { drapedRibbonInto, drapedStripInto, foundationGeometry, backBayPaving, BACK_BAY_PAVING, clipPortalSurfaceSteps } from './terrain-ground';
import { inTunnelApproach } from '../simulation/tunnels.ts';
import { mallGroundTest } from '../simulation/commonwealth-mall.ts';
import { greenway, obsoleteGreenwayCurb, inGreenway } from '../simulation/greenway.ts';
import { canopyHitsDeck, STREET_CANOPY } from '../simulation/deck-canopy.ts';
import { spatialInstances } from './spatial-batches';
import { PartBatches, box } from './geometry-writer';
import { computeBounds } from './fast-bounds';
import { meshChunks } from '../simulation/mesh-chunks';
import { due, until, UNPACED, type Pace } from './pacing';
import { createTrafficSignals } from './traffic-signals';
import { createStreetSign } from './signs';
import { createI93ExitSign } from './i93-exit-signs';
import { planI93ExitSigns } from '../simulation/i93-exit-signs';
import { createEntranceSign } from './entrance-signs';
import { planEntranceSigns, entranceSignStands } from '../simulation/entrance-signs';
import { createWarningSign } from './highway-signs';
import { planHighwaySigns } from '../simulation/highway-signs';
import { highwayMasts, mastHead, MAST_ARM, MAST_HEIGHT, MAST_LIGHT, type LampLight } from '../simulation/highway-lighting';
import { deckUndersideAt } from '../simulation/road-surfaces';
import { planStreetSigns, POLE_HEIGHT, POLE_RADIUS } from '../simulation/street-signs';
import { roadStructureSteps } from './bridges';
import { addSurveyViaductSupports } from './viaducts';
import { addSurveyDeckSurfaceSteps, addSurveyDeckParapetSteps } from './survey-deck-surface';
import { surveyViaductSupportSteps } from '../simulation/viaduct-supports.ts';
import { surveyDeckCarriagewaySteps } from '../simulation/survey-deck-lanes.ts';
import { surveyDeckParapetSteps } from '../simulation/survey-deck-parapets.ts';
import { addSourceFooting } from './source-footings';
import { prepareNeighborhoodArchitecture } from './neighborhood-profiles';
import { isFenwayBuilding, createFenwayShellMaterials } from './fenway-park';
import { isStateHouse, createStateHouseShellMaterials, splitStateHouseShell } from './state-house';
import { isSymphonyHall, createSymphonyHallMaterials, splitSymphonyHallShell } from './symphony-hall';
import { isSouthStation, createSouthStationMaterials, splitSouthStationShell } from './south-station';
import { isTdGarden, prepareTdGardenFinishes, splitTdGardenShell, tdGardenFinish } from './td-garden';
import { createPrudentialPenthouseMaterial, isPrudential, splitPrudentialShell } from './prudential';
import { createMissionChurchMaterials, isMissionChurch, splitMissionChurchShell } from './mission-church';
import { landmarkShellMaterial } from './metro-landmarks';
import { buildMelroseLandmark, replacesTileShell } from './melrose-landmarks';
import { sourceWallSampler, facadeDetailSteps } from './facade-details';
import { streetscapeSteps } from './streetscape';
import { rooftopDetailSteps } from './rooftops';
import { neighborhoodDetailSteps } from './neighborhood-architecture';
import { houseDetailSteps, houseTowerGeometry } from './house-details';
import { townFrontages } from './town-frontages';
import { housePlan } from './house-plan';
import { housePalette, houseRoof } from './house-styles';
import { cityParkDetailSteps, areaBoundsOf, type Bounds } from './city-parks';
import { DrapedSurface } from './draped-surface.ts';
import { fellsViewHeight } from './fells-woodland.ts';
import type { TreeField } from './foliage';

export interface TileContext {
  scene: THREE.Scene; city: MetroCity; physics: DrivingPhysics; materials: ReturnType<typeof createMaterials>;
  /** Shared instanced fields: street trees (with grates) and park specimens. */
  trees: TreeField; parkTrees: TreeField;
  /** Live id lookup of the detailed buildings currently in the scene. */
  buildingMap: Map<string, Building>;
  /** Shells and collisions supplied by persistent landmark models. */
  replacedBuildings?: ReadonlySet<string>;
  landmarkForecourt?: (x: number, z: number) => boolean;
  ground: THREE.Material; iron: THREE.Material; lampMat: THREE.Material; mobile?: boolean;
  detailed?: () => boolean;
  /** Starts linking a new static batch's shader programs, so the build can show it once they are ready. */ warm?: Warm;
  /** Sends new meshes' arrays to the GPU a slice a frame (paced-upload.ts); absent on a phone. */ upload?: Upload;
}
export interface TileStats {
  buildings: number; exactMeshes: number; triangles: number; roads: number; structures: number; trees: number; lamps: number; signs: number; signals: number; parkTrees: number; storefronts: number; facades: number; rooftops: number; porches: number; housePorches: number; colliders: number;
  /** Wall-clock span from the first generator step to completion. */ buildMs: number;
  /** Main-thread time inside the generator, in total and per completed stage (filled in by the streamer). */ cpuMs: number; stageMs?: Record<string, number>;
  /** Metres from the observer to the tile when its decks were in and when it was finished (filled in by the streamer's frame loop). */ structuresDistance?: number; finishDistance?: number;
}
/** A lamp's position on the ground, for the pooled night lights (world.ts): a street lamp's light unless the lamp carries its own. */
export type Lamp = THREE.Vector3 & { light?: LampLight };
export interface BuiltTile {
  key: string; tile: CityTile; group: THREE.Group; bounds: Bounds; colliders: RAPIER.Collider[]; meshes: THREE.Mesh[]; lamps: Lamp[]; signals: PlacedSignal[]; stats: TileStats;
  dispose(): void;
}
export type TileStage = 'survey' | 'terrain' | 'roads' | 'curbs' | 'structures' | 'buildings' | 'props' | 'signals' | 'parks' | 'details';
/** `scenery`: everything after the terrain and decks. The streamer hides it while the tile builds beyond clear view, so its meshes are neither drawn nor uploaded before the static batches replace them. */
export interface PartialTile { group: THREE.Group; colliders: RAPIER.Collider[]; key: string; tile: CityTile; ownedMaterials?: THREE.Material[]; surveyDeck?: string; structuresReady?: boolean; scenery?: THREE.Group; }

/** Run a paced helper as one named stage: each pause it takes becomes a yield of that stage. */
function* stage<T>(name: TileStage, steps: Generator<void, T>): Generator<TileStage, T> { let r = steps.next(); while (!r.done) { yield name; r = steps.next(); } return r.value; }
/** Run a helper that pauses between small units of work as one named stage, passing a pause on only once the frame's deadline has passed. */
function* paced<T>(name: TileStage, steps: Generator<void, T>, pace: Pace): Generator<TileStage, T> { let r = steps.next(); while (!r.done) { if (due(pace)) yield name; r = steps.next(); } return r.value; }

/** Everything world.ts once built for the whole survey, rebuilt here for one
 * 1 km tile at a time as a generator: each stage yields between its units of
 * work (a road, a curb path, a building, a park) once `pace.deadline` has
 * passed, so the streamer can hold a tile to a few milliseconds per frame. The
 * tile sees a sub-city view (nearby roads, its own buildings, curbs, paths and
 * the parks and water it touches), so every helper keeps its original per-city
 * logic without walking the metro. */
export function createTileBuilder(ctx: TileContext) {
  const { city, physics, materials, scene } = ctx;
  const fenwayMaterials = createFenwayShellMaterials(), stateHouseMaterials = createStateHouseShellMaterials(), prudentialPenthouse = createPrudentialPenthouseMaterial();
  const missionChurchMaterials=createMissionChurchMaterials();
  const symphonyHallMaterials=createSymphonyHallMaterials(), southStationMaterials=createSouthStationMaterials();
  const parkStone = new THREE.MeshStandardMaterial({ color: '#a5a397', roughness: .9 });
  // Reuse the brick texture, but not the ordinary sidewalk's depth bias that
  // deliberately puts it behind asphalt. Frontage paving must win that overlap.
  const frontageBrick=materials.brick.clone();frontageBrick.polygonOffset=false;
  const foundation = new THREE.MeshStandardMaterial({ color: '#827c6d', roughness: .95, side: THREE.DoubleSide });
  const chelseaLiftSteel = new THREE.MeshStandardMaterial({ color: '#9ea7a3', roughness: .72, metalness: .3 });
  const signSteel = new THREE.MeshStandardMaterial({ color: '#a9b4b6', roughness: .68, metalness: .25 });
  const exitSigns = planI93ExitSigns(city.roads), warningSigns = planHighwaySigns(city), entranceSigns = planEntranceSigns(city.roads);
  // Painted while the game loads (the arena's finishes, the northern towns' house walls and roofs: about 40 ms of
  // canvas work each); a phone, which may never see either, paints them with the first tile that needs them.
  if (!ctx.mobile) { prepareTdGardenFinishes(); materials.houses(); }
  const isChelseaLiftFrame = (building: Building) => building.id === 'osm-way-196751230';
  const height = (x: number, z: number) => sampleElevation(city, x, z);
  // Road, signal and area lookups by 250 m cell, built once for the metro.
  const CELL = 250, roadCells = new Map<string, Road[]>(), signalCells = new Map<string, Point2[]>(), parkCells = new Map<string, CityArea[]>(), waterCells = new Map<string, CityArea[]>();
  const cellKey = (cx: number, cz: number) => `${cx},${cz}`;
  const spread = <T>(map: Map<string, T[]>, item: T, minX: number, maxX: number, minZ: number, maxZ: number) => {
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) { const key = cellKey(cx, cz), list = map.get(key); if (list) list.push(item); else map.set(key, [item]); }
  };
  const roadBounds = new Map<Road, Bounds>();
  for (const road of city.roads) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of road.points) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    roadBounds.set(road, { minX, maxX, minZ, maxZ }); spread(roadCells, road, minX, maxX, minZ, maxZ);
  }
  for (const signal of city.signals) spread(signalCells, signal, signal[0], signal[0], signal[1], signal[1]);
  const areaBounds = new Map<CityArea, Bounds>();
  for (const [list, map] of [[city.parks ?? [], parkCells], [city.water ?? [], waterCells]] as const) for (const area of list) { if (!area.rings[0]?.length) continue; const b = areaBoundsOf(area); areaBounds.set(area, b); spread(map, area, b.minX, b.maxX, b.minZ, b.maxZ); }
  const collect = <T>(map: Map<string, T[]>, bounds: Bounds, test: (item: T) => boolean) => {
    const seen = new Set<T>(), result: T[] = [];
    for (let cx = Math.floor(bounds.minX / CELL); cx <= Math.floor(bounds.maxX / CELL); cx++) for (let cz = Math.floor(bounds.minZ / CELL); cz <= Math.floor(bounds.maxZ / CELL); cz++) for (const item of map.get(cellKey(cx, cz)) ?? []) { if (seen.has(item)) continue; seen.add(item); if (test(item)) result.push(item); }
    return result;
  };
  const overlaps = (a: Bounds, b: Bounds) => a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
  const grow = (b: Bounds, m: number): Bounds => ({ minX: b.minX - m, maxX: b.maxX + m, minZ: b.minZ - m, maxZ: b.maxZ + m });
  const roadsNear = (bounds: Bounds) => collect(roadCells, bounds, road => overlaps(roadBounds.get(road)!, bounds));
  const midpoint = roadMidpoint;
  // Source tiles include park monuments, shelters and utility structures among
  // the building meshes. Keep their measured forms without residential windows.
  const principalParks = (city.parks ?? []).filter(p => /^(Boston Common|Public Garden)$/.test(p.name) && p.rings[0]);
  const parkStructure = (b: Building) => b.height < 30 && principalParks.some(p => { const box = areaBounds.get(p)!; return b.center[0] >= box.minX && b.center[0] <= box.maxX && b.center[1] >= box.minZ && b.center[1] <= box.maxZ && pointInside(b.center, p.rings[0]) && !p.rings.slice(1).some(r => pointInside(b.center, r)); });
  const grid = terrainGrid(city) ?? (() => { throw new Error('A metro city needs its elevation grid before tiles can be built'); })();
  const woodlandViewHeight = fellsViewHeight(city);
  // The Commonwealth Avenue Mall plants its own rows: no street tree or grate on its lawns, nor before its fences.
  const onMallLawn = mallGroundTest(city.parks ?? []);
  // Several tiles can be under construction: whichever needs the index first starts it, any of them may advance it.
  let junctions: JunctionIndex | undefined, junctionSteps: Generator<void, JunctionIndex> | undefined;

  /** `partial` is owned by the caller so an interrupted build can be undone with `abandon`. */
  function* build(tile: CityTile, partial: PartialTile = { group: new THREE.Group(), colliders: [], key: tile.key, tile }, pace: Pace = UNPACED): Generator<TileStage, BuiltTile> {
    const began = performance.now(), key = tile.key, size = tile.size, x0 = tile.tx * size, z0 = tile.tz * size, x1 = x0 + size, z1 = z0 + size;
    const bounds: Bounds = { minX: x0, maxX: x1, minZ: z0, maxZ: z1 }, insideTile = (x: number, z: number) => x >= x0 && x < x1 && z >= z0 && z < z1;
    const group = partial.group; group.name = `Tile ${key}`;
    const colliders = partial.colliders, meshes: THREE.Mesh[] = [], owned = partial.ownedMaterials ??= [], lamps: Lamp[] = [], highwayLamps: Lamp[] = [];
    const stats: TileStats = { buildings: 0, exactMeshes: 0, triangles: 0, roads: 0, structures: 0, trees: 0, lamps: 0, signs: 0, signals: 0, parkTrees: 0, storefronts: 0, facades: 0, rooftops: 0, porches: 0, housePorches: 0, colliders: 0, buildMs: 0, cpuMs: 0 };
    const near = grow(bounds, 80), roads = roadsNear(near), ownedRoads = roads.filter(r => { const m = midpoint(r); return insideTile(m[0], m[1]); });
    const subCity: CityData = { ...city, roads, buildings: tile.buildings, signals: collect(signalCells, grow(bounds, 40), s => s[0] >= x0 - 40 && s[0] < x1 + 40 && s[1] >= z0 - 40 && s[1] < z1 + 40), curbs: tile.curbs, parkPaths: tile.parkPaths,
      parks: collect(parkCells, bounds, p => overlaps(areaBounds.get(p)!, bounds)), water: collect(waterCells, grow(bounds, 30), w => overlaps(areaBounds.get(w)!, grow(bounds, 30))) };
    shareTransitCorridors(subCity, city);
    // Terrain and structures go straight into the tile's group; the scenery that follows into its own (see PartialTile).
    let target = group;
    const addBatches = (batches: Pick<PartBatches, 'meshes'>) => {
      for (const m of batches.meshes()) { m.receiveShadow = true; if (m.material === materials.asphalt) m.renderOrder = -1; else if (m.material === materials.sidewalk) m.renderOrder = -2; target.add(m); }
    };

    // The viaduct extends beyond its owner tile. Publish the surveyed shell
    // and its collision together before building scenery under the bridge.
    const zakim = tile.buildings.find(b => b.landmark === 'zakim-bridge');
    const survey = zakim && tile.geometry.get(zakim.id);
    if (zakim && survey) {
      const shell = new THREE.Group();
      shell.name = 'Zakim survey shell'; shell.visible = false; group.add(shell);
      for (const isRoof of [false, true]) {
        if (due(pace)) yield 'survey';
        const geometry = tileShellGeometry(survey, zakim, isRoof); if (!geometry) continue;
        const material = landmarkShellMaterial(zakim, isRoof, materials) ?? materials.roof;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'Boston surveyed buildings'; mesh.castShadow = true; mesh.receiveShadow = true;
        computeBounds(geometry, false); meshes.push(mesh); shell.add(mesh);
      }
      if (due(pace)) yield 'survey';
      colliders.push(physics.addStaticMesh(survey.positions, tileCollisionIndices(survey)));
      ctx.buildingMap.set(zakim.id, zakim);
      stats.buildings++; stats.exactMeshes++; stats.triangles += (survey.facade.length + survey.roof.length) / 3;
      shell.visible = true; partial.surveyDeck = zakim.id;
      yield 'survey';
    }

    // Terrain: the grid quads this tile covers, plus the quad column and row on
    // its far edges so neighbouring tiles overlap by one cell instead of leaving
    // a seam when only one of them is loaded. Overlapping triangles are identical.
    {
      const cs = grid.cellSize, i0 = Math.max(0, Math.floor((x0 - grid.originX) / cs)), i1 = Math.min(grid.width - 1, Math.floor((x1 - grid.originX) / cs) + 1);
      const j0 = Math.max(0, Math.floor((z0 - grid.originZ) / cs)), j1 = Math.min(grid.height - 1, Math.floor((z1 - grid.originZ) / cs) + 1);
      const w = i1 - i0 + 1, h = j1 - j0 + 1;
      if (w >= 2 && h >= 2) {
        const positions = new Float32Array(w * h * 3), normals = new Float32Array(w * h * 3), uv = new Float32Array(w * h * 2), heights = grid.heights, W = grid.width, normal = [0, 1, 0];
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const gi = i0 + i, gj = j0 + j, n = j * w + i, x = grid.originX + gi * cs, z = grid.originZ + gj * cs;
          positions[n * 3] = x; positions[n * 3 + 1] = heights[gj * W + gi]; positions[n * 3 + 2] = z; uv[n * 2] = x / 4; uv[n * 2 + 1] = z / 4;
          // The draped pavement and lawns interpolate these same normals (draped-surface.ts).
          terrainVertexNormal(grid, gi, gj, normal); normals[n * 3] = normal[0]; normals[n * 3 + 1] = normal[1]; normals[n * 3 + 2] = normal[2];
        }
        const indices = new Uint32Array((w - 1) * (h - 1) * 6); let o = 0;
        for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) { const a = j * w + i, b = a + 1, c = a + w, d = c + 1; indices[o++] = a; indices[o++] = c; indices[o++] = b; indices[o++] = b; indices[o++] = c; indices[o++] = d; }
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3)); geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geometry.setIndex(new THREE.BufferAttribute(indices, 1)); geometry.computeBoundingSphere();
        // Tunnel portals cut the surface (paced: downtown tiles hold hundreds of
        // portal triangles); the collider then reuses that clip of the same arrays.
        if (due(pace)) yield 'terrain';
        yield* stage('terrain', clipPortalSurfaceSteps(city, geometry, pace));
        const ground = new THREE.Mesh(geometry, ctx.ground); ground.name = 'Terrain'; ground.position.y = -.04; ground.receiveShadow = true; ground.renderOrder = -3; group.add(ground);
        if (due(pace)) yield 'terrain';
        colliders.push(physics.addTerrainTile(positions,indices));
        if (overlaps(bounds, BACK_BAY_PAVING)) {
          if (due(pace)) yield 'terrain';
          const paving = backBayPaving(city, { i0, i1, j0, j1 });
          // The paving lies on the ground, so an open ramp's portal cuts it as it cuts the terrain (the Turnpike's Dartmouth Street entrance).
          if (paving.attributes.position?.count) yield* stage('terrain', clipPortalSurfaceSteps(city, paving, pace));
          if (paving.attributes.position?.count) { const mesh = new THREE.Mesh(paving, materials.sidewalk); mesh.name = 'Back Bay paving'; mesh.receiveShadow = true; mesh.renderOrder = -2; group.add(mesh); } else paving.dispose();
        }
      }
    }
    yield 'terrain';

    // Install the procedural decks and barriers ahead of street surfaces and
    // curbs so the highway can carry traffic while the tile finishes building.
    const elevated = ownedRoads.filter(r => r.elevations && !r.tunnel);
    if (elevated.length) {
      yield* stage('structures', roadStructureSteps(group, subCity, materials.asphalt, elevated, pace, city));
      for (const road of elevated) { if (due(pace)) yield 'structures'; colliders.push(...physics.addRoadDeck(subCity, road)); }
      stats.structures = elevated.length;
    }
    for (const sign of exitSigns) {
      if (!insideTile(sign.approach.x, sign.approach.z)) continue;
      // (a street bridge over the road right there would stand in the panel)
      if (deckUndersideAt(city, sign.approach.x, sign.approach.z, sign.approach.y + 2.5) < sign.approach.y + 9) continue;
      if (due(pace)) yield 'structures';
      const exit = createI93ExitSign(sign, height, signSteel);
      group.add(exit.group);
      owned.push(exit.material);
    }
    // The gantry over a highway entrance's mouth (none where a bridge stands in its panel or a building on a post's place).
    for (const sign of entranceSigns) {
      if (!insideTile(sign.approach.x, sign.approach.z) || !entranceSignStands(city, sign)) continue;
      if (due(pace)) yield 'structures';
      const entrance = createEntranceSign(sign, height, signSteel);
      group.add(entrance.group);
      owned.push(entrance.material);
    }
    // Storrow Drive's CARS ONLY and LOW CLEARANCE warnings (their yellow faces are shared by every tile, so none is this tile's to dispose).
    for (const place of warningSigns) if (insideTile(place.approach.x, place.approach.z)) group.add(createWarningSign(place, height, signSteel));
    // The Turnpike's lighting masts: a pole at the right edge, an arm over the lanes and a luminaire that glows with
    // the street lamps at night; the pooled night lights hang in the nearest luminaires as they do in a street lamp's globe.
    const masts = ownedRoads.flatMap(road => highwayMasts(road, (x, z, above) => deckUndersideAt(city, x, z, above)));
    if (masts.length) {
      const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(.09, .14, MAST_HEIGHT, 8), ctx.iron, masts.length), arms = new THREE.InstancedMesh(new THREE.BoxGeometry(MAST_ARM, .09, .11), ctx.iron, masts.length), heads = new THREE.InstancedMesh(new THREE.BoxGeometry(.95, .12, .38), ctx.lampMat, masts.length), post = new THREE.Object3D();
      masts.forEach((m, i) => {
        // Local +x points across the road from the mast toward the lanes.
        post.rotation.set(0, m.yaw, 0); post.scale.set(1, 1, 1);
        post.position.set(m.x, m.y + MAST_HEIGHT / 2 - .3, m.z); post.updateMatrix(); poles.setMatrixAt(i, post.matrix);
        const reach = (d: number) => post.position.set(m.x + Math.cos(m.yaw) * d, m.y + MAST_HEIGHT - .35, m.z - Math.sin(m.yaw) * d);
        reach(MAST_ARM / 2); post.updateMatrix(); arms.setMatrixAt(i, post.matrix);
        const head = mastHead(m); post.position.set(head.x, head.y, head.z); post.updateMatrix(); heads.setMatrixAt(i, post.matrix);
        // The lamp is the road under that head, like a street lamp's foot; its night light hangs MAST_LIGHT.rise over it, in the head.
        highwayLamps.push(Object.assign(new THREE.Vector3(head.x, m.y, head.z), { light: MAST_LIGHT }));
      });
      poles.castShadow = true; poles.name = 'Turnpike lighting masts'; arms.name = 'Turnpike mast arms'; heads.name = 'Turnpike luminaires';
      for (const mesh of [poles, arms, heads]) { mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); group.add(mesh); }
    }
    partial.structuresReady = true;
    yield 'structures';

    if (zakim && survey) {
      const traced = yield* paced('survey', surveyDeckCarriagewaySteps(survey), pace);
      yield* paced('survey', addSurveyDeckSurfaceSteps(group, city, survey, materials, traced), pace);
      const { parapets } = yield* paced('survey', surveyDeckParapetSteps(city, survey, traced.carriageways.map(c => c.stations)), pace);
      const concrete = landmarkShellMaterial(zakim, false, materials) ?? materials.facades[facadeStyleIndex(zakim)];
      yield* paced('survey', addSurveyDeckParapetSteps(group, parapets, concrete), pace);
      for (let i = 0; i < parapets.length; i += 64) {
        if (due(pace)) yield 'survey';
        colliders.push(...physics.addParapets(parapets.slice(i, i + 64)));
      }
      const supports = yield* paced('survey', surveyViaductSupportSteps(city, survey), pace);
      const viaduct = addSurveyViaductSupports(group, city, survey, supports);
      for (const mesh of viaduct.collisions) colliders.push(physics.addStaticMesh(mesh.vertices, mesh.indices));
      yield 'survey';
    }

    { const scenery = new THREE.Group(); scenery.name = 'Tile scenery'; scenery.userData.staging = true; group.add(scenery); partial.scenery = target = scenery; }

    // House typologies first: the shop frontages below skip houses.
    prepareNeighborhoodArchitecture(subCity, tile.buildings);

    // Roads owned by this tile (their midpoint lies inside it). The asphalt
    // follows the roadway measured between the curbs (tile.pavements, from
    // scripts/street_surfaces.py) with a sidewalk band only on the sides the
    // Boston sidewalk inventory does not cover; a road without a record keeps
    // the constant-width ribbons of the survey build.
    {
      const batches = ctx.mobile ? new SurfaceBatches(500) : new PartBatches(500);
      const ribbon = (material: THREE.Material, points: Point2[], width: number, y: number) => {
        const sink = batches.at(material, points[0][0], points[0][1]);
        drapedRibbonInto(sink, city, points, width, y);
        if (sink instanceof IndexedSurfaceWriter) sink.clearLookup();
      };
      const strip = (material: THREE.Material, left: Point2[], right: Point2[], y: number) => {
        const sink = batches.at(material, left[0][0], left[0][1]);
        drapedStripInto(sink, city, left, right, y);
        if (sink instanceof IndexedSurfaceWriter) sink.clearLookup();
      };
      const pavements = new Map<string, TilePavement[]>(), allEdges = [...tile.pavements, ...tile.borderPavements].map(p => pavementEdges(tile, p));
      for (const p of tile.pavements) { const list = pavements.get(p.road); if (list) list.push(p); else pavements.set(p.road, [p]); }
      // A few town ways share an id; the record starting nearest the road's first point is its own.
      const pavementOf = (road: Road) => {
        const list = pavements.get(road.id); if (!list || list.length === 1) return list?.[0];
        let best: TilePavement | undefined, bestDistance = Infinity;
        for (const p of list) { const d = Math.hypot(x0 + (p.edges[0] + p.edges[2]) / 200 - road.points[0][0], z0 + (p.edges[1] + p.edges[3]) / 200 - road.points[0][1]); if (d < bestDistance) { bestDistance = d; best = p; } }
        return best;
      };
      // The band outside a curb edge: each station pushed away from the opposite edge by the sidewalk allowance.
      const band = (edge: Point2[], other: Point2[]) => edge.map((p, i): Point2 => { const dx = p[0] - other[i][0], dz = p[1] - other[i][1], l = Math.hypot(dx, dz) || 1; return [p[0] + dx / l * WALK, p[1] + dz / l * WALK]; });
      for (const road of ownedRoads) {
        if (road.elevations) continue; stats.roads++;
        if (due(pace)) yield 'roads';
        const pavement = pavementOf(road), width = road.pavedWidth ?? road.width, edges = pavement && pavement.edges.length >= 8 ? pavementEdges(tile, pavement) : undefined;
        // Generated polygons resolve folds and junctions before tile clipping.
        // Keep records for markings; legacy packages still draw their strips.
        if (!tile.streetPavement && pavement && edges) {
          const { left, right } = edges;
          if (!pavement.walk?.[0]) strip(materials.sidewalk, band(left, right), left, .012);
          if (!pavement.walk?.[1]) strip(materials.sidewalk, right, band(right, left), .012);
          strip(materials.asphalt, left, right, .045);
        } else if (!tile.streetPavement) {
          ribbon(materials.sidewalk, road.points, road.width + 5.8, .012);
          ribbon(materials.asphalt, road.points, road.width, .045);
        }
        for (let i = 1; i < road.points.length; i++) {
          const a = road.points[i - 1], b = road.points[i], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz); if (len < 8) continue;
          const tx = dx / len, tz = dz / len;
          if (road.width >= 9) for (let d = 8; d < len - 7; d += 9) { const end = Math.min(d + 3, len - 7); ribbon(road.oneway ? materials.paint : materials.yellow, [[a[0] + tx * d, a[1] + tz * d], [a[0] + tx * end, a[1] + tz * end]], .12, .065); }
        }
      }
      // Crosswalks: at junctions only, just beyond the crossing roadway, thinned along each roadway (crosswalks.ts).
      // The stripes span the roadway measured at their own station, not the road-wide median width: Boylston
      // Street's west end closes from 21.8 m to 14 m, and its east end sits 6 m off the centerline. Records of twin
      // carriageways sharing the asphalt there (a parkway's second one-way centerline) extend them across the whole roadway.
      {
        const borders = new Map(tile.borderPavements.map(p => [p.road, p]));
        const edgesOf = (road: Road) => { const p = pavementOf(road) ?? borders.get(road.id); return p && p.edges.length >= 8 ? pavementEdges(tile, p) : undefined; };
        // The citywide junction index (20k roads) is built once, paced across frames by the first tile that needs it.
        while (!junctions) { junctionSteps ??= junctionIndexSteps(city.roads, city.signals); const r = junctionSteps.next(); if (r.done) junctions = r.value; else if (due(pace)) yield 'roads'; }
        // Planned over every road within 40 m of the owned roads' extents (a road owned by its midpoint can end 200 m
        // into the next tile), so the thinning sees the candidates across the tile border; drawn for the owned ones.
        const reach: Bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
        for (const road of ownedRoads) { const b = roadBounds.get(road)!; reach.minX = Math.min(reach.minX, b.minX); reach.maxX = Math.max(reach.maxX, b.maxX); reach.minZ = Math.min(reach.minZ, b.minZ); reach.maxZ = Math.max(reach.maxZ, b.maxZ); }
        const ownedSet = new Set(ownedRoads), planning = planCrosswalkSteps(ownedRoads.length ? roadsNear(grow(reach, 40)) : [], junctions, edgesOf, allEdges);
        let planned = planning.next(); while (!planned.done) { if (due(pace)) yield 'roads'; planned = planning.next(); }
        for (const { road, at, tx, tz, span: [lo, hi] } of planned.value) {
          if (!ownedSet.has(road)) continue;
          if (due(pace)) yield 'roads';
          for (let side = lo + .8; side < hi - .5; side += 1.35) {
            const x = at[0] - tz * side, z = at[1] + tx * side;
            ribbon(materials.paint, [[x, z], [x + tx * STRIPE_LENGTH, z + tz * STRIPE_LENGTH]], .65, .068);
          }
        }
      }
      addBatches(batches);
      // Surveyed sidewalks (above the lawn decals, below the asphalt, so a
      // disagreement with the curb line hides under the roadway), asphalt
      // driveway faces (above the lawn and the sidewalks they were cut around,
      // below the street asphalt) and concrete curb islands, merged per material.
      const paved: [THREE.Material, string, Point2[][][], number][] = [[materials.sidewalk, 'Sidewalks', tile.sidewalks.filter(w => w.material !== 'brick').map(w => w.rings), .03], [materials.brick, 'Brick sidewalks', tile.sidewalks.filter(w => w.material === 'brick').map(w => w.rings), .03], [materials.asphalt, 'Driveways', tile.driveways, .035], [materials.sidewalk, 'Curb islands', tile.islands, .05]];
      if (tile.streetPavement) paved.push([materials.asphalt,'Streets',tile.streetPavement,.045],[materials.sidewalk,'Street sidewalks',tile.streetSidewalks ?? [],.012]);
      if (tile.deckPavement) paved.push([materials.asphalt,'Paved embankments',tile.deckPavement,.03]);
      // Shopfront forecourts in the northern town centres, between the sidewalk band and the walls (town-frontages.ts).
      paved.push([materials.sidewalk,'Shop frontages',townFrontages(subCity,tile.buildings),.02]);
      // Cross Street's brick access lane shares the plaza surface. Its source
      // road ribbon otherwise paints asphalt over the plaza and strands its
      // real curb in an apparent traffic lane. Keep the curb and vehicle access.
      paved.push([frontageBrick,'Cross Street brick frontage',greenway.frontages.filter(a=>a.tile===key).map(a=>a.rings),.09]);
      // Each layer is one shared-vertex mesh on the terrain's own triangles (draped-surface.ts). A tile's generated
      // street pavement is one polygon spanning the whole tile: draped, merged and clipped a few milliseconds a frame.
      for (const [material, name, polygons, y] of paved) {
        if (!polygons.length) continue;
        const surface = new DrapedSurface(city, { offset: y, pace });
        for (const polygon of polygons) { if (due(pace)) yield 'roads'; yield* stage('roads', surface.add(polygon)); }
        const geometry = yield* stage('roads', surface.geometrySteps());
        if (!geometry.index!.count) { geometry.dispose(); continue; }
        const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.receiveShadow = true; mesh.renderOrder = -2; target.add(mesh);
      }
    }
    yield 'roads';

    // Raised curb boxes are decorative and dominate retained neighborhood
    // buffers. Mobile keeps the sidewalk surface and shared terrain/collisions.
    if (!ctx.mobile) {
      const batches = new PartBatches(500), matrix = new THREE.Matrix4();
      const crossesRoad = curbRoadClearance(city, roads);
      for (const points of tile.curbs) {
        if (due(pace)) yield 'curbs';
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1], b = points[i], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz); if (length < .05) continue;
          const n = Math.max(1, Math.ceil(length / 3)), part = box(.18, .17, length / n), yaw = Math.atan2(dx, dz);
          for (let j = 0; j < n; j++) {
            const t = (j + .5) / n, x = a[0] + dx * t, z = a[1] + dz * t;if(inTunnelApproach(city,x,z)||obsoleteGreenwayCurb(x,z)||crossesRoad(x,z,dx/length,dz/length))continue;
            const writer = batches.at(materials.curb, x, z), from = writer.count;
            // Each corner settles onto the ground under it; the faces then take their tilted normals.
            writer.box(part, matrix.makeRotationY(yaw).setPosition(x, .085, z));
            const p = writer.position; for (let k = from; k < writer.count; k++) p[k * 3 + 1] += height(p[k * 3], p[k * 3 + 2]);
            writer.flatNormals(from);
          }
        }
      }
      addBatches(batches);
    }
    yield 'curbs';

    // Buildings: the quantized tile shells become the same façade-styled,
    // spatially bucketed chunks the survey build produced, with exact-mesh
    // landmarks collided as meshes and everything else as convex hulls.
    {
      const buckets = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[] }>();
      const bucket = (material: THREE.Material, geometry: THREE.BufferGeometry, cx: number, cz: number, tag = '') => {
        const k = `${material.uuid}:${tag || `${Math.floor(cx / 500)}:${Math.floor(cz / 500)}`}`; let entry = buckets.get(k); if (!entry) { entry = { material, geometries: [] }; buckets.set(k, entry); } entry.geometries.push(geometry);
      };
      for (const b of tile.buildings) {
        if (b === zakim) continue;
        if (due(pace)) yield 'buildings';
        const data = tile.geometry.get(b.id); if (!data) continue;
        ctx.buildingMap.set(b.id, b); stats.buildings++;
        if (ctx.replacedBuildings?.has(b.id)) continue;
        stats.triangles += (data.facade.length + data.roof.length) / 3;
        // Hand-modelled northern landmarks replace their extruded shell, hull and foundation skirt.
        if (replacesTileShell(b)) { const model = buildMelroseLandmark(city, b, !!ctx.mobile); if (model) { target.add(model.group); for (const mesh of model.collisions) colliders.push(physics.addStaticMesh(mesh.vertices, mesh.indices)); continue; } }
        const style = facadeStyleIndex(b), isStone = parkStructure(b), fenway = isFenwayBuilding(b);
        const choose = (isRoof: boolean) => {
          let material: THREE.Material = isRoof ? materials.roof : materials.facades[style];
          if (!isRoof && b.landmark === 'hancock') material = materials.glass;
          else if (!isRoof && b.landmark === 'library') material = materials.library;
          else if (!isRoof && b.landmark === 'trinity') material = materials.church;
          else material = landmarkShellMaterial(b, isRoof, materials) ?? material;
          if (isStone) material = parkStone;
          if (fenway) material = isRoof ? fenwayMaterials.roof : fenwayMaterials.wall;
          // This source footprint is bridge machinery spanning an open road,
          // not occupied building massing with painted windows or interiors.
          if (isChelseaLiftFrame(b)) material = chelseaLiftSteel;
          return material;
        };
        if (usesExactBuildingCollision(b)) {
          colliders.push(physics.addStaticMesh(data.positions, tileCollisionIndices(data))); stats.exactMeshes++;
          // The map draws this shell's outline instead of its convex hull, which would cover the streets it spans.
          if (!b.structure) addBuildingPlan(city, b, data);
          const source = tileSourceGeometry(data);
          const footing = b.structure ? undefined : addSourceFooting(target, city, b, source); if (footing) colliders.push(physics.addStaticMesh(footing.vertices, footing.indices));
          source.dispose();
        } else { const hull = physics.addBuildingHull(b); if (hull) colliders.push(hull); }
        // Generated northern houses: palette-tinted walls, slope-mapped roof covering, painted soffits and fascia, an optional corner tower.
        const house = b.houseStyle && !isStone ? materials.houses() : undefined;
        if (house) {
          const palette = housePalette(b), covering = houseRoof(b), roofMaterial = covering < 0 ? materials.roof : house.roofs[covering];
          const paint = (g: THREE.BufferGeometry) => g.setAttribute('housePalette', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(palette), 1));
          const roofParts = (g: THREE.BufferGeometry) => {
            if (covering < 0) { bucket(roofMaterial, g, b.center[0], b.center[1]); return; }
            const { roof, trim } = splitHouseRoof(g); g.dispose();
            for (const [material, part] of [[roofMaterial, roof], [house.trim, trim]] as const) if (part.getAttribute('position').count) bucket(material, part, b.center[0], b.center[1]); else part.dispose();
          };
          const walls = tileShellGeometry(data, b, false); if (walls) { paint(walls); bucket(house.facade, walls, b.center[0], b.center[1]); }
          const roof = tileShellGeometry(data, b, true); if (roof) roofParts(roof);
          const tower = houseTowerGeometry(b, housePlan(city, b));
          if (tower) {
            bucket(house.facade, tower.facade, b.center[0], b.center[1]); bucket(roofMaterial === materials.roof ? house.roofs[5] : roofMaterial, tower.roof, b.center[0], b.center[1]); bucket(house.trim, tower.trim, b.center[0], b.center[1]);
            const hull = physics.addBuildingHull({ ...b, id: `${b.id}#tower`, footprint: tower.footprint, height: tower.top - (b.baseElevation ?? 0) }); if (hull) colliders.push(hull);
          }
          continue;
        }
        for (const isRoof of [false, true]) {
          const geometry = tileShellGeometry(data, b, isRoof); if (!geometry) continue;
          if (isMissionChurch(b)) { for (const part of splitMissionChurchShell(geometry,b,isRoof)) bucket(missionChurchMaterials[part.kind],part.geometry,b.center[0],b.center[1],'mission-church'); geometry.dispose(); continue; }
          if (isStateHouse(b)) { for (const part of splitStateHouseShell(geometry, isRoof)) bucket(stateHouseMaterials[part.kind], part.geometry, 0, 0, 'state-house'); geometry.dispose(); continue; }
          if (isSymphonyHall(b)) { for (const part of splitSymphonyHallShell(geometry, b, isRoof)) bucket(symphonyHallMaterials[part.kind], part.geometry, b.center[0], b.center[1], 'symphony-hall'); geometry.dispose(); continue; }
          if (isSouthStation(b)) { for (const part of splitSouthStationShell(geometry, isRoof)) bucket(part.kind === 'other' ? choose(isRoof) : southStationMaterials[part.kind], part.geometry, b.center[0], b.center[1], part.kind === 'other' ? '' : 'south-station'); geometry.dispose(); continue; }
          if (isTdGarden(b)) {
            // The passage's street wall is left out (the collider keeps it): the entrance hall stands behind it.
            for (const part of splitTdGardenShell(geometry, isRoof)) { if (part.kind === 'open') { part.geometry.dispose(); continue; } bucket(part.kind === 'other' ? choose(isRoof) : tdGardenFinish(part.kind, ctx.mobile), part.geometry, b.center[0], b.center[1], part.kind === 'other' ? '' : 'td-garden'); }
            geometry.dispose(); continue;
          }
          const material = choose(isRoof), parts = !isRoof && isPrudential(b) ? splitPrudentialShell(geometry, b) : [{ kind: 'facade', geometry }];
          for (const part of parts) bucket(part.kind === 'penthouse' ? prudentialPenthouse : material, part.geometry, b.center[0], b.center[1]);
          if (parts[0].geometry !== geometry) geometry.dispose();
        }
      }
      for (const { material, geometries } of buckets.values()) {
        if (due(pace)) yield 'buildings';
        const geometry = mergeGeometries(geometries, false); for (const g of geometries) g.dispose(); if (!geometry) continue;
        const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'Boston surveyed buildings'; computeBounds(geometry, false); meshes.push(mesh); target.add(mesh);
      }
      const footings = foundationGeometry({ ...city, buildings: tile.buildings.filter(b => !usesExactBuildingCollision(b) && !replacesTileShell(b) && !ctx.replacedBuildings?.has(b.id)) });
      if (footings.attributes.position.count) { const mesh = new THREE.Mesh(footings, foundation); mesh.name = 'Foundations'; mesh.receiveShadow = true; target.add(mesh); } else footings.dispose();
      addTileBuildings(city, tile);
    }
    yield 'buildings';

    // Street furniture on the owned roads: trees, lamps and name signs.
    {
      const treePositions: THREE.Vector3[] = [];
      const random = seeded(342 + hash(key) % 1000);
      const occupied = (x: number, z: number) => ctx.landmarkForecourt?.(x, z) || inGreenway(x,z) || inTransitCorridor(city, x, z) || inTunnelApproach(city,x,z) || !!city.index.at(x, z);
      const planted = (x: number, z: number) => occupied(x, z) || onMallLawn(x, z);
      const segmentCells = new Map<string, { a: Point2; b: Point2; radius: number }[]>();
      for (const road of roads.filter(r=>!r.tunnel)) for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1], b = road.points[i], radius = (road.pavedWidth ?? road.width) / 2 + .8, segment = { a, b, radius };
        for (let x = Math.floor((Math.min(a[0], b[0]) - radius) / 64); x <= Math.floor((Math.max(a[0], b[0]) + radius) / 64); x++) for (let z = Math.floor((Math.min(a[1], b[1]) - radius) / 64); z <= Math.floor((Math.max(a[1], b[1]) + radius) / 64); z++) {
          const k = `${x},${z}`, list = segmentCells.get(k) ?? []; list.push(segment); segmentCells.set(k, list);
        }
      }
      const inRoad = (x: number, z: number) => (segmentCells.get(`${Math.floor(x / 64)},${Math.floor(z / 64)}`) ?? []).some(({ a, b, radius }) => {
        const dx = b[0] - a[0], dz = b[1] - a[1], t = THREE.MathUtils.clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
        return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz) < radius;
      });
      const taken = new Set<string>();
      for (const road of ownedRoads) {
        if (road.elevations || road.width < 7 || /alley|unnamed/i.test(road.name)) continue;
        if (due(pace)) yield 'props';
        const verge = (road.pavedWidth ?? road.width) / 2 + 2;
        for (let i = 1; i < road.points.length; i++) {
          const a = road.points[i - 1], b = road.points[i], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz); if (length < .1) continue;
          const tx = dx / length, tz = dz / length;
          for (let d = 14; d < length - 8; d += 25) {
            for (const side of [-1, 1]) {
              const x = a[0] + tx * d - tz * verge * side, z = a[1] + tz * d + tx * verge * side;
              const k = `${Math.round(x / 8)},${Math.round(z / 8)}`; if (planted(x, z) || inRoad(x, z) || taken.has(k)) continue; taken.add(k);
              if ((!/Boylston/.test(road.name) || random() > .5) && !canopyHitsDeck(city, x, z, height(x, z), STREET_CANOPY)) treePositions.push(new THREE.Vector3(x, height(x, z), z));
              if (side === 1 && !inRoad(x - tx * 5, z - tz * 5) && !occupied(x - tx * 5, z - tz * 5)) lamps.push(new THREE.Vector3(x - tx * 5, height(x - tx * 5, z - tz * 5), z - tz * 5));
            }
          }
        }
      }
      // Name signs stand at a sparse, tile-independent set of corners (see planStreetSigns).
      const streetSigns = planStreetSigns(roadsNear(grow(bounds, 160)), (x, z) => !occupied(x, z) && !inRoad(x, z), insideTile);
      if (treePositions.length) ctx.trees.add(key, treePositions); stats.trees = treePositions.length; stats.lamps = lamps.length; stats.signs = streetSigns.length;
      const dummy = new THREE.Object3D();
      if (lamps.length) {
        const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(.055, .1, 5.7, 6), ctx.iron, lamps.length), bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(.27, 8, 6), ctx.lampMat, lamps.length);
        lamps.forEach((p, i) => { dummy.position.copy(p).add(new THREE.Vector3(0, 2.85, 0)); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); poles.setMatrixAt(i, dummy.matrix); dummy.position.y = p.y + 5.85; dummy.updateMatrix(); bulbs.setMatrixAt(i, dummy.matrix); });
        poles.castShadow = true; poles.name = 'Lamp poles'; bulbs.name = 'Lamp globes'; target.add(...spatialInstances(poles, 500), ...spatialInstances(bulbs, 500));
      }
      const hardware = new PartBatches(500), matrix = new THREE.Matrix4();
      for (const { position: [x, z], blades } of streetSigns) {
        if (due(pace)) yield 'props';
        const y = height(x, z), writer = hardware.at(ctx.iron, x, z);
        writer.append(new THREE.CylinderGeometry(POLE_RADIUS, POLE_RADIUS, POLE_HEIGHT, 6), matrix.makeTranslation(x, y + POLE_HEIGHT / 2, z));
        for (const blade of blades) {
          const bx = x + blade.offset[0], bz = z + blade.offset[1];
          writer.box(box(2.67, .5, .045), matrix.makeRotationY(blade.yaw).setPosition(bx, y + blade.height, bz));
          const plate = createStreetSign(blade.name, ctx.mobile); plate.position.set(bx, y + blade.height, bz); plate.rotation.y = blade.yaw; target.add(plate); owned.push(plate.material as THREE.Material);
        }
      }
      addBatches(hardware);
    }
    yield 'props';

    const placements = planTrafficSignals(subCity);
    if (placements.length) createTrafficSignals(target, subCity, placements);
    stats.signals = placements.length;
    yield 'signals';

    {
      for(const path of tile.parkPaths)colliders.push(...physics.addFootbridge(subCity,path));
      // Shore banks and rock outcrops collide as meshes: noted as the parks build, then added a run of triangles at a
      // time between frames (mesh-chunks.ts: a harbour tile's bank in one piece held a frame for 40 to 58 ms).
      const landscape: { vertices: Float32Array; indices: Uint32Array }[] = [], furnishings: Parameters<DrivingPhysics['addParapets']>[0][number][] = [];
      const addLandscapeCollider = (vertices: Float32Array, indices: Uint32Array) => { landscape.push({ vertices, indices }); };
      const parks = yield* stage('parks', cityParkDetailSteps(scene, subCity, { bounds, owner: key, treeField: ctx.parkTrees, target,
        budgets: { trees: 120, benches: 25 }, reserved: ctx.landmarkForecourt, pace, mobile: ctx.mobile, detailed: ctx.detailed, fellsViewHeight: woodlandViewHeight, onShore: addLandscapeCollider, onRock: addLandscapeCollider,
        sidewalks: tile.sidewalks, paving: materials.sidewalk, onSolids: boxes => { furnishings.push(...boxes); } }));
      for (const mesh of landscape) for (const part of meshChunks(mesh.vertices, mesh.indices)) { if (due(pace)) yield 'parks'; colliders.push(physics.addStaticMesh(part.vertices, part.indices)); }
      // Park fences and monuments stand as boxes, a few dozen a frame.
      for (let i = 0; i < furnishings.length; i += 64) { if (due(pace)) yield 'parks'; colliders.push(...physics.addParapets(furnishings.slice(i, i + 64))); }
      stats.parkTrees = parks.userData.trees ?? 0;
    }
    yield 'parks';

    // Architectural detail probes see only this tile's shells.
    {
      const sampler = sourceWallSampler(scene, meshes);
      yield 'details';
      const detailBuildings = tile.buildings.filter(b => !isChelseaLiftFrame(b) && !replacesTileShell(b) && !ctx.replacedBuildings?.has(b.id));
      const half = Math.ceil(detailBuildings.length / 2), subsets = [detailBuildings.slice(0, half), detailBuildings.slice(half)];
      for (const subset of ctx.mobile ? [] : subsets) {
        if (!subset.length) continue;
        const facades = yield* stage('details', facadeDetailSteps(scene, subCity, { buildings: subset, sampler, budget: 1300, target, pace }));
        stats.facades += facades.userData.facades ?? 0;
      }
      const shops = yield* stage('details', streetscapeSteps(scene, subCity, { buildings: detailBuildings, sampler, budget: ctx.mobile ? 35 : 100, target, pace })); stats.storefronts = shops.userData.storefrontCount ?? 0;
      if (!ctx.mobile) {
        const roofs = yield* stage('details', rooftopDetailSteps(scene, subCity, { buildings: detailBuildings, meshes, budget: 90, target, pace })); stats.rooftops = roofs.userData.units ?? 0;
      }
      const porches = yield* stage('details', neighborhoodDetailSteps(scene, subCity, { buildings: detailBuildings, sampler, budget: ctx.mobile ? 20 : 60, target, pace })); stats.porches = porches.userData.porches ?? 0;
      const houses = detailBuildings.filter(b => b.houseStyle);
      if (houses.length) {
        // Roof height over a point, from the house's own packaged roof triangles (chimney footing and clearance).
        const roofTop = (b: Building, x: number, z: number) => {
          const data = tile.geometry.get(b.id); if (!data) return undefined;
          const p = data.positions, r = data.roof; let best = -Infinity;
          for (let i = 0; i + 2 < r.length; i += 3) {
            const a = r[i] * 3, c = r[i + 1] * 3, d = r[i + 2] * 3, ax = p[a], az = p[a + 2], bx = p[c], bz = p[c + 2], cx = p[d], cz = p[d + 2];
            const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(det) < 1e-9) continue;
            const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det, l3 = 1 - l1 - l2;
            if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue; best = Math.max(best, l1 * p[a + 1] + l2 * p[c + 1] + l3 * p[d + 1]);
          }
          return best > -Infinity ? best : undefined;
        };
        const homes = materials.houses(), details = yield* stage('details', houseDetailSteps(scene, subCity, { buildings: houses, roofs: homes.roofs, trimRoof: homes.trim, roofTop, porchBudget: ctx.mobile ? 24 : 140, target, pace, mobile: ctx.mobile }));
        stats.housePorches = (details.userData.porches ?? 0) + (details.userData.porticos ?? 0);
      }
    }
    // Repacking an entire tile into BatchedMesh duplicates its vertex buffers. Mobile keeps its already grouped
    // road/shell buffers; either way nothing in the tile moves again, so its local matrices are composed once.
    if (ctx.mobile) { freezeTransforms(group); group.userData.batching = { sources: 0, batches: 0 }; }
    else {
      // The batches stay hidden, their sources in place, until the rest of the tile is on the GPU too: everything
      // then changes in this one step, which is also the step the streamer shows the tile's scenery in.
      const held: HeldBatches = new Map();
      group.userData.batching = yield* stage('details', staticDetailBatchSteps(group, pace, ctx.warm, ctx.upload, held));
      // What stays unbatched (building shells, a lone pavement layer, water) goes to the GPU the same way.
      if (ctx.upload) {
        const replaced = new Set([...held.values()].flat()), rest: THREE.Mesh[] = [];
        group.traverse(o => { if (o instanceof THREE.Mesh && !(o instanceof THREE.BatchedMesh) && !replaced.has(o)) rest.push(o); });
        // A material or variant this session has not drawn yet (a landmark's finish, a house palette) links off the main thread first.
        if (ctx.warm) { const linked = rest.map(mesh => ctx.warm!(mesh)); yield* stage('details', until(() => linked.every(ready => ready()), pace)); }
        yield* stage('details', ctx.upload(rest, pace));
      }
      showBatches(held);
    }
    stats.colliders = colliders.length; stats.buildMs = Math.round(performance.now() - began);
    group.userData = { ...group.userData, tile: key, ...stats };
    const built: BuiltTile = { key, tile, group, bounds, colliders, meshes, lamps: [...lamps, ...highwayLamps], signals: placements, stats, dispose: () => dispose(built, owned) };
    return built;
  }

  function dispose(built: BuiltTile, owned: THREE.Material[]) {
    physics.removeColliders(built.colliders); built.colliders.length = 0;
    removeTileBuildings(city, built.tile); removeBuildingPlans(city, built.tile.buildings); for (const b of built.tile.buildings) ctx.buildingMap.delete(b.id);
    ctx.trees.remove(built.key); ctx.parkTrees.remove(built.key);
    disposeTileResources(built.group, owned);
  }

  /** Abandon a tile whose build was interrupted: whatever stages ran are undone. */
  function abandon(partial: PartialTile) {
    physics.removeColliders(partial.colliders);
    partial.colliders.length = 0;
    removeTileBuildings(city, partial.tile); removeBuildingPlans(city, partial.tile.buildings); for (const b of partial.tile.buildings) ctx.buildingMap.delete(b.id);
    ctx.trees.remove(partial.key); ctx.parkTrees.remove(partial.key);
    disposeTileResources(partial.group, partial.ownedMaterials);
  }

  return { build, abandon, roadsNear, midpoint };
}
