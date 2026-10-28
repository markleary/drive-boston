import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { CityData, Point2, Road } from '../types';
import type { DrivingPhysics } from '../physics/vehicle';
import { closestRoad, pointInside } from '../simulation/roads.ts';
import { isMetroCity } from '../simulation/city-tiles.ts';
import { coverageTester } from '../simulation/coverage.ts';
import { createVehicleGeometry, createVehiclePlateGeometry, createMassachusettsPlateMaterial } from './car.ts';
import type { VehicleSurface } from './car.ts';
import { sampleElevation, sampleTerrainNormal, terrainRotation } from '../simulation/terrain.ts';
import { inTransitCorridor } from '../simulation/transit-corridors.ts';
import { createActivityProfile } from '../simulation/activity.ts';
import { createPedestrianModel } from './pedestrian-model.ts';

interface Segment { road: Road; a: Point2; b: Point2; length: number; tx: number; tz: number; index: number; }
interface WalkRoute { road: string; start: Point2; end: Point2; length: number; yaw: number; }
const PEDESTRIAN_CAPACITY = 112;
export interface StreetPedestrian {
  id: number; road: string; start: Point2; end: Point2; position: THREE.Vector3; yaw: number;
  speed: number; height: number; phase: number; route: WalkRoute; width: number; bag: boolean; scarf: boolean;
  pauseUntil?:number; outfit?:number;
}
export interface ParkedVehicle { id: number; road: string; x: number; y: number; z: number; yaw: number; meter: Point2 | null; }
const gap = (a: Point2, b: Point2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const lerp = THREE.MathUtils.lerp;
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

/** Ambient walkers follow verified sidewalk stretches; they do not enter traffic. */
export function createStreetLife(scene: THREE.Scene, city: CityData, physics?: DrivingPhysics) {
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
      const offset = side * (segment.road.width / 2 + 2);
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
  const nearSegments=spatialIndex(segments,s=>[Math.min(s.a[0],s.b[0])-s.road.width/2,Math.min(s.a[1],s.b[1])-s.road.width/2,Math.max(s.a[0],s.b[0])+s.road.width/2,Math.max(s.a[1],s.b[1])+s.road.width/2],3);
  const nearObstacles=spatialIndex(streetObstacles,p=>[p[0],p[1],p[0],p[1]],1);
  const inBounds = ([x, z]: Point2, margin = 5) => x > city.bounds.minX + margin && x < city.bounds.maxX - margin && z > city.bounds.minZ + margin && z < city.bounds.maxZ - margin && covered(x, z);
  function buildingClear(p: Point2, clearance: number) {
    return nearFootprints(p).every(footprint => {
      if (p[0] < footprint.minX - clearance || p[0] > footprint.maxX + clearance || p[1] < footprint.minZ - clearance || p[1] > footprint.maxZ + clearance) return true;
      return !pointInside(p, footprint.points) && footprint.points.every((a, i, points) => pointSegment(p, a, points[(i + 1) % points.length]) > clearance);
    });
  }
  function sidewalkClear(p: Point2, clearance = .42) {
    return !inTransitCorridor(city,...p) && inBounds(p) && buildingClear(p, clearance) && sampleTerrainNormal(city,p[0],p[1]).y>.75 && nearObstacles(p).every(obstacle => gap(p, obstacle) > .76) && nearSegments(p).every(segment => pointSegment(p, segment.a, segment.b) > segment.road.width / 2 + clearance);
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
        const offset = side * (segment.road.width / 2 + setback);
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
      // A long sidewalk can support several walkers. Give each its own clear
      // stretch, separated by a small gap, so opposing walkers never overlap.
      for(const route of best){
        const pieces=Math.max(1,Math.floor(route.length/22)),span=route.length/pieces;
        for(let part=0;part<pieces;part++){
          const begin=(part*span+.7)/route.length,end=((part+1)*span-.7)/route.length;
          const a:Point2=[lerp(route.start[0],route.end[0],begin),lerp(route.start[1],route.end[1],begin)];
          const b:Point2=[lerp(route.start[0],route.end[0],end),lerp(route.start[1],route.end[1],end)];
          routes.push({...route,start:a,end:b,length:gap(a,b)});
        }
      }
    }
    return routes;
  }
  const routesNear = (x: number, z: number, radius: number) => { const result: WalkRoute[] = []; for (const segment of segmentsNear(x, z, Number.isFinite(radius) ? radius + 60 : radius)) result.push(...routesFor(segment)); return result; };
  const routeCenter=(route:WalkRoute):Point2=>[(route.start[0]+route.end[0])/2,(route.start[1]+route.end[1])/2];
  const nearestStreet=(x:number,z:number)=>closestRoad(city,x,z).road?.name??'';
  const spawnStreet=nearestStreet(city.spawn.x,city.spawn.z);
  // Spend most of the bounded pool on the neighborhood around the camera. The
  // rest remains distributed on busy sidewalks and can follow later map trips.
  // A metro only considers the surrounding kilometre and a half for that reserve.
  const ranked = routesNear(city.spawn.x, city.spawn.z, metro ? 1400 : Infinity).map(route => {
    const point=routeCenter(route),distance=gap(point,[city.spawn.x,city.spawn.z]);
    return {route,distance,score:distance+(route.road===spawnStreet?-90:0)+random()*24,activity:activity(...point)};
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
  const pedestrianModel = createPedestrianModel(peopleGroup,pedestrians,ownedMaterials);

  const parked: ParkedVehicle[] = [];
  const candidates: { segment: Segment; x: number; z: number; side: number; yaw: number; score: number }[] = [];
  // Kerbside parking: the original streets in the survey, or in a metro any named
  // street or avenue of parking width within reach of the spawn.
  const parkable = (road: Road) => metro ? road.width >= 9.5 && road.width <= 15 && /\b(Street|Avenue)$/.test(road.name) : /^(Boylston|Dartmouth|Parker|Tremont|Wigglesworth|Calumet|Saint Alphonsus|Smith|Worthington) Street$/.test(road.name) && road.width >= 9.5;
  for (const segment of segmentsNear(city.spawn.x, city.spawn.z, metro ? 700 : Infinity)) {
    if (!parkable(segment.road)) continue;
    for (let d = 21; d < segment.length - 21; d += 18) for (const side of [-1, 1]) {
      const offset = side * (segment.road.width / 2 - 1.1);
      const x = segment.a[0] + segment.tx * d - segment.tz * offset, z = segment.a[1] + segment.tz * d + segment.tx * offset;
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
    const samples: Point2[] = [[x, z]];
    for (const width of [-1.08, 1.08]) for (const length of [-2.32, 0, 2.32]) samples.push([x + right[0] * width + forward[0] * length, z + right[1] * width + forward[1] * length]);
    if (!samples.every(p => inBounds(p, 12) && buildingClear(p, .45) && nearSegments(p).every(other => other.road.id === segment.road.id || pointSegment(p, other.a, other.b) > other.road.width / 2 + 2))) continue;
    const meterOffset = side * (segment.road.width / 2 + .65);
    const meter: Point2 = [segment.a[0] + segment.tx * ((x - segment.a[0]) * segment.tx + (z - segment.a[1]) * segment.tz + 2) - segment.tz * meterOffset,
      segment.a[1] + segment.tz * ((x - segment.a[0]) * segment.tx + (z - segment.a[1]) * segment.tz + 2) + segment.tx * meterOffset];
    parked.push({ id: parked.length, road: segment.road.name, x, y:sampleElevation(city,x,z), z, yaw, meter: sidewalkClear(meter, .25) ? meter : null });
  }
  const vehicleMaterials: Record<VehicleSurface, THREE.MeshStandardMaterial> = {
    paint: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: .35, roughness: .3, clearcoat: .65, clearcoatRoughness: .23 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x182023, roughness: .5, metalness: .25, side: THREE.DoubleSide }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x181c1e, roughness: .94 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xaeb9bc, roughness: .23, metalness: .86 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x142b36, roughness: .12, metalness: .42, side: THREE.DoubleSide }),
    headlight: new THREE.MeshStandardMaterial({ color: 0xcbd8d9, roughness: .22, metalness: .22 }),
    taillight: new THREE.MeshStandardMaterial({ color: 0x951f1c, roughness: .26, metalness: .12 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xa66b24, roughness: .3 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xd8dacf, roughness: .5 }),
  };
  Object.values(vehicleMaterials).forEach(material => ownedMaterials.add(material));
  const dummy = new THREE.Object3D();
  const carColors = [0x7a8d92, 0x515d61, 0xa7a695, 0x7d4740, 0xb4b9b1, 0x34525b, 0x8f806d, 0x384447];
  const parkedGeometry=createVehicleGeometry('sedan');
  if(typeof document!=='undefined'){
    const plateMaterial=createMassachusettsPlateMaterial('4BB 826');ownedMaterials.add(plateMaterial);vehicleMaterials.plate=plateMaterial;
    parkedGeometry.get('plate')?.dispose();parkedGeometry.set('plate',createVehiclePlateGeometry('sedan'));
  }
  if (parked.length) for (const [surface, geometry] of parkedGeometry) {
    const mesh = new THREE.InstancedMesh(geometry, vehicleMaterials[surface], parked.length);
    mesh.name = `Parked sedan ${surface}`; mesh.castShadow = true; mesh.receiveShadow = true;
    parked.forEach((vehicle, i) => {
      const normal=sampleTerrainNormal(city,vehicle.x,vehicle.z),rotation=terrainRotation(city,vehicle.x,vehicle.z,vehicle.yaw);
      dummy.position.set(vehicle.x+normal.x*.69,vehicle.y+normal.y*.69,vehicle.z+normal.z*.69); dummy.quaternion.set(rotation.x,rotation.y,rotation.z,rotation.w); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      if (surface === 'paint') mesh.setColorAt(i, new THREE.Color(carColors[i % carColors.length]));
    });
    parkedGroup.add(mesh);
  }
  const colliders: RAPIER.Collider[] = [];
  if (physics) for (const vehicle of parked) {
    const normal=sampleTerrainNormal(city,vehicle.x,vehicle.z);
    colliders.push(physics.world.createCollider(RAPIER.ColliderDesc.cuboid(.91, .79, 2.16)
      .setTranslation(vehicle.x+normal.x*.82,vehicle.y+normal.y*.82,vehicle.z+normal.z*.82).setRotation(terrainRotation(city,vehicle.x,vehicle.z,vehicle.yaw)).setFriction(.6).setRestitution(.05)));
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
      return {route,distance,score:distance+(route.road===street?-90:0)+random()*35};
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
      person.position.set(x,sampleElevation(city,x,z)+.035,z);relocations++;
    }
  }
  // Map teleports replace the whole view, so populate that new scene at once.
  // Ordinary travel uses the protected outer ring to avoid nearby appearances.
  function populateAt(observer:{x:number;z:number},player?:{x:number;z:number}){refill(observer,player,true);}
  function update(dt: number, time?: number,observer?:{x:number;z:number;y?:number},player?:{x:number;z:number;speed?:number}) {
    elapsed = time ?? elapsed + Math.max(0, Math.min(.1, dt));
    relocationTime+=Math.max(0,dt);
    if(observer&&relocationTime>.3){
      relocationTime=0;
      refill(observer,player);
    }
    pedestrians.forEach((person, i) => {
      const route = person.route, travel = route.length / person.speed, turn = 1.45, cycle = 2 * (travel + turn);
      const clock = ((elapsed + person.phase) % cycle+cycle)%cycle;
      let along = 0, yaw = route.yaw, walking = 1;
      if (clock < travel) along = clock * person.speed;
      else if (clock < travel + turn) {
        const t = (clock - travel) / turn; along = route.length; yaw += Math.PI * (t * t * (3 - 2 * t)); walking = 0;
      } else if (clock < 2 * travel + turn) { along = route.length - (clock - travel - turn) * person.speed; yaw += Math.PI; }
      else { const t = (clock - 2 * travel - turn) / turn; yaw += Math.PI * (1 + t * t * (3 - 2 * t)); walking = 0; }
      if(player&&Math.hypot(person.position.x-player.x,person.position.z-player.z)<3.4&&Math.abs(player.speed??0)>.5){person.phase-=Math.max(0,dt);walking=0;along=Math.max(0,Math.min(route.length,((person.position.x-route.start[0])*Math.sin(route.yaw)+(person.position.z-route.start[1])*Math.cos(route.yaw))));}
      person.yaw = yaw;
      const x=lerp(route.start[0],route.end[0],along/route.length),z=lerp(route.start[1],route.end[1],along/route.length);
      person.position.set(x,sampleElevation(city,x,z)+.035,z);
      // Unfold both route directions into continuous traveled distance; the
      // animation holds its phase during endpoint turns and vehicle pauses.
      const laps=Math.floor((elapsed+person.phase)/cycle);
      const walked=clock<travel?clock*person.speed:clock<travel+turn?route.length:
        clock<2*travel+turn?route.length+(clock-travel-turn)*person.speed:2*route.length;
      pedestrianModel.pose(i,person,laps*route.length*2+walked,walking,dt,!observer||Math.hypot(x-observer.x,z-observer.z)<65);
    });
    pedestrianModel.flush();
  }
  update(0, 0);
  return {
    group, pedestrians, parked, count, parkedCount: parked.length, meterCount: meters.length, update,populateAt,population,get relocations(){return relocations;},
    dispose() {
      pedestrianModel.dispose();
      if (physics) for (const collider of colliders) physics.world.removeCollider(collider, true);
      group.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
      ownedMaterials.forEach(material => {if(material instanceof THREE.MeshStandardMaterial)material.map?.dispose();material.dispose();}); scene.remove(group);
    },
  };
}
