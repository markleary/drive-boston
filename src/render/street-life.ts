import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { CityData, ParkPath, Point2, Road } from '../types';
import type { DrivingPhysics } from '../physics/vehicle';
import { closestRoad, pointInside } from '../simulation/roads.ts';
import { isMetroCity } from '../simulation/city-tiles.ts';
import { coverageTester } from '../simulation/coverage.ts';
import {createNPCVehicleBatches} from './npc-vehicles.ts';
import {NPC_BODY_LIFT,NPC_VEHICLES,npcVehicleAt,npcPaint,type NPCVehicleType} from '../simulation/npc-vehicle-specs.ts';
import {createNPCVehicleColliders} from '../physics/npc-vehicle.ts';
import { sampleElevation, sampleTerrainNormal, terrainRotation } from '../simulation/terrain.ts';
import { inTransitCorridor } from '../simulation/transit-corridors.ts';
import { inTunnelApproach } from '../simulation/tunnels.ts';
import { createActivityProfile } from '../simulation/activity.ts';
import { createPedestrianModel } from './pedestrian-model.ts';
import type { ConstructionZone } from '../simulation/construction-zones.ts';
import { sampleRoadElevation } from '../simulation/road-surfaces.ts';
import { KNOCK_SPEED, startKnock, stepKnock, struckBy, type KnockedDown, type KnockThreat } from '../simulation/knockdown.ts';
import { isCommonwealthMall, mallGroundTest, mallPathTest } from '../simulation/commonwealth-mall.ts';
import { laneTolerance, mallWalkLanes, offsetLine, pathLaneOffsets, straightRuns, type WalkStretch } from '../simulation/park-walks.ts';
import { outsideGreenwayPath } from '../simulation/greenway.ts';

interface Segment { road: Road; a: Point2; b: Point2; length: number; tx: number; tz: number; index: number; }
interface WalkRoute { road: string; start: Point2; end: Point2; length: number; yaw: number; /** A stretch of a park path, not of a street's sidewalk. */ park?: boolean; }
const PEDESTRIAN_CAPACITY = 112;
/** A park's walks draw walkers as if this many metres nearer than a sidewalk: with one walker a stretch and a
 * sidewalk either side of every street, the pool otherwise leaves a park's paths thinly walked. */
const PARK_DRAW = 45;
export interface StreetPedestrian {
  id: number; road: string; start: Point2; end: Point2; position: THREE.Vector3; yaw: number;
  speed: number; height: number; phase: number; route: WalkRoute; width: number; bag: boolean; scarf: boolean;
  pauseUntil?:number; outfit?:number;
  orientation?:THREE.Quaternion; sprawl?:number; knocked?:KnockedDown;
  /** Offset from the sidewalk route where a walker got back up; it fades out while walking. */
  rejoin?:{dx:number;dz:number;t:number};
}
export interface ParkedVehicle { registration?:string; type:NPCVehicleType; mass:number; id: number; road: string; x: number; y: number; z: number; yaw: number; meter: Point2 | null; }
export type { KnockedDown } from '../simulation/knockdown.ts';
/** The moving vehicle a walker can be struck by. */
export type WalkerThreat = KnockThreat;
/** Player speed (m/s) below which touching a walker only makes them stop and wait. */
export const PEDESTRIAN_HIT_SPEED = KNOCK_SPEED;
const gap = (a: Point2, b: Point2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** Half of this is the curb offset: the roadway measured between the curbs where the package has it. */
const paved = (road: Road) => road.pavedWidth ?? road.width;
const lerp = THREE.MathUtils.lerp, smooth = (t: number) => t * t * (3 - 2 * t);
function pointSegment(p: Point2, a: Point2, b: Point2) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

/** Conservative cell lookup: detailed geometry checks still decide clearance. */
function spatialIndex<T>(items: T[], bounds: (item:T)=>[number,number,number,number], margin:number) {
  const cells=new Map<string,T[]>(),size=64,empty:T[]=[];
  for(const item of items){const [minX,minZ,maxX,maxZ]=bounds(item);
    for(let x=Math.floor((minX-margin)/size);x<=Math.floor((maxX+margin)/size);x++)for(let z=Math.floor((minZ-margin)/size);z<=Math.floor((maxZ+margin)/size);z++){
      const key=`${x},${z}`,bucket=cells.get(key);if(bucket)bucket.push(item);else cells.set(key,[item]);
    }
  }
  return (p:Point2)=>cells.get(`${Math.floor(p[0]/size)},${Math.floor(p[1]/size)}`)??empty;
}

function spreadByBlock<T>(items:T[],point:(item:T)=>Point2,size=650):T[]{
  const blocks=new Map<string,T[]>();
  for(const item of items){const p=point(item),key=`${Math.floor(p[0]/size)},${Math.floor(p[1]/size)}`,block=blocks.get(key);if(block)block.push(item);else blocks.set(key,[item]);}
  const result:T[]=[];
  for(let i=0;result.length<items.length;i++)for(const block of blocks.values())if(i<block.length)result.push(block[i]);
  return result;
}

export interface StreetLifeOptions {
  mobile?: boolean;
  /** The main view: walkers outside it (and out of reach of it with their shadows) are left out of its draws. */ camera?: THREE.Camera;
  /** False where no other camera draws the walkers (a phone has no reflection captures): those out of view are not posed either. */ poseHidden?: boolean;
  /** A metro's streamed tiles: the park paths of the resident ones are walked too (a whole-city package lists its paths itself). */ tiles?: StreetLifeTiles;
}
export interface StreetLifeTiles { readonly loaded: ReadonlyMap<string, { tile: { parkPaths: ParkPath[] } }>; }
// A walker's reach into the view: the body, thrown clear of the ground at worst, and its shadow under a low sun.
const WALKER_REACH = 10;
/** Ambient walkers follow verified sidewalk stretches; they do not enter traffic. */
export function createStreetLife(scene: THREE.Scene, city: CityData, physics?: DrivingPhysics, constructionZones: readonly ConstructionZone[] = [], options: StreetLifeOptions = {}) {
  const group = new THREE.Group(); group.name = 'StreetLife'; scene.add(group);
  const peopleGroup = new THREE.Group(); peopleGroup.name = 'Pedestrians'; group.add(peopleGroup);
  const parkedGroup = new THREE.Group(); parkedGroup.name = 'ParkedVehicles'; group.add(parkedGroup);
  const furnitureGroup = new THREE.Group(); furnitureGroup.name = 'ParkingMeters'; group.add(furnitureGroup);
  const ownedMaterials = new Set<THREE.Material>();
  const activity = createActivityProfile(city);
  let seed = 21761;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const metro = isMetroCity(city) ? city : undefined, covered = coverageTester(city);
  const segments: Segment[] = [], segmentCells = new Map<string, Segment[]>();
  for (const road of city.roads.filter(r=>!r.elevations)) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i], length = gap(a, b);
    if (length <= .2) continue;
    const segment = { road, a, b, length, tx: (b[0] - a[0]) / length, tz: (b[1] - a[1]) / length, index: i }; segments.push(segment);
    const key = `${Math.floor((a[0] + b[0]) / 256)},${Math.floor((a[1] + b[1]) / 256)}`, list = segmentCells.get(key); if (list) list.push(segment); else segmentCells.set(key, [segment]);
  }
  /** Segments whose midpoint lies within `radius` (by 128 m cell), or all of them. */
  const segmentsNear = (x: number, z: number, radius: number) => {
    if (!Number.isFinite(radius)) return segments;
    const result: Segment[] = [];
    for (let cx = Math.floor((x - radius) / 128); cx <= Math.floor((x + radius) / 128); cx++) for (let cz = Math.floor((z - radius) / 128); cz <= Math.floor((z + radius) / 128); cz++) for (const s of segmentCells.get(`${cx},${cz}`) ?? []) if (Math.hypot((s.a[0] + s.b[0]) / 2 - x, (s.a[1] + s.b[1]) / 2 - z) <= radius) result.push(s);
    return result;
  };
  // Reserve the tree and lamp bands used by world.ts. Including potential
  // tree sites that were randomly omitted keeps these walking routes robust.
  const streetObstacles: Point2[] = [];
  for (const segment of segments) {
    if (segment.road.width < 8) continue;
    for (let d = 14; d < segment.length - 8; d += 25) for (const side of [-1, 1]) {
      const offset = side * (paved(segment.road) / 2 + 2);
      const x = segment.a[0] + segment.tx * d - segment.tz * offset;
      const z = segment.a[1] + segment.tz * d + segment.tx * offset;
      streetObstacles.push([x, z]);
      if (side === 1) streetObstacles.push([x - segment.tx * 5, z - segment.tz * 5]);
    }
  }
  type Footprint = { points: Point2[]; minX: number; maxX: number; minZ: number; maxZ: number };
  const footprints: Footprint[] = metro ? [] : city.buildings.map(building => ({
    points: building.footprint,
    minX: Math.min(...building.footprint.map(p => p[0])), maxX: Math.max(...building.footprint.map(p => p[0])),
    minZ: Math.min(...building.footprint.map(p => p[1])), maxZ: Math.max(...building.footprint.map(p => p[1])),
  }));
  // A metro answers from its hull index whether or not the tile is loaded.
  const nearFootprints: (p: Point2) => Footprint[] = metro ? p => metro.index.query(p[0] - 3, p[0] + 3, p[1] - 3, p[1] + 3).map(b => ({ points: b.footprint, minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ })) : spatialIndex(footprints,p=>[p.minX,p.minZ,p.maxX,p.maxZ],3);
  const nearSegments=spatialIndex(segments,s=>[Math.min(s.a[0],s.b[0])-paved(s.road)/2,Math.min(s.a[1],s.b[1])-paved(s.road)/2,Math.max(s.a[0],s.b[0])+paved(s.road)/2,Math.max(s.a[1],s.b[1])+paved(s.road)/2],3);
  const nearObstacles=spatialIndex(streetObstacles,p=>[p[0],p[1],p[0],p[1]],1);
  const inBounds = ([x, z]: Point2, margin = 5) => x > city.bounds.minX + margin && x < city.bounds.maxX - margin && z > city.bounds.minZ + margin && z < city.bounds.maxZ - margin && covered(x, z);
  function buildingClear(p: Point2, clearance: number) {
    return nearFootprints(p).every(footprint => {
      if (p[0] < footprint.minX - clearance || p[0] > footprint.maxX + clearance || p[1] < footprint.minZ - clearance || p[1] > footprint.maxZ + clearance) return true;
      return !pointInside(p, footprint.points) && footprint.points.every((a, i, points) => pointSegment(p, a, points[(i + 1) % points.length]) > clearance);
    });
  }
  // The Commonwealth Avenue Mall is a fenced lawn with no sidewalk along the avenue: its walkers keep to the centre walk (below).
  const onMallLawn = mallGroundTest(city.parks ?? [], 0);
  function sidewalkClear(p: Point2, clearance = .42) {
    return !onMallLawn(p[0], p[1]) && !inTransitCorridor(city,...p) && !inTunnelApproach(city,...p) && inBounds(p) && buildingClear(p, clearance) && sampleTerrainNormal(city,p[0],p[1]).y>.75 && nearObstacles(p).every(obstacle => gap(p, obstacle) > .76) && nearSegments(p).every(segment => pointSegment(p, segment.a, segment.b) > paved(segment.road) / 2 + clearance);
  }

  // Sidewalk stretches are verified per segment the first time a neighborhood
  // asks for them, so a metro never walks every street up front.
  const segmentRoutes = new Map<Segment, WalkRoute[]>();
  function routesFor(segment: Segment): WalkRoute[] {
    const cached = segmentRoutes.get(segment); if (cached) return cached;
    const routes: WalkRoute[] = []; segmentRoutes.set(segment, routes);
    if (segment.road.width < 7 || /alley|unnamed|private|ring road|cahners|copley place/i.test(segment.road.name) || segment.length < 20) return routes;
    for (const side of [-1, 1]) {
      let best: WalkRoute[] = [], bestLength=0;
      for (const setback of [1.1, 1.65, 2.2]) {
        const stretches:WalkRoute[]=[];
        const offset = side * (paved(segment.road) / 2 + setback);
        let start: Point2 | undefined, previous: Point2 | undefined;
        const finish = () => {
          if (start && previous && gap(start, previous) >= 8) {
            stretches.push({ road: segment.road.name, start, end: previous, length: gap(start, previous), yaw: Math.atan2(segment.tx, segment.tz) });
          }
          start = previous = undefined;
        };
        const endMargin=segment.length<45?5:9;
        for (let d = endMargin; d <= segment.length - endMargin; d += .75) {
          const p: Point2 = [segment.a[0] + segment.tx * d - segment.tz * offset, segment.a[1] + segment.tz * d + segment.tx * offset];
          if (sidewalkClear(p, .45)) { start ??= p; previous = p; } else finish();
        }
        finish();
        const length=stretches.reduce((sum,route)=>sum+route.length,0);
        if(length>bestLength){best=stretches;bestLength=length;}
      }
      for(const route of best)pieces(route,routes);
    }
    return routes;
  }
  // A long sidewalk can support several walkers. Give each its own clear
  // stretch, separated by a small gap, so opposing walkers never overlap.
  function pieces(route:WalkRoute,routes:WalkRoute[]){
    const count=Math.max(1,Math.floor(route.length/22)),span=route.length/count;
    for(let part=0;part<count;part++){
      const begin=(part*span+.7)/route.length,end=((part+1)*span-.7)/route.length;
      const a:Point2=[lerp(route.start[0],route.end[0],begin),lerp(route.start[1],route.end[1],begin)];
      const b:Point2=[lerp(route.start[0],route.end[0],end),lerp(route.start[1],route.end[1],end)];
      routes.push({...route,start:a,end:b,length:gap(a,b)});
    }
  }
  const routeCenter=(route:WalkRoute):Point2=>[(route.start[0]+route.end[0])/2,(route.start[1]+route.end[1])/2];
  const nearestStreet=(x:number,z:number)=>closestRoad(city,x,z).road?.name??'';

  // Park paths are walked as well: the straight stretches of each mapped path (a walker paces one line), checked
  // like a sidewalk and for water besides. A route takes the name of the street nearest it, so the walks beside
  // the street the player is on fill with that street's sidewalks. Water is tested by its source basins: the
  // harbour and rivers are one outline of 8,000 points across the whole metro.
  type Box = { minX: number; maxX: number; minZ: number; maxZ: number };
  const boxOf = (ring: Point2[]): Box => { let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity; for (const [x, z] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); } return { minX, maxX, minZ, maxZ }; };
  const waters = (city.water ?? []).flatMap(w => w.surfaces?.length ? w.surfaces.map(surface => surface.rings) : [w.rings]).filter(rings => rings[0]?.length >= 3).map(rings => ({ rings, ...boxOf(rings[0]) }));
  // A pond is found by cell; a basin kilometres across would fill thousands of cells, and there are few of them.
  const broad = waters.filter(w => (w.maxX - w.minX) * (w.maxZ - w.minZ) > 250000), nearPonds = spatialIndex(waters.filter(w => !broad.includes(w)), w => [w.minX, w.minZ, w.maxX, w.maxZ], 1);
  const inWater = (p: Point2, w: typeof waters[number]) => p[0] >= w.minX && p[0] <= w.maxX && p[1] >= w.minZ && p[1] <= w.maxZ && pointInside(p, w.rings[0]) && !w.rings.slice(1).some(hole => pointInside(p, hole));
  const wet = (p: Point2) => nearPonds(p).some(w => inWater(p, w)) || broad.some(w => inWater(p, w));
  function pathClear(p: Point2) {
    return !inTransitCorridor(city,...p) && !inTunnelApproach(city,...p) && inBounds(p) && buildingClear(p, .45) && sampleTerrainNormal(city,p[0],p[1]).y>.75 && nearObstacles(p).every(obstacle => gap(p, obstacle) > .76) && nearSegments(p).every(segment => pointSegment(p, segment.a, segment.b) > paved(segment.road) / 2 + .45) && !wet(p);
  }
  /** The clear parts of a straight stretch, at least 8 m each, as one walker's pieces. */
  function walkable(stretch: WalkStretch, routes: WalkRoute[]) {
    const length = gap(stretch.start, stretch.end), tx = (stretch.end[0] - stretch.start[0]) / length, tz = (stretch.end[1] - stretch.start[1]) / length;
    let start: Point2 | undefined, previous: Point2 | undefined;
    const finish = () => {
      if (start && previous && gap(start, previous) >= 8) pieces({ road: nearestStreet((start[0] + previous[0]) / 2, (start[1] + previous[1]) / 2), start, end: previous, length: gap(start, previous), yaw: Math.atan2(tx, tz), park: true }, routes);
      start = previous = undefined;
    };
    for (let d = 0; d <= length; d += .75) { const p: Point2 = [stretch.start[0] + tx * d, stretch.start[1] + tz * d]; if (pathClear(p)) { start ??= p; previous = p; } else finish(); }
    finish();
  }
  const onMall = mallPathTest(city.parks ?? []), pathRoutes = new Map<string, WalkRoute[]>();
  /** Verified the first time a neighborhood asks, and kept by the path's id: a tile that streams in again brings the same paths. */
  function routesForPath(path: ParkPath): WalkRoute[] {
    const cached = pathRoutes.get(path.id); if (cached) return cached;
    const routes: WalkRoute[] = []; pathRoutes.set(path.id, routes);
    // A footbridge has a deck of its own; a planned block of the Commonwealth Avenue Mall has its walk's two files (below).
    const mall = onMall(path); if (path.bridge || path.points.length < 2 || mall === 'block') return routes;
    const width = mall ? Math.min(path.width, 6.3) : path.width;
    for (const points of outsideGreenwayPath(path.points)) for (const lane of pathLaneOffsets(width)) for (const stretch of straightRuns(offsetLine(points, lane), laneTolerance(width, lane))) walkable(stretch, routes);
    return routes;
  }
  let mallRoutes: WalkRoute[] | undefined;
  const mallWalks = () => { if (!mallRoutes) { mallRoutes = []; if ((city.parks ?? []).some(isCommonwealthMall)) for (const stretch of mallWalkLanes()) walkable(stretch, mallRoutes); } return mallRoutes; };
  type PathEntry = Box & { path: ParkPath };
  const boxed = (paths: readonly ParkPath[]): PathEntry[] => paths.filter(path => path.points.length >= 2).map(path => ({ path, ...boxOf(path.points) }));
  const cityPaths = boxed(city.parkPaths ?? []), tilePaths = new WeakMap<object, PathEntry[]>();
  function parkRoutesNear(x: number, z: number, radius: number, result: WalkRoute[]) {
    const reach = radius + 60, within = (route: WalkRoute) => !Number.isFinite(reach) || gap(routeCenter(route), [x, z]) <= reach;
    const collect = (entries: PathEntry[]) => { for (const entry of entries) { if (Number.isFinite(reach) && (entry.minX > x + reach || entry.maxX < x - reach || entry.minZ > z + reach || entry.maxZ < z - reach)) continue; for (const route of routesForPath(entry.path)) if (within(route)) result.push(route); } };
    // A metro lists no paths of its own: they arrive with its tiles.
    if (!options.tiles) collect(cityPaths);
    for (const built of options.tiles?.loaded.values() ?? []) { let entries = tilePaths.get(built.tile); if (!entries) tilePaths.set(built.tile, entries = boxed(built.tile.parkPaths)); collect(entries); }
    for (const route of mallWalks()) if (within(route)) result.push(route);
  }
  const routesNear = (x: number, z: number, radius: number) => { const result: WalkRoute[] = []; for (const segment of segmentsNear(x, z, Number.isFinite(radius) ? radius + 60 : radius)) result.push(...routesFor(segment)); parkRoutesNear(x, z, radius, result); return result; };
  const spawnStreet=nearestStreet(city.spawn.x,city.spawn.z);
  // Spend most of the bounded pool on the neighborhood around the camera. The
  // rest remains distributed on busy sidewalks and can follow later map trips.
  // A metro only considers the surrounding kilometre and a half for that reserve.
  const ranked = routesNear(city.spawn.x, city.spawn.z, metro ? 1400 : Infinity).map(route => {
    const point=routeCenter(route),distance=gap(point,[city.spawn.x,city.spawn.z]);
    return {route,distance,score:distance+(route.road===spawnStreet?-90:0)-(route.park?PARK_DRAW:0)+random()*24,activity:activity(...point)};
  }).sort((a,b)=>a.score-b.score);
  const initialTarget=activity(city.spawn.x,city.spawn.z).pedestrians;
  const localRoutes=ranked.filter(r=>r.distance<330).slice(0,initialTarget);
  const distantRoutes=ranked.filter(r=>r.distance>600).sort((a,b)=>(a.activity.level==='busy'?-1500:0)+a.distance-(b.activity.level==='busy'?-1500:0)-b.distance);
  const pedestrians: StreetPedestrian[] = [];
  for (const { route } of [...localRoutes,...distantRoutes]) {
    if (pedestrians.length >= PEDESTRIAN_CAPACITY) break;
    const speed=.87+random()*.42,t=.2+random()*.6,phase=t*route.length/speed;
    const x=lerp(route.start[0],route.end[0],t),z=lerp(route.start[1],route.end[1],t);
    const position = new THREE.Vector3(x, sampleElevation(city,x,z)+.035, z);
    if (pedestrians.some(person => person.position.distanceTo(position) < 2.5)) continue;
    pedestrians.push({ id: pedestrians.length, road: route.road, start: route.start, end: route.end, route, position,
      yaw: route.yaw, speed, height: .94 + random() * .11, width: .93 + random() * .15,
      phase, bag: random() < .42, scarf: random() < .28, outfit:pedestrians.length%5 });
  }

  const count = pedestrians.length;
  const pedestrianModel = createPedestrianModel(peopleGroup,pedestrians,ownedMaterials,{mainCamera:options.camera});
  const shown = new Uint8Array(count), viewFrustum = new THREE.Frustum(), viewMatrix = new THREE.Matrix4(), reach = new THREE.Sphere(new THREE.Vector3(), WALKER_REACH), poseHidden = options.poseHidden ?? true;

  const parked: ParkedVehicle[] = [];
  const candidates: { segment: Segment; x: number; z: number; side: number; yaw: number; score: number }[] = [];
  // Kerbside parking: the original streets in the survey, or in a metro any named
  // street or avenue of parking width within reach of the spawn.
  const parkable = (road: Road) => metro ? road.width >= 9.5 && road.width <= 15 && /\b(Street|Avenue)$/.test(road.name) : /^(Boylston|Dartmouth|Parker|Tremont|Wigglesworth|Calumet|Saint Alphonsus|Smith|Worthington) Street$/.test(road.name) && road.width >= 9.5;
  for (const segment of segmentsNear(city.spawn.x, city.spawn.z, metro ? 700 : Infinity)) {
    if (!parkable(segment.road)) continue;
    for (let d = 21; d < segment.length - 21; d += 18) for (const side of [-1, 1]) {
      const offset = side * (paved(segment.road) / 2 - 1.1);
      const x = segment.a[0] + segment.tx * d - segment.tz * offset, z = segment.a[1] + segment.tz * d + segment.tx * offset;
      // The worksite reserves both its closed lane and the passing lane. A
      // parked car beside the cones must not narrow that remaining corridor.
      if (constructionZones.some(zone => {
        const dx=x-zone.x,dz=z-zone.z,sin=Math.sin(zone.yaw),cos=Math.cos(zone.yaw);
        return Math.abs(dx*sin+dz*cos)<zone.length/2+8 && Math.abs(dx*cos-dz*sin)<zone.pavedWidth/2+2 &&
          Math.abs(sampleRoadElevation(city,zone.road,x,z)-sampleElevation(city,x,z))<2;
      })) continue;
      const direction = segment.road.oneway || side;
      const yaw = Math.atan2(segment.tx * direction, segment.tz * direction);
      candidates.push({ segment, x, z, side, yaw, score: Math.hypot(x - city.spawn.x, z - city.spawn.z) + random() * 250 });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  for (const candidate of spreadByBlock(candidates,c=>[c.x,c.z])) {
    if (parked.length >= 8) break;
    const { x, z, yaw, segment, side } = candidate;
    if (Math.hypot(x - city.spawn.x, z - city.spawn.z) < 42 || parked.some(vehicle => Math.hypot(vehicle.x - x, vehicle.z - z) < 42)) continue;
    const forward: Point2 = [Math.sin(yaw), Math.cos(yaw)], right: Point2 = [-forward[1], forward[0]];
    const spec=npcVehicleAt(parked.length),halfWidth=spec.width/2+.12,halfLength=spec.length/2+.16;
    const samples: Point2[] = [[x, z]];
    for (const width of [-halfWidth, halfWidth]) for (const length of [-halfLength, 0, halfLength]) samples.push([x + right[0] * width + forward[0] * length, z + right[1] * width + forward[1] * length]);
    if (!samples.every(p => inBounds(p, 12) && !inTunnelApproach(city,...p) && buildingClear(p, .45) && nearSegments(p).every(other => other.road.id === segment.road.id || pointSegment(p, other.a, other.b) > paved(other.road) / 2 + 2))) continue;
    const meterOffset = side * (paved(segment.road) / 2 + .65);
    const meter: Point2 = [segment.a[0] + segment.tx * ((x - segment.a[0]) * segment.tx + (z - segment.a[1]) * segment.tz + 2) - segment.tz * meterOffset,
      segment.a[1] + segment.tz * ((x - segment.a[0]) * segment.tx + (z - segment.a[1]) * segment.tz + 2) + segment.tx * meterOffset];
    parked.push({ type:spec.type,mass:spec.mass,id: parked.length, road: segment.road.name, x, y:sampleElevation(city,x,z), z, yaw, meter: sidewalkClear(meter, .25) ? meter : null });
  }
  const parkedFleet=createNPCVehicleBatches(parkedGroup,Math.max(1,parked.length),options.mobile);
  const parkedBodies:(RAPIER.RigidBody|undefined)[]=[],colliders:RAPIER.Collider[]=[],parkedColors:THREE.Color[]=[];
  const dummy=new THREE.Object3D(),parkedLift=new THREE.Vector3();
  for(const [i,vehicle] of parked.entries()){
    const spec=NPC_VEHICLES.find(spec=>spec.type===vehicle.type)!,normal=sampleTerrainNormal(city,vehicle.x,vehicle.z),q=terrainRotation(city,vehicle.x,vehicle.z,vehicle.yaw);
    parkedFleet.bind(i,spec.type);vehicle.registration=parkedFleet.registration(i);parkedColors.push(new THREE.Color(npcPaint(spec)));
    dummy.position.set(vehicle.x+normal.x*NPC_BODY_LIFT,vehicle.y+normal.y*NPC_BODY_LIFT,vehicle.z+normal.z*NPC_BODY_LIFT);dummy.quaternion.set(q.x,q.y,q.z,q.w);
    if(physics){
      const body=physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...dummy.position.toArray()).setRotation(q).setLinearDamping(.6).setAngularDamping(.8).setCanSleep(true));
      colliders.push(...createNPCVehicleColliders(physics.world,body,spec));body.sleep();parkedBodies.push(body);
    }else parkedBodies.push(undefined);
  }
  const parkedPoses=parkedBodies.map(body=>body?{position:body.translation(),rotation:body.rotation()}:undefined),parkedSuspended=new Set<number>();
  function updateParked(observer?:{x:number;z:number}){
    for(const [i,vehicle] of parked.entries()){
      const body=parkedBodies[i];
      if(body&&physics?.streaming){
        const p=body.translation(),ground=sampleElevation(city,p.x,p.z);
        const support=physics.world.castRay(new RAPIER.Ray({x:p.x,y:ground+2,z:p.z},{x:0,y:-1,z:0}),4,true,undefined,undefined,undefined,body,c=>physics.terrainColliders.has(c.handle));
        // Tile disposal wakes sleeping bodies. Freeze at the last supported
        // pose until physical ground returns; sampled elevation alone cannot
        // keep a dynamic car from falling through an unloaded neighborhood.
        if(!support&&!parkedSuspended.has(i)){
          const pose=parkedPoses[i]!;body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased,true);body.setTranslation(pose.position,false);body.setRotation(pose.rotation,false);
          body.setLinvel({x:0,y:0,z:0},false);body.setAngvel({x:0,y:0,z:0},false);body.setNextKinematicTranslation(pose.position);body.setNextKinematicRotation(pose.rotation);parkedSuspended.add(i);
        }else if(support&&parkedSuspended.delete(i)){body.setBodyType(RAPIER.RigidBodyType.Dynamic,true);body.sleep();}
        if(support)parkedPoses[i]={position:body.translation(),rotation:body.rotation()};
      }
      if(body){const p=body.translation(),q=body.rotation();dummy.position.set(p.x,p.y,p.z);dummy.quaternion.set(q.x,q.y,q.z,q.w);}
      else{const n=sampleTerrainNormal(city,vehicle.x,vehicle.z),q=terrainRotation(city,vehicle.x,vehicle.z,vehicle.yaw);dummy.position.set(vehicle.x+n.x*NPC_BODY_LIFT,vehicle.y+n.y*NPC_BODY_LIFT,vehicle.z+n.z*NPC_BODY_LIFT);dummy.quaternion.set(q.x,q.y,q.z,q.w);}
      parkedLift.set(0,NPC_BODY_LIFT,0).applyQuaternion(dummy.quaternion);dummy.position.sub(parkedLift);dummy.updateMatrix();
      vehicle.x=dummy.position.x;vehicle.y=dummy.position.y;vehicle.z=dummy.position.z;
      parkedFleet.draw(i,dummy.matrix,parkedColors[i],observer?Math.hypot(vehicle.x-observer.x,vehicle.z-observer.z):0);
    }
    parkedFleet.flush();
  }
  const meters = parked.filter(vehicle => vehicle.meter);
  if (meters.length) {
    const iron = new THREE.MeshStandardMaterial({ color: 0x344544, metalness: .45, roughness: .5 });
    const face = new THREE.MeshStandardMaterial({ color: 0xbac4bb, metalness: .25, roughness: .37 }); ownedMaterials.add(iron); ownedMaterials.add(face);
    const parts = [
      { geometry: new THREE.CylinderGeometry(.032, .042, 1.1, 7), material: iron, y: .55 },
      { geometry: new THREE.BoxGeometry(.17, .25, .13), material: iron, y: 1.21 },
      { geometry: new THREE.BoxGeometry(.11, .10, .135), material: face, y: 1.25 },
    ];
    for (const part of parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, meters.length); mesh.castShadow = true; mesh.receiveShadow = true;
      meters.forEach((vehicle, i) => { dummy.position.set(vehicle.meter![0],sampleElevation(city,...vehicle.meter!)+part.y, vehicle.meter![1]); dummy.rotation.set(0, vehicle.yaw, 0); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); });
      furnitureGroup.add(mesh);
    }
  }

  let elapsed = 0,relocationTime=0,relocations=0;
  function population(observer:{x:number;z:number}){
    const profile=activity(observer.x,observer.z);
    return {level:profile.level,target:profile.pedestrians,
      local:pedestrians.filter(p=>Math.hypot(p.position.x-observer.x,p.position.z-observer.z)<350).length,
      nearby:pedestrians.filter(p=>Math.hypot(p.position.x-observer.x,p.position.z-observer.z)<125).length,total:pedestrians.length};
  }
  function refill(observer:{x:number;z:number},player?:{x:number;z:number},immediate=false){
    const {local,target}=population(observer);if(local>=target)return;
    const street=nearestStreet(observer.x,observer.z),minDistance=immediate?30:125;
    const available=routesNear(observer.x,observer.z,320).map(route=>{
      const point=routeCenter(route),distance=Math.hypot(point[0]-observer.x,point[1]-observer.z);
      return {route,distance,score:distance+(route.road===street?-90:0)-(route.park?PARK_DRAW:0)+random()*35};
    }).filter(({route,distance})=>distance>minDistance&&distance<320&&!pedestrians.some(p=>p.route===route)).sort((a,b)=>a.score-b.score);
    const distant=pedestrians.filter(p=>Math.hypot(p.position.x-observer.x,p.position.z-observer.z)>600&&(!player||Math.hypot(p.position.x-player.x,p.position.z-player.z)>20));
    let moved=0;
    for(const {route} of available){
      if(moved>=Math.min(target-local,immediate?PEDESTRIAN_CAPACITY:4)||moved>=distant.length)break;
      const t=.2+random()*.6,x=lerp(route.start[0],route.end[0],t),z=lerp(route.start[1],route.end[1],t);
      if(Math.hypot(x-observer.x,z-observer.z)<minDistance||Math.hypot(x-observer.x,z-observer.z)>330||
        (player&&Math.hypot(x-player.x,z-player.z)<10)||pedestrians.some(p=>Math.hypot(p.position.x-x,p.position.z-z)<2.5))continue;
      const person=distant[moved++];
      person.route=route;person.road=route.road;person.start=route.start;person.end=route.end;
      person.phase=-elapsed+t*route.length/person.speed;person.yaw=route.yaw;
      person.knocked=undefined;person.orientation=undefined;person.sprawl=0;person.rejoin=undefined;
      person.position.set(x,sampleElevation(city,x,z)+.035,z);relocations++;
    }
  }
  // Map teleports replace the whole view, so populate that new scene at once.
  // Ordinary travel uses the protected outer ring to avoid nearby appearances.
  function populateAt(observer:{x:number;z:number},player?:{x:number;z:number}){refill(observer,player,true);}
  const hits:number[]=[];
  function knockDown(person:StreetPedestrian,threat:WalkerThreat,across:number){
    person.knocked=startKnock({x:person.position.x,y:person.position.y-.035,z:person.position.z},person.yaw,person.height,threat,across,random);
    person.sprawl=1;person.rejoin=undefined;hits.push(Math.abs(threat.speed??0));
  }
  /** Rejoin the nearest sidewalk stretch from where the walker got up: their own
   * route if still beside it, else the closest one nearby; the offset fades out. */
  function resumeWalking(person:StreetPedestrian,x:number,z:number){
    const along=(route:WalkRoute)=>{const dx=route.end[0]-route.start[0],dz=route.end[1]-route.start[1],t=Math.max(0,Math.min(1,((x-route.start[0])*dx+(z-route.start[1])*dz)/(dx*dx+dz*dz||1)));return {t,distance:Math.hypot(x-route.start[0]-dx*t,z-route.start[1]-dz*t)};};
    let route=person.route,best=along(route);
    if(best.distance>5)for(const other of routesNear(x,z,60)){const fit=along(other);if(fit.distance<best.distance&&!pedestrians.some(p=>p!==person&&p.route===other)){route=other;best=fit;}}
    person.route=route;person.road=route.road;person.start=route.start;person.end=route.end;
    person.phase=-elapsed+best.t*route.length/person.speed;person.yaw=route.yaw;
    person.rejoin={dx:x-lerp(route.start[0],route.end[0],best.t),dz:z-lerp(route.start[1],route.end[1],best.t),t:0};
  }
  const groundAt=(x:number,z:number)=>sampleElevation(city,x,z);
  function updateKnocked(person:StreetPedestrian,k:KnockedDown,dt:number){
    const step=stepKnock(k,dt,person.height,groundAt,()=>{resumeWalking(person,k.hip.x,k.hip.z);return person.yaw;},random,person.position);
    person.sprawl=step.sprawl;
    if(step.done){person.knocked=undefined;person.orientation=undefined;person.sprawl=0;}else person.orientation=k.orientation;
  }
  function update(dt: number, time?: number,observer?:{x:number;z:number;y?:number},player?:WalkerThreat) {
    updateParked(observer);
    elapsed = time ?? elapsed + Math.max(0, Math.min(.1, dt));
    relocationTime+=Math.max(0,dt);
    if(observer&&relocationTime>.3){
      relocationTime=0;
      refill(observer,player);
    }
    const step=Math.max(0,Math.min(.1,dt)),view=options.camera;
    if(view){view.updateMatrixWorld();viewFrustum.setFromProjectionMatrix(viewMatrix.multiplyMatrices(view.projectionMatrix,view.matrixWorldInverse),view.coordinateSystem,(view as THREE.Camera&{reversedDepth?:boolean}).reversedDepth);}
    // Whether this walker reaches the main view, and so whether it is drawn there (and, on a phone, posed at all).
    const inView=(i:number,person:StreetPedestrian)=>{reach.center.copy(person.position);reach.center.y+=1;const visible=!view||viewFrustum.intersectsSphere(reach);shown[i]=visible?1:0;return visible||poseHidden;};
    pedestrianModel.begin();
    pedestrians.forEach((person, i) => {
      const route = person.route, travel = route.length / person.speed, turn = 1.45, cycle = 2 * (travel + turn);
      if(step>0&&!person.knocked&&player){
        // Inside the moving vehicle's footprint (plus a bumper margin) at its level.
        const across=struckBy(person.position.x,person.position.y,person.position.z,player);
        if(across!==undefined)knockDown(person,player,across);
      }
      if(person.knocked){
        updateKnocked(person,person.knocked,step);
        if(person.knocked){if(inView(i,person))pedestrianModel.pose(i,person,0,0,dt,!observer||Math.hypot(person.position.x-observer.x,person.position.z-observer.z)<65);return;}
      }
      const clock = ((elapsed + person.phase) % cycle+cycle)%cycle;
      let along = 0, yaw = route.yaw, walking = 1;
      if (clock < travel) along = clock * person.speed;
      else if (clock < travel + turn) {
        const t = (clock - travel) / turn; along = route.length; yaw += Math.PI * (t * t * (3 - 2 * t)); walking = 0;
      } else if (clock < 2 * travel + turn) { along = route.length - (clock - travel - turn) * person.speed; yaw += Math.PI; }
      else { const t = (clock - 2 * travel - turn) / turn; yaw += Math.PI * (1 + t * t * (3 - 2 * t)); walking = 0; }
      if(player&&Math.hypot(person.position.x-player.x,person.position.z-player.z)<3.4&&Math.abs(player.speed??0)>.5){person.phase-=Math.max(0,dt);walking=0;along=Math.max(0,Math.min(route.length,((person.position.x-route.start[0])*Math.sin(route.yaw)+(person.position.z-route.start[1])*Math.cos(route.yaw))));}
      person.yaw = yaw;
      let x=lerp(route.start[0],route.end[0],along/route.length),z=lerp(route.start[1],route.end[1],along/route.length);
      if(person.rejoin){const rejoin=person.rejoin;rejoin.t+=step;const fade=1-smooth(Math.min(1,rejoin.t/1.6));x+=rejoin.dx*fade;z+=rejoin.dz*fade;if(fade<=0)person.rejoin=undefined;}
      person.position.set(x,sampleElevation(city,x,z)+.035,z);
      // Unfold both route directions into continuous traveled distance; the
      // animation holds its phase during endpoint turns and vehicle pauses.
      const laps=Math.floor((elapsed+person.phase)/cycle);
      const walked=clock<travel?clock*person.speed:clock<travel+turn?route.length:
        clock<2*travel+turn?route.length+(clock-travel-turn)*person.speed:2*route.length;
      if(inView(i,person))pedestrianModel.pose(i,person,laps*route.length*2+walked,walking,dt,!observer||Math.hypot(x-observer.x,z-observer.z)<65);
    });
    pedestrianModel.flush(view?shown:undefined);
  }
  update(0, 0);
  return {
    group, pedestrians, parked, count, parkedCount: parked.length, meterCount: meters.length, update,populateAt,population,get relocations(){return relocations;},
    /** Vehicle speeds of the walkers struck since the previous call; the caller plays their sounds. */
    takeHits(){return hits.splice(0,hits.length);},
    /** Collider handles of the kerbside parked cars, so an impact can be classified as a vehicle. */
    parkedColliders:new Set(colliders.map(collider=>collider.handle)),
    setNight:parkedFleet.setNight,
    dispose() {
      pedestrianModel.dispose();parkedFleet.dispose();
      if (physics) for (const body of parkedBodies) if(body)physics.world.removeRigidBody(body);
      group.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
      ownedMaterials.forEach(material => {if(material instanceof THREE.MeshStandardMaterial)material.map?.dispose();material.dispose();}); scene.remove(group);
    },
  };
}
