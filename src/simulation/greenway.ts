import data from '../data/greenway-detail.json' with {type:'json'};
import type {Point2, CityArea} from '../types';
import {pointInside} from './roads.ts';

export interface GreenwayBounds {minX:number;maxX:number;minZ:number;maxZ:number;}
export interface GreenwayArea {id:string;kind:string;rings:Point2[][];name?:string;}
export interface GreenwayObject {id:string;kind:string;point:Point2;yaw?:number;radius?:number;rings?:Point2[][];name?:string;points?:Point2[];pergola?:Point2[];}
export const greenway=data as unknown as {
  parcels:GreenwayArea[];bases:GreenwayArea[];surfaces:GreenwayArea[];objects:GreenwayObject[];
  frontages:(GreenwayArea&{tile:string})[];
  curbExclusions:Point2[][][];replacedParkPrefixes:string[];
};
export const greenwayBounds=(rings:Point2[][]):GreenwayBounds=>({minX:Math.min(...rings[0].map(p=>p[0])),maxX:Math.max(...rings[0].map(p=>p[0])),minZ:Math.min(...rings[0].map(p=>p[1])),maxZ:Math.max(...rings[0].map(p=>p[1]))});
export const intersectsGreenwayBounds=(a:GreenwayBounds,b:GreenwayBounds)=>a.minX<=b.maxX&&a.maxX>=b.minX&&a.minZ<=b.maxZ&&a.maxZ>=b.minZ;
export const insideGreenwayRings=(p:Point2,rings:Point2[][])=>pointInside(p,rings[0])&&!rings.slice(1).some(r=>pointInside(p,r));
export const replacesGreenwayPark=(park:Pick<CityArea,'id'>)=>greenway.replacedParkPrefixes.some(p=>park.id.startsWith(p));
const entries=greenway.parcels.map(p=>({...p,bounds:greenwayBounds(p.rings)}));
function indexedInside(polygons:Point2[][][]){
  const cells=new Map<string,Point2[][][]>(),key=(x:number,z:number)=>`${Math.floor(x/64)},${Math.floor(z/64)}`;
  for(const rings of polygons){const b=greenwayBounds(rings);for(let x=Math.floor(b.minX/64);x<=Math.floor(b.maxX/64);x++)for(let z=Math.floor(b.minZ/64);z<=Math.floor(b.maxZ/64);z++){const k=`${x},${z}`,list=cells.get(k)??[];list.push(rings);cells.set(k,list);}}
  return(x:number,z:number)=>(cells.get(key(x,z))??[]).some(r=>insideGreenwayRings([x,z],r));
}
export const inGreenway=indexedInside(greenway.parcels.map(p=>p.rings));
export const inGreenwayWalk=indexedInside(greenway.surfaces.filter(s=>s.kind==='path'||s.kind==='boardwalk').map(s=>s.rings));
/** Decorative survey curb fragments only; protected surface street edges are
 * cut out of these polygons by build-greenway.py. Tunnel walls are separate. */
export const obsoleteGreenwayCurb=indexedInside(greenway.curbExclusions);

/** Keep the exterior portions of legacy paths, including a path that enters
 * and leaves a parcel in one segment. Replacing whole OSM ways would erase
 * unrelated sidewalks beyond the park. */
export function outsideGreenwayPath(points:Point2[]):Point2[][]{
  if(points.length<2)return [];
  const bounds=greenwayBounds([points]),near=entries.filter(p=>intersectsGreenwayBounds(bounds,p.bounds));
  if(!near.length)return [points];
  const result:Point2[][]=[];let current:Point2[]=[];
  const finish=()=>{if(current.length>1)result.push(current);current=[];};
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],cuts=[0,1];
    for(const p of near)for(const ring of p.rings)for(let j=0;j<ring.length;j++){
      const c=ring[j],d=ring[(j+1)%ring.length],ex=d[0]-c[0],ez=d[1]-c[1],det=dx*ez-dz*ex;if(Math.abs(det)<1e-9)continue;
      const qx=c[0]-a[0],qz=c[1]-a[1],t=(qx*ez-qz*ex)/det,u=(qx*dz-qz*dx)/det;
      if(t>0&&t<1&&u>=0&&u<=1)cuts.push(t);
    }
    cuts.sort((a,b)=>a-b);
    const at=(t:number):Point2=>[a[0]+dx*t,a[1]+dz*t];
    for(let j=1;j<cuts.length;j++){
      const lo=cuts[j-1],hi=cuts[j];if(hi-lo<1e-8)continue;
      if(near.some(p=>insideGreenwayRings(at((lo+hi)/2),p.rings))){finish();continue;}
      if(!current.length)current.push(at(lo));current.push(at(hi));
    }
  }
  finish();return result;
}
