import type { Building, CityData, Point2, Road } from '../types';
import { closestRoad, pointInside } from '../simulation/roads.ts';
import { isMetroCity, type MetroCity } from '../simulation/city-tiles.ts';
import { streetCharacter } from './street-character.ts';
import { isReligiousBuilding } from '../simulation/building-identities.ts';

export interface TripleDeckerProfile {
  kind:'triple-decker'; palette:number; floorHeight:number; raisedBase:number;
  front:{a:Point2;b:Point2;nx:number;nz:number;setback:number;road:string};
}
/** A detached-scale house that gets the clapboard family without porch details: its street or shape gave no verified front. */
export interface WoodFrameProfile { kind:'wood-frame'; palette:number; floorHeight:number; raisedBase:number; }
export type ArchitectureProfile=TripleDeckerProfile|WoodFrameProfile;
const profiles=new WeakMap<Building,ArchitectureProfile>();
const prepared=new WeakMap<CityData,{tripleDeckers:number;woodFrames:number;ids:string[]}>();
const considered=new WeakSet<Building>();
/** Dense wood-frame districts where detached three-story houses are the norm. */
const DISTRICTS=/^(Mission Hill|Jamaica Plain|Roxbury|Dorchester|Mattapan|South Boston|Charlestown|East Boston|Allston|Brighton|Somerville|Cambridge|Brookline|Chelsea)$/;
const HILL_STREETS=/Parker Hill|Calumet|Hillside|Iroquois|Oswald|Sachem|Pontiac|Harleston|Alleghany|Carmel|Burney|Wensley|Fisher|Delle|Wait|Pequot|Cherokee|Wigglesworth|Worthington|Parker Street/i;
/** OpenStreetMap building tags that are never a wood-frame house, whatever their size. */
const NOT_HOUSE=/^(retail|commercial|industrial|office|garages?|church|school|university|college|hospital|warehouse|public|civic|dormitory|hotel|shed|roof|carport|parking|service|train_station|transportation|kindergarten|religious|government|supermarket)$/;
const distance=(p:Point2,a:Point2,b:Point2)=>{
  const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));
  return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);
};
const hash=(text:string)=>{let n=0;for(const c of text)n=Math.imul(n,31)+c.charCodeAt(0)|0;return Math.abs(n);};

/** Conservative typology inference, not an address-level architectural survey.
 * Small, detached, three-story source masses in the wood-frame districts receive
 * wood-clad details: porches and bays where a residential street front is
 * verified, the clapboard family alone otherwise. Attached brick rows and large
 * blocks stay in their original material family. Nothing changes the surveyed
 * footprint. OpenStreetMap carries a material for almost none of the town
 * buildings, so size, district and the building tag stand in for it. */
export function prepareNeighborhoodArchitecture(city:CityData,buildings?:Building[]){
  const existing=buildings?undefined:prepared.get(city);if(existing)return existing;
  const metro=isMetroCity(city);
  const districts=(city.neighborhoods??[]).filter(n=>metro?DISTRICTS.test(n.name):n.name==='Mission Hill').flatMap(n=>n.rings.map(ring=>({ring,minX:Math.min(...ring.map(p=>p[0])),maxX:Math.max(...ring.map(p=>p[0])),minZ:Math.min(...ring.map(p=>p[1])),maxZ:Math.max(...ring.map(p=>p[1]))})));
  const ids:string[]=[],woodIds:string[]=[];
  if(!districts.length){const result={tripleDeckers:0,woodFrames:0,ids};if(!buildings)prepared.set(city,result);return result;}
  // A neighborhood may be several polygons (Charlestown's main body is its second ring), so every ring counts.
  const inDistrict=(p:Point2)=>districts.some(d=>p[0]>=d.minX&&p[0]<=d.maxX&&p[1]>=d.minZ&&p[1]<=d.maxZ&&pointInside(p,d.ring));
  // Town streets have no surveyed width to tell a lane from a boulevard; their
  // OpenStreetMap class and the town corridor list decide instead.
  const houseStreet=(road:Road)=>metro?(HILL_STREETS.test(road.name)||(road.kind?streetCharacter(road.name,road.width,road.kind)==='residential':road.width<=10.5&&streetCharacter(road.name,road.width)==='residential')):HILL_STREETS.test(road.name);
  const neighborsOf=(b:Building)=>metro?(city as MetroCity).index.near(b.center[0],b.center[1],34):city.buildings;
  for(const b of buildings??city.buildings){
    if(considered.has(b))continue;considered.add(b);
    if(b.landmark||isReligiousBuilding(b)||b.height<8.3||b.height>14.4||/school|hospital|college/i.test(b.name)||NOT_HOUSE.test(b.kind??'')||!inDistrict(b.center))continue;
    const p=b.footprint,area=Math.abs(p.reduce((s,a,i)=>{const c=p[(i+1)%p.length];return s+a[0]*c[1]-c[0]*a[1];},0))/2;
    if(area<65||area>245)continue;
    // Reject adjoining row-house masses. Separate roof parts of the same house
    // are ignored; the city data already preserves their supported elevation.
    const attached=neighborsOf(b).some(other=>{
      if(other===b||(other as Building).id===b.id||other.height<6||Math.hypot(other.center[0]-b.center[0],other.center[1]-b.center[1])>34)return false;
      if(pointInside(other.center,p)||pointInside(b.center,other.footprint))return false;
      let close=0;for(const vertex of p)if(other.footprint.some((a,i)=>distance(vertex,a,other.footprint[(i+1)%other.footprint.length])<.55))close++;
      return close>=2;
    });
    if(attached)continue;
    let best:TripleDeckerProfile['front']|undefined,score=-Infinity;
    for(let i=0;i<p.length;i++){
      const a=p[i],c=p[(i+1)%p.length],dx=c[0]-a[0],dz=c[1]-a[1],length=Math.hypot(dx,dz);if(length<5.5||length>15)continue;
      const x=(a[0]+c[0])/2,z=(a[1]+c[1])/2,nx=dz/length,nz=-dx/length,road=closestRoad(city,x,z,true);
      if(!houseStreet(road.road))continue;
      const facing=((road.x-x)*nx+(road.z-z)*nz)/Math.max(.01,road.distance),setback=road.distance-road.road.width/2;
      if(facing<.78||setback<1.4||setback>20)continue;
      const value=facing*10-Math.abs(length-9)*.15-setback*.05;
      if(value>score){score=value;best={a,b:c,nx,nz,setback,road:road.road.name};}
    }
    // Generated roof peaks are not occupied storeys. Fit the house's window
    // spacing below its known eaves; a two-storey wall cannot get three porches.
    const raisedBase=.65,wallHeight=b.eaveHeight??b.height;
    const floors=b.eaveHeight!==undefined&&wallHeight<8.3?2:3;
    const floorHeight=b.eaveHeight!==undefined?(wallHeight-raisedBase)/floors:Math.max(2.65,Math.min(3.35,(b.height-1.25-raisedBase)/3)),palette=hash(b.id)%5;
    if(best&&floors===3){profiles.set(b,{kind:'triple-decker',palette,floorHeight,raisedBase,front:best});ids.push(b.id);}
    else if(metro){profiles.set(b,{kind:'wood-frame',palette,floorHeight,raisedBase});woodIds.push(b.id);}
  }
  const result={tripleDeckers:ids.length,woodFrames:woodIds.length,ids};if(!buildings)prepared.set(city,result);return result;
}
export const architectureFor=(building?:Building)=>building?profiles.get(building):undefined;
