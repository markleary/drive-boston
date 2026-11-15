import type {CityData,Point2,Road} from '../types';
import {isCarsOnlyRoad,STORROW_SOURCE_CARRIAGEWAYS} from './cars-only-roads.ts';
import {FOOTBRIDGE_SLAB,roadWidthAt,sampleRoadElevation} from './road-surfaces.ts';
import {tunnelCoveredAt,tunnelStations} from './tunnels.ts';

/** Geometry-derived game clearances. Except for the photograph's Longfellow
 * 10 ft 6 in board and its OSM-tagged 12 ft westbound counterpart, these describe the modeled soffits, not surveyed heights. */
export interface LowClearanceCrossing {
  id:string;roadId:string;bridgeId:string;name:string;x:number;z:number;yaw:number;
  width:number;halfDepth:number;roadY:number;underside:number;clearance:number;
  station:number;posted:string;kind:'road'|'footbridge'|'longfellow';
}
export const TWELVE_FEET=12*.3048,LONGFELLOW_CLEARANCE=10.5*.3048;
/** Shared footprint for the Boston portal and the river ribs that bear on it.
 * The westbound river side includes the full Dudley White path opening. */
export function longfellowPortalLayout(site:LowClearanceCrossing){
  const half=site.width/2+5.6;
  return{left:site.roadId==='13519-0-0'?half+4.2:half,right:half,pierOffset:1.1,pierWidth:2.25};
}
const cache=new WeakMap<CityData,LowClearanceCrossing[]>();
export function clearanceLegend(meters:number){
  // Round down: never promise more clearance than the collision mesh provides.
  const inches=Math.floor((meters+.00001)/.0254);
  return `${Math.floor(inches/12)}'-${inches%12}"`;
}
type Upper={road:Road;kind:'road'|'footbridge';a:Point2;b:Point2;};
function intersection(a:Point2,b:Point2,c:Point2,d:Point2){
  const dx=b[0]-a[0],dz=b[1]-a[1],ex=d[0]-c[0],ez=d[1]-c[1],det=dx*ez-dz*ex;
  if(Math.abs(det)<1e-8)return;
  const t=((c[0]-a[0])*ez-(c[1]-a[1])*ex)/det,u=((c[0]-a[0])*dz-(c[1]-a[1])*dx)/det;
  if(t<-.00001||t>1.00001||u<-.00001||u>1.00001)return;
  return {x:a[0]+dx*t,z:a[1]+dz*t,t,angle:Math.abs(det)/(Math.hypot(dx,dz)*Math.hypot(ex,ez))};
}
const longfellowBostonUpper=new Set(['13130-0-0','13131-0-0','8580-0-0','9280-0-0']);
/** All modeled low overhead road/footbridge crossings on the three cars-only
 * parkways, including Charlesbank/Embankment records used by the source data.
 * Shared by warning signs and player truck contact/recovery logic. */
export function lowClearanceCrossings(city:CityData):LowClearanceCrossing[]{
  const previous=cache.get(city);if(previous)return previous;
  const cells=new Map<string,Upper[]>(),size=96;
  const decks:Road[]=[...city.roads,...(city.footbridges??[]).map(b=>({...b,name:b.id,oneway:0,bridge:{id:b.id,thickness:FOOTBRIDGE_SLAB,clearanceEstimated:true}}))];
  for(const road of decks){
    if(!road.elevations||road.tunnel)continue;
    const kind=city.roads.includes(road)?'road':'footbridge';
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],s:Upper={road,kind,a,b};
      for(let x=Math.floor(Math.min(a[0],b[0])/size);x<=Math.floor(Math.max(a[0],b[0])/size);x++)for(let z=Math.floor(Math.min(a[1],b[1])/size);z<=Math.floor(Math.max(a[1],b[1])/size);z++){
        const key=`${x},${z}`,items=cells.get(key)??[];items.push(s);cells.set(key,items);
      }
    }
  }
  const sites:LowClearanceCrossing[]=[];
  for(const road of city.roads){
    if(!isCarsOnlyRoad(road))continue;const stations=tunnelStations(road);
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],candidates=new Set<Upper>();
      for(let x=Math.floor(Math.min(a[0],b[0])/size);x<=Math.floor(Math.max(a[0],b[0])/size);x++)for(let z=Math.floor(Math.min(a[1],b[1])/size);z<=Math.floor(Math.max(a[1],b[1])/size);z++)for(const s of cells.get(`${x},${z}`)??[])candidates.add(s);
      for(const s of candidates){
        if(s.road===road)continue;const hit=intersection(a,b,s.a,s.b);if(!hit||hit.angle<.15)continue;
        const station=stations[i-1]+(stations[i]-stations[i-1])*hit.t;if(tunnelCoveredAt(road,station))continue;
        const boston=!!STORROW_SOURCE_CARRIAGEWAYS[road.id]&&longfellowBostonUpper.has(s.road.id),roadY=sampleRoadElevation(city,road,hit.x,hit.z);
        const underside=boston?roadY+(STORROW_SOURCE_CARRIAGEWAYS[road.id]==='west'?TWELVE_FEET:LONGFELLOW_CLEARANCE):sampleRoadElevation(city,s.road,hit.x,hit.z)-(s.road.bridge?.thickness??.75),clearance=underside-roadY;
        if(clearance<.75||(clearance>=TWELVE_FEET&&!boston))continue;
        const name=boston?'Longfellow Bridge Boston underpass':s.road.name,kind=boston?'longfellow':s.kind;
        const width=roadWidthAt(road,hit.x,hit.z),halfDepth=roadWidthAt(s.road,hit.x,hit.z)/2/hit.angle;
        // Adjacent upper carriageways and lower source seams are one structure.
        const existing=sites.find(c=>c.name===name&&Math.hypot(c.x-hit.x,c.z-hit.z)<c.halfDepth+halfDepth+12&&Math.abs(Math.sin(c.yaw-Math.atan2(b[0]-a[0],b[1]-a[1])))<.2&&Math.abs((hit.x-c.x)*Math.cos(c.yaw)-(hit.z-c.z)*Math.sin(c.yaw))<1.5);
        if(existing){
          const along=(hit.x-existing.x)*Math.sin(existing.yaw)+(hit.z-existing.z)*Math.cos(existing.yaw),lo=Math.min(-existing.halfDepth,along-halfDepth),hi=Math.max(existing.halfDepth,along+halfDepth),shift=(lo+hi)/2;
          existing.x+=Math.sin(existing.yaw)*shift;existing.z+=Math.cos(existing.yaw)*shift;existing.station+=shift;existing.halfDepth=(hi-lo)/2;
          if(clearance<existing.clearance){existing.clearance=clearance;existing.underside=underside;existing.posted=clearanceLegend(clearance);}
          continue;
        }
        sites.push({id:`clearance:${road.id}:${s.road.id}`,roadId:road.id,bridgeId:s.road.id,name,x:hit.x,z:hit.z,yaw:Math.atan2(b[0]-a[0],b[1]-a[1]),width,halfDepth,roadY,underside,clearance,station,posted:clearanceLegend(clearance),kind});
      }
    }
  }
  for(const site of sites)if(site.kind==='longfellow'){const road=city.roads.find(r=>r.id===site.roadId)!;site.roadY=sampleRoadElevation(city,road,site.x,site.z);site.underside=site.roadY+site.clearance;}
  cache.set(city,sites);return sites;
}
/** Conservative rectangle enclosing the overhead span, in the lower road's
 * frame. A height/contact check must accompany this horizontal lookup. */
export function lowClearanceAt(city:CityData,x:number,z:number,margin=0){
  let result:LowClearanceCrossing|undefined,best=Infinity;
  for(const site of lowClearanceCrossings(city)){
    const dx=x-site.x,dz=z-site.z,along=dx*Math.sin(site.yaw)+dz*Math.cos(site.yaw),across=dx*Math.cos(site.yaw)-dz*Math.sin(site.yaw);
    if(Math.abs(along)>site.halfDepth+margin||Math.abs(across)>site.width/2+margin)continue;
    const distance=Math.hypot(dx,dz);if(distance<best){best=distance;result=site;}
  }return result;
}
