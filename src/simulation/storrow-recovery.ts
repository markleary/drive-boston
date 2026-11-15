import type {CityData,Road} from '../types';
import type {LowClearanceCrossing} from './low-clearance.ts';
import {pointAtDistance,stations} from './motorway.ts';
import {roadProjection,roadWidthAt,sampleRoadElevation} from './road-surfaces.ts';

export interface StorrowRecoveryPose {x:number;z:number;yaw:number;roadId:string;}
type Leg={road:Road;along:number[];start:number;end:number;sign:number;distance:number;};
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));

/** Road-following repair positions beyond the struck structure. This only
 * plans pavement poses; the caller must reject occupied/blocked candidates.
 * Reverse travel preserves which end of the truck points forward. Source
 * seams may change IDs, point order and widths without changing the lane. */
export function storrowRecoveryCandidates(city:CityData,site:LowClearanceCrossing,pose:{x:number;z:number;yaw:number},direction:number,halfLength:number,halfWidth:number):StorrowRecoveryPose[]{
  const first=city.roads.find(road=>road.id===site.roadId);if(!first||first.points.length<2)return[];
  const along=stations(first.points),projection=roadProjection(first,site.x,site.z),start=along[projection.index]+(along[projection.index+1]-along[projection.index])*projection.t;
  const heading=pointAtDistance(first.points,start,along).dir,alignment=Math.sin(pose.yaw)*heading[0]+Math.cos(pose.yaw)*heading[1]>=0?1:-1,travel=direction<0?-1:1;
  const sign=alignment*travel,side=(pose.x-site.x)*Math.cos(site.yaw)-(pose.z-site.z)*Math.sin(site.yaw);
  // Lane offset follows the direction of travel even where the next source
  // record is digitized backwards. The truck yaw is reversed separately.
  // Leave room for the default chase camera beyond the portal as well.
  const travelSide=side*sign,minimum=site.halfDepth+halfLength+12,maximum=minimum+60;
  const legs:Leg[]=[],visited=new Set<string>();let road=first,roadAlong=along,s=start,forward=sign,walked=0;
  while(walked<maximum+halfLength+2&&legs.length<32){
    const key=`${road.id}:${forward}`;if(visited.has(key))break;visited.add(key);
    const end=forward>0?roadAlong[roadAlong.length-1]:0,span=Math.abs(end-s);
    legs.push({road,along:roadAlong,start:s,end,sign:forward,distance:walked});walked+=span;
    if(walked>=maximum+halfLength+2)break;
    const tip=pointAtDistance(road.points,end,roadAlong),dx=tip.dir[0]*forward,dz=tip.dir[1]*forward,y=sampleRoadElevation(city,road,...tip.p);
    let next:{road:Road;along:number[];s:number;sign:number;gap:number;score:number}|undefined;
    for(const candidate of city.roads){
      if(candidate===road||candidate.points.length<2)continue;
      const q=roadProjection(candidate,...tip.p);if(q.distance>8)continue;
      if(Math.abs(sampleRoadElevation(city,candidate,q.x,q.z)-y)>1.25)continue;
      const positions=stations(candidate.points),at=positions[q.index]+(positions[q.index+1]-positions[q.index])*q.t,tangent=pointAtDistance(candidate.points,at,positions).dir;
      for(const orientation of [1,-1]){
        const dot=(tangent[0]*dx+tangent[1]*dz)*orientation,remaining=orientation>0?positions[positions.length-1]-at:at;
        if(dot<.6||remaining<1||visited.has(`${candidate.id}:${orientation}`))continue;
        const score=q.distance*3+(1-dot)*20+(candidate.name===road.name?0:2);
        if(!next||score<next.score)next={road:candidate,along:positions,s:at,sign:orientation,gap:q.distance,score};
      }
    }
    if(!next)break;
    road=next.road;roadAlong=next.along;s=next.s;forward=next.sign;walked+=next.gap;
  }
  const candidates:StorrowRecoveryPose[]=[],sx=Math.sin(site.yaw)*sign,sz=Math.cos(site.yaw)*sign;
  for(let distance=minimum;distance<=maximum;distance+=4){
    const leg=legs.find(l=>distance>=l.distance&&distance<=l.distance+Math.abs(l.end-l.start));if(!leg)continue;
    const sample=pointAtDistance(leg.road.points,leg.start+leg.sign*(distance-leg.distance),leg.along),dx=sample.dir[0]*leg.sign,dz=sample.dir[1]*leg.sign;
    const width=roadWidthAt(leg.road,...sample.p),offset=clamp(travelSide,-Math.max(0,width/2-halfWidth-.3),Math.max(0,width/2-halfWidth-.3));
    const x=sample.p[0]+dz*offset,z=sample.p[1]-dx*offset,yaw=Math.atan2(dx*travel,dz*travel);
    // The complete truck must pass the far portal, even on a tight bend.
    const longitudinal=(x-site.x)*sx+(z-site.z)*sz,extent=Math.abs(dx*sx+dz*sz)*halfLength+Math.abs(dz*sx-dx*sz)*halfWidth;
    if(longitudinal-extent<site.halfDepth+.3)continue;
    // A tangent to a sharp bend can leave a long box outside the road. Check
    // all corners against this connected corridor rather than a nearby street.
    let paved=true;
    for(const nose of [-1,1])for(const side of [-1,1]){
      const cx=x+dx*nose*halfLength+dz*side*halfWidth,cz=z+dz*nose*halfLength-dx*side*halfWidth;
      if(!legs.some(l=>{
        const q=roadProjection(l.road,cx,cz);if(q.distance>roadWidthAt(l.road,q.x,q.z)/2-.1)return false;
        const a=l.road.points[q.index],b=l.road.points[q.index+1],dot=(cx-q.x)*(b[0]-a[0])+(cz-q.z)*(b[1]-a[1]);
        if(q.index===0&&q.t===0&&dot<-.01)return false;
        if(q.index===l.road.points.length-2&&q.t===1&&dot>.01)return false;
        return true;
      }))paved=false;
    }
    if(paved)candidates.push({x,z,yaw,roadId:leg.road.id});
  }
  return candidates;
}
