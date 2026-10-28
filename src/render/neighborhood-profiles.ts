import type { Building, CityData, Point2 } from '../types';
import { closestRoad, pointInside } from '../simulation/roads.ts';
import { isMetroCity, type MetroCity } from '../simulation/city-tiles.ts';
import { streetCharacter } from './street-character.ts';
import { isReligiousBuilding } from '../simulation/building-identities.ts';

export interface TripleDeckerProfile {
  kind:'triple-decker'; palette:number; floorHeight:number; raisedBase:number;
  front:{a:Point2;b:Point2;nx:number;nz:number;setback:number;road:string};
}
const profiles=new WeakMap<Building,TripleDeckerProfile>();
const prepared=new WeakMap<CityData,{tripleDeckers:number;ids:string[]}>();
const considered=new WeakSet<Building>();
/** Dense wood-frame districts where detached three-story houses are the norm. */
const DISTRICTS=/^(Mission Hill|Jamaica Plain|Roxbury|Dorchester|Mattapan|South Boston|Charlestown|East Boston|Allston|Brighton|Somerville|Cambridge|Brookline)$/;
const HILL_STREETS=/Parker Hill|Calumet|Hillside|Iroquois|Oswald|Sachem|Pontiac|Harleston|Alleghany|Carmel|Burney|Wensley|Fisher|Delle|Wait|Pequot|Cherokee|Wigglesworth|Worthington|Parker Street/i;
const distance=(p:Point2,a:Point2,b:Point2)=>{
  const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));
  return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);
};
const hash=(text:string)=>{let n=0;for(const c of text)n=Math.imul(n,31)+c.charCodeAt(0)|0;return Math.abs(n);};

/** Conservative typology inference, not an address-level architectural survey.
 * Mission Hill's small, detached, three-story source masses on residential
 * streets receive wood-clad details. Attached brick rows and large blocks stay
 * in their original material family. Nothing changes the surveyed footprint. */
export function prepareNeighborhoodArchitecture(city:CityData,buildings?:Building[]){
  const existing=buildings?undefined:prepared.get(city);if(existing)return existing;
  const metro=isMetroCity(city);
  const districts=(city.neighborhoods??[]).filter(n=>metro?DISTRICTS.test(n.name):n.name==='Mission Hill').map(n=>({ring:n.rings[0],minX:Math.min(...n.rings[0].map(p=>p[0])),maxX:Math.max(...n.rings[0].map(p=>p[0])),minZ:Math.min(...n.rings[0].map(p=>p[1])),maxZ:Math.max(...n.rings[0].map(p=>p[1]))}));
  const ids:string[]=[];
  if(!districts.length){const result={tripleDeckers:0,ids};if(!buildings)prepared.set(city,result);return result;}
  const inDistrict=(p:Point2)=>districts.some(d=>p[0]>=d.minX&&p[0]<=d.maxX&&p[1]>=d.minZ&&p[1]<=d.maxZ&&pointInside(p,d.ring));
  const houseStreet=(name:string,width:number)=>metro?(HILL_STREETS.test(name)||(width<=10.5&&streetCharacter(name,width)==='residential')):HILL_STREETS.test(name);
  const neighborsOf=(b:Building)=>metro?(city as MetroCity).index.near(b.center[0],b.center[1],34):city.buildings;
  for(const b of buildings??city.buildings){
    if(considered.has(b))continue;considered.add(b);
    if(b.landmark||isReligiousBuilding(b)||b.height<8.3||b.height>14.4||/school|hospital|college/i.test(b.name)||!inDistrict(b.center))continue;
    const p=b.footprint,area=Math.abs(p.reduce((s,a,i)=>{const c=p[(i+1)%p.length];return s+a[0]*c[1]-c[0]*a[1];},0))/2;
    if(area<65||area>245)continue;
    let best:TripleDeckerProfile['front']|undefined,score=-Infinity;
    for(let i=0;i<p.length;i++){
      const a=p[i],c=p[(i+1)%p.length],dx=c[0]-a[0],dz=c[1]-a[1],length=Math.hypot(dx,dz);if(length<5.5||length>15)continue;
      const x=(a[0]+c[0])/2,z=(a[1]+c[1])/2,nx=dz/length,nz=-dx/length,road=closestRoad(city,x,z,true);
      if(!houseStreet(road.road.name,road.road.width))continue;
      const facing=((road.x-x)*nx+(road.z-z)*nz)/Math.max(.01,road.distance),setback=road.distance-road.road.width/2;
      if(facing<.78||setback<1.4||setback>20)continue;
      const value=facing*10-Math.abs(length-9)*.15-setback*.05;
      if(value>score){score=value;best={a,b:c,nx,nz,setback,road:road.road.name};}
    }
    if(!best)continue;
    // Reject adjoining row-house masses. Separate roof parts of the same house
    // are ignored; the city data already preserves their supported elevation.
    const attached=neighborsOf(b).some(other=>{
      if(other===b||(other as Building).id===b.id||other.height<6||Math.hypot(other.center[0]-b.center[0],other.center[1]-b.center[1])>34)return false;
      if(pointInside(other.center,p)||pointInside(b.center,other.footprint))return false;
      let close=0;for(const vertex of p)if(other.footprint.some((a,i)=>distance(vertex,a,other.footprint[(i+1)%other.footprint.length])<.55))close++;
      return close>=2;
    });
    if(attached)continue;
    const raisedBase=.65,floorHeight=Math.max(2.65,Math.min(3.35,(b.height-1.25-raisedBase)/3));
    profiles.set(b,{kind:'triple-decker',palette:hash(b.id)%5,floorHeight,raisedBase,front:best});ids.push(b.id);
  }
  const result={tripleDeckers:ids.length,ids};if(!buildings)prepared.set(city,result);return result;
}
export const architectureFor=(building?:Building)=>building?profiles.get(building):undefined;

