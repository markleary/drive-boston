import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {CityData,Point2,Road,VehicleState} from '../types';
import type {DrivingPhysics} from '../physics/vehicle';
import {sampleElevation,sampleTerrainNormal,terrainRotation,rotationFromNormal} from './terrain.ts';
import {sampleRoadElevation,roadNormal,roadProjection} from './road-surfaces.ts';
import {signalPhase} from './signals.ts';
import {createGreenLine,createTransitBus} from '../render/transit-vehicles.ts';
export interface TransitRoute {id:string;line:string;kind:'bus'|'tram';destination:string;points:Point2[];length:number;stops:{id:string;name:string;distance:number;position:Point2}[];}
export interface TransitData {routes:TransitRoute[];sources:{name:string;url:string;license:string}[];notes:string;}
export interface TrafficObstacle {x:number;y:number;z:number;halfLength?:number;halfWidth?:number;speed?:number;}
interface Route extends TransitRoute {distances:number[];signalStops:{distance:number;yaw:number}[];decks:(Road|undefined)[];}
interface Actor {signalStop?:number;signalCommitted?:boolean;route:Route;distance:number;speed:number;dwell:number;nextStop:number;model:THREE.Group;tram?:ReturnType<typeof createGreenLine>;bodies:RAPIER.RigidBody[];x:number;z:number;y:number;yaw:number;lastStop:string;}
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
/** Height and up vector under a vehicle at a route distance: its deck sample, else the terrain. */
export function routeSurface(city:CityData,route:Pick<Route,'decks'>,distance:number,x:number,z:number){
 const deck=route.decks[Math.round(distance/DECK_STEP)];
 return deck?{height:sampleRoadElevation(city,deck,x,z),normal:roadNormal(city,deck,x,z)}:{height:sampleElevation(city,x,z),normal:sampleTerrainNormal(city,x,z)};
}
function routeData(source:TransitRoute,city:CityData):Route{
 const distances=[0];for(let i=1;i<source.points.length;i++)distances.push(distances[i-1]+dist(source.points[i],source.points[i-1]));
 const route:Route={...source,distances,length:distances[distances.length-1],signalStops:[],decks:[]};
 let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;for(const [x,z] of route.points){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
 for(const signal of city.signals){if(signal[0]<minX-13||signal[0]>maxX+13||signal[1]<minZ-13||signal[1]>maxZ+13)continue;let best={d:Infinity,s:0,yaw:0};for(let i=1;i<route.points.length;i++){
  const a=route.points[i-1],b=route.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=dist(a,b),t=THREE.MathUtils.clamp(((signal[0]-a[0])*dx+(signal[1]-a[1])*dz)/(length*length||1),0,1),d=Math.hypot(signal[0]-a[0]-dx*t,signal[1]-a[1]-dz*t);
  if(d<best.d)best={d,s:distances[i-1]+t*length,yaw:Math.atan2(dx,dz)};
 }if(best.d<13&&!route.signalStops.some(s=>Math.abs(s.distance-best.s)<22))route.signalStops.push({distance:Math.max(0,best.s-10),yaw:best.yaw});}
 route.signalStops.sort((a,b)=>a.distance-b.distance);if(route.kind==='bus')route.decks=routeDecks(city,route);return route;
}

/** Static MBTA geometry and a bounded service simulation: one vehicle per 4 km of
 * each route direction. Vehicles stop for the player, dwell at mapped stops, follow
 * bridge decks, and only recycle outside the view. */
export function createTransit(scene:THREE.Scene,city:CityData,physics:DrivingPhysics,data:TransitData){
 const group=new THREE.Group();group.name='Boston public transport';scene.add(group);
 const routes=data.routes.map(route=>routeData(route,city));
 const iron=new THREE.MeshStandardMaterial({color:'#555c5d',metalness:.7,roughness:.36});
 const concrete=new THREE.MeshStandardMaterial({color:'#777d70',roughness:.95});
 const railGeometries:THREE.BufferGeometry[]=[],beds:THREE.BufferGeometry[]=[],wires:THREE.BufferGeometry[]=[],supports:THREE.BufferGeometry[]=[];
 const cable=(a:THREE.Vector3,b:THREE.Vector3,r:number)=>{const delta=b.clone().sub(a),g=new THREE.CylinderGeometry(r,r,delta.length(),5);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));return g.translate(...a.add(b).multiplyScalar(.5).toArray());};
 for(const route of routes.filter(r=>r.kind==='tram')){
  let lastPole=-100;
  for(let s=0;s<route.length-1;s+=3){
   const a=transitPoint(route,s),b=transitPoint(route,Math.min(route.length,s+3)),dx=b[0]-a[0],dz=b[1]-a[1],length=dist(a,b),yaw=Math.atan2(dx,dz),nx=-dz/(length||1),nz=dx/(length||1);
   const ya=sampleElevation(city,...a),yb=sampleElevation(city,...b),tilt=-Math.atan2(yb-ya,length),cy=(ya+yb)/2;
   // Only the reserved northeastern section receives a concrete rail bed.
   // Beyond Brigham Circle the Green Line shares the paved street.
   if(a[0]>-2460)beds.push(new THREE.BoxGeometry(2.5,.035,length+.025).rotateX(tilt).rotateY(yaw).translate((a[0]+b[0])/2,cy+.062,(a[1]+b[1])/2));
   for(const side of [-1,1])railGeometries.push(new THREE.BoxGeometry(.065,.04,length+.03).rotateX(tilt).rotateY(yaw).translate((a[0]+b[0])/2+nx*.7175*side,cy+.095,(a[1]+b[1])/2+nz*.7175*side));
   wires.push(cable(new THREE.Vector3(a[0],ya+5.73,a[1]),new THREE.Vector3(b[0],yb+5.73,b[1]),.012));
   // One set of poles per track, offset to the median between the tracks.
   if(route.id===routes.find(r=>r.kind==='tram')?.id&&s-lastPole>34&&a[0]>-2460){
    lastPole=s;const x=a[0]+nx*1.9,z=a[1]+nz*1.9,y=sampleElevation(city,x,z);supports.push(new THREE.CylinderGeometry(.07,.1,6.3,7).translate(x,y+3.15,z));supports.push(cable(new THREE.Vector3(x,y+6.1,z),new THREE.Vector3(a[0]-nx*4,ya+6.1,a[1]-nz*4),.035));
   }
  }
 }
 const mesh=(geometries:THREE.BufferGeometry[],material:THREE.Material,name:string)=>{if(!geometries.length)return;const g=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());if(g){const m=new THREE.Mesh(g,material);m.name=name;m.receiveShadow=true;m.castShadow=name==='Catenary poles';group.add(m);}};
 mesh(beds,concrete,'Reserved Green Line rail bed');mesh(railGeometries,iron,'Standard gauge Green Line rails');mesh(wires,iron,'Green Line overhead wire');mesh(supports,iron,'Catenary poles');
 const actors:Actor[]=[];
 for(let i=0;i<routes.length;i++){
  const route=routes[i],fleet=Math.max(1,Math.min(3,Math.round(route.length/4000)));
  // The Huntington services keep a vehicle near the MFA/Longwood stops so the showcase
  // destination finds them; the rest of a fleet is spread so opposite directions interleave.
  const showcase=route.stops.find(s=>/Fine Arts|Louis Prang/.test(s.name));
  for(let k=0;k<fleet;k++){
   const tram=route.kind==='tram'?createGreenLine(route.destination):undefined,model=tram?.group??createTransitBus(route.destination);group.add(model);
   const distance=k===0&&showcase?Math.max(25,showcase.distance-(i%2?180:80)):Math.min(route.length-25,Math.max(25,route.length*(k+.25)/fleet)),point=transitPoint(route,distance),next=transitPoint(route,distance+1),yaw=Math.atan2(next[0]-point[0],next[1]-point[1]);
   const bodies:RAPIER.RigidBody[]=[];
   for(let part=0;part<(tram?3:1);part++){
    const body=physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(tram?1.25:1.25,tram?1.25:1.3,tram?(part===1?3.12:3.85):5.9).setFriction(.4).setRestitution(.02),body);bodies.push(body);
   }
   const actor:Actor={route,distance,speed:0,dwell:0,nextStop:Math.max(0,route.stops.findIndex(s=>s.distance>distance+3)),model,tram,bodies,x:point[0],z:point[1],y:routeSurface(city,route,distance,...point).height,yaw,lastStop:''};
   if(route.stops.every(s=>s.distance<=distance+3))actor.nextStop=route.stops.length;actors.push(actor);
  }
 }
 let elapsed=0;
 const place=(object:THREE.Object3D,body:RAPIER.RigidBody,route:Route,distance:number,immediate=false)=>{
  const p=transitPoint(route,distance),a=transitPoint(route,distance-1),b=transitPoint(route,distance+1),yaw=Math.atan2(b[0]-a[0],b[1]-a[1]),surface=routeSurface(city,route,distance,...p),y=surface.height+(route.kind==='tram'?.11:.01),q=rotationFromNormal(surface.normal,yaw);
  object.position.set(p[0],y,p[1]);object.quaternion.set(q.x,q.y,q.z,q.w);
  const position={x:p[0],y:y+1.6,z:p[1]};if(immediate){body.setTranslation(position,true);body.setRotation(q,true);}else{body.setNextKinematicTranslation(position);body.setNextKinematicRotation(q);}
 };
 const pose=(actor:Actor,immediate=false)=>{
  if(actor.tram){actor.tram.sections.forEach((section,i)=>place(section,actor.bodies[i],actor.route,actor.distance+actor.tram!.offsets[i],immediate));actor.tram.bellows.forEach((joint,i)=>{const distance=actor.distance+(i===0?3.32:-3.32),p=transitPoint(actor.route,distance),a=transitPoint(actor.route,distance-1),b=transitPoint(actor.route,distance+1),q=terrainRotation(city,...p,Math.atan2(b[0]-a[0],b[1]-a[1]));joint.position.set(p[0],sampleElevation(city,...p)+.11,p[1]);joint.quaternion.set(q.x,q.y,q.z,q.w);});}
  else place(actor.model,actor.bodies[0],actor.route,actor.distance,immediate);
 };
 actors.forEach(a=>pose(a,true));
 const obstacles=():TrafficObstacle[]=>actors.map(a=>({x:a.x,y:a.y,z:a.z,halfLength:a.tram?11.25:6.0,halfWidth:1.3,speed:a.speed}));
 return{
  count:actors.length,busCount:actors.filter(a=>!a.tram).length,tramCount:actors.filter(a=>a.tram).length,obstacles,
  snapshot:()=>actors.map(a=>({kind:a.route.kind,line:a.route.line,x:a.x,y:a.y,z:a.z,speed:a.speed,dwell:a.dwell,nextStop:a.route.stops[a.nextStop]?.name,lastStop:a.lastStop})),
  update(dt:number,player:VehicleState,observer:Pick<VehicleState,'x'|'y'|'z'>=player,traffic:TrafficObstacle[]=[]){
   dt=Math.max(0,Math.min(dt,1/30));elapsed+=dt;const fleet=obstacles();
   for(const actor of actors){
    const p=transitPoint(actor.route,actor.distance),look=transitPoint(actor.route,actor.distance+6),fx=Math.sin(actor.yaw),fz=Math.cos(actor.yaw),half=actor.tram?11.25:6;
    let target=actor.tram?8:8.5;
    const upcomingYaw=Math.atan2(look[0]-p[0],look[1]-p[1]),turn=Math.abs(Math.atan2(Math.sin(upcomingYaw-actor.yaw),Math.cos(upcomingYaw-actor.yaw)));target*=1-Math.min(.7,turn*.6);
    const stop=actor.route.stops[actor.nextStop];
    if(actor.dwell>0){actor.dwell=Math.max(0,actor.dwell-dt);target=0;}
    else if(stop){const gap=stop.distance-actor.distance;target=Math.min(target,Math.sqrt(Math.max(0,2*1.8*(gap-.7))));if(gap<1.1&&actor.speed<.2){actor.dwell=actor.tram?8:5;actor.lastStop=stop.name;actor.nextStop++;}}
    const light=actor.route.signalStops.find(l=>l.distance>=actor.distance+half-.3);
    if(light&&signalPhase(elapsed,light.yaw)!=='green'){const gap=light.distance-actor.distance-half;if(actor.signalStop!==light.distance){actor.signalStop=light.distance;actor.signalCommitted=actor.speed>2&&gap<actor.speed*actor.speed/7+1;}if(!actor.signalCommitted)target=Math.min(target,Math.sqrt(Math.max(0,2*2.4*(gap-.6))));}else{actor.signalStop=undefined;actor.signalCommitted=false;}
    const others:TrafficObstacle[]=[{...player,halfLength:2.1,halfWidth:.9},...traffic,...fleet.filter(a=>a.x!==actor.x||a.z!==actor.z)];
    for(const other of others){
     if(Math.abs(other.y-actor.y)>4)continue;const dx=other.x-actor.x,dz=other.z-actor.z,along=dx*fx+dz*fz,across=Math.abs(dx*fz-dz*fx),gap=along-half-(other.halfLength??2.1)-2;
     if(along>0&&along<65&&across<1.35+(other.halfWidth??.9))target=Math.min(target,Math.sqrt(Math.max(0,2*3.2*gap)));
    }
    const end=actor.route.length-actor.distance-half-1;target=Math.min(target,Math.sqrt(Math.max(0,2*2*end)));
    actor.speed+=THREE.MathUtils.clamp(target-actor.speed,-4*dt,(actor.tram?1.05:1.25)*dt);actor.distance=Math.min(actor.route.length-half-.5,actor.distance+actor.speed*dt);
    if(end<2&&actor.speed<.1&&Math.hypot(actor.x-observer.x,actor.z-observer.z)>450){const start=transitPoint(actor.route,half+2);if(Math.hypot(start[0]-observer.x,start[1]-observer.z)>450){actor.distance=half+2;actor.nextStop=0;actor.dwell=0;pose(actor,true);}}
    const next=transitPoint(actor.route,actor.distance),ahead=transitPoint(actor.route,actor.distance+2);actor.x=next[0];actor.z=next[1];actor.y=routeSurface(city,actor.route,actor.distance,...next).height;actor.yaw=Math.atan2(ahead[0]-next[0],ahead[1]-next[1]);pose(actor);
    // Beyond the detailed tiles the far city draws hulls only; a vehicle there is not drawn either.
    actor.model.visible=Math.hypot(actor.x-observer.x,actor.z-observer.z)<1400;
   }
  },
  setNight(night:boolean){group.traverse(o=>{if(o instanceof THREE.Mesh&&o.material instanceof THREE.MeshStandardMaterial&&['head','tail'].includes(o.name))o.material.emissiveIntensity=night?2.4:.3;});},
  dispose(){for(const a of actors)for(const b of a.bodies)physics.world.removeRigidBody(b);const materials=new Set<THREE.Material>();group.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m));}});materials.forEach(m=>{if(m instanceof THREE.MeshStandardMaterial)m.map?.dispose();m.dispose();});scene.remove(group);}
 };
}
