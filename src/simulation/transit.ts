import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type {CityData,Point2,Road,VehicleState} from '../types';
import type {DrivingPhysics} from '../physics/vehicle';
import {sampleElevation,sampleTerrainNormal,rotationFromNormal} from './terrain.ts';
import {sampleRoadElevation,roadNormal,roadProjection} from './road-surfaces.ts';
import {signalPhase} from './signals.ts';
import {createGreenLine,createTransitBus} from '../render/transit-vehicles.ts';
import {createTransitTracks} from '../render/transit-tracks.ts';
import {createRailProfile,railSurface,railCovered,railStopDistance,type RailProfile} from './transit-rail-surface.ts';
export interface TransitRoute {id:string;line:string;kind:'bus'|'tram';destination:string;directionId?:number;covered?:{start:number;end:number}[];bridges?:{start:number;end:number}[];points:Point2[];length:number;stops:{id:string;name:string;distance:number;position:Point2}[];}
export interface TransitData {routes:TransitRoute[];sources:{name:string;url:string;license:string}[];notes:string;}
/** A vehicle other traffic must keep clear of. A bus or tram also gives its
 * heading and its pose `travel` metres further along its route, so cars can
 * settle right of way with it instead of only braking for what is ahead. */
export interface TrafficObstacle {x:number;y:number;z:number;halfLength?:number;halfWidth?:number;speed?:number;yaw?:number;pose?:(travel:number)=>{x:number;z:number;yaw:number};}
interface Route extends TransitRoute {rail?:RailProfile;distances:number[];signalStops:{distance:number;yaw:number}[];decks:(Road|undefined)[];lanes?:BusLanes;}
/** A bus's lateral position every DECK_STEP, in metres right of its route shape along (rx, rz):
 * `base` is the right-hand lane of the street it rides, `base + delta` the lane clear of the tram tracks. */
export interface BusLanes {base:Float32Array;delta:Float32Array;rx:Float32Array;rz:Float32Array;}
/** `offset`: metres beyond the bus's street lane toward its track-clear lane, held in metres so the lane narrowing ahead does not move it;
 * `lateral`: the speed (m/s) of the lane change under way, 0 while the bus holds; `near`: a tram calls for the track-clear lane. */
interface Actor {offset:number;lateral:number;near:boolean;lean:number;signalStop?:number;signalCommitted?:boolean;route:Route;distance:number;speed:number;dwell:number;nextStop:number;model:THREE.Group;tram?:ReturnType<typeof createGreenLine>;bodies:RAPIER.RigidBody[];x:number;z:number;y:number;yaw:number;lastStop:string;}
const dist=(a:Point2,b:Point2)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
export function transitPoint(route:Pick<Route,'points'|'distances'|'length'>,distance:number):Point2{
 const s=Math.max(0,Math.min(route.length,distance));let lo=0,hi=route.distances.length-1;
 while(lo+1<hi){const mid=(lo+hi)>>1;if(route.distances[mid]<s)lo=mid;else hi=mid;}
 const a=route.points[lo],b=route.points[hi],t=(s-route.distances[lo])/(route.distances[hi]-route.distances[lo]||1);return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
}
const DECK_STEP=2,ROAD_CELL=64;
const roadIndexes=new WeakMap<CityData,Map<string,Road[]>>();
/** Streets near a point, from a per-city cell index (an MBTA shape is a service
 * alignment, so a vehicle is matched to the street it follows rather than to a lane). */
function roadsNear(city:CityData,x:number,z:number){
 let cells=roadIndexes.get(city);
 if(!cells){
  cells=new Map();
  for(const road of city.roads??[]){
   const margin=road.width/2+5;
   for(let i=1;i<road.points.length;i++){const a=road.points[i-1],b=road.points[i];
    for(let cx=Math.floor((Math.min(a[0],b[0])-margin)/ROAD_CELL);cx<=Math.floor((Math.max(a[0],b[0])+margin)/ROAD_CELL);cx++)for(let cz=Math.floor((Math.min(a[1],b[1])-margin)/ROAD_CELL);cz<=Math.floor((Math.max(a[1],b[1])+margin)/ROAD_CELL);cz++){const key=`${cx},${cz}`,list=cells.get(key)??[];if(list[list.length-1]!==road)list.push(road);cells.set(key,list);}
   }
  }
  roadIndexes.set(city,cells);
 }
 return cells.get(`${Math.floor(x/ROAD_CELL)},${Math.floor(z/ROAD_CELL)}`)??[];
}
/** A point rides a street while it is within the pavement plus a shape tolerance and
 * has not run past either end (a clamped projection only counts beside the end itself). */
function streetHit(road:Road,x:number,z:number){
 const hit=roadProjection(road,x,z),past=(hit.index===0&&hit.t===0)||(hit.index===road.points.length-2&&hit.t===1);
 return hit.distance<=road.width/2+4&&(!past||hit.distance<=2.5)?hit:undefined;
}
/** The bridge deck under every DECK_STEP metres of a route, or undefined for graded ground.
 * The walk keeps the street it is on until the shape leaves it, then takes the nearest
 * street near its current level (a street 1.5 m or more away in height is the one below an
 * overpass or above an underpass); past a deck piece's end it coasts up to 12 m for the next
 * piece before accepting a level change. A bus thus follows a deck's surveyed profile across
 * a river or the Turnpike cut and changes level only where the streets actually join. */
export function routeDecks(city:CityData,route:Pick<Route,'points'|'distances'|'length'>){
 const decks:(Road|undefined)[]=[];let street:Road|undefined,ended:Road|undefined,endedAt=0,level=0;
 const heightOn=(road:Road|undefined,x:number,z:number)=>road?.elevations?sampleRoadElevation(city,road,x,z):sampleElevation(city,x,z);
 for(let s=0;s<=route.length;s+=DECK_STEP){
  const [x,z]=transitPoint(route,s);
  if(street&&!streetHit(street,x,z)){ended=street;endedAt=s;street=undefined;}
  if(!street){
   let nearest:Road|undefined,best=Infinity,nearestLevel:Road|undefined,bestLevel=Infinity;
   for(const road of roadsNear(city,x,z)){const hit=streetHit(road,x,z);if(!hit)continue;if(hit.distance<best){best=hit.distance;nearest=road;}if(s>0&&Math.abs(heightOn(road,x,z)-level)<1.5&&hit.distance<bestLevel){bestLevel=hit.distance;nearestLevel=road;}}
   street=nearestLevel??(ended&&s-endedAt<=12&&Math.abs(heightOn(ended,x,z)-level)<1.5?ended:nearest);
  }
  level=heightOn(street,x,z);decks.push(street?.elevations?street:undefined);
 }
 return decks;
}
/** Height and up vector on the rail profile, bus bridge deck, or graded terrain. */
export function routeSurface(city:CityData,route:Pick<Route,'decks'|'rail'>,distance:number,x:number,z:number){
 if(route.rail)return railSurface(route.rail,distance);
 const deck=route.decks[Math.round(distance/DECK_STEP)];
 return deck?{height:sampleRoadElevation(city,deck,x,z),normal:roadNormal(city,deck,x,z)}:{height:sampleElevation(city,x,z),normal:sampleTerrainNormal(city,x,z)};
}
const BUS_HALF=1.3,TRACK_CLEARANCE=BUS_HALF+1.25+.35,CURB_MARGIN=.3,TRACK_CELL=32;
/** The offset of the right-hand lane traffic drives on a street (see `lane()` in traffic.ts). */
function streetLane(road:Road){const paved=road.pavedWidth??road.width;return road.oneway===0?Math.min(3,paved*.23):road.width>=12&&paved>=6.5?Math.min(3,paved*.17):Math.min(2,paved*.14);}
interface TrackSegment {a:Point2;b:Point2;start:number;length:number;route:Pick<TransitRoute,'covered'>;}
/** Every open tram track segment, by 32 m cell. */
export function trackIndex(routes:Pick<Route,'points'|'distances'|'covered'>[]){
 const cells=new Map<string,TrackSegment[]>();
 for(const route of routes)for(let i=1;i<route.points.length;i++){
  const a=route.points[i-1],b=route.points[i],segment={a,b,start:route.distances[i-1],length:route.distances[i]-route.distances[i-1],route};
  for(let x=Math.floor((Math.min(a[0],b[0])-10)/TRACK_CELL);x<=Math.floor((Math.max(a[0],b[0])+10)/TRACK_CELL);x++)for(let z=Math.floor((Math.min(a[1],b[1])-10)/TRACK_CELL);z<=Math.floor((Math.max(a[1],b[1])+10)/TRACK_CELL);z++){const key=`${x},${z}`,list=cells.get(key)??[];list.push(segment);cells.set(key,list);}
 }
 return cells;
}
/** Lateral positions (along rx, rz from p) of the nearest point of each open tram track within 10 m running parallel to heading (hx, hz). */
function tracksBeside(tracks:Map<string,TrackSegment[]>,p:Point2,hx:number,hz:number){
 const nearest=new Map<TrackSegment['route'],{distance:number;lateral:number}>();
 for(const {a,b,start,length,route} of tracks.get(`${Math.floor(p[0]/TRACK_CELL)},${Math.floor(p[1]/TRACK_CELL)}`)??[]){
  const dx=b[0]-a[0],dz=b[1]-a[1];if(!length||Math.abs((dx*hx+dz*hz)/length)<.8)continue;
  const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(length*length))),x=a[0]+dx*t-p[0],z=a[1]+dz*t-p[1],distance=Math.hypot(x,z);
  if(distance>10||distance>=(nearest.get(route)?.distance??Infinity)||railCovered(route,start+length*t))continue;nearest.set(route,{distance,lateral:-x*hz+z*hx});
 }
 return[...nearest.values()].map(v=>v.lateral);
}
/** A moving average over ±radius samples. */
function smooth(values:Float32Array,radius:number){
 const out=new Float32Array(values.length);
 for(let i=0;i<values.length;i++){let sum=0,n=0;for(let j=Math.max(0,i-radius);j<=Math.min(values.length-1,i+radius);j++){sum+=values[j];n++;}out[i]=sum/n;}
 return out;
}
/** An MBTA shape is a service alignment near the street centerline, used by both
 * directions. A bus instead drives the right-hand lane of the street it follows (matched
 * like `routeDecks`: the street it is on while the shape stays within it, else the
 * nearest one running along the shape, a one-way street only in its own direction),
 * and has a second lane clear of any parallel tram track: right of the tracks where
 * the curb allows, else left of them while it stays on its own side of the street,
 * never across a track the lane already clears. Where neither fits, the lane is
 * unchanged and the bus queues behind the tram. */
export function routeLanes(city:CityData,route:Pick<Route,'points'|'distances'|'length'|'decks'>,tracks:Map<string,TrackSegment[]>=new Map()):BusLanes{
 const n=Math.floor(route.length/DECK_STEP)+1,base=new Float32Array(n).fill(NaN),outer=new Float32Array(n).fill(Infinity),inner=new Float32Array(n).fill(-Infinity),rx=new Float32Array(n),rz=new Float32Array(n),beside:number[][]=[];
 let hx=0,hz=1,street:Road|undefined;
 for(let k=0;k<n;k++){
  const s=k*DECK_STEP,p=transitPoint(route,s),a=transitPoint(route,s-6),b=transitPoint(route,s+6),l=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(l>.5){hx=(b[0]-a[0])/l;hz=(b[1]-a[1])/l;}rx[k]=-hz;rz[k]=hx;
  // Through a turn the lateral frame swings; the shift there is held from the straight approaches instead.
  const turn=Math.abs(Math.atan2((p[0]-a[0])*(b[1]-p[1])-(p[1]-a[1])*(b[0]-p[0]),(p[0]-a[0])*(b[0]-p[0])+(p[1]-a[1])*(b[1]-p[1])));
  beside.push(turn<.35?tracksBeside(tracks,p,hx,hz):[]);
  const deck=route.decks[k];let best:{road:Road;x:number;z:number;score:number}|undefined;
  const match=(road:Road)=>{
   const hit=deck?roadProjection(road,p[0],p[1]):streetHit(road,p[0],p[1]);if(!hit||hit.distance>road.width/2+4)return;
   const r0=road.points[hit.index],r1=road.points[hit.index+1],rl=Math.hypot(r1[0]-r0[0],r1[1]-r0[1])||1,along=((r1[0]-r0[0])*hx+(r1[1]-r0[1])*hz)/rl;
   if(road.oneway*along<0)return;return{road,x:hit.x,z:hit.z,score:hit.distance+(Math.abs(along)<.7?6:0)};
  };
  if(deck)best=match(deck);
  else{
   const kept=street&&match(street);if(kept&&kept.score<6)best=kept;
   for(const level of [false,true]){
    if(best)break;
    for(const road of roadsNear(city,p[0],p[1]))if(!!road.elevations===level){const m=match(road);if(m&&(!best||m.score<best.score))best=m;}
   }
  }
  street=best?.road;if(!best)continue;
  const side=(best.x-p[0])*rx[k]+(best.z-p[1])*rz[k],paved=best.road.pavedWidth??best.road.width;
  base[k]=side+streetLane(best.road);outer[k]=side+paved/2-BUS_HALF-CURB_MARGIN;inner[k]=best.road.oneway?side-paved/2+BUS_HALF+CURB_MARGIN:side+BUS_HALF;
 }
 // Gaps (a busway, a junction no street claims) keep the nearest matched lane.
 const valid=[...base.keys()].filter(k=>Number.isFinite(base[k]));
 for(let k=0,v=0;k<n;k++){if(!valid.length){base[k]=0;continue;}while(v+1<valid.length&&Math.abs(valid[v+1]-k)<=Math.abs(valid[v]-k))v++;if(!Number.isFinite(base[k]))base[k]=base[valid[v]];}
 const lane=smooth(base,6),shift=new Float32Array(n);
 for(let k=0;k<n;k++){
  const tracks=beside[k],clash=(x:number)=>tracks.filter(t=>Math.abs(x-t)<TRACK_CLEARANCE);if(!clash(lane[k]).length)continue;
  let right=lane[k],left=lane[k];
  for(let i=0;i<4;i++){const c=clash(right);if(!c.length)break;right=Math.max(...c)+TRACK_CLEARANCE;}
  for(let i=0;i<4;i++){const c=clash(left);if(!c.length)break;left=Math.min(...c)-TRACK_CLEARANCE;}
  // A bus pulls out from the tracks its lane overlaps toward the curb if it can, never across a track it already
  // clears, and by at most a lane and a half.
  const across=(x:number)=>tracks.some(t=>Math.abs(t-lane[k])>=TRACK_CLEARANCE&&(t-lane[k])*(t-x)<0),options=[right,left].filter(x=>x<=outer[k]&&x>=inner[k]&&Math.abs(x-lane[k])<=5&&!clash(x).length&&!across(x));
  if(options.length)shift[k]=options[0]-lane[k];
 }
 // Hold each shift 20 m either side so the bus does not weave between track gaps, then ease it in.
 const held=new Float32Array(n);
 for(let k=0;k<n;k++)for(let j=Math.max(0,k-10);j<=Math.min(n-1,k+10);j++)if(Math.abs(shift[j])>Math.abs(held[k]))held[k]=shift[j];
 return{base:lane,delta:smooth(held,8),rx:smooth(rx,2),rz:smooth(rz,2)};
}
/** A lane array sampled `distance` along the route. */
function laneAt(values:Float32Array,distance:number){const at=Math.max(0,Math.min(values.length-1,distance/DECK_STEP)),i=Math.floor(at),j=Math.min(values.length-1,i+1);return values[i]+(values[j]-values[i])*(at-i);}
/** Where a bus is `distance` along its route, `shift` of the way from its street lane to its track-clear lane plus `extra` metres. */
export function busPoint(route:Pick<Route,'points'|'distances'|'length'>&{lanes?:BusLanes},distance:number,shift=0,extra=0):Point2{
 const p=transitPoint(route,distance),lanes=route.lanes;if(!lanes)return p;
 const at=Math.max(0,Math.min(lanes.base.length-1,distance/DECK_STEP)),i=Math.min(lanes.base.length-2,Math.floor(at)),f=Math.max(0,Math.min(1,at-i)),j=Math.min(lanes.base.length-1,i+1);
 if(i<0)return p;const mix=(v:Float32Array)=>v[i]+(v[j]-v[i])*f,offset=mix(lanes.base)+shift*mix(lanes.delta)+extra;
 return[p[0]+mix(lanes.rx)*offset,p[1]+mix(lanes.rz)*offset];
}
function routeData(source:TransitRoute,city:CityData):Route{
 const distances=[0];for(let i=1;i<source.points.length;i++)distances.push(distances[i-1]+dist(source.points[i],source.points[i-1]));
 const route:Route={...source,distances,length:distances[distances.length-1],signalStops:[],decks:[]};
 let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;for(const [x,z] of route.points){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
 for(const signal of route.line==='Green-D'?[]:city.signals){if(signal[0]<minX-13||signal[0]>maxX+13||signal[1]<minZ-13||signal[1]>maxZ+13)continue;let best={d:Infinity,s:0,yaw:0};for(let i=1;i<route.points.length;i++){
  const a=route.points[i-1],b=route.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=dist(a,b),t=THREE.MathUtils.clamp(((signal[0]-a[0])*dx+(signal[1]-a[1])*dz)/(length*length||1),0,1),d=Math.hypot(signal[0]-a[0]-dx*t,signal[1]-a[1]-dz*t);
  if(d<best.d)best={d,s:distances[i-1]+t*length,yaw:Math.atan2(dx,dz)};
 }if(best.d<13&&!route.signalStops.some(s=>Math.abs(s.distance-best.s)<22))route.signalStops.push({distance:Math.max(0,best.s-10),yaw:best.yaw});}
 route.signalStops.sort((a,b)=>a.distance-b.distance);
 if(route.kind==='bus')route.decks=routeDecks(city,route);
 else{
  route.rail=createRailProfile(city,route);
  // Parent-station coordinates can be below a road bridge. Dwell on the nearby
  // open platform so one complete car remains visible while serving the stop.
  route.stops=route.stops.map(stop=>{const distance=railStopDistance(route.rail!,stop.distance);return{...stop,distance,position:transitPoint(route,distance)};}).sort((a,b)=>a.distance-b.distance);
 }
 return route;
}

/** Static MBTA geometry and a bounded service simulation: one vehicle per 4 km of
 * each route direction. Vehicles stop for the player, dwell at mapped stops, follow
 * bridge decks, and only recycle outside the view. Buses keep to the right-hand lane
 * and move over to their track-clear lane while a tram is near. */
export function createTransit(scene:THREE.Scene,city:CityData,physics:DrivingPhysics,data:TransitData){
 const group=new THREE.Group();group.name='Boston public transport';scene.add(group);
 const routes=data.routes.map(route=>routeData(route,city)),rails=trackIndex(routes.filter(r=>r.rail));
 for(const route of routes)if(route.kind==='bus')route.lanes=routeLanes(city,route,rails);
 const tracks=createTransitTracks(city,routes,transitPoint,(route,distance,point)=>routeSurface(city,route,distance,...point).height,(route,distance)=>!!route.rail&&railCovered(route.rail,distance,1.5));group.add(tracks.group);
 const actors:Actor[]=[],colliders=new Set<number>();
 for(let i=0;i<routes.length;i++){
  const route=routes[i],fleet=Math.max(1,Math.min(3,Math.round(route.length/4000)));
  // The Huntington services keep a vehicle near the MFA/Longwood stops so the showcase
  // destination finds them; the rest of a fleet is spread so opposite directions interleave.
  const showcase=route.stops.find(s=>/Fine Arts|Louis Prang/.test(s.name));
  for(let k=0;k<fleet;k++){
   const tram=route.kind==='tram'?createGreenLine(route.destination):undefined,model=tram?.group??createTransitBus(route.destination);group.add(model);
   const distance=k===0&&showcase?Math.max(25,showcase.distance-(i%2?180:80)):Math.min(route.length-25,Math.max(25,route.length*(k+.25)/fleet)),point=busPoint(route,distance),next=busPoint(route,distance+1),yaw=Math.atan2(next[0]-point[0],next[1]-point[1]);
   const bodies:RAPIER.RigidBody[]=[];
   for(let part=0;part<(tram?3:1);part++){
    const body=physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    colliders.add(physics.world.createCollider(RAPIER.ColliderDesc.cuboid(tram?1.25:1.25,tram?1.25:1.3,tram?(part===1?3.12:3.85):5.9).setFriction(.4).setRestitution(.02),body).handle);bodies.push(body);
   }
   const actor:Actor={offset:0,lateral:0,near:false,lean:0,route,distance,speed:0,dwell:0,nextStop:Math.max(0,route.stops.findIndex(s=>s.distance>distance+3)),model,tram,bodies,x:point[0],z:point[1],y:routeSurface(city,route,distance,...point).height,yaw,lastStop:''};
   if(route.stops.every(s=>s.distance<=distance+3))actor.nextStop=route.stops.length;actors.push(actor);
  }
 }
 let elapsed=0;
 const place=(object:THREE.Object3D,body:RAPIER.RigidBody,route:Route,distance:number,immediate=false,extra=0,lean=0)=>{
  const p=busPoint(route,distance,0,extra),a=busPoint(route,distance-1,0,extra),b=busPoint(route,distance+1,0,extra),yaw=Math.atan2(b[0]-a[0],b[1]-a[1])+lean,surface=routeSurface(city,route,distance,...p),y=surface.height+(route.kind==='tram'?.11:.01),q=rotationFromNormal(surface.normal,yaw);
  object.position.set(p[0],y,p[1]);object.quaternion.set(q.x,q.y,q.z,q.w);
  let reset=immediate;
  if(route.rail){object.visible=!railCovered(route.rail,distance);reset||=!body.isEnabled()||!object.visible;body.setEnabled(object.visible);}
  // Disabled kinematic bodies do not consume next-pose targets. Keep their real
  // pose current, including on re-entry, so emerging from cover cannot impart
  // an entire underpass's travel as a one-frame collision velocity.
  const position={x:p[0],y:y+1.6,z:p[1]};if(reset){body.setTranslation(position,true);body.setRotation(q,true);}else{body.setNextKinematicTranslation(position);body.setNextKinematicRotation(q);}
 };
 const pose=(actor:Actor,immediate=false)=>{
  if(actor.tram){
   actor.tram.sections.forEach((section,i)=>place(section,actor.bodies[i],actor.route,actor.distance+actor.tram!.offsets[i],immediate));
   actor.tram.bellows.forEach((joint,i)=>{const distance=actor.distance+(i===0?3.32:-3.32),p=transitPoint(actor.route,distance),a=transitPoint(actor.route,distance-1),b=transitPoint(actor.route,distance+1),surface=routeSurface(city,actor.route,distance,...p),q=rotationFromNormal(surface.normal,Math.atan2(b[0]-a[0],b[1]-a[1]));joint.position.set(p[0],surface.height+.11,p[1]);joint.quaternion.set(q.x,q.y,q.z,q.w);joint.visible=!railCovered(actor.route.rail!,distance);});
  }
  else place(actor.model,actor.bodies[0],actor.route,actor.distance,immediate,actor.offset,actor.lean);
 };
 actors.forEach(a=>pose(a,true));
 // The trajectory traffic settles right of way with carries a lane change under way to its end (a held bus stays put).
 const predictedOffset=(a:Actor,travel:number)=>{if(!a.lateral||!a.route.lanes)return a.offset;const reach=Math.abs(a.lateral)*travel/Math.max(1,a.speed),goal=a.near?laneAt(a.route.lanes.delta,a.distance+travel):0;return a.offset+THREE.MathUtils.clamp(goal-a.offset,-reach,reach);};
 const obstacles=():TrafficObstacle[]=>actors.filter(a=>!a.route.rail||!railCovered(a.route.rail,a.distance)).map(a=>({x:a.x,y:a.y,z:a.z,halfLength:a.tram?11.25:6.0,halfWidth:1.3,speed:a.speed,yaw:a.yaw,pose:(travel:number)=>{const s=Math.min(a.distance+travel,a.route.length-2),o=predictedOffset(a,travel),p=busPoint(a.route,s,0,o),q=busPoint(a.route,s+2,0,o);return{x:p[0],z:p[1],yaw:Math.atan2(q[0]-p[0],q[1]-p[1])};}}));
 return{
  count:actors.length,busCount:actors.filter(a=>!a.tram).length,tramCount:actors.filter(a=>a.tram).length,obstacles,
  /** Collider handles of every bus and tram section; they stay kinematic (a 12 t bus does not budge for a car). */
  colliders,
  snapshot:()=>actors.map(a=>({kind:a.route.kind,line:a.route.line,destination:a.route.destination,route:a.route.id,distance:a.distance,yaw:a.yaw,covered:!!a.route.rail&&railCovered(a.route.rail,a.distance),carCount:1,laneOffset:a.offset,x:a.x,y:a.y,z:a.z,speed:a.speed,dwell:a.dwell,nextStop:a.route.stops[a.nextStop]?.name,lastStop:a.lastStop})),
  update(dt:number,player:VehicleState,observer:Pick<VehicleState,'x'|'y'|'z'>=player,traffic:TrafficObstacle[]=[]){
   dt=Math.max(0,Math.min(dt,1/30));elapsed+=dt;const fleet=obstacles();tracks.updateVisibility(observer.x,observer.z);
   for(const actor of actors){
    const p=transitPoint(actor.route,actor.distance),look=transitPoint(actor.route,actor.distance+6),fx=Math.sin(actor.yaw),fz=Math.cos(actor.yaw),half=actor.tram?11.25:6;
    let target=actor.tram?8:8.5;
    const upcomingYaw=Math.atan2(look[0]-p[0],look[1]-p[1]),turn=Math.abs(Math.atan2(Math.sin(upcomingYaw-actor.yaw),Math.cos(upcomingYaw-actor.yaw)));target*=1-Math.min(.7,turn*.6);
    const stop=actor.route.stops[actor.nextStop];
    if(actor.dwell>0){actor.dwell=Math.max(0,actor.dwell-dt);target=0;}
    else if(stop){const gap=stop.distance-actor.distance;target=Math.min(target,Math.sqrt(Math.max(0,2*1.8*(gap-.7))));if(gap<1.1&&actor.speed<.2){actor.dwell=actor.tram?8:5;actor.lastStop=stop.name;actor.nextStop++;}}
    const light=actor.route.signalStops.find(l=>l.distance>=actor.distance+half-.3);
    if(light&&signalPhase(elapsed,light.yaw)!=='green'){const gap=light.distance-actor.distance-half;if(actor.signalStop!==light.distance){actor.signalStop=light.distance;actor.signalCommitted=actor.speed>2&&gap<actor.speed*actor.speed/7+1;}if(!actor.signalCommitted)target=Math.min(target,Math.sqrt(Math.max(0,2*2.4*(gap-.6))));}else{actor.signalStop=undefined;actor.signalCommitted=false;}
    const covered=!!actor.route.rail&&railCovered(actor.route.rail,actor.distance);
    const others:TrafficObstacle[]=[...(covered?[]:[{...player,halfLength:2.1,halfWidth:.9},...traffic]),...fleet.filter(a=>a.x!==actor.x||a.z!==actor.z)];
    if(actor.route.lanes){
     // Move over while an open tram is within 90 m ahead or 30 m behind (either direction), ease back once it has gone;
     // the change runs faster with speed, and the bus heads into it as a lane change rather than sliding sideways.
     const lanes=actor.route.lanes,near=actors.some(o=>{if(!o.tram||Math.abs(o.y-actor.y)>=4||railCovered(o.route.rail!,o.distance))return false;const dx=o.x-actor.x,dz=o.z-actor.z,along=dx*fx+dz*fz;return along>-30&&along<90&&Math.abs(dx*fz-dz*fx)<9;});
     const k=Math.min(lanes.delta.length-1,Math.round(actor.distance/DECK_STEP)),goal=near?lanes.delta[k]:0,route=transitPoint(actor.route,actor.distance),rx=lanes.rx[k],rz=lanes.rz[k];
     // Either way the bus waits for the strip it would sweep into to be free of anything alongside: the player, a car,
     // another bus or a tram. Its own footprint is not part of the strip, so a car queued behind it does not count.
     const blocked=(offset:number)=>{
      const from=lanes.base[k]+actor.offset,to=lanes.base[k]+offset,[lo,hi]=to>from?[from+BUS_HALF,to+BUS_HALF+.3]:[to-BUS_HALF-.3,from-BUS_HALF];
      return Math.abs(to-from)>.01&&others.some(o=>{
       if(Math.abs(o.y-actor.y)>4)return false;
       const c=o.yaw===undefined?1:Math.abs(Math.cos(o.yaw-actor.yaw)),sn=Math.sqrt(1-c*c),hl=o.halfLength??2.1,hw=o.halfWidth??.9,lateral=(o.x-route[0])*rx+(o.z-route[1])*rz,reach=hl*sn+hw*c;
       // Leave room for what closes on the bus during the change (about 2.5 s): a faster car behind, a slower one ahead.
       const along=(o.x-actor.x)*fx+(o.z-actor.z)*fz,closing=(along<0?1:-1)*((o.speed??0)*(o.yaw===undefined?1:Math.cos(o.yaw-actor.yaw))-actor.speed);
       return Math.abs(along)<half+hl*c+hw*sn+1.5+Math.max(0,closing)*2.5&&lateral+reach>lo&&lateral-reach<hi;
      });
     };
     const rate=Math.min(1.5,.5+.12*actor.speed),before=actor.offset;actor.near=near;if(!blocked(goal))actor.offset+=THREE.MathUtils.clamp(goal-actor.offset,-rate*dt,rate*dt);actor.lateral=dt>0?(actor.offset-before)/dt:0;
     actor.lean+=(-Math.atan2(actor.lateral,Math.max(3,actor.speed))-actor.lean)*Math.min(1,dt*4);
     // Where the track-clear lane narrows within braking reach (its ends) and the bus could not move back to the room left
     // there, it stops before it would leave that lane instead of running on past it beside whatever holds it there.
     if(Math.abs(actor.offset)>.3)for(let ahead=2;ahead<=actor.speed*actor.speed/4.8+12;ahead+=DECK_STEP){
      const d=lanes.delta[Math.min(lanes.delta.length-1,k+ahead/DECK_STEP)],room=actor.offset*d>0?d:0;
      if(Math.sign(actor.offset)*(actor.offset-room)>.3){if(blocked(room))target=Math.min(target,Math.sqrt(Math.max(0,2*2.4*(ahead-4))));break;}
     }
    }
    for(const other of others){
     if(Math.abs(other.y-actor.y)>4)continue;const dx=other.x-actor.x,dz=other.z-actor.z,along=dx*fx+dz*fz,across=Math.abs(dx*fz-dz*fx),gap=along-half-(other.halfLength??2.1)-2;
     if(along>0&&along<65&&across<1.35+(other.halfWidth??.9))target=Math.min(target,Math.sqrt(Math.max(0,2*3.2*gap)));
    }
    const end=actor.route.length-actor.distance-half-1;target=Math.min(target,Math.sqrt(Math.max(0,2*2*end)));
    actor.speed+=THREE.MathUtils.clamp(target-actor.speed,-4*dt,(actor.tram?1.05:1.25)*dt);actor.distance=Math.min(actor.route.length-half-.5,actor.distance+actor.speed*dt);
    if(end<2&&actor.speed<.1&&Math.hypot(actor.x-observer.x,actor.z-observer.z)>450){const start=transitPoint(actor.route,half+2);if(Math.hypot(start[0]-observer.x,start[1]-observer.z)>450){actor.distance=half+2;actor.nextStop=0;actor.dwell=0;pose(actor,true);}}
    const next=busPoint(actor.route,actor.distance,0,actor.offset),ahead=busPoint(actor.route,actor.distance+2,0,actor.offset);actor.x=next[0];actor.z=next[1];actor.y=routeSurface(city,actor.route,actor.distance,...next).height;actor.yaw=Math.atan2(ahead[0]-next[0],ahead[1]-next[1]);pose(actor);
    // Beyond the detailed tiles the far city draws hulls only; a vehicle there is not drawn either.
    actor.model.visible=Math.hypot(actor.x-observer.x,actor.z-observer.z)<1400;
   }
  },
  setNight(night:boolean){group.traverse(o=>{if(o instanceof THREE.Mesh&&o.material instanceof THREE.MeshStandardMaterial&&['head','tail'].includes(o.name))o.material.emissiveIntensity=night?2.4:.3;});},
  dispose(){for(const a of actors)for(const b of a.bodies)physics.world.removeRigidBody(b);const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();group.traverse(o=>{if(o instanceof THREE.Mesh){geometries.add(o.geometry);(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m));}});geometries.forEach(g=>g.dispose());materials.forEach(m=>{for(const value of Object.values(m))if(value instanceof THREE.Texture)textures.add(value);m.dispose();});textures.forEach(t=>t.dispose());scene.remove(group);}
 };
}
