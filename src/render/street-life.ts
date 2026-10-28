import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { CityData, Point2, Road } from '../types';
import type { DrivingPhysics } from '../physics/vehicle';
import { pointInside } from '../simulation/roads.ts';
import { createVehicleGeometry, createVehiclePlateGeometry, createMassachusettsPlateMaterial } from './car.ts';
import type { VehicleSurface } from './car.ts';
import { sampleElevation, sampleTerrainNormal, terrainRotation } from '../simulation/terrain.ts';
import { inTransitCorridor } from '../simulation/transit-corridors.ts';
import { createActivityProfile } from '../simulation/activity.ts';

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
  const segments: Segment[] = [];
  for (const road of city.roads.filter(r=>!r.elevations)) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i], length = gap(a, b);
    if (length > .2) segments.push({ road, a, b, length, tx: (b[0] - a[0]) / length, tz: (b[1] - a[1]) / length, index: i });
  }
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
  const footprints = city.buildings.map(building => ({
    points: building.footprint,
    minX: Math.min(...building.footprint.map(p => p[0])), maxX: Math.max(...building.footprint.map(p => p[0])),
    minZ: Math.min(...building.footprint.map(p => p[1])), maxZ: Math.max(...building.footprint.map(p => p[1])),
  }));
  const nearFootprints=spatialIndex(footprints,p=>[p.minX,p.minZ,p.maxX,p.maxZ],3);
  const nearSegments=spatialIndex(segments,s=>[Math.min(s.a[0],s.b[0])-s.road.width/2,Math.min(s.a[1],s.b[1])-s.road.width/2,Math.max(s.a[0],s.b[0])+s.road.width/2,Math.max(s.a[1],s.b[1])+s.road.width/2],3);
  const nearObstacles=spatialIndex(streetObstacles,p=>[p[0],p[1],p[0],p[1]],1);
  const inBounds = ([x, z]: Point2, margin = 5) => x > city.bounds.minX + margin && x < city.bounds.maxX - margin && z > city.bounds.minZ + margin && z < city.bounds.maxZ - margin && (!city.coverage?.length||city.coverage.some(polygon=>pointInside([x,z],polygon)));
  function buildingClear(p: Point2, clearance: number) {
    return nearFootprints(p).every(footprint => {
      if (p[0] < footprint.minX - clearance || p[0] > footprint.maxX + clearance || p[1] < footprint.minZ - clearance || p[1] > footprint.maxZ + clearance) return true;
      return !pointInside(p, footprint.points) && footprint.points.every((a, i, points) => pointSegment(p, a, points[(i + 1) % points.length]) > clearance);
    });
  }
  function sidewalkClear(p: Point2, clearance = .42) {
    return !inTransitCorridor(city,...p) && inBounds(p) && buildingClear(p, clearance) && sampleTerrainNormal(city,p[0],p[1]).y>.75 && nearObstacles(p).every(obstacle => gap(p, obstacle) > .76) && nearSegments(p).every(segment => pointSegment(p, segment.a, segment.b) > segment.road.width / 2 + clearance);
  }

  const routes: WalkRoute[] = [];
  for (const segment of segments) {
    if (segment.road.width < 7 || /alley|unnamed|private|ring road|cahners|copley place/i.test(segment.road.name) || segment.length < 20) continue;
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
  }
  const routeCenter=(route:WalkRoute):Point2=>[(route.start[0]+route.end[0])/2,(route.start[1]+route.end[1])/2];
  const nearestStreet=(x:number,z:number)=>{
    let nearest=Infinity,name='';
    for(const segment of segments){const distance=pointSegment([x,z],segment.a,segment.b);if(distance<nearest){nearest=distance;name=segment.road.name;}}
    return name;
  };
  const spawnStreet=nearestStreet(city.spawn.x,city.spawn.z);
  // Spend most of the bounded pool on the neighborhood around the camera. The
  // rest remains distributed on busy sidewalks and can follow later map trips.
  const ranked = routes.map(route => {
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

  const coats = [0x354753, 0x80634d, 0x4f5547, 0x3f4245, 0x7b403b, 0xa29379, 0x42656a, 0x5d4d61];
  const trousers = [0x343b40, 0x283b4c, 0x4c4940, 0x5c5b53];
  const skins = [0xb28165, 0xd6a789, 0x8f624b, 0x654636, 0xc39976, 0xe0b69a];
  const hairs = [0x302b26, 0x544231, 0x837059, 0x29282a, 0x8e8b80];
  const unitSphere = () => new THREE.SphereGeometry(.5, 10, 8);
  const capsule = () => new THREE.CapsuleGeometry(.5, 1, 3, 7).scale(1, .5, 1);
  function peopleBatch(name: string, geometry: THREE.BufferGeometry, capacity: number, roughness = .93) {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness }); ownedMaterials.add(material);
    const mesh = new THREE.InstancedMesh(geometry, material, capacity); mesh.name = name;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.frustumCulled = false; peopleGroup.add(mesh); return mesh;
  }
  const count = pedestrians.length;
  const bodyProfile=[[-.5,.39],[-.32,.43],[.16,.46],[.35,.49],[.46,.40],[.5,.21]].map(([y,r])=>new THREE.Vector2(r,y));
  const torso = peopleBatch('Tailored jackets', new THREE.LatheGeometry(bodyProfile,12), count);
  const arms = peopleBatch('Sleeves', capsule(), count * 4);
  const legs = peopleBatch('Trousers', capsule(), count * 4);
  const skin = peopleBatch('Faces and hands', unitSphere(), count * 5);
  const hair = peopleBatch('Hair', new THREE.SphereGeometry(.5, 10, 7, 0, Math.PI * 2, 0, Math.PI * .42), count);
  const shoes = peopleBatch('Shoes', new THREE.BoxGeometry(1, 1, 1), count * 2, .72);
  const bags = peopleBatch('Bags', new THREE.BoxGeometry(1, 1, 1), count, .9);
  const scarves = peopleBatch('Scarves', new THREE.CylinderGeometry(.5, .5, 1, 8), count);
  const eyes = peopleBatch('Face details', unitSphere(), count * 2);
  const collar=peopleBatch('Shirts and collars',new THREE.BoxGeometry(1,1,1),count);
  const skirt=peopleBatch('Long coats and skirts',new THREE.CylinderGeometry(.39,.5,1,12),count);
  const longHair=peopleBatch('Long hairstyles',unitSphere(),count);
  const ears=peopleBatch('Ears',unitSphere(),count*2);
  const soles=peopleBatch('Shoe soles',new THREE.BoxGeometry(1,1,1),count*2);
  const straps=peopleBatch('Bag straps',new THREE.BoxGeometry(1,1,1),count*2);
  pedestrians.forEach((person, i) => {
    const coat = new THREE.Color(coats[i % coats.length]), pants = new THREE.Color(trousers[i % trousers.length]);
    const complexion = new THREE.Color(skins[i % skins.length]);
    torso.setColorAt(i, coat); hair.setColorAt(i, new THREE.Color(hairs[i % hairs.length]));
    collar.setColorAt(i,new THREE.Color([0xd3d2c5,0x9daeb2,0x383a42][i%3]));skirt.setColorAt(i,i%5===1?pants:coat);longHair.setColorAt(i,new THREE.Color(hairs[i%hairs.length]));
    for(let j=0;j<2;j++){ears.setColorAt(i*2+j,complexion);soles.setColorAt(i*2+j,new THREE.Color(i%3?0xaaa99c:0x393b38));straps.setColorAt(i*2+j,new THREE.Color(0x373c3a));}
    bags.setColorAt(i, new THREE.Color(i % 2 ? 0x574538 : 0x273638)); scarves.setColorAt(i, new THREE.Color(i % 2 ? 0x8b6e4d : 0x4d6770));
    for (let j = 0; j < 4; j++) { arms.setColorAt(i * 4 + j, coat); legs.setColorAt(i * 4 + j, pants); }
    for (let j = 0; j < 5; j++) skin.setColorAt(i * 5 + j, complexion);
    for (let j = 0; j < 2; j++) { shoes.setColorAt(i * 2 + j, new THREE.Color(i % 3 === 0 ? 0x645248 : 0x252b2e)); eyes.setColorAt(i * 2 + j, new THREE.Color(0x33302c)); }
  });

  const parked: ParkedVehicle[] = [];
  const candidates: { segment: Segment; x: number; z: number; side: number; yaw: number; score: number }[] = [];
  for (const segment of segments) {
    if (!/^(Boylston|Dartmouth|Parker|Tremont|Wigglesworth|Calumet|Saint Alphonsus|Smith|Worthington) Street$/.test(segment.road.name) || segment.road.width < 9.5) continue;
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

  const actorMatrix = new THREE.Matrix4(), localMatrix = new THREE.Matrix4(), worldMatrix = new THREE.Matrix4();
  const position = new THREE.Vector3(), size = new THREE.Vector3(), quaternion = new THREE.Quaternion(), identity = new THREE.Quaternion();
  const startPoint = new THREE.Vector3(), endPoint = new THREE.Vector3(), direction = new THREE.Vector3();
  function place(mesh: THREE.InstancedMesh, index: number, p: [number, number, number], dimensions: [number, number, number]) {
    localMatrix.compose(position.set(...p), identity, size.set(...dimensions)); worldMatrix.multiplyMatrices(actorMatrix, localMatrix); mesh.setMatrixAt(index, worldMatrix);
  }
  function limb(mesh: THREE.InstancedMesh, index: number, a: [number, number, number], b: [number, number, number], diameter: number) {
    startPoint.set(...a); endPoint.set(...b); direction.copy(endPoint).sub(startPoint);
    const length = direction.length(); quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, direction.normalize());
    localMatrix.compose(position.copy(startPoint).add(endPoint).multiplyScalar(.5), quaternion, size.set(diameter, length, diameter));
    worldMatrix.multiplyMatrices(actorMatrix, localMatrix); mesh.setMatrixAt(index, worldMatrix);
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
    const available=routes.map(route=>{
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
      const gait = (elapsed + person.phase) * person.speed * 6.1;
      const bob = Math.cos(gait*2)*.012*walking;
      quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      actorMatrix.compose(person.position, quaternion, size.set(person.width * person.height, person.height, person.height));
      place(torso, i, [0, 1.13 + bob, 0], [.43, .54, .28]);
      place(collar,i,[0,1.35+bob,.125],[.135,.17,.025]);
      place(skirt,i,[0,.80+bob,0],i%5===1?[.44,.33,.33]:i%5===3?[.48,.28,.34]:[0,0,0]);
      place(longHair,i,[0,1.49+bob,-.075],i%4===1?[.21,.28,.18]:[0,0,0]);
      place(skin, i * 5, [0, 1.585 + bob, .007], [.195, .255, .195]);
      place(skin, i * 5 + 1, [0, 1.425 + bob, 0], [.085, .10, .08]);
      place(skin, i * 5 + 4, [0, 1.58 + bob, .109], [.032, .045, .035]);
      place(hair, i, [0, 1.59 + bob, .002], [.206, .263, .207]);
      place(bags, i, [0, 1.13 + bob, -.184], person.bag ? [.265, .33, .16] : [0, 0, 0]);
      place(scarves, i, [0, 1.402 + bob, 0], person.scarf ? [.145, .065, .13] : [0, 0, 0]);
      for (const [sideIndex, side] of [-1, 1].entries()) {
        const phase=gait+sideIndex*Math.PI,swing=Math.sin(phase)*.27*walking;
        const hip:[number,number,number]=[side*.092,.86+bob,0];
        const ankle:[number,number,number]=[side*.099,.075+Math.max(0,Math.cos(phase))*.10*walking,swing];
        // Solve a two-bone leg to the grounded foot, so the stance leg does not
        // slide above the sidewalk as the opposite leg swings through.
        const dy=ankle[1]-hip[1],dz=ankle[2],distance=Math.hypot(dy,dz),leg=.415,along=distance*.5,bend=Math.sqrt(Math.max(0,leg*leg-along*along));
        const knee:[number,number,number]=[side*.096,hip[1]+dy*.5+dz/distance*bend,dz*.5-dy/distance*bend];
        limb(legs, i * 4 + sideIndex * 2, hip, knee, .14); limb(legs, i * 4 + sideIndex * 2 + 1, knee, ankle, .112);
        place(shoes, i * 2 + sideIndex, [ankle[0], ankle[1] - .035, ankle[2] + .056], [.118, .08, .245]);
        place(soles,i*2+sideIndex,[ankle[0],ankle[1]-.066,ankle[2]+.056],[.123,.018,.25]);
        place(ears,i*2+sideIndex,[side*.096,1.59+bob,.005],[.032,.06,.038]);
        place(straps,i*2+sideIndex,[side*.12,1.20+bob,.14],person.bag?[.026,.36,.025]:[0,0,0]);
        const armSwing = -swing * .82;
        const shoulder: [number, number, number] = [side * .225, 1.34 + bob, 0];
        const elbow: [number, number, number] = [side * .235, shoulder[1] - Math.cos(armSwing) * .27, Math.sin(armSwing) * .27];
        const hand: [number, number, number] = [side * .235, elbow[1] - Math.cos(armSwing + .13) * .255, elbow[2] + Math.sin(armSwing + .13) * .255];
        limb(arms, i * 4 + sideIndex * 2, shoulder, elbow, .122); limb(arms, i * 4 + sideIndex * 2 + 1, elbow, hand, .099);
        place(skin, i * 5 + 2 + sideIndex, [hand[0], hand[1] - .02, hand[2]], [.061, .086, .063]);
        place(eyes, i * 2 + sideIndex, [side * .036, 1.614 + bob, .098], [.011, .009, .011]);
      }
    });
    for (const child of peopleGroup.children) if (child instanceof THREE.InstancedMesh) child.instanceMatrix.needsUpdate = true;
  }
  update(0, 0);
  return {
    group, pedestrians, parked, count, parkedCount: parked.length, meterCount: meters.length, update,populateAt,population,get relocations(){return relocations;},
    dispose() {
      if (physics) for (const collider of colliders) physics.world.removeCollider(collider, true);
      group.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
      ownedMaterials.forEach(material => {if(material instanceof THREE.MeshStandardMaterial)material.map?.dispose();material.dispose();}); scene.remove(group);
    },
  };
}
