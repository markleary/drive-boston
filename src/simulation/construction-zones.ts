import type {CityData,Point2,Road} from '../types';
import {coverageTester} from './coverage.ts';
import {sampleRoadElevation,roadWidthAt} from './road-surfaces.ts';
import {motorwayLanes,pointAtDistance,stations} from './motorway.ts';

/** Road-local offsets use the same convention as traffic.lane(): positive is
 * the side (-cos(yaw), sin(yaw)) of a vehicle travelling at `yaw`. */
export interface ConstructionZone {
  id:string;
  roadId:string;
  road:Road;
  x:number;
  z:number;
  yaw:number;
  direction:1|-1;
  laneOffset:number;
  openOffset:number;
  length:number;
  workLength:number;
  taperLength:number;
  pavedWidth:number;
  seed:number;
  vehicleKind:'dump-truck'|'excavator';
  /** A highway site follows its record's curve: `along` is measured on the
   * centreline from `station` (metres from the record's start), the offset
   * square to it. Street sites are straight, in the frame of x, z and yaw. */
  frame?:{points:readonly Point2[];along:number[];station:number};
}
export interface ConstructionOptions {
  seed?:number;
  excludedRoadIds?:ReadonlySet<string>;
  /** Transit keeps its source route: work sites must clear both road buses and
   * dedicated rail reservations rather than make them drive through cones. */
  transitRoutes?:ReadonlyArray<{points:ReadonlyArray<Point2>}>;
  /** At most this many street sites (96); the highway's own sites come on top,
   * since the metro's street plan always fills the cap. 0 plans none at all. */
  maxZones?:number;
}

export const CONSTRUCTION_WORK_LENGTH=24;
export const CONSTRUCTION_TAPER_LENGTH=18;
export const CONSTRUCTION_LENGTH=CONSTRUCTION_WORK_LENGTH+CONSTRUCTION_TAPER_LENGTH*2;
/** Merge before the first cone and rejoin after the final cone. */
export const CONSTRUCTION_APPROACH=12;
const PROFILE_REACH=CONSTRUCTION_LENGTH/2+CONSTRUCTION_APPROACH;
const END_CLEARANCE=18;
const SPACING=350;
const CELL=96;
/** Highway sites close the outside lane over 60 m behind 45 m tapers, every
 * 1.5 to 2.5 km along each direction of a carriageway (`Road.lanes` decks). */
export const MOTORWAY_WORK_LENGTH=60,MOTORWAY_TAPER_LENGTH=45,MOTORWAY_SPACING:[number,number]=[1500,2500];
const MOTORWAY_LENGTH=MOTORWAY_WORK_LENGTH+MOTORWAY_TAPER_LENGTH*2,MOTORWAY_REACH=MOTORWAY_LENGTH/2+CONSTRUCTION_APPROACH;

type Segment={a:Point2;b:Point2;road?:Road};
function indexSegments(lines:ReadonlyArray<{points:ReadonlyArray<Point2>;road?:Road}>){
  const cells=new Map<string,Segment[]>();
  for(const line of lines)for(let i=1;i<line.points.length;i++){
    const a=line.points[i-1],b=line.points[i];if(Math.hypot(b[0]-a[0],b[1]-a[1])<.01)continue;
    const segment={a,b,road:line.road};
    for(let x=Math.floor(Math.min(a[0],b[0])/CELL);x<=Math.floor(Math.max(a[0],b[0])/CELL);x++)for(let z=Math.floor(Math.min(a[1],b[1])/CELL);z<=Math.floor(Math.max(a[1],b[1])/CELL);z++){
      const key=`${x},${z}`,list=cells.get(key)??[];list.push(segment);cells.set(key,list);
    }
  }
  return (x:number,z:number,radius:number)=>{
    const found=new Set<Segment>();
    for(let xx=Math.floor((x-radius)/CELL);xx<=Math.floor((x+radius)/CELL);xx++)for(let zz=Math.floor((z-radius)/CELL);zz<=Math.floor((z+radius)/CELL);zz++)for(const segment of cells.get(`${xx},${zz}`)??[])found.add(segment);
    return found;
  };
}
function projection(a:Point2,b:Point2,x:number,z:number){
  const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
  return{x:a[0]+dx*t,z:a[1]+dz*t};
}
function roadProfile(road:Road){
  const distances=[0];for(let i=1;i<road.points.length;i++)distances.push(distances[i-1]+Math.hypot(road.points[i][0]-road.points[i-1][0],road.points[i][1]-road.points[i-1][1]));
  return{length:distances[distances.length-1],at:(s:number):Point2=>{
    let lo=0,hi=distances.length-1;while(lo+1<hi){const mid=(lo+hi)>>1;if(distances[mid]<s)lo=mid;else hi=mid;}
    const t=(s-distances[lo])/(distances[hi]-distances[lo]||1),a=road.points[lo],b=road.points[hi];return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  }};
}

/** A session-seeded layout is fixed for the entire visit. Only its nearby
 * render/physics residents change, so driving away and back cannot move a site
 * underneath a player or change a route that an NPC is already following.
 *
 * Lane counts are not present in the imported data. Require a full 7 m paved
 * one-way carriageway, or 13 m on a two-way road so each direction retains a
 * lane without borrowing the opposing lane. Roads without measured pavement
 * stay clear rather than trusting the road-class width guess. Bridges,
 * tunnels and transit corridors stay clear. */
export function planConstructionZones(city:CityData,options:ConstructionOptions={}):ConstructionZone[]{
  if((options.maxZones??96)<=0)return[];
  let state=(options.seed??0x42b0570)>>>0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const roadsNear=indexSegments(city.roads.map(road=>({points:road.points,road})));
  const transitNear=indexSegments(options.transitRoutes??[]);
  const covered=coverageTester(city),candidates:{zone:ConstructionZone;priority:number}[]=[];
  for(const road of [...city.roads].sort((a,b)=>a.id.localeCompare(b.id))){
    const paved=Math.min(road.pavedWidth??road.width,...(road.deckWidths??[]));
    if(road.points.length<2||road.traffic===false||road.bridge||road.tunnel||!Number.isFinite(road.pavedWidth)||road.width<7||paved<(road.oneway?7:13)||options.excludedRoadIds?.has(road.id)||/alley|private|parking|unnamed/i.test(road.name))continue;
    const profile=roadProfile(road),margin=PROFILE_REACH+END_CLEARANCE;
    if(profile.length<margin*2)continue;
    const tries=Math.min(4,Math.max(1,Math.floor(profile.length/100)));
    for(let attempt=0;attempt<tries;attempt++){
      const station=margin+(profile.length-margin*2)*(attempt+random())/tries;
      const p=profile.at(station),a=profile.at(station-2),b=profile.at(station+2),dx=b[0]-a[0],dz=b[1]-a[1],distance=Math.hypot(dx,dz);
      if(distance<3.9)continue;
      const direction:1|-1=road.oneway===-1?-1:road.oneway===1?1:random()<.5?1:-1;
      const yaw=Math.atan2(dx*direction,dz*direction),fx=Math.sin(yaw),fz=Math.cos(yaw);
      const laneOffset=paved/2-1.7,openOffset=road.oneway?laneOffset-3.4:Math.max(1.6,laneOffset-3.4);
      const zone:ConstructionZone={id:`construction-${road.id}`,roadId:road.id,road,x:p[0],z:p[1],yaw,direction,laneOffset,openOffset,length:CONSTRUCTION_LENGTH,workLength:CONSTRUCTION_WORK_LENGTH,taperLength:CONSTRUCTION_TAPER_LENGTH,pavedWidth:paved,seed:state,vehicleKind:random()<.5?'dump-truck':'excavator'};
      if(Math.hypot(p[0]-city.spawn.x,p[1]-city.spawn.z)<CONSTRUCTION_LENGTH/2+35)continue;
      let safe=true;
      // The whole transition must be straight, inside coverage, free of road
      // junctions/overlapping ribbons, and outside every transit corridor.
      for(let along=-PROFILE_REACH;along<=PROFILE_REACH&&safe;along+=4){
        const point=profile.at(station+along*direction),expectedX=p[0]+fx*along,expectedZ=p[1]+fz*along;
        if(Math.hypot(point[0]-expectedX,point[1]-expectedZ)>.45){safe=false;break;}
        const height=sampleRoadElevation(city,road,...point);
        for(const offset of [-paved/2+.5,paved/2-.5])if(!covered(point[0]-fz*offset,point[1]+fx*offset))safe=false;
        if(!safe)break;
        for(const other of roadsNear(point[0],point[1],paved/2+40)){
          if(other.road===road)continue;
          const hit=projection(other.a,other.b,...point),clearance=(paved+(other.road!.pavedWidth??other.road!.width))/2+4;
          if(Math.hypot(hit.x-point[0],hit.z-point[1])<clearance&&Math.abs(sampleRoadElevation(city,other.road!,hit.x,hit.z)-height)<3){safe=false;break;}
        }
        if(!safe)break;
        for(const transit of transitNear(point[0],point[1],paved/2+8)){
          const hit=projection(transit.a,transit.b,...point);
          if(Math.hypot(hit.x-point[0],hit.z-point[1])<paved/2+8){safe=false;break;}
        }
      }
      if(safe)candidates.push({zone,priority:random()});
    }
  }
  const zones:ConstructionZone[]=[],used=new Set<string>();
  for(const {zone}of candidates.sort((a,b)=>a.priority-b.priority)){
    if(used.has(zone.roadId)||zones.some(other=>Math.hypot(other.x-zone.x,other.z-zone.z)<SPACING))continue;
    used.add(zone.roadId);zones.push(zone);if(zones.length>=(options.maxZones??96))break;
  }
  zones.push(...planMotorwayZones(city,options.seed??0x42b0570));
  return zones;
}

/** Highway worksites on their own random stream (the street plan is unchanged):
 * each direction of a carriageway is chained from its pieces (records named
 * alike, end to start), and a site is planned 1.5 to 2.5 km after the last,
 * slid forward to where its whole merge lies on one piece (pieces end at every
 * gore and lane change, so a run of short ones can push it on by a kilometre)
 * at least 150 m from a closed end and clear of the spawn. The outside lane
 * closes into the next one over. */
export function planMotorwayZones(city:CityData,seed:number):ConstructionZone[]{
  let state=(seed^0x93a5c3)>>>0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const decks=city.roads.filter(road=>road.lanes!==undefined&&road.lanes>=2&&road.kind==='motorway'&&road.oneway===1&&road.traffic!==false&&!road.tunnel&&road.points.length>=2).sort((a,b)=>a.id.localeCompare(b.id));
  const same=(a:Point2,b:Point2)=>Math.hypot(a[0]-b[0],a[1]-b[1])<.5,groups=new Map<string,Road[]>();
  for(const road of decks){const name=road.name.split(' · ')[0],list=groups.get(name)??[];list.push(road);groups.set(name,list);}
  const zones:ConstructionZone[]=[];
  for(const pieces of groups.values()){
    const visited=new Set<Road>();
    for(const head of pieces.filter(road=>!pieces.some(other=>other!==road&&same(other.points[other.points.length-1],road.points[0])))){
      const chain:{road:Road;along:number[];start:number}[]=[];let total=0;
      for(let road:Road|undefined=head;road&&!visited.has(road);road=pieces.find(next=>!visited.has(next)&&same(next.points[0],road!.points[road!.points.length-1]))){
        visited.add(road);const along=stations(road.points);chain.push({road,along,start:total});total+=along[along.length-1];
      }
      const closed=chain.flatMap(piece=>[piece.road.closed==='start'?piece.start:undefined,piece.road.closed==='end'?piece.start+piece.along[piece.along.length-1]:undefined]).filter((s):s is number=>s!==undefined);
      for(let target=MOTORWAY_SPACING[0]*(.3+.7*random());target<total;target+=MOTORWAY_SPACING[0]+(MOTORWAY_SPACING[1]-MOTORWAY_SPACING[0])*random()){
        let placed=false;
        for(let s=target;s<total&&!placed;s+=50){
          const piece=chain.find(c=>s>=c.start+MOTORWAY_REACH+20&&s<=c.start+c.along[c.along.length-1]-MOTORWAY_REACH-20);
          if(!piece||closed.some(end=>Math.abs(end-s)<MOTORWAY_REACH+150))continue;
          const local=s-piece.start,{p,dir}=pointAtDistance(piece.road.points,local,piece.along);
          if(Math.hypot(p[0]-city.spawn.x,p[1]-city.spawn.z)<MOTORWAY_LENGTH/2+60)continue;
          const lanes=motorwayLanes(piece.road),laneOffset=lanes[lanes.length-1],openOffset=lanes[lanes.length-2];
          let pavedWidth=Infinity;for(let a=-MOTORWAY_LENGTH/2;a<=MOTORWAY_LENGTH/2;a+=15){const q=pointAtDistance(piece.road.points,local+a,piece.along).p;pavedWidth=Math.min(pavedWidth,roadWidthAt(piece.road,q[0],q[1]));}
          zones.push({id:`construction-${piece.road.id}`,roadId:piece.road.id,road:piece.road,x:p[0],z:p[1],yaw:Math.atan2(dir[0],dir[1]),direction:1,laneOffset,openOffset,length:MOTORWAY_LENGTH,workLength:MOTORWAY_WORK_LENGTH,taperLength:MOTORWAY_TAPER_LENGTH,pavedWidth,seed:state,vehicleKind:random()<.5?'dump-truck':'excavator',frame:{points:piece.road.points,along:piece.along,station:local}});
          target=s;placed=true;
        }
        if(!placed)break;
      }
    }
  }
  return zones;
}

/** A position in a site's travel frame: metres along from its middle, the
 * offset in traffic's lane convention and the heading of travel there. */
export function constructionLocal(zone:ConstructionZone,x:number,z:number){
  if(!zone.frame){const sin=Math.sin(zone.yaw),cos=Math.cos(zone.yaw),dx=x-zone.x,dz=z-zone.z;return{along:dx*sin+dz*cos,offset:-dx*cos+dz*sin,yaw:zone.yaw};}
  const {points,along,station}=zone.frame,reach=zone.length/2+CONSTRUCTION_APPROACH+60;
  let best={gap:Infinity,s:station,tx:Math.sin(zone.yaw),tz:Math.cos(zone.yaw),cx:zone.x,cz:zone.z};
  for(let i=1;i<points.length;i++){
    if(along[i]<station-reach||along[i-1]>station+reach)continue;
    const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<1e-6)continue;
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(length*length))),cx=a[0]+dx*t,cz=a[1]+dz*t,gap=Math.hypot(x-cx,z-cz);
    if(gap<best.gap)best={gap,s:along[i-1]+length*t,tx:dx/length*zone.direction,tz:dz/length*zone.direction,cx,cz};
  }
  return{along:(best.s-station)*zone.direction,offset:-(x-best.cx)*best.tz+(z-best.cz)*best.tx,yaw:Math.atan2(best.tx,best.tz)};
}

/** A point in a site's travel frame; `offset` follows traffic's lane convention. */
export function constructionPoint(zone:ConstructionZone,along:number,offset=zone.laneOffset):Point2{
  if(zone.frame){
    const {p,dir}=pointAtDistance(zone.frame.points,zone.frame.station+along*zone.direction,zone.frame.along),tx=dir[0]*zone.direction,tz=dir[1]*zone.direction;
    return[p[0]-tz*offset,p[1]+tx*offset];
  }
  return[zone.x+Math.sin(zone.yaw)*along-Math.cos(zone.yaw)*offset,zone.z+Math.cos(zone.yaw)*along+Math.sin(zone.yaw)*offset];
}

/** Offset a source road lane and merge it smoothly into the remaining lane.
 * Only matching travel directions are changed. Keep the original vertices for
 * unaffected roads, and sample affected roads every 3 m so long source segments
 * cannot skip an entire closure. Both same-direction lane routes share the
 * open lane, allowing the normal traffic-conflict system to meter the merge. */
export function constructionLanePoints(road:Road,points:Point2[],nominalOffset:number,zones:ReadonlyArray<ConstructionZone>):Point2[]{
  const relevant=zones.filter(zone=>zone.roadId===road.id&&nominalOffset>zone.openOffset+.001);
  const matching=relevant.filter(zone=>points.some((p,i)=>{
    const q=points[i+1];if(!q)return false;const dx=q[0]-p[0],dz=q[1]-p[1];return(dx*Math.sin(zone.yaw)+dz*Math.cos(zone.yaw))/(Math.hypot(dx,dz)||1)>.9;
  }));
  const samples:Point2[]=[];
  if(matching.length){
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],count=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/3));
      if(i===1)samples.push(a);for(let j=1;j<=count;j++)samples.push([a[0]+(b[0]-a[0])*j/count,a[1]+(b[1]-a[1])*j/count]);
    }
  }else samples.push(...points);
  return samples.map((p,i)=>{
    const a=samples[Math.max(0,i-1)],b=samples[Math.min(samples.length-1,i+1)],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz)||1;
    let offset=nominalOffset;
    for(const zone of matching){
      let along:number;
      if(zone.frame){
        // A highway site's frame follows the curve of its record.
        if(Math.hypot(p[0]-zone.x,p[1]-zone.z)>zone.length/2+CONSTRUCTION_APPROACH+30)continue;
        const local=constructionLocal(zone,p[0],p[1]);
        if(Math.abs(local.offset)>1||(dx*Math.sin(local.yaw)+dz*Math.cos(local.yaw))/length<.9)continue;
        along=local.along;
      }else{
        const fx=Math.sin(zone.yaw),fz=Math.cos(zone.yaw);if((dx*fx+dz*fz)/length<.9)continue;
        const across=-(p[0]-zone.x)*fz+(p[1]-zone.z)*fx;along=(p[0]-zone.x)*fx+(p[1]-zone.z)*fz;
        if(Math.abs(across)>1)continue;
      }
      const full=zone.workLength/2+8,reach=zone.length/2+CONSTRUCTION_APPROACH,t=Math.max(0,Math.min(1,(reach-Math.abs(along))/(reach-full))),blend=t*t*(3-2*t);
      offset=Math.min(offset,nominalOffset+(zone.openOffset-nominalOffset)*blend);
    }
    return[p[0]-dz/length*offset,p[1]+dx/length*offset];
  });
}
