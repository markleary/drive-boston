import data from '../data/waterfront.json' with {type:'json'};
import type { CityArea, CityData, Point2 } from '../types.ts';
import { pointInside } from './roads.ts';
import { sampleElevation } from './terrain.ts';

export type WaterfrontKind = 'park' | 'promenade' | 'working' | 'parking' | 'naval';
export interface WaterfrontSite {
  id:string; name:string; kind:WaterfrontKind; rings:Point2[][]; quays:Point2[][];
  lawns?:Point2[][][];
  paving?:Point2[][][];
}
export interface WaterfrontBounds {minX:number;maxX:number;minZ:number;maxZ:number;}
export const waterfrontSites = (data.sites as WaterfrontSite[]).map(site=>({...site,
  bounds:{minX:Math.min(...site.rings[0].map(p=>p[0])),maxX:Math.max(...site.rings[0].map(p=>p[0])),minZ:Math.min(...site.rings[0].map(p=>p[1])),maxZ:Math.max(...site.rings[0].map(p=>p[1]))},
}));
export const insideWaterfrontPolygon=(p:Point2,rings:Point2[][])=>pointInside(p,rings[0])&&!rings.slice(1).some(r=>pointInside(p,r));
export const waterfrontOverlaps=(a:WaterfrontBounds,b:WaterfrontBounds)=>a.maxX>=b.minX&&a.minX<=b.maxX&&a.maxZ>=b.minZ&&a.minZ<=b.maxZ;
export interface QuayEdge {a:Point2;b:Point2;nx:number;nz:number;site:WaterfrontSite;}
export const quayEdges:QuayEdge[]=[];
const cells=new Map<string,QuayEdge[]>(),cell=24;
for(const site of waterfrontSites)for(const line of site.quays)for(let i=1;i<line.length;i++){
  const a=line[i-1],b=line[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.05)continue;
  let nx=-dz/length,nz=dx/length;
  if(!insideWaterfrontPolygon([(a[0]+b[0])/2+nx*.3,(a[1]+b[1])/2+nz*.3],site.rings)){nx=-nx;nz=-nz;}
  const edge={a,b,nx,nz,site};quayEdges.push(edge);
  for(let x=Math.floor((Math.min(a[0],b[0])-10)/cell);x<=Math.floor((Math.max(a[0],b[0])+10)/cell);x++)for(let z=Math.floor((Math.min(a[1],b[1])-10)/cell);z<=Math.floor((Math.max(a[1],b[1])+10)/cell);z++){
    const key=`${x},${z}`,list=cells.get(key)??[];list.push(edge);cells.set(key,list);
  }
}
/** Exact hydro-boundary edges only. Site clipping edges never become seawalls. */
export function nearestQuay(x:number,z:number){
  let distance=Infinity,edge:QuayEdge|undefined,point:Point2=[x,z];
  for(const e of cells.get(`${Math.floor(x/cell)},${Math.floor(z/cell)}`)??[]){
    const dx=e.b[0]-e.a[0],dz=e.b[1]-e.a[1],t=Math.max(0,Math.min(1,((x-e.a[0])*dx+(z-e.a[1])*dz)/(dx*dx+dz*dz)));
    const p:Point2=[e.a[0]+t*dx,e.a[1]+t*dz],d=Math.hypot(x-p[0],z-p[1]);if(d<distance){distance=d;edge=e;point=p;}
  }
  return {distance,edge,point};
}
export const hardQuayAt=(x:number,z:number,reach=.12)=>nearestQuay(x,z).distance<reach;
export function waterfrontAt(x:number,z:number){
  return waterfrontSites.find(s=>x>=s.bounds.minX&&x<=s.bounds.maxX&&z>=s.bounds.minZ&&z<=s.bounds.maxZ&&insideWaterfrontPolygon([x,z],s.rings));
}
/** Keep the DEM inland and bridge only its last few metres of shoreline rolloff.
 * The same height is used for the deck, its retaining wall and collision. */
export function waterfrontHeight(city:CityData,x:number,z:number){
  const ground=sampleElevation(city,x,z),q=nearestQuay(x,z);
  if(!q.edge||q.distance>=4)return ground+.031;
  const land=sampleElevation(city,q.point[0]+q.edge.nx*4,q.point[1]+q.edge.nz*4);
  const t=1-q.distance/4;
  return Math.max(ground,ground+(land-ground)*t*t)+.031;
}
export function waterfrontReserved(x:number,z:number){
  const site=waterfrontAt(x,z);if(!site)return false;
  return !(site.lawns??[]).some(rings=>insideWaterfrontPolygon([x,z],rings));
}
export const isPavedWaterfrontPark=(area:CityArea)=>/harborwalk|pier walk|^Long Wharf$|^Fan Pier Plaza$/i.test(area.name);
