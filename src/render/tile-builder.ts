import * as THREE from 'three';
import { IndexedSurfaceWriter, SurfaceBatches } from './indexed-surfaces.ts';
import { staticDetailBatchSteps } from './static-batches.ts';
import { disposeTileResources } from './tile-resources.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Building, CityArea, CityData, Point2, Road } from '../types';
import type { DrivingPhysics } from '../physics/vehicle';
import { addTileBuildings, removeTileBuildings, type CityTile, type MetroCity } from '../simulation/city-tiles.ts';
import { pavementEdges, pavementSpan, roadwaySpan, type TilePavement } from '../simulation/tile-format.ts';
import { WALK } from '../simulation/road-grading.ts';
import { roadMidpoint } from '../simulation/road-tile-coverage.ts';
import { sampleElevation, terrainGrid } from '../simulation/terrain.ts';
import { inTransitCorridor, shareTransitCorridors } from '../simulation/transit-corridors.ts';
import { planTrafficSignals, type PlacedSignal } from '../simulation/signal-placement.ts';
import { usesExactBuildingCollision } from '../simulation/building-collisions.ts';
import { pointInside } from '../simulation/roads.ts';
import { type createMaterials, facadeStyleIndex, hash, seeded } from './materials';
import { tileCollisionIndices, tileShellGeometry, tileSourceGeometry } from './tile-geometry';
import { drapedRibbonInto, drapedStripInto, foundationGeometry, backBayPaving, BACK_BAY_PAVING, clipPortalSurface } from './terrain-ground';
import { inTunnelApproach } from '../simulation/tunnels.ts';
import { spatialInstances } from './spatial-batches';
import { PartBatches, box } from './geometry-writer';
import { due, UNPACED, type Pace } from './pacing';
import { createTrafficSignals } from './traffic-signals';
import { createStreetSign } from './signs';
import { planStreetSigns, POLE_HEIGHT, POLE_RADIUS } from '../simulation/street-signs';
import { addRoadStructures } from './bridges';
import { addSurveyViaductSupports } from './viaducts';
import { addSourceFooting } from './source-footings';
import { prepareNeighborhoodArchitecture } from './neighborhood-profiles';
import { isFenwayBuilding, createFenwayShellMaterials } from './fenway-park';
import { isStateHouse, createStateHouseShellMaterials, splitStateHouseShell } from './state-house';
import { isSymphonyHall, createSymphonyHallMaterials, splitSymphonyHallShell } from './symphony-hall';
import { isSouthStation, createSouthStationMaterials, splitSouthStationShell } from './south-station';
import { createPrudentialPenthouseMaterial, isPrudential, splitPrudentialShell } from './prudential';
import { createMissionChurchMaterials, isMissionChurch, splitMissionChurchShell } from './mission-church';
import { landmarkShellMaterial } from './metro-landmarks';
import { sourceWallSampler, facadeDetailSteps } from './facade-details';
import { streetscapeSteps } from './streetscape';
import { rooftopDetailSteps } from './rooftops';
import { neighborhoodDetailSteps } from './neighborhood-architecture';
import { cityParkDetailSteps, areaBoundsOf, parkSurface, type Bounds } from './city-parks';
import type { TreeField } from './foliage';

export interface TileContext {
  scene: THREE.Scene; city: MetroCity; physics: DrivingPhysics; materials: ReturnType<typeof createMaterials>;
  /** Shared instanced fields: street trees (with grates) and park specimens. */
  trees: TreeField; parkTrees: TreeField;
  /** Live id lookup of the detailed buildings currently in the scene. */
  buildingMap: Map<string, Building>;
  ground: THREE.Material; iron: THREE.Material; lampMat: THREE.Material; mobile?: boolean;
}
export interface TileStats {
  buildings: number; exactMeshes: number; triangles: number; roads: number; structures: number; trees: number; lamps: number; signs: number; signals: number; parkTrees: number; storefronts: number; facades: number; rooftops: number; porches: number; colliders: number;
  /** Wall-clock span from the first generator step to completion. */ buildMs: number;
  /** Main-thread time inside the generator, in total and per completed stage (filled in by the streamer). */ cpuMs: number; stageMs?: Record<string, number>;
}
export interface BuiltTile {
  key: string; tile: CityTile; group: THREE.Group; bounds: Bounds; colliders: RAPIER.Collider[]; meshes: THREE.Mesh[]; lamps: THREE.Vector3[]; signals: PlacedSignal[]; stats: TileStats;
  dispose(): void;
}
export type TileStage = 'terrain' | 'roads' | 'curbs' | 'structures' | 'buildings' | 'props' | 'signals' | 'parks' | 'details';
export interface PartialTile { group: THREE.Group; colliders: RAPIER.Collider[]; key: string; tile: CityTile; ownedMaterials?: THREE.Material[]; }

/** Run a paced helper as one named stage: each pause it takes becomes a yield of that stage. */
function* stage<T>(name: TileStage, steps: Generator<void, T>): Generator<TileStage, T> { let r = steps.next(); while (!r.done) { yield name; r = steps.next(); } return r.value; }

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
  const foundation = new THREE.MeshStandardMaterial({ color: '#827c6d', roughness: .95, side: THREE.DoubleSide });
  const chelseaLiftSteel = new THREE.MeshStandardMaterial({ color: '#9ea7a3', roughness: .72, metalness: .3 });
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

  /** `partial` is owned by the caller so an interrupted build can be undone with `abandon`. */
  function* build(tile: CityTile, partial: PartialTile = { group: new THREE.Group(), colliders: [], key: tile.key, tile }, pace: Pace = UNPACED): Generator<TileStage, BuiltTile> {
    const began = performance.now(), key = tile.key, size = tile.size, x0 = tile.tx * size, z0 = tile.tz * size, x1 = x0 + size, z1 = z0 + size;
    const bounds: Bounds = { minX: x0, maxX: x1, minZ: z0, maxZ: z1 }, insideTile = (x: number, z: number) => x >= x0 && x < x1 && z >= z0 && z < z1;
    const group = partial.group; group.name = `Tile ${key}`;
    const colliders = partial.colliders, meshes: THREE.Mesh[] = [], owned = partial.ownedMaterials ??= [], lamps: THREE.Vector3[] = [];
    const stats: TileStats = { buildings: 0, exactMeshes: 0, triangles: 0, roads: 0, structures: 0, trees: 0, lamps: 0, signs: 0, signals: 0, parkTrees: 0, storefronts: 0, facades: 0, rooftops: 0, porches: 0, colliders: 0, buildMs: 0, cpuMs: 0 };
    const near = grow(bounds, 80), roads = roadsNear(near), ownedRoads = roads.filter(r => { const m = midpoint(r); return insideTile(m[0], m[1]); });
    const subCity: CityData = { ...city, roads, buildings: tile.buildings, signals: collect(signalCells, grow(bounds, 40), s => s[0] >= x0 - 40 && s[0] < x1 + 40 && s[1] >= z0 - 40 && s[1] < z1 + 40), curbs: tile.curbs, parkPaths: tile.parkPaths,
      parks: collect(parkCells, bounds, p => overlaps(areaBounds.get(p)!, bounds)), water: collect(waterCells, grow(bounds, 30), w => overlaps(areaBounds.get(w)!, grow(bounds, 30))) };
    shareTransitCorridors(subCity, city);
    const addBatches = (batches: Pick<PartBatches, 'meshes'>) => {
      for (const m of batches.meshes()) { m.receiveShadow = true; if (m.material === materials.asphalt) m.renderOrder = -1; else if (m.material === materials.sidewalk) m.renderOrder = -2; group.add(m); }
    };

    // Terrain: the grid quads this tile covers, plus the quad column and row on
    // its far edges so neighbouring tiles overlap by one cell instead of leaving
    // a seam when only one of them is loaded. Overlapping triangles are identical.
    {
      const cs = grid.cellSize, i0 = Math.max(0, Math.floor((x0 - grid.originX) / cs)), i1 = Math.min(grid.width - 1, Math.floor((x1 - grid.originX) / cs) + 1);
      const j0 = Math.max(0, Math.floor((z0 - grid.originZ) / cs)), j1 = Math.min(grid.height - 1, Math.floor((z1 - grid.originZ) / cs) + 1);
      const w = i1 - i0 + 1, h = j1 - j0 + 1;
      if (w >= 2 && h >= 2) {
        const positions = new Float32Array(w * h * 3), normals = new Float32Array(w * h * 3), uv = new Float32Array(w * h * 2), heights = grid.heights, W = grid.width, H = grid.height;
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const gi = i0 + i, gj = j0 + j, n = j * w + i, x = grid.originX + gi * cs, z = grid.originZ + gj * cs;
          positions[n * 3] = x; positions[n * 3 + 1] = heights[gj * W + gi]; positions[n * 3 + 2] = z; uv[n * 2] = x / 4; uv[n * 2 + 1] = z / 4;
          const hl = heights[gj * W + Math.max(gi - 1, 0)], hr = heights[gj * W + Math.min(gi + 1, W - 1)], hu = heights[Math.max(gj - 1, 0) * W + gi], hd = heights[Math.min(gj + 1, H - 1) * W + gi];
          const nx = -(hr - hl) / (2 * cs), nz = -(hd - hu) / (2 * cs), length = Math.hypot(nx, 1, nz);
          normals[n * 3] = nx / length; normals[n * 3 + 1] = 1 / length; normals[n * 3 + 2] = nz / length;
        }
        const indices = new Uint32Array((w - 1) * (h - 1) * 6); let o = 0;
        for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) { const a = j * w + i, b = a + 1, c = a + w, d = c + 1; indices[o++] = a; indices[o++] = c; indices[o++] = b; indices[o++] = b; indices[o++] = c; indices[o++] = d; }
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3)); geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geometry.setIndex(new THREE.BufferAttribute(indices, 1)); geometry.computeBoundingSphere();
        clipPortalSurface(city,geometry);
        const ground = new THREE.Mesh(geometry, ctx.ground); ground.name = 'Terrain'; ground.position.y = -.04; ground.receiveShadow = true; ground.renderOrder = -3; group.add(ground);
        colliders.push(physics.addTerrainTile(positions,indices));
        if (overlaps(bounds, BACK_BAY_PAVING)) {
          const paving = backBayPaving(city, { i0, i1, j0, j1 });
          if (paving.attributes.position?.count) { const mesh = new THREE.Mesh(paving, materials.sidewalk); mesh.name = 'Back Bay paving'; mesh.receiveShadow = true; mesh.renderOrder = -2; group.add(mesh); } else paving.dispose();
        }
      }
    }
    yield 'terrain';

    // Roads owned by this tile (their midpoint lies inside it). The asphalt
    // follows the roadway measured between the curbs (tile.pavements, from
    // scripts/street_surfaces.py) with a sidewalk band only on the sides the
    // Boston sidewalk inventory does not cover; a road without a record keeps
    // the constant-width ribbons of the survey build.
    {
      const batches = ctx.mobile ? new SurfaceBatches(500) : new PartBatches(500), crossingKeys = new Set<string>();
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
        if (pavement && edges) {
          const { left, right } = edges;
          if (!pavement.walk?.[0]) strip(materials.sidewalk, band(left, right), left, .012);
          if (!pavement.walk?.[1]) strip(materials.sidewalk, right, band(right, left), .012);
          strip(materials.asphalt, left, right, .045);
        } else {
          ribbon(materials.sidewalk, road.points, road.width + 5.8, .012);
          ribbon(materials.asphalt, road.points, road.width, .045);
        }
        for (let i = 1; i < road.points.length; i++) {
          const a = road.points[i - 1], b = road.points[i], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz); if (len < 8) continue;
          const tx = dx / len, tz = dz / len;
          if (road.width >= 9) for (let d = 8; d < len - 7; d += 9) { const end = Math.min(d + 3, len - 7); ribbon(road.oneway ? materials.paint : materials.yellow, [[a[0] + tx * d, a[1] + tz * d], [a[0] + tx * end, a[1] + tz * end]], .12, .065); }
        }
        if (road.width < 7 || /alley|unnamed/i.test(road.name)) continue;
        for (const reverse of [false, true]) {
          const a = road.points[reverse ? road.points.length - 1 : 0], b = road.points[reverse ? road.points.length - 2 : 1]; if (!b) continue;
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 18) continue;
          const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len, crossing = `${Math.round(a[0] / 3)},${Math.round(a[1] / 3)},${Math.round(Math.atan2(tx, tz) * 2)}`;
          if (crossingKeys.has(crossing)) continue; crossingKeys.add(crossing);
          // The stripes span the roadway measured at their own station, not the road-wide median width: Boylston
          // Street's west end closes from 21.8 m to 14 m, and its east end sits 6 m off the centerline. Records of other
          // roads that share the asphalt there (a parkway's second one-way centerline) extend them across the whole roadway.
          const at: Point2 = [a[0] + tx * 8, a[1] + tz * 8], [lo, hi] = roadwaySpan((edges && pavementSpan(edges, at, tx, tz)) ?? [-width / 2, width / 2], allEdges, at, tx, tz);
          for (let side = lo + .8; side < hi - .5; side += 1.35) {
            const x = at[0] - tz * side, z = at[1] + tx * side;
            ribbon(materials.paint, [[x, z], [x + tx * 3, z + tz * 3]], .65, .068);
          }
        }
      }
      addBatches(batches);
      // Surveyed sidewalks (above the lawn decals, below the asphalt, so a
      // disagreement with the curb line hides under the roadway), asphalt
      // driveway faces (above the lawn and the sidewalks they were cut around,
      // below the street asphalt) and concrete curb islands, merged per material.
      const paved: [THREE.BufferGeometry[], THREE.Material, string, Point2[][][], number][] = [[[], materials.sidewalk, 'Sidewalks', tile.sidewalks.filter(w => w.material !== 'brick').map(w => w.rings), .03], [[], materials.brick, 'Brick sidewalks', tile.sidewalks.filter(w => w.material === 'brick').map(w => w.rings), .03], [[], materials.asphalt, 'Driveways', tile.driveways, .035], [[], materials.sidewalk, 'Curb islands', tile.islands, .05]];
      for (const [list, , , rings, y] of paved) for (const polygon of rings) {
        if (due(pace)) yield 'roads';
        const geometry = clipPortalSurface(city, parkSurface(city, polygon, y)); if (geometry.attributes.position?.count) list.push(geometry); else geometry.dispose();
      }
      for (const [list, material, name] of paved) {
        if (!list.length) continue;
        const mesh = new THREE.Mesh(mergeGeometries(list), material); mesh.name = name; mesh.receiveShadow = true; mesh.renderOrder = -2; group.add(mesh); for (const g of list) g.dispose();
      }
    }
    yield 'roads';

    // Raised curb boxes are decorative and dominate retained neighborhood
    // buffers. Mobile keeps the sidewalk surface and shared terrain/collisions.
    if (!ctx.mobile) {
      const batches = new PartBatches(500), matrix = new THREE.Matrix4();
      for (const points of tile.curbs) {
        if (due(pace)) yield 'curbs';
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1], b = points[i], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz); if (length < .05) continue;
          const n = Math.max(1, Math.ceil(length / 3)), part = box(.18, .17, length / n), yaw = Math.atan2(dx, dz);
          for (let j = 0; j < n; j++) {
            const t = (j + .5) / n, x = a[0] + dx * t, z = a[1] + dz * t;if(inTunnelApproach(city,x,z))continue;
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

    // Elevated decks, barriers and supports, with their Rapier solids.
    {
      const elevated = ownedRoads.filter(r => r.elevations && !r.tunnel);
      if (elevated.length) { addRoadStructures(group, subCity, materials.asphalt, elevated); for (const road of elevated) colliders.push(...physics.addRoadDeck(subCity, road)); stats.structures = elevated.length; }
    }
    yield 'structures';

    // Buildings: the quantized tile shells become the same façade-styled,
    // spatially bucketed chunks the survey build produced, with exact-mesh
    // landmarks collided as meshes and everything else as convex hulls.
    {
      prepareNeighborhoodArchitecture(subCity, tile.buildings);
      const buckets = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[] }>();
      const bucket = (material: THREE.Material, geometry: THREE.BufferGeometry, cx: number, cz: number, tag = '') => {
        const k = `${material.uuid}:${tag || `${Math.floor(cx / 500)}:${Math.floor(cz / 500)}`}`; let entry = buckets.get(k); if (!entry) { entry = { material, geometries: [] }; buckets.set(k, entry); } entry.geometries.push(geometry);
      };
      for (const b of tile.buildings) {
        if (due(pace)) yield 'buildings';
        const data = tile.geometry.get(b.id); if (!data) continue;
        ctx.buildingMap.set(b.id, b); stats.buildings++; stats.triangles += (data.facade.length + data.roof.length) / 3;
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
          if(b.landmark==='zakim-bridge'){
            const viaduct=addSurveyViaductSupports(group,city,data);
            for(const mesh of viaduct.collisions)colliders.push(physics.addStaticMesh(mesh.vertices,mesh.indices));
          }
          const source = tileSourceGeometry(data);
          const footing = b.structure ? undefined : addSourceFooting(group, city, b, source); if (footing) colliders.push(physics.addStaticMesh(footing.vertices, footing.indices));
          source.dispose();
        } else { const hull = physics.addBuildingHull(b); if (hull) colliders.push(hull); }
        for (const isRoof of [false, true]) {
          const geometry = tileShellGeometry(data, b, isRoof); if (!geometry) continue;
          if (isMissionChurch(b)) { for (const part of splitMissionChurchShell(geometry,b,isRoof)) bucket(missionChurchMaterials[part.kind],part.geometry,b.center[0],b.center[1],'mission-church'); geometry.dispose(); continue; }
          if (isStateHouse(b)) { for (const part of splitStateHouseShell(geometry, isRoof)) bucket(stateHouseMaterials[part.kind], part.geometry, 0, 0, 'state-house'); geometry.dispose(); continue; }
          if (isSymphonyHall(b)) { for (const part of splitSymphonyHallShell(geometry, b, isRoof)) bucket(symphonyHallMaterials[part.kind], part.geometry, b.center[0], b.center[1], 'symphony-hall'); geometry.dispose(); continue; }
          if (isSouthStation(b)) { for (const part of splitSouthStationShell(geometry, isRoof)) bucket(part.kind === 'other' ? choose(isRoof) : southStationMaterials[part.kind], part.geometry, b.center[0], b.center[1], part.kind === 'other' ? '' : 'south-station'); geometry.dispose(); continue; }
          const material = choose(isRoof), parts = !isRoof && isPrudential(b) ? splitPrudentialShell(geometry, b) : [{ kind: 'facade', geometry }];
          for (const part of parts) bucket(part.kind === 'penthouse' ? prudentialPenthouse : material, part.geometry, b.center[0], b.center[1]);
          if (parts[0].geometry !== geometry) geometry.dispose();
        }
      }
      for (const { material, geometries } of buckets.values()) {
        if (due(pace)) yield 'buildings';
        const geometry = mergeGeometries(geometries, false); for (const g of geometries) g.dispose(); if (!geometry) continue;
        const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'Boston surveyed buildings'; geometry.computeBoundingSphere(); meshes.push(mesh); group.add(mesh);
      }
      const footings = foundationGeometry({ ...city, buildings: tile.buildings.filter(b => !usesExactBuildingCollision(b)) });
      if (footings.attributes.position.count) { const mesh = new THREE.Mesh(footings, foundation); mesh.name = 'Foundations'; mesh.receiveShadow = true; group.add(mesh); } else footings.dispose();
      addTileBuildings(city, tile);
    }
    yield 'buildings';

    // Street furniture on the owned roads: trees, lamps and name signs.
    {
      const treePositions: THREE.Vector3[] = [];
      const random = seeded(342 + hash(key) % 1000);
      const occupied = (x: number, z: number) => inTransitCorridor(city, x, z) || inTunnelApproach(city,x,z) || !!city.index.at(x, z);
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
              const k = `${Math.round(x / 8)},${Math.round(z / 8)}`; if (occupied(x, z) || inRoad(x, z) || taken.has(k)) continue; taken.add(k);
              if (!/Boylston/.test(road.name) || random() > .5) treePositions.push(new THREE.Vector3(x, height(x, z), z));
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
        poles.castShadow = true; poles.name = 'Lamp poles'; bulbs.name = 'Lamp globes'; group.add(...spatialInstances(poles, 500), ...spatialInstances(bulbs, 500));
      }
      const hardware = new PartBatches(500), matrix = new THREE.Matrix4();
      for (const { position: [x, z], blades } of streetSigns) {
        if (due(pace)) yield 'props';
        const y = height(x, z), writer = hardware.at(ctx.iron, x, z);
        writer.append(new THREE.CylinderGeometry(POLE_RADIUS, POLE_RADIUS, POLE_HEIGHT, 6), matrix.makeTranslation(x, y + POLE_HEIGHT / 2, z));
        for (const blade of blades) {
          const bx = x + blade.offset[0], bz = z + blade.offset[1];
          writer.box(box(2.67, .5, .045), matrix.makeRotationY(blade.yaw).setPosition(bx, y + blade.height, bz));
          const plate = createStreetSign(blade.name); plate.position.set(bx, y + blade.height, bz); plate.rotation.y = blade.yaw; group.add(plate); owned.push(plate.material as THREE.Material);
        }
      }
      addBatches(hardware);
    }
    yield 'props';

    const placements = planTrafficSignals(subCity);
    if (placements.length) createTrafficSignals(group, subCity, placements);
    stats.signals = placements.length;
    yield 'signals';

    {
      for(const path of tile.parkPaths)colliders.push(...physics.addFootbridge(subCity,path));
      const parks = yield* stage('parks', cityParkDetailSteps(scene, subCity, { bounds, owner: key, treeField: ctx.parkTrees, target: group, budgets: { trees: 120, benches: 25 }, pace, onShore:(vertices,indices)=>colliders.push(physics.addStaticMesh(vertices,indices)) }));
      stats.parkTrees = parks.userData.trees ?? 0;
    }
    yield 'parks';

    // Architectural detail probes see only this tile's shells.
    {
      const sampler = sourceWallSampler(scene, meshes);
      yield 'details';
      const detailBuildings = tile.buildings.filter(b => !isChelseaLiftFrame(b));
      const half = Math.ceil(detailBuildings.length / 2), subsets = [detailBuildings.slice(0, half), detailBuildings.slice(half)];
      for (const subset of ctx.mobile ? [] : subsets) {
        if (!subset.length) continue;
        const facades = yield* stage('details', facadeDetailSteps(scene, subCity, { buildings: subset, sampler, budget: 1300, target: group, pace }));
        stats.facades += facades.userData.facades ?? 0;
      }
      const shops = yield* stage('details', streetscapeSteps(scene, subCity, { buildings: detailBuildings, sampler, budget: ctx.mobile ? 35 : 100, target: group, pace })); stats.storefronts = shops.userData.storefrontCount ?? 0;
      if (!ctx.mobile) {
        const roofs = yield* stage('details', rooftopDetailSteps(scene, subCity, { buildings: detailBuildings, meshes, budget: 90, target: group, pace })); stats.rooftops = roofs.userData.units ?? 0;
      }
      const porches = yield* stage('details', neighborhoodDetailSteps(scene, subCity, { buildings: detailBuildings, sampler, budget: ctx.mobile ? 20 : 60, target: group, pace })); stats.porches = porches.userData.porches ?? 0;
    }
    // Repacking an entire tile into BatchedMesh duplicates its vertex buffers. Mobile keeps its already grouped road/shell buffers.
    group.userData.batching = ctx.mobile ? { sources: 0, batches: 0 } : yield* stage('details', staticDetailBatchSteps(group, pace));
    stats.colliders = colliders.length; stats.buildMs = Math.round(performance.now() - began);
    group.userData = { ...group.userData, tile: key, ...stats };
    const built: BuiltTile = { key, tile, group, bounds, colliders, meshes, lamps, signals: placements, stats, dispose: () => dispose(built, owned) };
    return built;
  }

  function dispose(built: BuiltTile, owned: THREE.Material[]) {
    physics.removeColliders(built.colliders); built.colliders.length = 0;
    removeTileBuildings(city, built.tile); for (const b of built.tile.buildings) ctx.buildingMap.delete(b.id);
    ctx.trees.remove(built.key); ctx.parkTrees.remove(built.key);
    disposeTileResources(built.group, owned);
  }

  /** Abandon a tile whose build was interrupted: whatever stages ran are undone. */
  function abandon(partial: PartialTile) {
    physics.removeColliders(partial.colliders);
    partial.colliders.length = 0;
    removeTileBuildings(city, partial.tile); for (const b of partial.tile.buildings) ctx.buildingMap.delete(b.id);
    ctx.trees.remove(partial.key); ctx.parkTrees.remove(partial.key);
    disposeTileResources(partial.group, partial.ownedMaterials);
  }

  return { build, abandon, roadsNear, midpoint };
}
