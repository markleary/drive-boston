import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { CityData, Point2, VehicleState, Road } from '../types';
import type { DrivingPhysics } from '../physics/vehicle';
import {createNPCVehicleBatches} from '../render/npc-vehicles.ts';
import {NPC_BODY_LIFT,TRAFFIC_CAPACITY,npcVehicleAt,npcPaint,type NPCVehicleSpec} from './npc-vehicle-specs.ts';
import {createNPCVehicleColliders} from '../physics/npc-vehicle.ts';
import { sampleElevation } from './terrain.ts';
import {headOnThreat,advanceEvasion,type Evasion} from './traffic-evasion.ts';
import {CONFLICT,firstContact,clearance,crossing,rightOfWay,yieldSpeed,blockingCycle,type Pose,type Trajectory} from './traffic-conflicts.ts';
import { pointInside } from './roads.ts';
import { coverageTester } from './coverage.ts';
import { sampleRoadElevation,roadNormal,roadRotation,sampleVehicleSurface,roadProjection,roadWidthAt } from './road-surfaces.ts';
import { signalPhase } from './signals.ts';
import type { TrafficObstacle } from './transit.ts';
import { createActivityProfile } from './activity.ts';
import {createRouteSignalLookup} from './traffic-route-signals.ts';
import {constructionLanePoints,type ConstructionZone} from './construction-zones.ts';
import {isMotorway,speedClass,motorwayLanes,CLOSURE_SETBACK,SINK_BEYOND,pointAtDistance,stations} from './motorway.ts';
import {tunnelCoveredAt,tunnelStations} from './tunnels.ts';

/** `sink`: the edge ends at a closed end or tunnel cap, whose barrier its cars
 * drive through and vanish behind; `source`: cars emerge from one at its start. */
interface Edge { id: number; start: number; end: number; points: Point2[]; length:number; name: string; width: number; oneway: boolean; road:Road; laneOffset?:number; sink?:boolean; source?:boolean; }
/** `source` keeps the unrounded lane points (and the source vertex of each rounded
 * point) so a route can be extended in place; `last` is its final graph edge.
 * `sinkAt` is the station just past the barrier where a route into a closed end vanishes,
 * `changes` the stations where its speed class (street, ramp, highway) changes,
 * `merges` where it passes an entrance gore (a carriageway record starting
 * where two highway records end). */
export interface Path { points: Point2[]; distances: number[]; length: number; stops: {distance:number;yaw:number}[]; roadAt:Road[]; component?: number; last?:Edge; source:{points:Point2[];roads:Road[];vertex:number[]}; sinkAt?:number; sourceAt?:number; changes?:{distance:number;road:Road}[]; merges?:number[]; }
/** A struck car runs as a dynamic body (`knocked`) until it comes to rest, then
 * eases back onto its lane over `rejoin` from the pose it was left in. A
 * `parked` car has driven into a closed end and waits, hidden, to be placed again;
 * a `hidden` one rides a deck that has not streamed in. */
interface Actor { body: RAPIER.RigidBody; collider: RAPIER.Collider; colliders:RAPIER.Collider[]; spec:NPCVehicleSpec; registration:string; path: Path; distance: number; speed: number; cruise: number; x: number; z: number; yaw: number; color: THREE.Color; steering:number; evasion?:Evasion; signalStop?: number; signalCommitted?: boolean; knocked?: { since: number; settled: number }; rejoin?: { t: number; duration: number; x: number; y: number; z: number; q: THREE.Quaternion }; waiting:number; priorityUntil?:number; ended?:number; parked?:boolean; hidden?:boolean; }
type FleetObstacle = TrafficObstacle & { hidden?: boolean };
/** A car on an undrawn deck still leads a visible car along the route it is about
 * to join (the queue it reaches keeps its spacing), but never makes it yield to a
 * crossing it cannot see; a hidden car sees every car. */
const leads=(actor:{hidden?:boolean},other:FleetObstacle,heading:number)=>!!actor.hidden||!other.hidden||(other.yaw!==undefined&&Math.cos(other.yaw-heading)>.5);
const COUNT = TRAFFIC_CAPACITY;
/** Highway cruise ranges (m/s): a car's own temper, from its seeded street
 * cruise, picks its speed within each, so it keeps its place in the order. */
export const MOTORWAY_CRUISE:[number,number]=[24,29],RAMP_CRUISE:[number,number]=[13,17];
/** Highway following (Gipps): reaction time (s), braking assumed of both cars
 * (m/s²), standstill gap (m) and how far ahead (m) a car looks for its leader. */
export const FOLLOW={reaction:1.1,brake:4,standstill:2.5,reach:160};
/** The highest speed from which a car can still stop behind a leader `gap`
 * metres ahead (bumper to bumper) driving at `lead` and braking as hard. */
export function followSpeed(gap:number,lead:number){
  const b=FOLLOW.brake,t=FOLLOW.reaction;
  return Math.max(0,-b*t+Math.sqrt(b*b*t*t+lead*lead+2*b*Math.max(0,gap-FOLLOW.standstill)));
}
/** Cars kept on the highway around an observer driving on it (2) or beside it
 * (1), within `MOTORWAY_REACH` metres, plus a share left for the streets. */
export const MOTORWAY_DENSITY=[0,24,56],MOTORWAY_STREETS=18,MOTORWAY_REACH=500;
/** Highway placements keep this plan distance (m) from every other car. */
const MOTORWAY_HEADWAY=22;
/** Chance per joint that a highway car moves over a lane, and that one in the
 * two lanes nearest an exit takes it (two lanes; three or more). */
export const LANE_CHANGE=.12,EXIT_SHARE=[.25,.35];
/** Conflict look-ahead cap (m) of a car within `MERGE_WINDOW` metres before an
 * entrance gore on its route, about its braking distance from 28 m/s (elsewhere
 * CONFLICT.maxHorizon): a car closing on a ramp merge sees the ramp car
 * converging early enough to settle the order by arrival. */
const MOTORWAY_HORIZON=120,MERGE_WINDOW=400;
/** A closed start emits a car per lane every 1.5 to 4 s while the observer is within this many metres. */
const EMIT_RANGE=750;
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
  const candidates:{road:Road;points:Point2[];length:number;start:number;end:number;first:boolean;last:boolean}[]=[],incident=new Map<number,Set<number>>();
  // Survey-deck traces (the Zakim viaduct) are graph edges only, outside city.roads.
  const roads=city.surveyRoads?.length?[...city.roads,...city.surveyRoads]:city.roads;
  // A ramp lands on an existing street vertex, often inside the street's record:
  // split the street there (only there) so the ramp joins the graph.
  const landings=new Map<number,{p:Point2;height:number}[]>(),cell=(cx:number,cz:number)=>(cx+100000)*200003+cz+100000;
  let landMinX=Infinity,landMaxX=-Infinity,landMinZ=Infinity,landMaxZ=-Infinity;
  for(const road of roads)if(isMotorway(road)&&road.traffic!==false&&road.points.length>=2)for(const p of [road.points[0],road.points[road.points.length-1]]){
    const key=cell(Math.floor(p[0]/4),Math.floor(p[1]/4)),entry={p,height:sampleRoadElevation(city,road,...p)},list=landings.get(key);if(list)list.push(entry);else landings.set(key,[entry]);
    landMinX=Math.min(landMinX,p[0]);landMaxX=Math.max(landMaxX,p[0]);landMinZ=Math.min(landMinZ,p[1]);landMaxZ=Math.max(landMaxZ,p[1]);
  }
  const landsAt=(road:Road,p:Point2)=>{
    if(p[0]<landMinX-1||p[0]>landMaxX+1||p[1]<landMinZ-1||p[1]>landMaxZ+1)return false;
    const cx=Math.floor(p[0]/4),cz=Math.floor(p[1]/4);let height:number|undefined;
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const landing of landings.get(cell(cx+dx,cz+dz))??[])if(distance(landing.p,p)<1){height??=sampleRoadElevation(city,road,...p);if(Math.abs(landing.height-height)<1)return true;}
    return false;
  };
  for (const road of roads) {
    if(road.traffic===false)continue;
    const arterial=/^(primary|secondary)$/.test(road.kind??'')&&!/^unnamed\b/i.test(road.name);
    const tobinRamp=road.bridge?.id==='tobin-approach'&&road.oneway!==0&&road.width>=5.5;
    // Highway decks and ramps join whatever their width (a one-lane ramp is
    // narrower than a minor street), and so does a street a ramp lands on, so
    // the ramp has a way on. (`\balley` keeps Mystic Valley Parkway.)
    if (road.points.length<2 || (!tobinRamp&&!isMotorway(road)&&(road.width < 7 || (road.width<8&&!arterial&&(activityAt(...road.points[0]).level!=='busy'||!/(street|avenue|road|boulevard|parkway)$/i.test(road.name))))&&!(landings.size&&road.points.some(p=>landsAt(road,p)))) || /\balley|private|ring road|cahners|copley place/i.test(road.name)) continue;
    const points = road.points.filter((p, i, a) => i === 0 || distance(p, a[i - 1]) > .5);
    if (points.length < 2) continue;
    const cuts=[0];if(landings.size)for(let i=1;i<points.length-1;i++)if(landsAt(road,points[i]))cuts.push(i);cuts.push(points.length-1);
    for(let c=1;c<cuts.length;c++){
      const piece=cuts.length===2?points:points.slice(cuts[c-1],cuts[c]+1);
      const length=piece.slice(1).reduce((sum,p,i)=>sum+distance(piece[i],p),0);if(length<1)continue;
      const start = node(piece[0],sampleRoadElevation(city,road,...piece[0])), end = node(piece[piece.length - 1],sampleRoadElevation(city,road,...piece[piece.length-1]));
      if(start===end&&length<12)continue;
      const index=candidates.length;candidates.push({road,points:piece,length,start,end,first:c===1,last:c===cuts.length-1});
      for(const n of [start,end]){const list=incident.get(n)??new Set<number>();list.add(index);incident.set(n,list);}
    }
  }
  // Source ways split at lane changes and bridge tags, sometimes only a few
  // metres apart. Keep those connecting pieces without populating short
  // isolated stubs; prune a dangling chain all the way back to its main road.
  // A one-way highway record that nothing leaves at its travel end, which is
  // not closed (a tunnel entrance whose survey trace is missing, as the Cross
  // Street entrance's was), would park every car that takes it there: it goes
  // too, and so does a highway record left leading only into it.
  const closedAt=(road:Road,at:'start'|'end')=>road.closed===at||(at==='start'?!!road.tunnel?.capStart:!!road.tunnel?.capEnd);
  const departs=(i:number,n:number)=>{const c=candidates[i];return (c.road.oneway>=0&&c.start===n)||(c.road.oneway<=0&&c.end===n);};
  const deadEnd=(index:number)=>{
    const c=candidates[index],n=c.road.oneway>0?c.end:c.start;
    return isMotorway(c.road)&&c.road.oneway!==0&&!(c.road.oneway>0?c.last&&closedAt(c.road,'end'):c.first&&closedAt(c.road,'start'))&&![...incident.get(n)??[]].some(i=>i!==index&&departs(i,n));
  };
  const removed=new Set<number>(),pending=candidates.map((_,i)=>i);
  while(pending.length){
    const index=pending.pop()!,c=candidates[index];if(removed.has(index)||(c.length>=12&&!deadEnd(index)))continue;
    if(c.length<12&&(incident.get(c.start)?.size??0)>1&&(incident.get(c.end)?.size??0)>1)continue;
    removed.add(index);
    for(const n of [c.start,c.end]){const list=incident.get(n)!;list.delete(index);pending.push(...list);}
  }
  for(const [index,{road,points,length,start,end,first,last}]of candidates.entries()){
    if(removed.has(index))continue;
    const closed=(at:'start'|'end')=>closedAt(road,at);
    const add = (ps: Point2[], a: number, b: number, forward:boolean) => {
      // Lane offsets follow the measured roadway, not the class width: a one-way class avenue carries two lanes only where the curbs leave room for them
      // (Huntington Avenue's carriageways beside the Green Line reservation measure 7.5 m against a 15 m class width; its Copley Place lane 5.3 m).
      // A highway deck carries its own lane count.
      const paved=road.pavedWidth??road.width;
      const lanes:(number|undefined)[]=road.bridge?.id==='tobin'&&road.oneway!==0?[-road.width/3,0,road.width/3]:road.lanes!==undefined&&road.oneway!==0?motorwayLanes(road):road.oneway!==0&&road.width>=12&&paved>=6.5?[-Math.min(3,paved*.17),Math.min(3,paved*.17)]:[undefined];
      const sink=forward?last&&closed('end'):first&&closed('start'),source=forward?first&&closed('start'):last&&closed('end');
      for(const laneOffset of lanes){
        const edge:Edge={ id: edges.length, start: a, end: b, points: ps, length, name: road.name, width: road.width, oneway: road.oneway !== 0,road,laneOffset };
        if(sink)edge.sink=true;if(source)edge.source=true;
        if(city.coverage?.length&&!lane(edge).every(p=>covered(p[0],p[1])))continue;
        edges.push(edge);
      }
    };
    if (road.oneway >= 0) add(points, start, end, true);
    if (road.oneway <= 0) add([...points].reverse(), end, start, false);
  }
  return { nodes, heights, edges };
}

/** The lane centerline an edge's traffic follows: offset from the road centerline within the measured roadway. */
export function lane(edge: Edge,constructionZones:readonly ConstructionZone[]=[]): Point2[] {
  const paved = edge.road.pavedWidth ?? edge.width, offset = edge.laneOffset ?? (edge.oneway ? Math.min(2, paved * .14) : Math.min(3, paved * .23));
  return constructionLanePoints(edge.road,edge.points,offset,constructionZones);
}

/** `owners[i]` is the road of the lane that reaches vertex i, so the segment
 * leaving vertex i belongs to `owners[i+1]`: a junction vertex keeps the arriving
 * road (the next lane's first point is dropped as a duplicate or cut away in
 * `join`), and attributing the departing segment to it as well put a car on a
 * street at the clamped end height of the deck it had just left (sunk 0.65 m on
 * New Rutherford Avenue after the Austin Street deck) or carried a street's
 * terrain height onto the first span of a bridge. `roadAt[k]` is the road of the
 * segment that starts at rounded point k, which is what `pathRoad` reads. */
export function roundedPath(points: Point2[],roads:Road[]): Path {
  const clean:Point2[]=[],owners:Road[]=[];points.forEach((p,i)=>{if(i===0||distance(p,points[i-1])>.15){clean.push(p);owners.push(roads[i]);}});
  const rounded: Point2[] = [clean[0]],roadAt:Road[]=[owners[Math.min(1,owners.length-1)]],vertex=[0];
  for (let i = 1; i < clean.length - 1; i++) {
    const a = clean[i - 1], b = clean[i], c = clean[i + 1];
    const ab = distance(a, b), bc = distance(b, c);
    const trim = Math.min(7, ab * .34, bc * .34);
    const before: Point2 = [b[0] + (a[0] - b[0]) * trim / ab, b[1] + (a[1] - b[1]) * trim / ab];
    const after: Point2 = [b[0] + (c[0] - b[0]) * trim / bc, b[1] + (c[1] - b[1]) * trim / bc];
    rounded.push(before);roadAt.push(owners[i]);vertex.push(i);
    for (let j = 1; j <= 6; j++) {
      const t = j / 6, u = 1 - t;
      // Up to the apex (j = 3, on the junction vertex) the corner lies on the arriving lane; the segments from the apex on are on the departing one.
      rounded.push([u * u * before[0] + 2 * u * t * b[0] + t * t * after[0], u * u * before[1] + 2 * u * t * b[1] + t * t * after[1]]);roadAt.push(owners[j<=2?i:i+1]);vertex.push(i);
    }
  }
  rounded.push(clean[clean.length - 1]);roadAt.push(owners[owners.length-1]);vertex.push(clean.length-1);
  const distances = [0];
  for (let i = 1; i < rounded.length; i++) distances.push(distances[i - 1] + distance(rounded[i - 1], rounded[i]));
  return { points: rounded, distances, length: distances[distances.length - 1], stops: [],roadAt,source:{points:clean,roads:owners,vertex} };
}

function at(path: Path, s: number): Point2 {
  s = Math.max(0, Math.min(path.length, s));
  let lo = 0, hi = path.distances.length - 1;
  while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (path.distances[mid] < s) lo = mid; else hi = mid; }
  const a = path.points[lo], b = path.points[hi], t = (s - path.distances[lo]) / (path.distances[hi] - path.distances[lo] || 1);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** `at` for stations that only grow (a trajectory's samples): it walks forward
 * from the last segment instead of searching the whole path each time. */
function walker(path:Path){
  let lo=-1;const d=path.distances,n=d.length;
  return (s:number):Point2=>{
    s=Math.max(0,Math.min(path.length,s));
    if(lo<0||d[lo]>=s){lo=0;let hi=n-1;while(lo+1<hi){const mid=(lo+hi)>>1;if(d[mid]<s)lo=mid;else hi=mid;}}
    while(lo+2<n&&d[lo+1]<s)lo++;
    const a=path.points[lo],b=path.points[Math.min(n-1,lo+1)],t=(s-d[lo])/(d[Math.min(n-1,lo+1)]-d[lo]||1);
    return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  };
}

/** The road under a path station: the owner of the rounded segment containing it. */
export function pathRoad(path:Path,distance:number){let lo=0,hi=path.distances.length-1;while(lo+1<hi){const mid=(lo+hi)>>1;if(path.distances[mid]<distance)lo=mid;else hi=mid;}return path.roadAt[lo];}
function pathYaw(path:Path,distance:number){distance=Math.min(distance,path.length-2);const a=at(path,distance),b=at(path,distance+2);return Math.atan2(b[0]-a[0],b[1]-a[1]);}

/** Append a lane to a route. Lanes sit to one side of their centerlines, so at
 * a sharp turn the end of one can lie beyond the start of the next; joined end
 * to end the route would double back and loop through the junction (Beacon
 * Street onto Brookline Avenue at Kenmore). Where they meet at an angle, both
 * are cut at the point where their lines cross instead. */
export function join(points:Point2[],roads:Road[],next:Point2[],road:Road){
  const a0=points[points.length-2],a1=points[points.length-1],b0=next[0],b1=next[1];
  if(a0&&b1){
    const ax=a1[0]-a0[0],az=a1[1]-a0[1],al=Math.hypot(ax,az),bx=b1[0]-b0[0],bz=b1[1]-b0[1],bl=Math.hypot(bx,bz),cross=(ax*bz-az*bx)/(al*bl||1);
    if(Math.abs(cross)>.34&&al>.5&&bl>.5){
      // a1 + t·â = b0 + u·b̂, with t and u in metres along each lane.
      const dx=b0[0]-a1[0],dz=b0[1]-a1[1],t=(dx*bz-dz*bx)/bl/cross,u=(dx*az-dz*ax)/al/cross;
      if(t>-al+.5&&t<15&&u>-15&&u<bl-.5){
        points[points.length-1]=[a1[0]+ax/al*t,a1[1]+az/al*t];
        for(let i=1;i<next.length;i++){points.push(next[i]);roads.push(road);}
        return;
      }
    }
  }
  points.push(...next);roads.push(...next.map(()=>road));
}

/** Candidate metres back along the route and ahead into the next lane for a highway blend. */
const BLEND_STEPS=[0,8,16,25,35,50,65,80,100,120,145];
/** Steepest blend allowed: one metre sideways in fourteen along. */
const BLEND_SLOPE=14;
/** Append a highway lane whose start is offset sideways from the route's end:
 * a lane added or dropped, a gore (a ramp's centreline starts on the
 * carriageway's), a lane change. Leave the route up to 145 m before the joint
 * and enter the lane up to 145 m into it, the shortest such pair joined by a
 * smooth curve no steeper than one in fourteen, so a car drifts over instead of
 * stepping sideways. Points before index `keep` stay (a car is on them).
 * Returns the index of the first point changed. */
export function blendJoin(points:Point2[],roads:Road[],next:Point2[],road:Road,keep=0){
  const n=points.length;
  if(n<2||next.length<2||distance(points[n-1],next[0])<.3){join(points,roads,next,road);return n;}
  // back[k]: metres from the route's end back to points[n-1-k], down to index keep.
  const back=[0];for(let i=n-1;i>Math.max(0,keep);i--)back.push(back[back.length-1]+distance(points[i],points[i-1]));
  const ahead=[0];for(let i=1;i<next.length;i++)ahead.push(ahead[i-1]+distance(next[i-1],next[i]));
  const behind=(w:number)=>{
    if(w<=0||back.length<2){const a=points[n-2],b=points[n-1],length=distance(a,b)||1;return{p:b,dir:[(b[0]-a[0])/length,(b[1]-a[1])/length] as Point2,index:n-1};}
    let k=1;while(k<back.length-1&&back[k]<w)k++;
    const i=n-1-k,a=points[i],b=points[i+1],span=back[k]-back[k-1],t=span>0?Math.min(1,(w-back[k-1])/span):0,length=distance(a,b)||1;
    return{p:[b[0]+(a[0]-b[0])*t,b[1]+(a[1]-b[1])*t] as Point2,dir:[(b[0]-a[0])/length,(b[1]-a[1])/length] as Point2,index:i};
  };
  const into=(u:number)=>{
    let k=1;while(k<ahead.length-1&&ahead[k]<u)k++;
    const a=next[k-1],b=next[k],span=ahead[k]-ahead[k-1],t=span>0?Math.max(0,Math.min(1,(u-ahead[k-1])/span)):0,length=distance(a,b)||1;
    return{p:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t] as Point2,dir:[(b[0]-a[0])/length,(b[1]-a[1])/length] as Point2,index:k};
  };
  const reachBack=back[back.length-1],reachAhead=ahead[ahead.length-1]-1;
  let best:{w:number;u:number;score:number}|undefined;
  for(const w of BLEND_STEPS)if(w<=reachBack)for(const u of BLEND_STEPS)if(u<=reachAhead){
    const a=behind(w),b=into(u),cx=b.p[0]-a.p[0],cz=b.p[1]-a.p[1],c=Math.hypot(cx,cz);if(c<2)continue;
    if((cx*a.dir[0]+cz*a.dir[1])/c<.9||a.dir[0]*b.dir[0]+a.dir[1]*b.dir[1]<.9)continue;
    const side=Math.max(Math.abs(cx*a.dir[1]-cz*a.dir[0]),Math.abs(cx*b.dir[1]-cz*b.dir[0]));
    const score=side<=c/BLEND_SLOPE+.1?w+u:1e6+side/c;
    if(!best||score<best.score)best={w,u,score};
  }
  if(!best){join(points,roads,next,road);return n;}
  const a=behind(best.w),b=into(best.u),c=distance(a.p,b.p),before=roads[a.index];
  points.length=a.index+1;roads.length=a.index+1;
  if(distance(points[a.index],a.p)>.05){points.push(a.p);roads.push(before);}
  // Cubic Hermite from the route's heading to the lane's.
  const steps=Math.max(2,Math.ceil(c/5));
  for(let j=1;j<steps;j++){
    const t=j/steps,t2=t*t,t3=t2*t,h00=2*t3-3*t2+1,h10=t3-2*t2+t,h01=-2*t3+3*t2,h11=t3-t2;
    points.push([h00*a.p[0]+h10*c*a.dir[0]+h01*b.p[0]+h11*c*b.dir[0],h00*a.p[1]+h10*c*a.dir[1]+h01*b.p[1]+h11*c*b.dir[1]]);roads.push(t<.5?before:road);
  }
  points.push(b.p);roads.push(road);
  for(let k=b.index;k<next.length;k++)if(distance(points[points.length-1],next[k])>.05){points.push(next[k]);roads.push(road);}
  return a.index+1;
}

/** Lightweight local traffic; all routes follow the imported directed road graph.
 * `deckDrawn` hides traffic until its supporting deck is visible. */
export function createTraffic(scene: THREE.Scene, city: CityData, physics: DrivingPhysics,constructionZones:readonly ConstructionZone[]=[],{deckDrawn}:{deckDrawn?:(road:Road)=>boolean}={}) {
  const { nodes, heights, edges } = roadGraph(city);
  const zonesByRoad=new Map<string,ConstructionZone[]>(),lanes=new Map<Edge,Point2[]>();
  for(const zone of constructionZones){const list=zonesByRoad.get(zone.roadId)??[];list.push(zone);zonesByRoad.set(zone.roadId,list);}
  // Retain densified worksite lanes only; ordinary metro streets need no new
  // city-wide geometry cache on memory-constrained phones.
  const laneFor=(edge:Edge)=>{
    const zones=zonesByRoad.get(edge.road.id);if(!zones)return lane(edge);
    let points=lanes.get(edge);if(!points){points=lane(edge,zones);lanes.set(edge,points);}return points;
  };
  const spawnEdges=edges.filter(edge=>edge.length>=12);
  const activityAt=createActivityProfile(city);
  const outgoing = new Map<number, Edge[]>(), connections = new Map<number, Set<number>>(), arriving=new Map<number,Set<Road>>();
  for(const edge of edges){
    const next=outgoing.get(edge.start);if(next)next.push(edge);else outgoing.set(edge.start,[edge]);
    if(!connections.has(edge.start))connections.set(edge.start,new Set());if(!connections.has(edge.end))connections.set(edge.end,new Set());
    connections.get(edge.start)!.add(edge.end);connections.get(edge.end)!.add(edge.start);
    if(isMotorway(edge.road)){const roads=arriving.get(edge.end);if(roads)roads.add(edge.road);else arriving.set(edge.end,new Set([edge.road]));}
  }
  const mergeRoads=new Set(edges.filter(edge=>speedClass(edge.road)===2&&(arriving.get(edge.start)?.size??0)>=2).map(edge=>edge.road));
  const components=new Map<number,number>();let component=0;
  for(const node of connections.keys())if(!components.has(node)){
    const stack=[node];components.set(node,component);
    while(stack.length){const current=stack.pop()!;for(const next of connections.get(current)??[])if(!components.has(next)){components.set(next,component);stack.push(next);}}
    component++;
  }
  // Match measured signal locations to graph junctions, rather than treating a
  // roadside signal point as if it sat in the middle of the driving lane. A
  // highway gore or lane drop is no intersection (only junctions a street
  // reaches count), and a route stops only on the junction's own level, so a
  // deck passing over a signalled crossing keeps going.
  const streetNodes=new Set<number>();for(const edge of edges)if(!isMotorway(edge.road)){streetNodes.add(edge.start);streetNodes.add(edge.end);}
  const signalNodes=nodes.flatMap((point, index) => {
    const branches = connections.get(index)??new Set<number>();
    return branches.size >= 3 && streetNodes.has(index) && city.signals.some(signal => distance(signal, point) < 24)?[index]:[];
  });
  const routeSignalStops=createRouteSignalLookup(signalNodes.map(index=>nodes[index]));
  // Sibling lanes of one edge, for the lane a highway car is in counted from either side.
  const laneSets=new Map<string,number[]>(),laneKey=(edge:Edge)=>`${edge.road.id}|${edge.start}|${edge.end}`;
  for(const edge of edges)if(edge.laneOffset!==undefined){const key=laneKey(edge),list=laneSets.get(key);if(list)list.push(edge.laneOffset);else laneSets.set(key,[edge.laneOffset]);}
  // Highway carriageway stations every 25 m, for how close an observer is to the highway (`covered`: under a tunnel's cover).
  const highwayEdges=edges.filter(edge=>speedClass(edge.road)===2&&edge.length>=12),HIGHWAY_CELL=100,highwayCells=new Map<string,{p:Point2;y:number;tunnel:boolean;covered:boolean}[]>();
  for(const road of new Set(highwayEdges.map(edge=>edge.road))){
    const along=stations(road.points),total=along[along.length-1];
    for(let s=0;s<=total;s+=25){const {p}=pointAtDistance(road.points,s,along),key=`${Math.floor(p[0]/HIGHWAY_CELL)},${Math.floor(p[1]/HIGHWAY_CELL)}`,entry={p,y:sampleRoadElevation(city,road,...p),tunnel:!!road.tunnel,covered:tunnelCoveredAt(road,s)},list=highwayCells.get(key);if(list)list.push(entry);else highwayCells.set(key,[entry]);}
  }
  /** An observer more than 4 m below the ground is in a tunnel and sees the tunnel
   * records' traffic; one above ground sees every station open to the sky, a
   * tunnel's portal approaches included (`tunnel.covered` leaves them out). */
  const underground=(o:{x:number;y?:number;z:number})=>o.y!==undefined&&o.y<sampleElevation(city,o.x,o.z)-4;
  /** Whether a record has a stretch open to the sky: any but a tunnel covered end to end. */
  const open=(road:Road)=>!road.tunnel||!!road.tunnel.covered;
  /** Whether (x, z) on `road` lies under its tunnel's cover. */
  function coveredAt(road:Road,x:number,z:number){
    if(!road.tunnel?.covered)return !!road.tunnel;
    const {index,t}=roadProjection(road,x,z),along=tunnelStations(road);
    return tunnelCoveredAt(road,along[index]+(along[index+1]-along[index])*t);
  }
  /** 2 on a highway carriageway (within 30 m and 6 m of its level), 1 beside one (260 m, 18 m), else 0. */
  function motorwayLevel(observer:{x:number;y?:number;z:number}){
    if(!highwayCells.size)return 0;
    const below=underground(observer),cx=Math.floor(observer.x/HIGHWAY_CELL),cz=Math.floor(observer.z/HIGHWAY_CELL);let level=0;
    for(let dx=-3;dx<=3;dx++)for(let dz=-3;dz<=3;dz++)for(const sample of highwayCells.get(`${cx+dx},${cz+dz}`)??[]){
      if(below?!sample.tunnel:sample.covered)continue;
      const d=Math.hypot(sample.p[0]-observer.x,sample.p[1]-observer.z),dy=observer.y===undefined?0:Math.abs(sample.y-observer.y);
      if(d<30&&dy<6)return 2;if(d<260&&dy<18)level=1;
    }
    return level;
  }
  // Where two source datasets meet, a street can end a few metres short of its
  // continuation without sharing a graph node (Huntington Avenue and Washington
  // Street at the Brookline line); routes may bridge such a seam.
  const SEAM=9,seamCells=new Map<string,Edge[]>(),seamKey=(p:Point2)=>`${Math.floor(p[0]/SEAM)},${Math.floor(p[1]/SEAM)}`;
  for(const edge of edges){const key=seamKey(edge.points[0]),list=seamCells.get(key);if(list)list.push(edge);else seamCells.set(key,[edge]);}
  function seamOptions(edge:Edge,dir:number[]){
    const joint=edge.points[edge.points.length-1],height=sampleRoadElevation(city,edge.road,...joint),cx=Math.floor(joint[0]/SEAM),cz=Math.floor(joint[1]/SEAM),options:Edge[]=[];
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const next of seamCells.get(`${cx+dx},${cz+dz}`)??[]){
      if(next.start===edge.end||next.end===edge.start||distance(next.points[0],joint)>SEAM)continue;
      const forward=[next.points[1][0]-next.points[0][0],next.points[1][1]-next.points[0][1]];
      if((forward[0]*dir[0]+forward[1]*dir[1])/(Math.hypot(...forward)*Math.hypot(...dir))<.5)continue;
      if(Math.abs(sampleRoadElevation(city,next.road,...next.points[0])-height)<1.5)options.push(next);
    }
    return options;
  }
  // `level` and `highway`: the observer's motorwayLevel and the highway cars within MOTORWAY_REACH, as of the last refill.
  let elapsed = 0, rehomeTimer=0, level=0, highway=0;
  let seed = 43571;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const choose = <T,>(array: T[]) => array[Math.floor(random() * array.length)];
  /** A lane's first or last point and its heading, from the edge's centreline (worksites never reach a record's ends). */
  function laneTip(edge:Edge,start:boolean){
    const ps=edge.points,p=start?ps[0]:ps[ps.length-1],q=start?ps[1]:ps[ps.length-2],sign=start?-1:1,dx=(p[0]-q[0])*sign,dz=(p[1]-q[1])*sign,length=Math.hypot(dx,dz)||1;
    const paved=edge.road.pavedWidth??edge.width,offset=edge.laneOffset??(edge.oneway?Math.min(2,paved*.14):Math.min(3,paved*.23));
    return{p:[p[0]-dz/length*offset,p[1]+dx/length*offset] as Point2,dir:[dx/length,dz/length] as Point2};
  }
  /** The lane a highway car takes at a joint: its own lane on (the nearest where
   * lanes are added or dropped, now and then the next one over); from the two
   * lanes nearest an exit it leaves a quarter to a third of the time; off a
   * ramp it merges into the outer lane on its own side. */
  function motorwayChoice(edge:Edge,options:Edge[]){
    const end=laneTip(edge,false),right:Point2=[-end.dir[1],end.dir[0]];
    const lateral=(o:Edge)=>{const p=laneTip(o,true).p;return(p[0]-end.p[0])*right[0]+(p[1]-end.p[1])*right[1];};
    const keepLane=(list:Edge[])=>{
      const sorted=[...list].sort((a,b)=>lateral(a)-lateral(b));let best=0;
      for(let i=1;i<sorted.length;i++)if(Math.abs(lateral(sorted[i]))<Math.abs(lateral(sorted[best])))best=i;
      const tie=sorted.findIndex((o,i)=>i!==best&&Math.abs(Math.abs(lateral(o))-Math.abs(lateral(sorted[best])))<.3);
      if(tie>=0&&random()<.5)best=tie;
      if(sorted.length>1&&random()<LANE_CHANGE)best=Math.max(0,Math.min(sorted.length-1,best+(random()<.5?-1:1)));
      return sorted[best];
    };
    const own=speedClass(edge.road),main=options.filter(o=>speedClass(o.road)===2),ramps=options.filter(o=>speedClass(o.road)===1);
    if(own===2&&main.length&&ramps.length){
      const a=ramps[0].points[0],b=pointAtDistance(ramps[0].points,40).p,exit=(b[0]-a[0])*right[0]+(b[1]-a[1])*right[1]>=0?1:-1;
      const offset=edge.laneOffset??0,set=laneSets.get(laneKey(edge))??[offset],rank=set.filter(o=>(o-offset)*exit>1e-6).length;
      if(rank<2&&random()<EXIT_SHARE[set.length>=3?1:0]){const outer=[...ramps].sort((p,q)=>((q.laneOffset??0)-(p.laneOffset??0))*exit);return outer[Math.min(rank,outer.length-1)];}
      return keepLane(main);
    }
    if(own===1&&main.length&&!ramps.length){
      const tip=edge.points[edge.points.length-1],back=pointAtDistance([...edge.points].reverse(),40).p,start=laneTip(main[0],true),side=(back[0]-tip[0])*-start.dir[1]+(back[1]-tip[1])*start.dir[0]>=0?1:-1;
      return [...main].sort((p,q)=>((q.laneOffset??0)-(p.laneOffset??0))*side)[0];
    }
    const same=options.filter(o=>speedClass(o.road)===own);
    return keepLane(same.length?same:options);
  }
  /** Append up to 15 streets after `edge` to the lane points; returns the final
   * edge and the first point index a highway blend changed (Infinity for none).
   * When extending a running route, a street that stops at a dataset seam carries
   * on across it and a dead end turns back along its own street. (New routes end
   * there as they always have, which keeps the opening fleet layout unchanged.)
   * A route into a closed end stops there. */
  function follow(edge:Edge,points:Point2[],roads:Road[],extending=false,keep=0){
    let cut=Infinity;
    // Connector fragments must not spend the normal 15-street route budget,
    // or cars would still stop near the player after a densely split junction.
    for (let n = 0,connectors=0; n < 15&&connectors<64;) {
      const before = edge.points[edge.points.length - 2], joint = edge.points[edge.points.length - 1];
      const dir = [joint[0] - before[0], joint[1] - before[1]];
      const leaving=outgoing.get(edge.end)??[],current=edge;
      let options = leaving.filter(next => {
        if (next.end === edge.start) return false;
        const forward = [next.points[1][0] - next.points[0][0], next.points[1][1] - next.points[0][1]];
        return (forward[0] * dir[0] + forward[1] * dir[1]) / (Math.hypot(...forward) * Math.hypot(...dir)) > -.8;
      });
      if(!options.length&&extending)options=seamOptions(edge,dir);
      if(!options.length&&extending)options=leaving.filter(next=>next.end===current.start&&next.road===current.road);
      if (!options.length) break;
      if(isMotorway(edge.road)&&options.some(next=>isMotorway(next.road)))edge=motorwayChoice(edge,options);
      else{
        const sameStreet = options.filter(next => next.name === edge.name);
        const sameLane=sameStreet.filter(next=>next.laneOffset===edge.laneOffset);
        edge = choose(sameStreet.length && random() < .65 ? (sameLane.length?sameLane:sameStreet) : options);
      }
      if(edge.length>=12)n++;else connectors++;
      if(isMotorway(current.road)&&isMotorway(edge.road))cut=Math.min(cut,blendJoin(points,roads,laneFor(edge),edge.road,keep));
      else join(points,roads,laneFor(edge),edge.road);
      if(edge.sink)break;
    }
    return {edge,cut};
  }
  function finish(path:Path,last:Edge){
    path.last=last;path.component=components.get(last.start);
    path.stops=routeSignalStops(path.points,path.distances,(junction,along)=>{const p=at(path,along);return Math.abs(sampleRoadElevation(city,pathRoad(path,along),p[0],p[1])-heights[signalNodes[junction]])<3;}).map(distance=>({distance,yaw:pathYaw(path,distance)}));
    if(last.sink)path.sinkAt=Math.max(0,path.length-CLOSURE_SETBACK+SINK_BEYOND);
    let speed=-1;path.changes=[];path.merges=[];
    for(let k=0;k<path.roadAt.length;k++){const c=speedClass(path.roadAt[k]);if(c!==speed){if(speed>=0)path.changes.push({distance:path.distances[k],road:path.roadAt[k]});speed=c;}if(k&&path.roadAt[k]!==path.roadAt[k-1]&&mergeRoads.has(path.roadAt[k]))path.merges.push(path.distances[k]);}
    return path;
  }
  function route(first?: Edge): Path {
    const edge = first ?? choose(spawnEdges);
    const points = [...laneFor(edge)],roads=points.map(()=>edge.road),last=follow(edge,points,roads).edge;
    const path=finish(roundedPath(points,roads),last);if(edge.source)path.sourceAt=CLOSURE_SETBACK;
    return path;
  }
  /** Continue a route that is running out near the player, so the car drives on
   * instead of parking at its end and holding up everyone behind it. The new
   * path keeps the unrounded points from two vertices behind the car, so the
   * stretch it is on rounds exactly as before and it carries on without a jump. */
  function extendRoute(actor:Actor){
    const old=actor.path,last=old.last;if(!last||last.sink)return false;
    let lo=0,hi=old.distances.length-1;while(lo+1<hi){const mid=(lo+hi)>>1;if(old.distances[mid]<actor.distance)lo=mid;else hi=mid;}
    const from=Math.max(0,old.source.vertex[lo]-2),points=old.source.points.slice(from),roads=old.source.roads.slice(from),count=points.length;
    // A highway blend may reshape the old lane ahead of the car, never under it.
    const {edge:end,cut}=follow(last,points,roads,true,Math.min(count-1,old.source.vertex[lo]-from+2));if(points.length===count&&cut===Infinity)return false;
    const path=finish(roundedPath(points,roads),end),kept=Math.min(count,cut);
    // Project the car onto the part of the new path rebuilt from the old points.
    let best=0,bestGap=Infinity;
    for(let i=1;i<path.points.length&&path.source.vertex[i-1]<kept;i++){
      const a=path.points[i-1],b=path.points[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((actor.x-a[0])*dx+(actor.z-a[1])*dz)/(dx*dx+dz*dz||1)));
      const gap=Math.hypot(a[0]+dx*t-actor.x,a[1]+dz*t-actor.z);if(gap<bestGap){bestGap=gap;best=path.distances[i-1]+(path.distances[i]-path.distances[i-1])*t;}
    }
    if(actor.signalStop!==undefined)actor.signalStop+=best-actor.distance;
    actor.path=path;actor.distance=best;return true;
  }
  /** A car's highway and ramp cruise: its seeded street cruise (5.5 to 9 m/s) sets where it drives in each range. */
  function cruiseOn(actor:Actor,road:Road){
    const c=speedClass(road),range=c===2?MOTORWAY_CRUISE:c===1?RAMP_CRUISE:undefined;
    return range?range[0]+(range[1]-range[0])*Math.max(0,Math.min(1,(actor.cruise-5.5)/3.5)):actor.cruise;
  }
  const leadPoints:Point2[]=[],leadStations:number[]=[];
  /** Highway following: the Gipps speed behind the nearest of `others` (skipping
   * index `skip`) ahead on the car's own route, within FOLLOW.reach and close
   * enough to the lane to touch (about 2 m; the next lane is 3.65 m over),
   * measured along the route so a leader on a bend or one drifting over from
   * the next lane still counts. */
  function leaderLimit(actor:Actor,others:readonly FleetObstacle[],skip:number){
    const reach=Math.min(FOLLOW.reach,actor.path.length-actor.distance),step=4;if(reach<1)return Infinity;
    const y=actor.body.translation().y,fx=Math.sin(actor.yaw),fz=Math.cos(actor.yaw);
    leadPoints.length=0;leadStations.length=0;
    const point=walker(actor.path);for(let s=0;;s+=step){const t=Math.min(s,reach);leadPoints.push(point(actor.distance+t));leadStations.push(t);if(t>=reach)break;}
    let limit=Infinity;
    for(let k=0;k<others.length;k++){
      if(k===skip)continue;
      const other=others[k],dx=other.x-actor.x,dz=other.z-actor.z,range=Math.hypot(dx,dz);
      if(range>reach+8||Math.abs(other.y-y)>3||(range<10&&dx*fx+dz*fz<-1))continue;
      // The station is at least the plan distance, and not much more on any highway curve.
      const k0=Math.floor(range/step);let lateral=Infinity,station=0;
      for(let i=Math.max(0,k0-2),end=Math.min(leadPoints.length-1,k0+3+Math.ceil(k0*.3));i<end;i++){
        const a=leadPoints[i],b=leadPoints[i+1],sx=b[0]-a[0],sz=b[1]-a[1],t=Math.max(0,Math.min(1,((other.x-a[0])*sx+(other.z-a[1])*sz)/(sx*sx+sz*sz||1))),d=Math.hypot(a[0]+sx*t-other.x,a[1]+sz*t-other.z);
        if(d<lateral){lateral=d;station=leadStations[i]+(leadStations[i+1]-leadStations[i])*t;}
      }
      if(lateral>actor.spec.width/2+(other.halfWidth??.95)+.2||station<=0)continue;
      const heading=pathYaw(actor.path,actor.distance+station);if(!leads(actor,other,heading))continue;
      const lead=other.yaw===undefined?0:(other.speed??0)*Math.max(0,Math.cos(other.yaw-heading));
      limit=Math.min(limit,followSpeed(station-actor.spec.length/2-(other.halfLength??2.1),lead));
    }
    return limit;
  }
  /** Keep each actor's slot stable so following can skip its own index. */
  const fleetObstacles=():FleetObstacle[]=>actors.map(a=>({x:a.x,y:a.body.translation().y,z:a.z,halfLength:a.spec.length/2,halfWidth:a.spec.width/2,speed:a.speed,yaw:a.yaw,hidden:!!a.hidden}));
  /** A station on a highway lane between `min` and `max` metres from the
   * observer, on its level (a tunnel record in a tunnel, anywhere open to the
   * sky above ground), clear of the player and of every car by the highway
   * headway; lanes weighted by length. */
  function motorwayPlacement(observer:Pick<VehicleState,'x'|'z'>&{y?:number},player:Pick<VehicleState,'x'|'z'>,min:number,max:number,except?:Actor,external:TrafficObstacle[]=[],attempts=24):Placement|undefined{
    const below=underground(observer),candidates=highwayEdges.filter(edge=>(below?!!edge.road.tunnel:open(edge.road))&&edge.points.some(p=>Math.hypot(p[0]-observer.x,p[1]-observer.z)<max+40));
    if(!candidates.length)return;
    const total=candidates.reduce((sum,edge)=>sum+edge.length,0);
    const clear=(p:Point2)=>Math.hypot(p[0]-player.x,p[1]-player.z)>=35&&!actors.some(actor=>actor!==except&&Math.hypot(actor.x-p[0],actor.z-p[1])<MOTORWAY_HEADWAY)&&!external.some(other=>Math.hypot(other.x-p[0],other.z-p[1])<(other.halfLength??2.1)+5);
    for(let attempt=0;attempt<attempts;attempt++){
      let pick=random()*total,edge=candidates[0];for(const c of candidates){edge=c;if((pick-=c.length)<=0)break;}
      const lanePoints=laneFor(edge),along=stations(lanePoints),s=random()*along[along.length-1],p=pointAtDistance(lanePoints,s,along).p,radius=Math.hypot(p[0]-observer.x,p[1]-observer.z);
      if(radius<min||radius>max||!clear(p)||!below&&coveredAt(edge.road,p[0],p[1]))continue;
      const path=route(edge),d=Math.min(s,path.length-1);
      if(path.sinkAt!==undefined&&d>path.sinkAt-40)continue;
      const q=at(path,d);if(!clear(q))continue;
      return{path,d,p:q};
    }
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
  /** Lanes within `radius`; tunnel lanes only for an observer in a tunnel. */
  function nearbyEdges(observer:Pick<VehicleState,'x'|'z'>&{y?:number},radius:number){
    const below=underground(observer);
    return spawnEdges.filter(edge=>(below||!edge.road.tunnel)&&edge.points.some(point=>Math.hypot(point[0]-observer.x,point[1]-observer.z)<radius));
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
  // A start on or beside the highway fills it first (none of this applies elsewhere, so the street layout is unchanged).
  const spawnLevel=motorwayLevel(spawnPlayer),spawnHighway=MOTORWAY_DENSITY[spawnLevel],streetTraffic=activityAt(spawnPlayer.x,spawnPlayer.z).traffic;
  const target=spawnLevel?Math.min(COUNT-3,Math.max(streetTraffic,spawnHighway+MOTORWAY_STREETS)):streetTraffic,nearTarget=Math.round(streetTraffic/3),streetTarget=Math.round(streetTraffic/6);
  for (let i = 0; i < COUNT && spawnEdges.length; i++) {
    // Populate the street in view first, then adjacent blocks, then a reserve
    // fleet in the rest of the city. Every placement keeps its safe headway.
    let candidate=i<spawnHighway?motorwayPlacement(spawnPlayer,spawnPlayer,35,MOTORWAY_REACH):undefined;
    const k=Math.max(0,i-spawnHighway);
    if(!candidate&&spawnLevel<2&&k<Math.min(6,streetTarget))candidate=forwardPlacement(forward,spawnPlayer,spawnPlayer,k);
    if(!candidate&&spawnLevel<2&&k<streetTarget)candidate=placement(streetEdges,spawnPlayer,spawnPlayer,35,230);
    if(!candidate&&k<nearTarget)candidate=placement(nearEdges,spawnPlayer,spawnPlayer,35,240);
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
    const actor:Actor={ body, collider, colliders, spec, registration:fleet.registration(actors.length),path, distance: d, speed: 0, cruise: 5.5 + random() * 3.5, x: p[0], z: p[1], yaw, steering:0,color: new THREE.Color(npcPaint(spec)),waiting:0 };
    setDeckVisibility(actor,road);actors.push(actor);
    // Highway cars start at speed, no faster than the car ahead allows.
    if(speedClass(road)>0)actor.speed=Math.min(cruiseOn(actor,road)*.9,leaderLimit(actor,fleetObstacles(),actors.length-1));
  }
  const byCollider=new Map(actors.flatMap(actor=>actor.colliders.map(collider=>[collider.handle,actor] as const)));
  // Each lane leaving a closed start emits a car from its barrier every 1.5 to
  // 4 s, on its own random stream so the fleet's draws are unchanged.
  const emitters=edges.filter(edge=>edge.source).map(edge=>{const point=pointAtDistance(laneFor(edge),CLOSURE_SETBACK).p;return{edge,point,covered:coveredAt(edge.road,point[0],point[1]),timer:0};});
  let emitSeed=91447;const emitRandom=()=>{emitSeed=(Math.imul(emitSeed,1664525)+1013904223)>>>0;return emitSeed/4294967296;};
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion(), laneRotation = new THREE.Quaternion(), position = new THREE.Vector3(), scale = new THREE.Vector3(1, 1, 1), lift = new THREE.Vector3(), meshPosition = new THREE.Vector3();
  /** Write one actor's instance matrices from the body pose in `position`/`rotation`
   * (the body sits .65 m above the wheels' contact, the mesh origin on it). */
  function setDeckVisibility(actor:Actor,road:Road){
    const hidden=deckDrawn?.(road)===false;
    if(hidden===!!actor.hidden)return;
    actor.hidden=hidden;
    // Keep advancing the lane pose while streamed out, without leaving an
    // invisible obstacle for the player on a neighboring loaded surface.
    for(const collider of actor.colliders)collider.setEnabled(!hidden);
  }
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
  /** Wheel forces for a knocked car that is upright on the road (a bridge deck, or the Zakim's survey
   * mesh over its trace), applied at both axles so a sideways slide also brakes its spin as real tyres do. */
  function tyreGrip(actor:Actor,dt:number){
    const r=actor.body.rotation(),t=actor.body.translation(),upright=1-2*(r.x*r.x+r.z*r.z)>.7&&t.y-sampleVehicleSurface(city,t.x,t.z,t.y).height<1.1;
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
        const hit=byCollider.get(other.handle);if(!hit||hit.hidden||hit.knocked||closing(v,hit)<=threshold)return;
        let touching=false;physics.world.contactPair(collider,other,manifold=>{for(let i=0;i<manifold.numContacts();i++)if(manifold.contactDist(i)<=.05)touching=true;});
        if(touching)struck.add(hit);
      });
      for(const hit of actors){
        if(hit===self||hit.hidden||hit.knocked||struck.has(hit)||Math.hypot(hit.x-p.x,hit.z-p.z)>15||closing(v,hit)<=threshold)continue;
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
    restore(actor);actor.rejoin=undefined;actor.evasion=undefined;actor.steering=0;actor.parked=false;
    actor.path=path;actor.distance=d;actor.speed=0;actor.signalStop=undefined;actor.signalCommitted=false;actor.waiting=0;actor.priorityUntil=undefined;actor.ended=undefined;
    actor.x=start[0];actor.z=start[1];actor.yaw=Math.atan2(next[0]-start[0],next[1]-start[1]);
    const road=pathRoad(path,d),normal=roadNormal(city,road,...start);
    actor.body.setTranslation({x:start[0]+normal.x*NPC_BODY_LIFT,y:sampleRoadElevation(city,road,...start)+normal.y*NPC_BODY_LIFT,z:start[1]+normal.z*NPC_BODY_LIFT},true);
    actor.body.setRotation(roadRotation(city,road,...start,actor.yaw),true);
    setDeckVisibility(actor,road);
    if(speedClass(road)>0)actor.speed=Math.min(cruiseOn(actor,road)*.9,leaderLimit(actor,fleetObstacles(),actors.indexOf(actor)));
  }
  /** A car that drove into a closed end: hidden, its body moved out of the
   * world (20 m apart, below the map's far corner) until it is placed again. */
  function park(actor:Actor,index:number){
    restore(actor);actor.parked=true;actor.rejoin=undefined;actor.evasion=undefined;actor.steering=0;actor.speed=0;
    actor.signalStop=undefined;actor.signalCommitted=false;actor.waiting=0;actor.priorityUntil=undefined;actor.ended=undefined;
    actor.x=city.bounds.minX-4000-index*20;actor.z=city.bounds.minZ-4000;
    actor.body.setTranslation({x:actor.x,y:-800,z:actor.z},true);
    fleet.hide(index);
  }


  const evasionShapeQ=new THREE.Quaternion();
  function evasionPoint(actor:Actor,s:number,offset:number){
    const p=at(actor.path,s),yaw=pathYaw(actor.path,s),road=pathRoad(actor.path,s);
    return{x:p[0]+Math.cos(yaw)*offset,z:p[1]-Math.sin(yaw)*offset,yaw,road};
  }
  /** Keep the whole footprint inside the measured roadway, with curb clearance.
   * Test the sweep too: a clear endpoint beyond a parked car is not a clear way. */
  function evasionClear(actor:Actor,s:number,offset:number,includePlayer:boolean,yaw?:number){
    const point=evasionPoint(actor,s,offset),heading=yaw??point.yaw,fx=Math.sin(heading),fz=Math.cos(heading);
    for(const along of [-actor.spec.length/2,0,actor.spec.length/2])for(const across of [-actor.spec.width/2-.2,actor.spec.width/2+.2]){
      const x=point.x+fx*along+fz*across,z=point.z+fz*along-fx*across;
      // A taper can narrow beneath the front bumper before the center reaches
      // it. Deck widths override a road-wide pavement estimate at each sample.
      const width=(point.road.deckWidths?roadWidthAt(point.road,x,z):point.road.pavedWidth??point.road.width)/2;
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

  const posAt=(path:Path,s:number):Pose=>{const p=at(path,s);return{x:p[0],z:p[1],yaw:pathYaw(path,s)};};
  /** The route ahead of a lane keeper, long enough to cover its braking distance. */
  function trajectory(actor:Actor):Trajectory{
    const cap=actor.path.merges?.some(s=>s-actor.distance>-30&&s-actor.distance<MERGE_WINDOW)?MOTORWAY_HORIZON:CONFLICT.maxHorizon,horizon=Math.min(cap,CONFLICT.minHorizon+actor.speed*actor.speed/(2*CONFLICT.decel)),here={x:actor.x,z:actor.z,yaw:actor.yaw},poses=[here];
    // posAt for each sample, walking the path once: the yaw is the chord over the next 2 m.
    const path=actor.path,point=walker(path),from=walker(path),to=walker(path);
    for(let t=CONFLICT.step;t<=horizon&&actor.distance+t<path.length;t+=CONFLICT.step){const s=actor.distance+t,y=Math.min(s,path.length-2),p=point(s),a=from(y),b=to(y+2);poses.push({x:p[0],z:p[1],yaw:Math.atan2(b[0]-a[0],b[1]-a[1])});}
    return{halfLength:actor.spec.length/2,halfWidth:actor.spec.width/2,poses,pose:t=>t<=0?here:posAt(actor.path,actor.distance+t)};
  }
  /** Travel at which a red light (not yet run on amber) or the route's end will
   * stop the car anyway; a route into a closed end does not stop there. */
  function heldAt(actor:Actor){
    let held=actor.path.sinkAt===undefined?actor.path.length-actor.distance-2:Infinity;
    const stop=actor.path.stops.find(s=>s.distance>=actor.distance-.2);
    if(stop&&signalPhase(elapsed,stop.yaw)!=='green'){
      const gap=stop.distance-actor.distance,committed=actor.signalStop===stop.distance?actor.signalCommitted:actor.speed>2&&gap<actor.speed*actor.speed/12+1;
      if(!committed)held=Math.min(held,gap-.5);
    }
    return held;
  }
  let rightOfWayMemory=new Map<number,number>();
  /** Bus and tram drivers only brake for what lies in a straight box ahead
   * (transit.ts); this mirrors that rule to tell when one is held by a car. */
  function holdsBus(actor:Actor,bus:TrafficObstacle){
    const yaw=bus.yaw??0,dx=actor.x-bus.x,dz=actor.z-bus.z,along=dx*Math.sin(yaw)+dz*Math.cos(yaw),across=Math.abs(dx*Math.cos(yaw)-dz*Math.sin(yaw));
    return along>0&&along<65&&across<1.35+actor.spec.width/2&&along-(bus.halfLength??6)-actor.spec.length/2-2<1;
  }
  function busTrajectory(bus:TrafficObstacle):Trajectory{
    const speed=bus.speed??0,horizon=Math.min(CONFLICT.maxHorizon,CONFLICT.minHorizon+speed*speed/(2*3.2)),poses:Pose[]=[];
    for(let t=0;t<=horizon;t+=CONFLICT.step)poses.push(bus.pose!(t));
    return{halfLength:bus.halfLength??6,halfWidth:bus.halfWidth??1.3,poses,pose:bus.pose!};
  }
  /** One settled conflict: winner `w` and loser `l` (a bus or tram k is
   * actors.length + k, and never loses), each one's travel to the first contact
   * and to clear of the other's path, whether they cross, and whether the
   * winner is held outside the loser's path too (neither could get through). */
  interface Decision {w:number;l:number;tw:number;tl:number;xw:number;xl:number;crossing:boolean;swapped:boolean;bothHold:boolean;}
  /** Settle right of way between every pair of lane keepers whose routes meet,
   * and with buses and trams: each car's speed limit, and what it is stopped
   * for (-1 for nothing; a bus or tram k is actors.length + k). A bus goes
   * first unless it is already waiting for the car.
   *
   * A car only takes its right of way across another's path if it can get
   * through: one that would have to stop inside it (behind a stopped queue
   * beyond the junction) lets the other go first, and when neither could get
   * through both wait outside. Cars that pushed in anyway from three sides
   * can still end up each stopped for the next; such a cycle is broken by
   * giving one car priority for a few seconds (preferably one whose blocker is
   * not standing in its path), which lets it pass through after a long wait. */
  function rightsOfWay(keepers:boolean[],external:TrafficObstacle[]){
    const n=actors.length,limits=new Array<number>(n).fill(Infinity),blockers=new Array<number>(n+external.length).fill(-1),blockerInPath=new Array<boolean>(n).fill(false);
    const paths=actors.map((actor,i)=>keepers[i]?trajectory(actor):undefined),held=actors.map((actor,i)=>keepers[i]?heldAt(actor):Infinity),heights=actors.map(actor=>actor.body.translation().y);
    const forced=actors.map(actor=>elapsed<(actor.priorityUntil??0)),speedOf=(k:number)=>k<n?actors[k].speed:external[k-n].speed??0;
    const decisions:Decision[]=[],memory=new Map<number,number>();
    for(let i=0;i<n;i++){
      const pi=paths[i];if(!pi)continue;
      const reachI=CONFLICT.step*pi.poses.length+pi.halfLength+3;
      for(let j=i+1;j<n;j++){
        const pj=paths[j];if(!pj||Math.abs(heights[i]-heights[j])>3)continue;
        const a=actors[i],b=actors[j];
        // Hidden cars settle conflicts with one another to keep spacing
        // while their deck is out of view.
        if(!!a.hidden!==!!b.hidden)continue;
        const dx=b.x-a.x,dz=b.z-a.z;
        if(Math.hypot(dx,dz)>reachI+CONFLICT.step*pj.poses.length+pj.halfLength+3)continue;
        const ti=firstContact(pi,pj);if(ti===undefined)continue;
        const tj=firstContact(pj,pi)??0;
        const winner=rightOfWay(
          {index:i,travel:ti,speed:a.speed,stopsShort:ti>held[i],forced:forced[i],otherAhead:dx*Math.sin(a.yaw)+dz*Math.cos(a.yaw)>=0},
          {index:j,travel:tj,speed:b.speed,stopsShort:tj>held[j],forced:forced[j],otherAhead:-dx*Math.sin(b.yaw)-dz*Math.cos(b.yaw)>=0},
          rightOfWayMemory.get(i*256+j));
        if(winner===undefined)continue;
        const xi=clearance(pi,pj,ti),xj=clearance(pj,pi,tj),cross=crossing(pi.pose(ti),pj.pose(tj));
        decisions.push(winner===i?{w:i,l:j,tw:ti,tl:tj,xw:xi,xl:xj,crossing:cross,swapped:false,bothHold:false}:{w:j,l:i,tw:tj,tl:ti,xw:xj,xl:xi,crossing:cross,swapped:false,bothHold:false});
      }
    }
    const buses=new Map<number,Trajectory>();
    for(let i=0;i<n;i++){
      const pi=paths[i];if(!pi)continue;
      const actor=actors[i];
      if(actor.hidden)continue;
      for(let k=0;k<external.length;k++){
        const bus=external[k];if(!bus.pose||Math.abs(bus.y-heights[i])>3||Math.hypot(bus.x-actor.x,bus.z-actor.z)>CONFLICT.step*pi.poses.length+pi.halfLength+(bus.halfLength??6)+CONFLICT.maxHorizon+3)continue;
        if(holdsBus(actor,bus)){blockers[n+k]=i;continue;}
        const trajectory=buses.get(k)??busTrajectory(bus);buses.set(k,trajectory);
        const travel=firstContact(pi,trajectory);
        // A car already in the bus's path (on a bend, outside its braking box)
        // must clear it, as must one too fast to stop or holding priority.
        if(travel===undefined||travel<=0||forced[i]||actor.speed*actor.speed/(2*CONFLICT.brake)>travel-CONFLICT.buffer)continue;
        decisions.push({w:n+k,l:i,tw:firstContact(trajectory,pi)??0,tl:travel,xw:Infinity,xl:Infinity,crossing:false,swapped:false,bothHold:false});
      }
    }
    // Where each car will come to a stop (travel), and for whom: a red light,
    // or a conflict it loses to a car that is crossing or not moving away.
    const stopAt=held.slice(),stopBy=new Array<number>(n).fill(-1);
    const stops=()=>{
      stopAt.splice(0,n,...held);stopBy.fill(-1);
      for(const d of decisions){
        const at=d.tl-CONFLICT.buffer;
        if((d.crossing||speedOf(d.w)<1)&&at<stopAt[d.l]){stopAt[d.l]=at;stopBy[d.l]=d.w;}
        if(d.bothHold&&d.tw-CONFLICT.buffer<stopAt[d.w]){stopAt[d.w]=d.tw-CONFLICT.buffer;stopBy[d.w]=d.w;}
      }
    };
    for(let pass=0;pass<3;pass++){
      stops();let changed=false;
      for(const d of decisions){
        if(d.bothHold||!d.crossing||d.w>=n||forced[d.w])continue;
        const w=actors[d.w],boxed=d.tw>0&&stopAt[d.w]<d.xw&&stopAt[d.w]>d.tw-CONFLICT.buffer&&w.speed*w.speed/(2*CONFLICT.brake)<=d.tw-CONFLICT.buffer;
        if(!boxed)continue;
        if(d.swapped){d.bothHold=true;}
        else{const {w:a,l:b,tw,tl,xw,xl}=d;Object.assign(d,{w:b,l:a,tw:tl,tl:tw,xw:xl,xl:xw,swapped:true});}
        changed=true;
      }
      if(!changed)break;
    }
    stops();
    const constrain=(i:number,travel:number,blocker:number,inPath:boolean,lead?:number)=>{const limit=lead===undefined?yieldSpeed(travel):followSpeed(travel,lead);if(limit<limits[i]){limits[i]=limit;blockers[i]=limit<.5?blocker:-1;blockerInPath[i]=inPath;}};
    // A highway car behind or merging beside a moving car keeps a following gap
    // to it (Gipps) instead of planning to stop short of where it is now. Into
    // a merge the gap is how far it would arrive behind the other (their travels
    // to the contact differ by it); one that would not arrive 2 m behind still
    // plans to stop short and lets the other by.
    const follows=(d:Decision)=>{
      if(d.crossing||d.bothHold||d.w>=n||speedOf(d.w)<1||speedClass(pathRoad(actors[d.l].path,actors[d.l].distance))===0)return;
      return speedOf(d.w)*Math.max(0,Math.cos(actors[d.w].yaw-actors[d.l].yaw));
    };
    for(const d of decisions){
      if(d.w<n&&d.l<n)memory.set(Math.min(d.w,d.l)*256+Math.max(d.w,d.l),d.w);
      // A car held outside a junction it could not get through waits on what
      // stops it beyond; a blocker of its own is no part of a deadlock.
      const lead=follows(d),gap=d.tl-Math.max(0,d.tw);
      constrain(d.l,lead===undefined||gap<2?d.tl:gap,d.bothHold?stopBy[d.l]:d.w,d.tw<=0,lead===undefined||gap<2?undefined:lead);
      if(d.bothHold)constrain(d.w,d.tw,stopBy[d.w]===d.w?-1:stopBy[d.w],false);
    }
    rightOfWayMemory=memory;
    for(let i=0;i<n;i++){
      if(blockers[i]<0||actors[i].waiting<1.5)continue;
      const cycle=blockingCycle(i,blockers)?.filter(k=>k<n);if(!cycle?.length)continue;
      const order=[...cycle].sort((a,b)=>Number(blockerInPath[a])-Number(blockerInPath[b])||actors[b].waiting-actors[a].waiting||a-b);
      actors[order[0]].priorityUntil=elapsed+3;
      for(const k of cycle)blockers[k]=-1;
    }
    return{limits,blockers};
  }

  return {
    count: actors.length,
    /** `motorway`: highway cars within MOTORWAY_REACH; `highway`: the observer's motorwayLevel. */
    population(observer:Observer&{y?:number}){
      const profile=activityAt(observer.x,observer.z);
      return {level:profile.level,target:profile.traffic,forward:actors.filter(actor=>{const p=aheadOf([actor.x,actor.z],observer);return p.along>35&&p.along<200&&Math.abs(p.across)<12;}).length,local:actors.filter(actor=>Math.hypot(actor.x-observer.x,actor.z-observer.z)<LOCAL_RADIUS).length,nearby:actors.filter(actor=>Math.hypot(actor.x-observer.x,actor.z-observer.z)<240).length,total:actors.length,
        motorway:actors.filter(actor=>!actor.parked&&speedClass(pathRoad(actor.path,actor.distance))===2&&Math.hypot(actor.x-observer.x,actor.z-observer.z)<MOTORWAY_REACH).length,highway:motorwayLevel(observer),parked:actors.filter(actor=>actor.parked).length};
    },
    // Called only during an explicit map teleport/reset, before the new view is
    // rendered. Ordinary driving uses the protected-distance refill below.
    // On or beside the highway its share is placed first.
    populateAt(observer:Observer&{y?:number},player:Pick<VehicleState,'x'|'z'>=observer,external:TrafficObstacle[]=[]){
      const profile=activityAt(observer.x,observer.z),local=()=>actors.filter(actor=>Math.hypot(actor.x-observer.x,actor.z-observer.z)<LOCAL_RADIUS).length;
      const levelHere=motorwayLevel(observer),traffic=levelHere?Math.min(actors.length-3,Math.max(profile.traffic,MOTORWAY_DENSITY[levelHere]+MOTORWAY_STREETS)):profile.traffic,highwayTarget=MOTORWAY_DENSITY[levelHere];
      let onHighway=levelHere?actors.filter(actor=>!actor.parked&&speedClass(pathRoad(actor.path,actor.distance))===2&&Math.hypot(actor.x-observer.x,actor.z-observer.z)<MOTORWAY_REACH).length:0;
      const candidates=nearbyEdges(observer,650),near=nearbyEdges(observer,240),name=nearestStreet(observer),same=near.filter(edge=>edge.name===name);
      const forward=levelHere===2?[]:forwardPlacements(same,observer);
      let inFront=actors.filter(actor=>{const p=aheadOf([actor.x,actor.z],observer);return p.along>35&&p.along<200&&Math.abs(p.across)<12;}).length;
      let nearby=actors.filter(actor=>Math.hypot(actor.x-observer.x,actor.z-observer.z)<240).length;
      for(const actor of actors){
        if(local()>=traffic&&onHighway>=highwayTarget)break;
        // A highway short of cars also takes street cars beyond 300 m.
        const away=Math.hypot(actor.x-observer.x,actor.z-observer.z);
        if(away<LOCAL_RADIUS*1.35&&!(onHighway<highwayTarget&&away>300&&!actor.knocked&&speedClass(pathRoad(actor.path,actor.distance))===0))continue;
        let candidate=onHighway<highwayTarget?motorwayPlacement(observer,player,35,MOTORWAY_REACH,actor,external):undefined;
        if(candidate)onHighway++;
        else if(away>=LOCAL_RADIUS*1.35){
          if(levelHere<2&&inFront<Math.min(6,Math.round(profile.traffic/6)))candidate=forwardPlacement(forward,observer,player,inFront,actor,external);
          if(!candidate&&levelHere<2&&nearby<Math.round(profile.traffic/6))candidate=placement(same,observer,player,35,230,actor,external);
          if(!candidate&&nearby<Math.round(profile.traffic/3))candidate=placement(near,observer,player,35,240,actor,external);
          candidate??=placement(candidates,observer,player,35,LOCAL_RADIUS,actor,external);
        }
        if(candidate){relocate(actor,candidate.path,candidate.d);if(Math.hypot(candidate.p[0]-observer.x,candidate.p[1]-observer.z)<240)nearby++;const p=aheadOf(candidate.p,observer);if(p.along>35&&p.along<200&&Math.abs(p.across)<12)inFront++;}
      }
    },
    snapshot:()=>actors.map(a=>{const stop=a.path.stops.find(s=>s.distance>=a.distance-.2);return{x:a.x,y:a.body.translation().y,z:a.z,yaw:a.yaw,speed:a.speed,steering:a.steering,evasion:a.evasion?.offset??0,road:pathRoad(a.path,a.distance).name,parked:!!a.parked,hidden:!!a.parked||!!a.hidden,motorway:speedClass(pathRoad(a.path,a.distance)),signal:stop?signalPhase(elapsed,stop.yaw):undefined,stopGap:stop?stop.distance-a.distance:Infinity,remaining:a.path.length-a.distance,priority:elapsed<(a.priorityUntil??0),knocked:!!a.knocked,rejoining:!!a.rejoin,dynamic:a.body.isDynamic(),collider:a.collider.handle,registration:a.registration,type:a.spec.type,mass:a.spec.mass,color:`#${a.color.getHexString()}`,height:a.spec.height,halfLength:a.spec.length/2,halfWidth:a.spec.width/2};}),
    /** Each car with its heading, so a bus changing lanes sees how far a turning or crossing car reaches. */
    obstacles:():TrafficObstacle[]=>actors.filter(a=>!a.hidden).map(a=>({x:a.x,y:a.body.translation().y,z:a.z,halfLength:a.spec.length/2,halfWidth:a.spec.width/2,speed:a.speed,yaw:a.yaw})),
    /** Collider handles of the fleet, so an impact on the player can be classified. */
    colliders:new Set(byCollider.keys()),
    update(dt: number, player: VehicleState, observer: Pick<VehicleState,'x'|'y'|'z'> = player, external:TrafficObstacle[] = []) {
      dt = Math.max(0, Math.min(dt, 1 / 30));
      drawObserver=observer;elapsed += dt;rehomeTimer+=dt;
      // Apply changes from the streamer before any car samples the fleet.
      if(deckDrawn)for(const actor of actors){
        if(actor.parked||actor.knocked)continue;
        setDeckVisibility(actor,pathRoad(actor.path,actor.distance));
      }
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
      const below=underground(observer);
      if(rehomeTimer>.25){
        rehomeTimer=0;
        // On or beside the highway, keep its own share of the fleet (MOTORWAY_DENSITY) within MOTORWAY_REACH on top of the streets'.
        level=motorwayLevel(observer);
        const streetTraffic=activityAt(observer.x,observer.z).traffic,target=level?Math.min(actors.length-3,Math.max(streetTraffic,MOTORWAY_DENSITY[level]+MOTORWAY_STREETS)):streetTraffic,highwayTarget=MOTORWAY_DENSITY[level];
        let local=actors.filter(actor=>Math.hypot(actor.x-observer.x,actor.z-observer.z)<localRadius).length;
        highway=level?actors.filter(actor=>!actor.parked&&speedClass(pathRoad(actor.path,actor.distance))===2&&Math.hypot(actor.x-observer.x,actor.z-observer.z)<MOTORWAY_REACH).length:0;
        if(local<Math.min(target,actors.length)||highway<highwayTarget){
          const approaches=spawnEdges.filter(edge=>{
            if(edge.road.tunnel&&!below)return false;
            const a=edge.points[0],b=edge.points[1],d=Math.hypot(a[0]-observer.x,a[1]-observer.z);
            if(d<recycleDistance+15||d>localRadius-30)return false;
            const dx=b[0]-a[0],dz=b[1]-a[1];
            return (dx*(observer.x-a[0])+dz*(observer.z-a[1]))/(Math.hypot(dx,dz)*d)>-.1;
          });
          // Driving the highway, cars left 700 m behind are recycled ahead.
          const beyond=level===2?Math.min(localRadius*1.35,MOTORWAY_REACH+200):localRadius*1.35;
          let moved=0;
          for(const actor of actors){
            if((local>=target&&highway>=highwayTarget)||moved>=2)break;
            const away=Math.hypot(actor.x-observer.x,actor.z-observer.z);
            if(Math.hypot(actor.x-player.x,actor.z-player.z)<=35)continue;
            // A highway short of cars also takes street cars out of view.
            if(away<=beyond&&!(highway<highwayTarget&&away>recycleDistance+40&&!actor.knocked&&speedClass(pathRoad(actor.path,actor.distance))===0))continue;
            let candidate=highway<highwayTarget?motorwayPlacement(observer,player,recycleDistance,Math.min(localRadius-10,480),actor,external,8):undefined;
            if(candidate)highway++;
            else if(local<target&&away>beyond)candidate=placement(approaches,observer,player,recycleDistance,localRadius-10,actor,external,6);
            if(candidate){relocate(actor,candidate.path,candidate.d);if(away>=localRadius)local++;moved++;}
          }
        }
      }
      // Closed starts emit cars while the observer is near and on their level, and the highway is short of cars.
      for(const emitter of emitters){
        emitter.timer-=dt;if(emitter.timer>0)continue;
        emitter.timer=1.5+emitRandom()*2.5;
        const p=emitter.point;
        if(highway>=MOTORWAY_DENSITY[Math.max(1,level)]||(below?!emitter.edge.road.tunnel:emitter.covered)||Math.hypot(p[0]-observer.x,p[1]-observer.z)>EMIT_RANGE||Math.hypot(p[0]-player.x,p[1]-player.z)<20||actors.some(actor=>Math.hypot(actor.x-p[0],actor.z-p[1])<28))continue;
        // A car parked behind a closed end first, else the farthest one well out of view.
        let pick=actors.find(actor=>actor.parked);
        if(!pick){let far=localRadius*1.35;for(const actor of actors){const d=Math.hypot(actor.x-observer.x,actor.z-observer.z);if(d>far&&!actor.knocked&&Math.hypot(actor.x-player.x,actor.z-player.z)>35){far=d;pick=actor;}}}
        if(!pick)continue;
        relocate(pick,route(emitter.edge),CLOSURE_SETBACK);highway++;
      }
      // Snapshot once per step instead of allocating an O(N²) pile of obstacle
      // objects. The stable snapshot also avoids actor-order-dependent following.
      const obstacles:FleetObstacle[]=[{...player,halfLength:2.1,halfWidth:.9},...fleetObstacles(),...external];
      detectKnocks();
      for(const actor of actors)if(!actor.knocked&&!actor.rejoin&&actor.path.length-actor.distance<40&&Math.hypot(actor.x-observer.x,actor.z-observer.z)<=localRadius*1.35)extendRoute(actor);
      const keepers=actors.map(actor=>!actor.knocked&&!actor.rejoin&&!actor.parked),{limits,blockers}=rightsOfWay(keepers,external);
      for (let index = 0; index < actors.length; index++) {
        const actor = actors[index];
        if(actor.parked)continue;
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
          else{rotation.set(r.x,r.y,r.z,r.w);position.set(t.x,t.y,t.z);actor.hidden=false;draw(index);continue;}
        }
        const previousX=actor.x,previousZ=actor.z,previousYaw=actor.yaw,previousDistance=actor.distance;
        const forwardX = Math.sin(actor.yaw), forwardZ = Math.cos(actor.yaw);
        const here=pathRoad(actor.path,actor.distance),fast=speedClass(here)>0;
        let target = actor.rejoin?0:cruiseOn(actor,here);
        const lookAhead=fast?Math.max(12,actor.speed*1.2):12,p = at(actor.path, actor.distance), ahead = at(actor.path, actor.distance + lookAhead);
        const upcomingYaw = Math.atan2(ahead[0] - p[0], ahead[1] - p[1]);
        const turn = Math.abs(Math.atan2(Math.sin(upcomingYaw - actor.yaw), Math.cos(upcomingYaw - actor.yaw)));
        if(fast&&!actor.rejoin){
          // Up to the highway's speed for a merge, down ahead of an exit or the
          // street at 2.5 m/s², about 3 m/s² sideways on a bend (the chord to a
          // point `lookAhead` metres on turns by half the arc), and the car ahead.
          let first=true;
          for(const change of actor.path.changes??[]){
            const gap=change.distance-actor.distance;if(gap<0)continue;if(gap>220)break;
            const next=cruiseOn(actor,change.road);
            if(next<target)target=Math.min(target,Math.sqrt(next*next+5*gap));else if(first&&gap<140)target=next;
            first=false;
          }
          target=Math.min(target,Math.sqrt(3.2*lookAhead/(2*Math.max(turn,1e-4))),leaderLimit(actor,obstacles,index+1));
        }else target *= 1 - Math.min(.6, turn * .65);
        const stop=actor.path.stops.find(s=>s.distance>=actor.distance-.2);
        if(stop&&signalPhase(elapsed,stop.yaw)!=='green'){
          const gap=stop.distance-actor.distance;
          if(actor.signalStop!==stop.distance){actor.signalStop=stop.distance;actor.signalCommitted=actor.speed>2&&gap<actor.speed*actor.speed/12+1;}
          if(!actor.signalCommitted)target=Math.min(target,Math.sqrt(Math.max(0,2*5*(gap-.5))));
        }else{actor.signalStop=undefined;actor.signalCommitted=false;}
        const actorHeight=obstacles[index+1].y,hidden=!!actor.hidden;
        for(let otherIndex=0;otherIndex<obstacles.length;otherIndex++){
          const other=obstacles[otherIndex];
          if(otherIndex===index+1||!leads(actor,other,actor.yaw))continue;
          // Two lane keepers settle their order through rightsOfWay; the symmetric
          // rules below would stop both of two cars meeting at a corner for good.
          const sharesRightOfWay=otherIndex<=actors.length
            ? otherIndex>0&&keepers[otherIndex-1]&&hidden===other.hidden
            : !hidden&&!!other.pose;
          if(keepers[index]&&sharesRightOfWay)continue;
          if(Math.abs(other.y-actorHeight)>3)continue;
          const dx=other.x-actor.x,dz=other.z-actor.z,along=dx*forwardX+dz*forwardZ,across=Math.abs(dx*forwardZ-dz*forwardX);
          const inLane=across<actor.spec.width/2+.4+(other.halfWidth??.95);
          if(fast){
            // Highway cars follow along their route (leaderLimit); straight ahead only up close, where a bend cannot hide the lane.
            if(along>0&&along<25&&inLane)target=Math.min(target,followSpeed(along-actor.spec.length/2-(other.halfLength??2.1),other.yaw===undefined?0:(other.speed??0)*Math.max(0,Math.cos(other.yaw-actor.yaw))));
            if(Math.hypot(dx,dz)<5&&along>-1&&inLane)target=0;
            continue;
          }
          const gap=along-actor.spec.length/2-(other.halfLength??2.1)-2.3;
          if(along>0&&along<55&&inLane)target=Math.min(target,Math.sqrt(Math.max(0,2*3.8*gap)));
          if(Math.hypot(dx,dz)<5&&along>-1)target=0;
        }
        if(keepers[index])target=Math.min(target,limits[index]);
        const evasion=evade(actor,player,dt);
        const remaining = actor.path.length - actor.distance;
        if (remaining < 12&&actor.path.sinkAt===undefined) target = Math.min(target, Math.sqrt(Math.max(0, 2 * 3 * (remaining - 2))));
        actor.speed += Math.max(-6 * dt, Math.min((fast?2.6:2.2) * dt, target - actor.speed));
        actor.waiting=actor.speed<.3&&blockers[index]>=0?actor.waiting+dt:0;
        actor.distance = Math.min(actor.path.length - .05, actor.distance + actor.speed * dt);
        // A car reaching the barrier of a closed end drives through it and is gone.
        if(actor.path.sinkAt!==undefined&&actor.distance>=actor.path.sinkAt){park(actor,index);continue;}
        // Recycling occurs only well away from the player.
        // A route that could not be extended (a one-way street leaving the map)
        // ends here: recycle the car once it is out of the way of the view, or
        // after a while anyway rather than let it hold up the cars behind it.
        const away=Math.hypot(actor.x-observer.x,actor.z-observer.z);
        if(remaining<3&&actor.speed<.2){actor.ended??=elapsed;const wait=elapsed-actor.ended;if(away>localRadius*1.35||(wait>3&&away>120)||wait>15)respawnAway(actor);}
        else{actor.ended=undefined;if(remaining<3&&away>localRadius*1.35)respawnAway(actor);}
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
        setDeckVisibility(actor,road);if(actor.hidden)fleet.hide(index);else draw(index);
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
