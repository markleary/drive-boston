import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { CityData, Point2, VehicleState, Road } from '../types';
import type { DrivingPhysics } from '../physics/vehicle';
import {createNPCVehicleBatches} from '../render/npc-vehicles.ts';
import {NPC_BODY_LIFT,TRAFFIC_CAPACITY,npcVehicleAt,npcPaint,type NPCVehicleSpec} from './npc-vehicle-specs.ts';
import {createNPCVehicleColliders} from '../physics/npc-vehicle.ts';
import { sampleElevation } from './terrain.ts';
import {headOnThreat,advanceEvasion,type Evasion} from './traffic-evasion.ts';
import { pointInside } from './roads.ts';
import { coverageTester } from './coverage.ts';
import { sampleRoadElevation,roadNormal,roadRotation,sampleDriveSurface,roadProjection } from './road-surfaces.ts';
import { signalPhase } from './signals.ts';
import type { TrafficObstacle } from './transit.ts';
import { createActivityProfile } from './activity.ts';
import {createRouteSignalLookup} from './traffic-route-signals.ts';

interface Edge { id: number; start: number; end: number; points: Point2[]; length:number; name: string; width: number; oneway: boolean; road:Road; laneOffset?:number; }
interface Path { points: Point2[]; distances: number[]; length: number; stops: {distance:number;yaw:number}[]; roadAt:Road[]; component?: number; }
/** A struck car runs as a dynamic body (`knocked`) until it comes to rest, then
 * eases back onto its lane over `rejoin` from the pose it was left in. */
interface Actor { body: RAPIER.RigidBody; collider: RAPIER.Collider; colliders:RAPIER.Collider[]; spec:NPCVehicleSpec; registration:string; path: Path; distance: number; speed: number; cruise: number; x: number; z: number; yaw: number; color: THREE.Color; steering:number; evasion?:Evasion; signalStop?: number; signalCommitted?: boolean; knocked?: { since: number; settled: number }; rejoin?: { t: number; duration: number; x: number; y: number; z: number; q: THREE.Quaternion }; }
const COUNT = TRAFFIC_CAPACITY;
/** Closing speed (m/s) at which a touch becomes a knock rather than a nudge. */
export const KNOCK_SPEED = 1.2;
/** How far ahead (s) a striker is swept against lane keepers, so a struck car turns
 * dynamic before the contact step instead of after it: two and a half 60 Hz steps. */
export const KNOCK_LOOKAHEAD = 2.5/60;
/** How a struck car moves once Rapier has resolved the hit. Box-on-road friction
 * (averaged with the road's 1.0) would stop it at about 1 g in every direction and
 * wipe out its spin within a tenth of a second, so while it is upright on the road
 * its box barely touches (`friction`) and `tyreGrip` stands in for the wheels:
 * they roll freely (`rolling`, in g) until the shaken driver brakes (`braking`
 * after `brakeAfter` s) and grip sideways up to `grip` g at each axle. On its roof
 * or side it scrapes with ordinary friction. */
export const KNOCKED = { friction: .05, scrape: .6, linearDamping: .05, angularDamping: .3, grip: .7, rolling: .03, braking: .5, brakeAfter: .8 };
const LOCAL_RADIUS = 650;
const distance = (a: Point2, b: Point2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function roadGraph(city: CityData) {
  const activityAt=createActivityProfile(city),covered=coverageTester(city);
  const nodes: Point2[] = [], heights:number[]=[], edges: Edge[] = [];
  const buckets = new Map<string, number[]>();
  const node = (p: Point2,height:number) => {
    const cx = Math.floor(p[0] / 4), cz = Math.floor(p[1] / 4);
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const index of buckets.get(`${cx+dx},${cz+dz}`)??[])if(distance(p,nodes[index])<4&&Math.abs(heights[index]-height)<1)return index;
    const index=nodes.length,key=`${cx},${cz}`;nodes.push(p);heights.push(height);
    const bucket=buckets.get(key);if(bucket)bucket.push(index);else buckets.set(key,[index]);return index;
  };
  const candidates:{road:Road;points:Point2[];length:number;start:number;end:number}[]=[],incident=new Map<number,Set<number>>();
  for (const road of city.roads) {
    if(road.traffic===false)continue;
    const arterial=/^(primary|secondary)$/.test(road.kind??'')&&!/^unnamed\b/i.test(road.name);
    const tobinRamp=road.bridge?.id==='tobin-approach'&&road.oneway!==0&&road.width>=5.5;
    if (road.points.length<2 || (!tobinRamp&&(road.width < 7 || (road.width<8&&!arterial&&(activityAt(...road.points[0]).level!=='busy'||!/(street|avenue|road|boulevard|parkway)$/i.test(road.name))))) || /alley|private|ring road|cahners|copley place/i.test(road.name)) continue;
    const points = road.points.filter((p, i, a) => i === 0 || distance(p, a[i - 1]) > .5);
    if (points.length < 2) continue;
    const length=points.slice(1).reduce((sum,p,i)=>sum+distance(points[i],p),0);if(length<1)continue;
    const start = node(points[0],sampleRoadElevation(city,road,...points[0])), end = node(points[points.length - 1],sampleRoadElevation(city,road,...points[points.length-1]));
    if(start===end&&length<12)continue;
    const index=candidates.length;candidates.push({road,points,length,start,end});
    for(const n of [start,end]){const list=incident.get(n)??new Set<number>();list.add(index);incident.set(n,list);}
  }
  // Source ways split at lane changes and bridge tags, sometimes only a few
  // metres apart. Keep those connecting pieces without populating short
  // isolated stubs; prune a dangling chain all the way back to its main road.
  const removed=new Set<number>(),pending=candidates.map((_,i)=>i);
  while(pending.length){
    const index=pending.pop()!,c=candidates[index];if(removed.has(index)||c.length>=12)continue;
    if((incident.get(c.start)?.size??0)>1&&(incident.get(c.end)?.size??0)>1)continue;
    removed.add(index);
    for(const n of [c.start,c.end]){const list=incident.get(n)!;list.delete(index);pending.push(...list);}
  }
  for(const [index,{road,points,length,start,end}]of candidates.entries()){
    if(removed.has(index))continue;
    const add = (ps: Point2[], a: number, b: number) => {
      // Lane offsets follow the measured roadway, not the class width: a one-way class avenue carries two lanes only where the curbs leave room for them
      // (Huntington Avenue's carriageways beside the Green Line reservation measure 7.5 m against a 15 m class width; its Copley Place lane 5.3 m).
      const paved=road.pavedWidth??road.width;
      const lanes:(number|undefined)[]=road.bridge?.id==='tobin'&&road.oneway!==0?[-road.width/3,0,road.width/3]:road.oneway!==0&&road.width>=12&&paved>=6.5?[-Math.min(3,paved*.17),Math.min(3,paved*.17)]:[undefined];
      for(const laneOffset of lanes){
        const edge={ id: edges.length, start: a, end: b, points: ps, length, name: road.name, width: road.width, oneway: road.oneway !== 0,road,laneOffset };
        if(city.coverage?.length&&!lane(edge).every(p=>covered(p[0],p[1])))continue;
        edges.push(edge);
      }
    };
    if (road.oneway >= 0) add(points, start, end);
    if (road.oneway <= 0) add([...points].reverse(), end, start);
  }
  return { nodes, edges };
}

/** The lane centerline an edge's traffic follows: offset from the road centerline within the measured roadway. */
export function lane(edge: Edge): Point2[] {
  const paved = edge.road.pavedWidth ?? edge.width, offset = edge.laneOffset ?? (edge.oneway ? Math.min(2, paved * .14) : Math.min(3, paved * .23));
  return edge.points.map((p, i, points) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
    return [p[0] - dz / len * offset, p[1] + dx / len * offset];
  });
}

function roundedPath(points: Point2[],roads:Road[]): Path {
  const clean:Point2[]=[],owners:Road[]=[];points.forEach((p,i)=>{if(i===0||distance(p,points[i-1])>.15){clean.push(p);owners.push(roads[i]);}});
  const rounded: Point2[] = [clean[0]],roadAt:Road[]=[owners[0]];
  for (let i = 1; i < clean.length - 1; i++) {
    const a = clean[i - 1], b = clean[i], c = clean[i + 1];
    const ab = distance(a, b), bc = distance(b, c);
    const trim = Math.min(7, ab * .34, bc * .34);
    const before: Point2 = [b[0] + (a[0] - b[0]) * trim / ab, b[1] + (a[1] - b[1]) * trim / ab];
    const after: Point2 = [b[0] + (c[0] - b[0]) * trim / bc, b[1] + (c[1] - b[1]) * trim / bc];
    rounded.push(before);roadAt.push(owners[i]);
    for (let j = 1; j <= 6; j++) {
      const t = j / 6, u = 1 - t;
      rounded.push([u * u * before[0] + 2 * u * t * b[0] + t * t * after[0], u * u * before[1] + 2 * u * t * b[1] + t * t * after[1]]);roadAt.push(owners[i]);
    }
  }
  rounded.push(clean[clean.length - 1]);roadAt.push(owners[owners.length-1]);
  const distances = [0];
  for (let i = 1; i < rounded.length; i++) distances.push(distances[i - 1] + distance(rounded[i - 1], rounded[i]));
  return { points: rounded, distances, length: distances[distances.length - 1], stops: [],roadAt };
}

function at(path: Path, s: number): Point2 {
  s = Math.max(0, Math.min(path.length, s));
  let lo = 0, hi = path.distances.length - 1;
  while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (path.distances[mid] < s) lo = mid; else hi = mid; }
  const a = path.points[lo], b = path.points[hi], t = (s - path.distances[lo]) / (path.distances[hi] - path.distances[lo] || 1);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function pathRoad(path:Path,distance:number){let lo=0,hi=path.distances.length-1;while(lo+1<hi){const mid=(lo+hi)>>1;if(path.distances[mid]<distance)lo=mid;else hi=mid;}return path.roadAt[lo];}
function pathYaw(path:Path,distance:number){const a=at(path,distance),b=at(path,distance+2);return Math.atan2(b[0]-a[0],b[1]-a[1]);}

/** Lightweight local traffic; all routes follow the imported directed road graph. */
export function createTraffic(scene: THREE.Scene, city: CityData, physics: DrivingPhysics) {
  const { nodes, edges } = roadGraph(city);
  const spawnEdges=edges.filter(edge=>edge.length>=12);
  const activityAt=createActivityProfile(city);
  const outgoing = new Map<number, Edge[]>(), connections = new Map<number, Set<number>>();
  for(const edge of edges){
    const next=outgoing.get(edge.start);if(next)next.push(edge);else outgoing.set(edge.start,[edge]);
    if(!connections.has(edge.start))connections.set(edge.start,new Set());if(!connections.has(edge.end))connections.set(edge.end,new Set());
    connections.get(edge.start)!.add(edge.end);connections.get(edge.end)!.add(edge.start);
  }
  const components=new Map<number,number>();let component=0;
  for(const node of connections.keys())if(!components.has(node)){
    const stack=[node];components.set(node,component);
    while(stack.length){const current=stack.pop()!;for(const next of connections.get(current)??[])if(!components.has(next)){components.set(next,component);stack.push(next);}}
    component++;
  }
  // Match measured signal locations to graph junctions, rather than treating a
  // roadside signal point as if it sat in the middle of the driving lane.
  const signalJunctions = nodes.filter((point, index) => {
    const branches = connections.get(index)??new Set<number>();
    return branches.size >= 3 && city.signals.some(signal => distance(signal, point) < 24);
  });
  const routeSignalStops=createRouteSignalLookup(signalJunctions);
  let elapsed = 0, rehomeTimer=0;
  let seed = 43571;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const choose = <T,>(array: T[]) => array[Math.floor(random() * array.length)];
  function route(first?: Edge): Path {
    let edge = first ?? choose(spawnEdges);
    const points = lane(edge),roads=points.map(()=>edge.road);
    // Connector fragments must not spend the normal 15-street route budget,
    // or cars would still stop near the player after a densely split junction.
    for (let n = 0,connectors=0; n < 15&&connectors<64;) {
      const before = edge.points[edge.points.length - 2], joint = edge.points[edge.points.length - 1];
      const dir = [joint[0] - before[0], joint[1] - before[1]];
      const options = (outgoing.get(edge.end)??[]).filter(next => {
        if (next.end === edge.start) return false;
        const forward = [next.points[1][0] - next.points[0][0], next.points[1][1] - next.points[0][1]];
        return (forward[0] * dir[0] + forward[1] * dir[1]) / (Math.hypot(...forward) * Math.hypot(...dir)) > -.8;
      });
      if (!options.length) break;
      const sameStreet = options.filter(next => next.name === edge.name);
      const sameLane=sameStreet.filter(next=>next.laneOffset===edge.laneOffset);
      edge = choose(sameStreet.length && random() < .65 ? (sameLane.length?sameLane:sameStreet) : options);
      if(edge.length>=12)n++;else connectors++;
      const next=lane(edge);points.push(...next);roads.push(...next.map(()=>edge.road));
    }
    const path = roundedPath(points,roads);
    path.component=components.get(edge.start);
    path.stops=routeSignalStops(path.points,path.distances).map(distance=>({distance,yaw:pathYaw(path,distance)}));
    return path;
  }

  const actors: Actor[] = [];
  const group = new THREE.Group(); group.name = 'AmbientTraffic'; scene.add(group);
  const fleet=createNPCVehicleBatches(group,COUNT);
  const spawnPlayer = physics.getState();
  let drawObserver:Pick<VehicleState,'x'|'z'>=spawnPlayer;
  const edgeActivity=new Map(edges.map(edge=>[edge.id,activityAt(...edge.points[Math.floor(edge.points.length/2)]).traffic]));
  // Favor broad commercial streets, but preserve through traffic on the smaller
  // streets too. This is a bounded local fleet, not cars for every city block.
  function weightedEdge(candidates:Edge[]){
    let selected=choose(candidates);
    for(let attempt=0;attempt<6;attempt++){
      selected=choose(candidates);
      const weight=Math.min(1,(edgeActivity.get(selected.id)??18)/48)*Math.min(1,selected.width/15);
      if(random()<weight)break;
    }
    return selected;
  }
  function nearbyEdges(observer:Pick<VehicleState,'x'|'z'>,radius:number){
    return spawnEdges.filter(edge=>edge.points.some(point=>Math.hypot(point[0]-observer.x,point[1]-observer.z)<radius));
  }
  function nearestStreet(observer:Pick<VehicleState,'x'|'z'>){
    let best=Infinity,name='';
    for(const edge of nearbyEdges(observer,200))for(let i=1;i<edge.points.length;i++){
      const a=edge.points[i-1],b=edge.points[i],dx=b[0]-a[0],dz=b[1]-a[1];
      const t=Math.max(0,Math.min(1,((observer.x-a[0])*dx+(observer.z-a[1])*dz)/(dx*dx+dz*dz||1)));
      const d=Math.hypot(observer.x-a[0]-dx*t,observer.z-a[1]-dz*t);
      if(d<best){best=d;name=edge.name;}
    }
    return name;
  }
  type Placement={path:Path;d:number;p:Point2};
  type Observer=Pick<VehicleState,'x'|'z'>&Partial<Pick<VehicleState,'yaw'>>;
  function placement(candidates:Edge[],observer:Pick<VehicleState,'x'|'z'>,player:Pick<VehicleState,'x'|'z'>,min:number,max:number,except?:Actor,external:TrafficObstacle[]=[],attempts=36):Placement|undefined{
    for(let attempt=0;attempt<attempts&&candidates.length;attempt++){
      const path=route(weightedEdge(candidates)),d=Math.min(path.length*.45,8+random()*110),p=at(path,d),radius=Math.hypot(p[0]-observer.x,p[1]-observer.z);
      if(radius<min||radius>max||Math.hypot(p[0]-player.x,p[1]-player.z)<35)continue;
      if(actors.some(actor=>actor!==except&&Math.hypot(actor.x-p[0],actor.z-p[1])<18))continue;
      if(external.some(other=>Math.hypot(other.x-p[0],other.z-p[1])<(other.halfLength??2.1)+5))continue;
      return {path,d,p};
    }
  }
  function aheadOf(point:Point2,observer:Observer){
    const yaw=observer.yaw??0,dx=point[0]-observer.x,dz=point[1]-observer.z;
    return {along:dx*Math.sin(yaw)+dz*Math.cos(yaw),across:dx*Math.cos(yaw)-dz*Math.sin(yaw)};
  }
  function forwardPlacements(candidates:Edge[],observer:Observer){
    if(observer.yaw===undefined)return[];
    const placements:(Placement&{laneOffset?:number})[]=[];
    for(const edge of candidates){
      const path=route(edge),limit=Math.min(path.length-5,240);
      for(let d=8;d<limit;d+=5){
        if(pathRoad(path,d).name!==edge.name)continue;
        const p=at(path,d),{along,across}=aheadOf(p,observer);
        if(along>=38&&along<=185&&Math.abs(across)<Math.max(8,(edge.road.pavedWidth??edge.width)/2+2))placements.push({path,d,p,laneOffset:edge.laneOffset});
      }
    }
    return placements;
  }
  function forwardPlacement(candidates:(Placement&{laneOffset?:number})[],observer:Observer,player:Pick<VehicleState,'x'|'z'>,slot:number,except?:Actor,external:TrafficObstacle[]=[]){
    const desired=40+slot*27;
    let selected:Placement|undefined,best=Infinity;
    for(const candidate of candidates){
      const {along,across}=aheadOf(candidate.p,observer),preferredLane=slot%2===0?-1:1;
      const score=Math.abs(along-desired)+Math.abs(across)*.3+(candidate.laneOffset!==undefined&&Math.sign(candidate.laneOffset)!==preferredLane?16:0);
      if(score>=best||Math.hypot(candidate.p[0]-player.x,candidate.p[1]-player.z)<35)continue;
      if(actors.some(actor=>actor!==except&&Math.hypot(actor.x-candidate.p[0],actor.z-candidate.p[1])<18))continue;
      if(external.some(other=>Math.hypot(other.x-candidate.p[0],other.z-candidate.p[1])<(other.halfLength??2.1)+5))continue;
      best=score;selected=candidate;
    }
    return selected;
  }
  const initialEdges=nearbyEdges(spawnPlayer,650),nearEdges=nearbyEdges(spawnPlayer,240),street=nearestStreet(spawnPlayer);
  const streetEdges=nearEdges.filter(edge=>edge.name===street),forward=forwardPlacements(streetEdges,spawnPlayer);
  const target=activityAt(spawnPlayer.x,spawnPlayer.z).traffic,nearTarget=Math.round(target/3),streetTarget=Math.round(target/6);
  for (let i = 0; i < COUNT && spawnEdges.length; i++) {
    // Populate the street in view first, then adjacent blocks, then a reserve
    // fleet in the rest of the city. Every placement keeps its safe headway.
    let candidate=i<Math.min(6,streetTarget)?forwardPlacement(forward,spawnPlayer,spawnPlayer,i):undefined;
    if(!candidate&&i<streetTarget)candidate=placement(streetEdges,spawnPlayer,spawnPlayer,35,230);
    if(!candidate&&i<nearTarget)candidate=placement(nearEdges,spawnPlayer,spawnPlayer,35,240);
    if(!candidate&&i<target)candidate=placement(initialEdges,spawnPlayer,spawnPlayer,35,LOCAL_RADIUS);
    if(!candidate)candidate=placement(spawnEdges,spawnPlayer,spawnPlayer,i<target?35:LOCAL_RADIUS+80,Infinity);
    if (!candidate) continue;
    const { path, d, p } = candidate;
    const q = at(path, d + 2), yaw = Math.atan2(q[0] - p[0], q[1] - p[1]);
    const road=pathRoad(path,d),normal=roadNormal(city,road,p[0],p[1]),ground=sampleRoadElevation(city,road,p[0],p[1]);
    const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(p[0]+normal.x*NPC_BODY_LIFT,ground+normal.y*NPC_BODY_LIFT,p[1]+normal.z*NPC_BODY_LIFT).setRotation(roadRotation(city,road,p[0],p[1],yaw)));
    const spec=npcVehicleAt(actors.length),colliders=createNPCVehicleColliders(physics.world,body,spec),collider=colliders[0];
    fleet.bind(actors.length,spec.type);
    actors.push({ body, collider, colliders, spec, registration:fleet.registration(actors.length),path, distance: d, speed: 0, cruise: 5.5 + random() * 3.5, x: p[0], z: p[1], yaw, steering:0,color: new THREE.Color(npcPaint(spec)) });
  }
  const byCollider=new Map(actors.flatMap(actor=>actor.colliders.map(collider=>[collider.handle,actor] as const)));
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion(), laneRotation = new THREE.Quaternion(), position = new THREE.Vector3(), scale = new THREE.Vector3(1, 1, 1), lift = new THREE.Vector3(), meshPosition = new THREE.Vector3();
  /** Write one actor's instance matrices from the body pose in `position`/`rotation`
   * (the body sits .65 m above the wheels' contact, the mesh origin on it). */
  function draw(index:number){
    lift.set(0,NPC_BODY_LIFT,0).applyQuaternion(rotation);meshPosition.copy(position).sub(lift);matrix.compose(meshPosition,rotation,scale);
    fleet.draw(index,matrix,actors[index].color,Math.hypot(actors[index].x-drawObserver.x,actors[index].z-drawObserver.z),actors[index].steering);
  }
  /** A struck vehicle becomes a sliding, spinning dynamic compound body, carrying
   * its lane speed into the collision; its taller shape rests on the road. The
   * Min combine rule keeps its own low friction against the road. */
  function knock(actor:Actor){
    if(actor.knocked)return;
    actor.knocked={since:elapsed,settled:0};actor.rejoin=undefined;actor.evasion=undefined;actor.steering=0;
    for(const collider of actor.colliders)collider.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
    actor.body.setBodyType(RAPIER.RigidBodyType.Dynamic,true);
    actor.body.setLinearDamping(KNOCKED.linearDamping);actor.body.setAngularDamping(KNOCKED.angularDamping);
    actor.body.setLinvel({x:Math.sin(actor.yaw)*actor.speed,y:0,z:Math.cos(actor.yaw)*actor.speed},true);actor.body.setAngvel({x:0,y:0,z:0},true);
  }
  function restore(actor:Actor){
    if(!actor.knocked)return;
    actor.knocked=undefined;actor.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased,true);
    for(const collider of actor.colliders){collider.setFriction(.5);collider.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average);}
    actor.body.setLinvel({x:0,y:0,z:0},true);actor.body.setAngvel({x:0,y:0,z:0},true);
  }
  const tyreQ=new THREE.Quaternion(),tyreForward=new THREE.Vector3(),tyreRight=new THREE.Vector3();
  /** Wheel forces for a knocked car that is upright on the road (or a bridge deck), applied at both
   * axles so a sideways slide also brakes its spin as real tyres do. */
  function tyreGrip(actor:Actor,dt:number){
    const r=actor.body.rotation(),t=actor.body.translation(),upright=1-2*(r.x*r.x+r.z*r.z)>.7&&t.y-sampleDriveSurface(city,t.x,t.z,t.y).height<1.1;
    for(const collider of actor.colliders)collider.setFriction(upright?KNOCKED.friction:KNOCKED.scrape);if(!upright)return;
    tyreQ.set(r.x,r.y,r.z,r.w);tyreForward.set(0,0,1).applyQuaternion(tyreQ);tyreRight.set(1,0,0).applyQuaternion(tyreQ);
    const m=actor.spec.mass/2,g=9.81,along=elapsed-actor.knocked!.since>KNOCKED.brakeAfter?KNOCKED.braking:KNOCKED.rolling;
    for(const arm of [actor.spec.frontAxle,actor.spec.rearAxle]){
      const point={x:t.x+tyreForward.x*arm,y:t.y-.45,z:t.z+tyreForward.z*arm},v=actor.body.velocityAtPoint(point);
      const vl=v.x*tyreForward.x+v.z*tyreForward.z,vs=v.x*tyreRight.x+v.z*tyreRight.z;
      const jl=-Math.sign(vl)*Math.min(Math.abs(vl)*m,along*g*m*dt),js=-Math.sign(vs)*Math.min(Math.abs(vs)*m*.5,KNOCKED.grip*g*m*dt);
      actor.body.applyImpulseAtPoint({x:tyreForward.x*jl+tyreRight.x*js,y:0,z:tyreForward.z*jl+tyreRight.z*js},point,true);
    }
  }
  /** Knock every lane keeper the player (or an already knocked car) is pushing into
   * or will reach within KNOCK_LOOKAHEAD. Rapier lists a contact pair only after the
   * step that brings two shapes together, so without the sweep a fast hit often
   * lands on the still-kinematic car: the striker stops dead and the struck car,
   * knocked a step later, is left with nothing to carry. The pair list also holds
   * every collider whose bounding box merely overlaps, so a listed pair counts only
   * with a manifold contact within 5 cm (a car passing 4 m away is no hit). */
  function detectKnocks(){
    const struck=new Set<Actor>(),pv=physics.body.linvel(),lane={x:0,y:0,z:0};
    const closing=(v:{x:number;z:number},actor:Actor)=>Math.hypot(v.x-Math.sin(actor.yaw)*actor.speed,v.z-Math.cos(actor.yaw)*actor.speed);
    const sweep=(collider:RAPIER.Collider,v:RAPIER.Vector,threshold:number,self?:Actor)=>{
      const p=collider.translation();
      physics.world.contactPairsWith(collider,other=>{
        const hit=byCollider.get(other.handle);if(!hit||hit.knocked||closing(v,hit)<=threshold)return;
        let touching=false;physics.world.contactPair(collider,other,manifold=>{for(let i=0;i<manifold.numContacts();i++)if(manifold.contactDist(i)<=.05)touching=true;});
        if(touching)struck.add(hit);
      });
      for(const hit of actors){
        if(hit===self||hit.knocked||struck.has(hit)||Math.hypot(hit.x-p.x,hit.z-p.z)>15||closing(v,hit)<=threshold)continue;
        lane.x=Math.sin(hit.yaw)*hit.speed;lane.z=Math.cos(hit.yaw)*hit.speed;
        if(hit.colliders.some(other=>collider.castCollider(v,other,lane,.05,KNOCK_LOOKAHEAD,true)))struck.add(hit);
      }
    };
    sweep(physics.chassisCollider,pv,KNOCK_SPEED);
    for(const actor of actors)if(actor.knocked)for(const collider of actor.colliders)sweep(collider,actor.body.linvel(),KNOCK_SPEED+.3,actor);
    for(const actor of struck)knock(actor);
  }
  /** Route distance of the lane point nearest to where the car now lies, within 90 m. */
  function nearestSlot(actor:Actor){
    let best=actor.distance,bestGap=Infinity;
    for(let s=Math.max(0,actor.distance-90);s<=Math.min(actor.path.length-.05,actor.distance+90);s+=1){const p=at(actor.path,s),gap=Math.hypot(p[0]-actor.x,p[1]-actor.z);if(gap<bestGap){bestGap=gap;best=s;}}
    return best;
  }

  /** Sweep the car's footprint from `from` to `to`, lifted clear of the road,
   * ignoring terrain, traffic and sensors. */
  function sweep(actor:Actor,from:{x:number;y:number;z:number},to:{x:number;y:number;z:number},accept:(handle:number)=>boolean){
    return physics.world.castShape({x:from.x,y:from.y+.3,z:from.z},actor.body.rotation(),{x:to.x-from.x,y:to.y-from.y,z:to.z-from.z},new RAPIER.Cuboid(actor.spec.width/2,.3,actor.spec.length/2),0,1,true,undefined,undefined,actor.collider,undefined,c=>accept(c.handle)&&!byCollider.has(c.handle)&&!physics.terrainColliders.has(c.handle)&&!c.isSensor());
  }
  /** Whether a settled car may ease back onto its lane. The player's chassis in
   * the way means wait (a kinematic car would shove it); anything else (a wall,
   * parked car or bus) means the way is blocked. */
  function rejoinWay(actor:Actor):'wait'|'blocked'|'clear'{
    const s=nearestSlot(actor),p=at(actor.path,s),hit=sweep(actor,actor.body.translation(),{x:p[0],y:sampleRoadElevation(city,pathRoad(actor.path,s),p[0],p[1])+NPC_BODY_LIFT,z:p[1]},()=>true);
    return !hit?'clear':hit.collider.handle===physics.chassisCollider.handle?'wait':'blocked';
  }
  /** Back to a lane keeper at the nearest point of its route; nearby cars ease
   * there over two seconds from where they stopped, distant ones just resume. */
  function beginRejoin(actor:Actor,observer:Pick<VehicleState,'x'|'z'>){
    const t=actor.body.translation(),r=actor.body.rotation();
    restore(actor);
    actor.distance=nearestSlot(actor);actor.speed=0;actor.signalStop=undefined;actor.signalCommitted=false;
    const far=Math.hypot(actor.x-observer.x,actor.z-observer.z)>160;
    actor.rejoin={t:0,duration:far?0:2.2,x:t.x,y:t.y,z:t.z,q:new THREE.Quaternion(r.x,r.y,r.z,r.w)};
  }
  function relocate(actor:Actor,path:Path,d=5){
    const start=at(path,d),next=at(path,d+2);
    restore(actor);actor.rejoin=undefined;actor.evasion=undefined;actor.steering=0;
    actor.path=path;actor.distance=d;actor.speed=0;actor.signalStop=undefined;actor.signalCommitted=false;
    actor.x=start[0];actor.z=start[1];actor.yaw=Math.atan2(next[0]-start[0],next[1]-start[1]);
    const road=pathRoad(path,d),normal=roadNormal(city,road,...start);
    actor.body.setTranslation({x:start[0]+normal.x*NPC_BODY_LIFT,y:sampleRoadElevation(city,road,...start)+normal.y*NPC_BODY_LIFT,z:start[1]+normal.z*NPC_BODY_LIFT},true);
    actor.body.setRotation(roadRotation(city,road,...start,actor.yaw),true);
  }


  const evasionShapeQ=new THREE.Quaternion();
  function evasionPoint(actor:Actor,s:number,offset:number){
    const p=at(actor.path,s),yaw=pathYaw(actor.path,s),road=pathRoad(actor.path,s);
    return{x:p[0]+Math.cos(yaw)*offset,z:p[1]-Math.sin(yaw)*offset,yaw,road};
  }
  /** Keep the whole footprint inside the measured roadway, with curb clearance.
   * Test the sweep too: a clear endpoint beyond a parked car is not a clear way. */
  function evasionClear(actor:Actor,s:number,offset:number,includePlayer:boolean,yaw?:number){
    const point=evasionPoint(actor,s,offset),heading=yaw??point.yaw,fx=Math.sin(heading),fz=Math.cos(heading),width=(point.road.pavedWidth??point.road.width)/2;
    for(const along of [-actor.spec.length/2,0,actor.spec.length/2])for(const across of [-actor.spec.width/2-.2,actor.spec.width/2+.2]){
      const x=point.x+fx*along+fz*across,z=point.z+fz*along-fx*across;
      if(x<city.bounds.minX||x>city.bounds.maxX||z<city.bounds.minZ||z>city.bounds.maxZ||roadProjection(point.road,x,z).distance>width)return false;
    }
    const h=sampleRoadElevation(city,point.road,point.x,point.z)+NPC_BODY_LIFT,from=actor.body.translation(),pose=roadRotation(city,point.road,point.x,point.z,heading);
    evasionShapeQ.set(pose.x,pose.y,pose.z,pose.w);
    return !physics.world.castShape(from,evasionShapeQ,{x:point.x-from.x,y:h-from.y,z:point.z-from.z},new RAPIER.Cuboid(actor.spec.width/2+.08,.48,actor.spec.length/2+.1),0,1,true,undefined,undefined,undefined,actor.body,c=>!c.isSensor()&&!physics.terrainColliders.has(c.handle)&&(includePlayer||c.handle!==physics.chassisCollider.handle));
  }
  function evade(actor:Actor,player:VehicleState,dt:number){
    if(actor.rejoin)return;
    const lanePoint=evasionPoint(actor,actor.distance,0),height=actor.body.translation().y;
    const threat=headOnThreat({x:actor.x,y:height,z:actor.z,yaw:lanePoint.yaw,speed:actor.speed,halfLength:actor.spec.length/2,halfWidth:actor.spec.width/2},player);
    if(threat){
      const projection=roadProjection(lanePoint.road,lanePoint.x,lanePoint.z),outward=(lanePoint.x-projection.x)*Math.cos(lanePoint.yaw)-(lanePoint.z-projection.z)*Math.sin(lanePoint.yaw);
      const preferred=actor.evasion?.target?Math.sign(actor.evasion.target):Math.abs(threat.across)>.3?-Math.sign(threat.across):Math.sign(outward)||-1;
      let target=0;
      for(const side of [preferred,-preferred]){
        for(const amount of [2.4,2,1.6,1.2,.8,.4]){
          const offset=side*amount;
          if(Math.abs(threat.across-offset)<=Math.abs(threat.across)+.25)continue;
          if([0,.5,1].every(t=>evasionClear(actor,actor.distance+Math.max(3,actor.speed*.8)*t,offset*t,false))){target=offset;break;}
        }
        if(target)break;
      }
      if(target){actor.evasion??={offset:0,velocity:0,target,holdUntil:elapsed};actor.evasion.target=target;actor.evasion.holdUntil=elapsed+.7;}
    }
    const state=actor.evasion;if(!state)return;
    const dx=player.x-actor.x,dz=player.z-actor.z,along=dx*Math.sin(lanePoint.yaw)+dz*Math.cos(lanePoint.yaw);
    // Keep the escape side while passing; do not cut back across the player.
    if(!threat&&elapsed>state.holdUntil&&Math.abs(along)>actor.spec.length/2+6)state.target=0;
    const next=advanceEvasion(state,dt,actor.speed);
    return{state,...next};
  }

  return {
    count: actors.length,
    population(observer:Observer){
      const profile=activityAt(observer.x,observer.z);
      return {level:profile.level,target:profile.traffic,forward:actors.filter(actor=>{const p=aheadOf([actor.x,actor.z],observer);return p.along>35&&p.along<200&&Math.abs(p.across)<12;}).length,local:actors.filter(actor=>Math.hypot(actor.x-observer.x,actor.z-observer.z)<LOCAL_RADIUS).length,nearby:actors.filter(actor=>Math.hypot(actor.x-observer.x,actor.z-observer.z)<240).length,total:actors.length};
    },
    // Called only during an explicit map teleport/reset, before the new view is
    // rendered. Ordinary driving uses the protected-distance refill below.
    populateAt(observer:Observer,player:Pick<VehicleState,'x'|'z'>=observer,external:TrafficObstacle[]=[]){
      const profile=activityAt(observer.x,observer.z),local=()=>actors.filter(actor=>Math.hypot(actor.x-observer.x,actor.z-observer.z)<LOCAL_RADIUS).length;
      const candidates=nearbyEdges(observer,650),near=nearbyEdges(observer,240),name=nearestStreet(observer),same=near.filter(edge=>edge.name===name);
      const forward=forwardPlacements(same,observer);
      let inFront=actors.filter(actor=>{const p=aheadOf([actor.x,actor.z],observer);return p.along>35&&p.along<200&&Math.abs(p.across)<12;}).length;
      let nearby=actors.filter(actor=>Math.hypot(actor.x-observer.x,actor.z-observer.z)<240).length;
      for(const actor of actors){
        if(local()>=profile.traffic)break;
        if(Math.hypot(actor.x-observer.x,actor.z-observer.z)<LOCAL_RADIUS*1.35)continue;
        let candidate=inFront<Math.min(6,Math.round(profile.traffic/6))?forwardPlacement(forward,observer,player,inFront,actor,external):undefined;
        if(!candidate&&nearby<Math.round(profile.traffic/6))candidate=placement(same,observer,player,35,230,actor,external);
        if(!candidate&&nearby<Math.round(profile.traffic/3))candidate=placement(near,observer,player,35,240,actor,external);
        candidate??=placement(candidates,observer,player,35,LOCAL_RADIUS,actor,external);
        if(candidate){relocate(actor,candidate.path,candidate.d);if(Math.hypot(candidate.p[0]-observer.x,candidate.p[1]-observer.z)<240)nearby++;const p=aheadOf(candidate.p,observer);if(p.along>35&&p.along<200&&Math.abs(p.across)<12)inFront++;}
      }
    },
    snapshot:()=>actors.map(a=>{const stop=a.path.stops.find(s=>s.distance>=a.distance-.2);return{x:a.x,z:a.z,yaw:a.yaw,speed:a.speed,steering:a.steering,evasion:a.evasion?.offset??0,road:pathRoad(a.path,a.distance).name,signal:stop?signalPhase(elapsed,stop.yaw):undefined,stopGap:stop?stop.distance-a.distance:Infinity,knocked:!!a.knocked,rejoining:!!a.rejoin,dynamic:a.body.isDynamic(),collider:a.collider.handle,registration:a.registration,type:a.spec.type,mass:a.spec.mass,color:`#${a.color.getHexString()}`,height:a.spec.height,halfLength:a.spec.length/2,halfWidth:a.spec.width/2};}),
    obstacles:():TrafficObstacle[]=>actors.map(a=>({x:a.x,y:a.body.translation().y,z:a.z,halfLength:a.spec.length/2,halfWidth:a.spec.width/2,speed:a.speed})),
    /** Collider handles of the fleet, so an impact on the player can be classified. */
    colliders:new Set(byCollider.keys()),
    update(dt: number, player: VehicleState, observer: Pick<VehicleState,'x'|'y'|'z'> = player, external:TrafficObstacle[] = []) {
      dt = Math.max(0, Math.min(dt, 1 / 30));
      drawObserver=observer;elapsed += dt;rehomeTimer+=dt;
      const recycleDistance=260+Math.max(0,observer.y-sampleElevation(city,observer.x,observer.z))*4;
      const localRadius=Math.max(650,recycleDistance+220);
      // Refill only outside the protected view and use the current district's
      // activity target. Keeping a fixed pool makes draw calls/memory predictable.
      const clearRelocation = (point: Point2, actor: Actor) =>
        Math.hypot(point[0] - player.x, point[1] - player.z) > 35 &&
        !actors.some(other => other !== actor && Math.hypot(other.x - point[0], other.z - point[1]) < 18) &&
        !external.some(other => Math.hypot(other.x - point[0], other.z - point[1]) < (other.halfLength ?? 2.1) + 5);
      // Retain the old body until an unoccupied distant replacement has been found.
      const respawnAway=(actor:Actor)=>{
        for (let attempt = 0; attempt < 12; attempt++) {
          const connected=spawnEdges.filter(edge=>components.get(edge.start)===actor.path.component);if(!connected.length)return false;
          const path = route(choose(connected)), start = at(path, 5);
          if (Math.hypot(start[0] - observer.x, start[1] - observer.z) < recycleDistance || !clearRelocation(start,actor)) continue;
          relocate(actor,path);return true;
        }
        return false;
      };
      if(rehomeTimer>.25){
        rehomeTimer=0;
        const target=activityAt(observer.x,observer.z).traffic;
        let local=actors.filter(actor=>Math.hypot(actor.x-observer.x,actor.z-observer.z)<localRadius).length;
        if(local<Math.min(target,actors.length)){
          const approaches=spawnEdges.filter(edge=>{
            const a=edge.points[0],b=edge.points[1],d=Math.hypot(a[0]-observer.x,a[1]-observer.z);
            if(d<recycleDistance+15||d>localRadius-30)return false;
            const dx=b[0]-a[0],dz=b[1]-a[1];
            return (dx*(observer.x-a[0])+dz*(observer.z-a[1]))/(Math.hypot(dx,dz)*d)>-.1;
          });
          let moved=0;
          for(const actor of actors){
            if(local>=target||moved>=2)break;
            if(Math.hypot(actor.x-observer.x,actor.z-observer.z)<=localRadius*1.35||Math.hypot(actor.x-player.x,actor.z-player.z)<=35)continue;
            const candidate=placement(approaches,observer,player,recycleDistance,localRadius-10,actor,external,6);
            if(candidate){relocate(actor,candidate.path,candidate.d);local++;moved++;}
          }
        }
      }
      // Snapshot once per step instead of allocating an O(N²) pile of obstacle
      // objects. The stable snapshot also avoids actor-order-dependent following.
      const obstacles:TrafficObstacle[]=[{...player,halfLength:2.1,halfWidth:.9},...actors.map(actor=>({x:actor.x,y:actor.body.translation().y,z:actor.z,halfLength:actor.spec.length/2,halfWidth:actor.spec.width/2,speed:actor.speed})),...external];
      detectKnocks();
      for (let index = 0; index < actors.length; index++) {
        const actor = actors[index];
        if(actor.knocked){
          // Rapier moves this one. Track it so other cars still brake for it,
          // and hand it back to the lane once it has stopped sliding (or after
          // ten seconds, or if it was pushed off the loaded ground).
          const k=actor.knocked,t=actor.body.translation(),r=actor.body.rotation(),v=actor.body.linvel(),w=actor.body.angvel();
          const lost=![t.x,t.y,t.z].every(Number.isFinite)||t.y<sampleElevation(city,t.x,t.z)-6;
          if(!lost){
            actor.x=t.x;actor.z=t.z;actor.speed=Math.hypot(v.x,v.z);
            const fx=2*(r.x*r.z+r.w*r.y),fz=1-2*(r.x*r.x+r.y*r.y);if(Math.hypot(fx,fz)>.1)actor.yaw=Math.atan2(fx,fz);
            k.settled=Math.hypot(v.x,v.y,v.z)>.4||Math.hypot(w.x,w.y,w.z)>.4?0:k.settled+dt;
            tyreGrip(actor,dt);
          }
          const way=lost?'lost':k.settled>1.2||elapsed-k.since>10?rejoinWay(actor):'wait';
          if(way==='lost')relocate(actor,actor.path,Math.min(actor.path.length-.05,actor.distance));
          else if(way==='blocked'){if(!respawnAway(actor))relocate(actor,actor.path,Math.min(actor.path.length-.05,actor.distance));}
          else if(way==='clear')beginRejoin(actor,observer);
          else{rotation.set(r.x,r.y,r.z,r.w);position.set(t.x,t.y,t.z);draw(index);continue;}
        }
        const previousX=actor.x,previousZ=actor.z,previousYaw=actor.yaw,previousDistance=actor.distance;
        const forwardX = Math.sin(actor.yaw), forwardZ = Math.cos(actor.yaw);
        let target = actor.rejoin?0:actor.cruise;
        const p = at(actor.path, actor.distance), ahead = at(actor.path, actor.distance + 12);
        const upcomingYaw = Math.atan2(ahead[0] - p[0], ahead[1] - p[1]);
        const turn = Math.abs(Math.atan2(Math.sin(upcomingYaw - actor.yaw), Math.cos(upcomingYaw - actor.yaw)));
        target *= 1 - Math.min(.6, turn * .65);
        const stop=actor.path.stops.find(s=>s.distance>=actor.distance-.2);
        if(stop&&signalPhase(elapsed,stop.yaw)!=='green'){
          const gap=stop.distance-actor.distance;
          if(actor.signalStop!==stop.distance){actor.signalStop=stop.distance;actor.signalCommitted=actor.speed>2&&gap<actor.speed*actor.speed/12+1;}
          if(!actor.signalCommitted)target=Math.min(target,Math.sqrt(Math.max(0,2*5*(gap-.5))));
        }else{actor.signalStop=undefined;actor.signalCommitted=false;}
        const actorHeight=obstacles[index+1].y;
        for(let otherIndex=0;otherIndex<obstacles.length;otherIndex++){
          if(otherIndex===index+1)continue;
          const other=obstacles[otherIndex];
          if(Math.abs(other.y-actorHeight)>3)continue;
          const dx=other.x-actor.x,dz=other.z-actor.z,along=dx*forwardX+dz*forwardZ,across=Math.abs(dx*forwardZ-dz*forwardX);
          const gap=along-actor.spec.length/2-(other.halfLength??2.1)-2.3;
          if(along>0&&along<55&&across<actor.spec.width/2+.4+(other.halfWidth??.95))target=Math.min(target,Math.sqrt(Math.max(0,2*3.8*gap)));
          if(Math.hypot(dx,dz)<5&&along>-1)target=0;
        }
        const evasion=evade(actor,player,dt);
        const remaining = actor.path.length - actor.distance;
        if (remaining < 12) target = Math.min(target, Math.sqrt(Math.max(0, 2 * 3 * (remaining - 2))));
        actor.speed += Math.max(-6 * dt, Math.min(2.2 * dt, target - actor.speed));
        actor.distance = Math.min(actor.path.length - .05, actor.distance + actor.speed * dt);
        // Recycling occurs only well away from the player.
        if (remaining < 3 && Math.hypot(actor.x - observer.x, actor.z - observer.z) > localRadius*1.35) respawnAway(actor);
        let next=at(actor.path,actor.distance),look=at(actor.path,actor.distance+1.5);
        let yaw=distance(next,look)>.01?Math.atan2(look[0]-next[0],look[1]-next[1]):actor.yaw;
        if(evasion){
          const p=evasionPoint(actor,actor.distance,evasion.offset),shift=evasion.offset-evasion.state.offset;
          yaw=p.yaw+Math.atan2(shift,Math.max(.05,actor.distance-previousDistance));
          if(evasionClear(actor,actor.distance,evasion.offset,true,yaw)){
            next=[p.x,p.z];evasion.state.offset=evasion.offset;evasion.state.velocity=evasion.velocity;
          }else{
            // Brake and wait for clearance instead of making a kinematic shove.
            actor.distance=previousDistance;actor.speed=0;next=[previousX,previousZ];yaw=previousYaw;evasion.state.velocity=0;
          }
          if(evasion.state.target===0&&Math.abs(evasion.state.offset)<.015&&Math.abs(evasion.state.velocity)<.04)actor.evasion=undefined;
        }
        actor.x=next[0];actor.z=next[1];actor.yaw=yaw;
        const travel=Math.hypot(actor.x-previousX,actor.z-previousZ),turnAngle=Math.atan2(Math.sin(yaw-previousYaw),Math.cos(yaw-previousYaw));
        const steering=travel>.001?Math.max(-.5,Math.min(.5,Math.atan((actor.spec.frontAxle-actor.spec.rearAxle)*turnAngle/travel))):0;
        actor.steering+=Math.max(-2.5*dt,Math.min(2.5*dt,steering-actor.steering));
        const road=pathRoad(actor.path,actor.distance),normal=roadNormal(city,road,actor.x,actor.z),ground=sampleRoadElevation(city,road,actor.x,actor.z),pose=roadRotation(city,road,actor.x,actor.z,actor.yaw);
        rotation.set(pose.x,pose.y,pose.z,pose.w);position.set(actor.x+normal.x*NPC_BODY_LIFT,ground+normal.y*NPC_BODY_LIFT,actor.z+normal.z*NPC_BODY_LIFT);
        if(actor.rejoin){
          // Hold the blend while the chassis is in what is left of the way: a still kinematic car is a kerb, one moving at the chassis a shove.
          const rejoin=actor.rejoin,chassis=physics.chassisCollider.handle;
          if(!sweep(actor,actor.body.translation(),position,handle=>handle===chassis))rejoin.t+=dt;
          const u=rejoin.duration>0?Math.min(1,rejoin.t/rejoin.duration):1,s=u*u*(3-2*u);
          position.set(rejoin.x,rejoin.y,rejoin.z).lerp(meshPosition.set(actor.x+normal.x*NPC_BODY_LIFT,ground+normal.y*NPC_BODY_LIFT,actor.z+normal.z*NPC_BODY_LIFT),s);
          rotation.copy(rejoin.q).slerp(laneRotation.set(pose.x,pose.y,pose.z,pose.w),s);
          if(u>=1)actor.rejoin=undefined;
        }
        actor.body.setNextKinematicTranslation(position);
        actor.body.setNextKinematicRotation(rotation);
        draw(index);
      }
      fleet.flush();
    },
    setNight(night: boolean) {fleet.setNight(night);},
    dispose() {
      for (const actor of actors) physics.world.removeRigidBody(actor.body);
      fleet.dispose();
      scene.remove(group);
    },
  };
}
