import type {CityArea,CityData,Point2} from '../types';
import {pointInside} from './roads.ts';
import {sampleElevation} from './terrain.ts';

const waterLevels=new WeakMap<object,WeakMap<CityArea,number>>();
function distanceToSegment(p:Point2,a:Point2,b:Point2){
  const dx=b[0]-a[0],dz=b[1]-a[1],d=dx*dx+dz*dz,t=d?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/d)):0;
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);
}
const ringArea=(ring:Point2[])=>Math.abs(ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0))/2;

/** One horizontal plane for a complete mapped pond, independent of tile bounds.
 * Size the sample lattice by wet area: narrow winding channels occupy little of
 * their bounding box. Exclude a whole DEM cell around the bank so interpolation
 * with high land cannot choose a floating water level. The bounded fallback is
 * for ponds too narrow to contain a full cell; source basin levels take priority
 * at the caller. This remains a terrain estimate, not a surveyed water gauge. */
export function waterHeight(city:CityData,area:CityArea){
  // Streamed tiles share the same full grid even though each has a subCity view.
  const terrain=city.elevation??city;
  let cache=waterLevels.get(terrain);if(!cache){cache=new WeakMap();waterLevels.set(terrain,cache);}
  const cached=cache.get(area);if(cached!==undefined)return cached;
  const ring=area.rings[0];if(!ring?.length)return 0;
  const minX=Math.min(...ring.map(p=>p[0])),maxX=Math.max(...ring.map(p=>p[0])),minZ=Math.min(...ring.map(p=>p[1])),maxZ=Math.max(...ring.map(p=>p[1]));
  const holes=area.rings.slice(1),wetArea=Math.max(1,ringArea(ring)-holes.reduce((sum,r)=>sum+ringArea(r),0));
  const step=Math.max(6,Math.sqrt(wetArea/1800),Math.sqrt((maxX-minX)*(maxZ-minZ)/12000));
  const inset=Math.max(3,city.elevation?.cellSize??6),cell=Math.max(24,inset*2),edges=new Map<string,[Point2,Point2][]>();
  for(const r of area.rings)for(let i=0;i<r.length;i++){
    const a=r[i],b=r[(i+1)%r.length];
    for(let x=Math.floor((Math.min(a[0],b[0])-inset)/cell);x<=Math.floor((Math.max(a[0],b[0])+inset)/cell);x++)for(let z=Math.floor((Math.min(a[1],b[1])-inset)/cell);z<=Math.floor((Math.max(a[1],b[1])+inset)/cell);z++){
      const key=`${x},${z}`,list=edges.get(key)??[];list.push([a,b]);edges.set(key,list);
    }
  }
  const values:number[]=[],fallback:number[]=[];
  for(let x=minX+step/2;x<maxX;x+=step)for(let z=minZ+step/2;z<maxZ;z+=step){
    const p:Point2=[x,z];if(!pointInside(p,ring)||holes.some(r=>pointInside(p,r)))continue;
    const height=sampleElevation(city,x,z);fallback.push(height);
    if(!(edges.get(`${Math.floor(x/cell)},${Math.floor(z/cell)}`)??[]).some(([a,b])=>distanceToSegment(p,a,b)<inset))values.push(height);
  }
  if(!values.length)values.push(...fallback);
  if(!values.length)values.push(...ring.map(p=>sampleElevation(city,...p)));
  values.sort((a,b)=>a-b);const level=values[Math.floor((values.length-1)*.85)];cache.set(area,level);return level;
}
