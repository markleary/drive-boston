import type { CityData, Point2, Road } from '../types';
import { sampleElevation } from './terrain.ts';
/** Road vertices keyed on a half-meter grid. Centerlines are split where streets
 * meet, so a vertex shared by differently named roads marks an intersection. */
type Stop={road:Road;index:number};
const nodeIndexes=new WeakMap<CityData,Map<string,Stop[]>>();
const key=(p:Point2)=>`${Math.round(p[0]*2)},${Math.round(p[1]*2)}`;
const minor=(name:string)=>!name||/alley|unnamed|driveway|parking|private/i.test(name);
// Surface height at a vertex: a deck's own profile, otherwise the graded terrain. Roads whose surfaces
// differ by more than a meter there are grade-separated (the traffic graph joins junctions the same way).
const heightAt=(city:CityData,road:Road,i:number)=>road.elevations?.[i]??sampleElevation(city,road.points[i][0],road.points[i][1]);
function nodeIndex(city:CityData){
  const cached=nodeIndexes.get(city);if(cached)return cached;
  const nodes=new Map<string,Stop[]>();
  for(const road of city.roads)road.points.forEach((p,index)=>{const k=key(p),list=nodes.get(k);if(list)list.push({road,index});else nodes.set(k,[{road,index}]);});
  nodeIndexes.set(city,nodes);return nodes;
}
export interface NextIntersection{names:string[];distance:number}
/** The first cross street ahead of (x,z) along `road`, travelling toward `heading`
 * (yaw, forward = [sin, cos]). Follows same-named continuations through vertices
 * where the street is split without a crossing; returns null at a dead end or
 * beyond `maxDistance` meters. */
export function nextIntersection(city:CityData,road:Road,x:number,z:number,heading:number,maxDistance=1200):NextIntersection|null{
  if(road.points.length<2)return null;
  const nodes=nodeIndex(city),fx=Math.sin(heading),fz=Math.cos(heading);
  let seg=1,best=Infinity;
  for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],len2=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/len2));
    const d=Math.hypot(a[0]+t*dx-x,a[1]+t*dz-z);if(d<best){best=d;seg=i;}
  }
  const a=road.points[seg-1],b=road.points[seg];
  let current=road,dir=(b[0]-a[0])*fx+(b[1]-a[1])*fz>=0?1:-1,i=dir>0?seg:seg-1,prev:Point2=[x,z],travelled=0;
  const visited=new Set<Road>([road]);
  for(;;){
    const p=current.points[i];travelled+=Math.hypot(p[0]-prev[0],p[1]-prev[1]);if(travelled>maxDistance)return null;
    const here=nodes.get(key(p))??[],height=heightAt(city,current,i),level=(s:Stop)=>Math.abs(heightAt(city,s.road,s.index)-height)<1;
    const cross=[...new Set(here.filter(s=>s.road.name!==road.name&&!minor(s.road.name)&&level(s)).map(s=>s.road.name))];
    if(cross.length)return {names:cross.slice(0,2),distance:travelled};
    const from=current.points[i-dir]??prev;prev=p;
    if(i!==(dir>0?current.points.length-1:0)){i+=dir;continue;}
    // End of this piece: carry on along the same street, preferring the straightest continuation.
    const ix=p[0]-from[0],iz=p[1]-from[1],il=Math.hypot(ix,iz)||1;
    let next:{road:Road;index:number;dir:number}|undefined,score=-.3;
    for(const s of here){
      if(visited.has(s.road)||s.road.name!==road.name||!level(s))continue;
      for(const d of [1,-1]){
        const q=s.road.points[s.index+d];if(!q)continue;
        const ox=q[0]-p[0],oz=q[1]-p[1],cos=(ox*ix+oz*iz)/((Math.hypot(ox,oz)||1)*il);
        if(cos>score){score=cos;next={road:s.road,index:s.index+d,dir:d};}
      }
    }
    if(!next)return null;
    current=next.road;i=next.index;dir=next.dir;visited.add(current);
  }
}
