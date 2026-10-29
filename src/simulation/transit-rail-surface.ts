import type {CityData,Point2} from '../types';
import {sampleElevation} from './terrain.ts';
import {roadProjection,sampleRoadElevation} from './road-surfaces.ts';

export interface CoveredRail {start:number;end:number;}
interface RailPath {points:Point2[];distances:number[];length:number;line?:string;covered?:CoveredRail[];bridges?:CoveredRail[];}
export interface RailProfile {
  city:CityData;
  path:RailPath;
  step:number;
  heights:Float64Array;
  /** The source's covered crossings plus the narrow DEM transition at each end. */
  covered:CoveredRail[];
}

const STEP=2,COVERED_MARGIN=12;
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
function point(path:RailPath,distance:number):Point2{
  const d=clamp(distance,0,path.length);let lo=0,hi=path.points.length-1;
  while(lo+1<hi){const mid=(lo+hi)>>1;if(path.distances[mid]<d)lo=mid;else hi=mid;}
  const a=path.points[lo],b=path.points[hi],t=(d-path.distances[lo])/(path.distances[hi]-path.distances[lo]||1);
  return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
}

/** A rail pair is level across its gauge. Sampling both rails prevents the
 * uphill rail disappearing in the coarse terrain's crossfall. */
function ground(city:CityData,path:RailPath,distance:number){
  const p=point(path,distance),a=point(path,distance-1),b=point(path,distance+1);
  const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz)||1,nx=-dz/length*.7175,nz=dx/length*.7175;
  return Math.max(sampleElevation(city,...p),sampleElevation(city,p[0]+nx,p[1]+nz),sampleElevation(city,p[0]-nx,p[1]-nz));
}

export function railCovered(path:Pick<RailPath,'covered'>,distance:number,padding=0){
  return path.covered?.some(span=>distance>=span.start-padding&&distance<=span.end+padding)??false;
}

/** Keep station dwells visible when a coarse terrain/road mask reaches a
 * mapped platform. Only the simulated stopping point moves; source stops stay
 * unchanged. The nearest clear whole-car position must remain within 100 m. */
export function railStopDistance(profile:RailProfile,distance:number,clearance=13){
  if(!railCovered(profile,distance,clearance))return distance;
  const candidates=profile.covered.flatMap(span=>[span.start-clearance-.01,span.end+clearance+.01])
    .filter(d=>d>=clearance&&d<=profile.path.length-clearance&&Math.abs(d-distance)<=100&&!railCovered(profile,d,clearance));
  candidates.sort((a,b)=>Math.abs(a-distance)-Math.abs(b-distance)||b-a);
  return candidates[0]??distance;
}

/** D has no road level crossings. OSM does not tag every short rail-under-road
 * crossing as a tunnel, so intersect the actual mapped road centerlines too.
 * These are display/height assumptions, not additional source tunnel claims. */
function roadCrossings(city:CityData,path:RailPath):CoveredRail[]{
  if(path.line!=='Green-D')return[];
  const cells=new Map<string,number[]>(),size=128;
  for(let i=1;i<path.points.length;i++){
    const a=path.points[i-1],b=path.points[i];
    for(let x=Math.floor(Math.min(a[0],b[0])/size);x<=Math.floor(Math.max(a[0],b[0])/size);x++)for(let z=Math.floor(Math.min(a[1],b[1])/size);z<=Math.floor(Math.max(a[1],b[1])/size);z++){
      const key=`${x},${z}`,list=cells.get(key)??[];list.push(i);cells.set(key,list);
    }
  }
  const out:CoveredRail[]=[];
  for(const road of city.roads??[])for(let j=1;j<road.points.length;j++){
    const c=road.points[j-1],d=road.points[j],sx=d[0]-c[0],sz=d[1]-c[1],sl=Math.hypot(sx,sz),candidates=new Set<number>();
    if(sl<.01)continue;
    for(let x=Math.floor(Math.min(c[0],d[0])/size);x<=Math.floor(Math.max(c[0],d[0])/size);x++)for(let z=Math.floor(Math.min(c[1],d[1])/size);z<=Math.floor(Math.max(c[1],d[1])/size);z++)for(const i of cells.get(`${x},${z}`)??[])candidates.add(i);
    for(const i of candidates){
      const a=path.points[i-1],b=path.points[i],rx=b[0]-a[0],rz=b[1]-a[1],rl=Math.hypot(rx,rz),cross=rx*sz-rz*sx,sine=Math.abs(cross)/(rl*sl||1);
      if(sine<.25)continue;
      const dx=c[0]-a[0],dz=c[1]-a[1],t=(dx*sz-dz*sx)/cross,u=(dx*rz-dz*rx)/cross;
      if(t<0||t>1||u<0||u>1)continue;
      const distance=path.distances[i-1]+t*rl;
      if(path.bridges?.some(span=>distance>=span.start&&distance<=span.end))continue;
      const radius=road.width/(2*sine)+2;
      out.push({start:distance-radius,end:distance+radius});
    }
  }
  return out;
}

/** A small rail-only support profile: no city terrain is edited. Visible track
 * stays on or just above the ground, with at most 25 cm of smoothing fill.
 * Short covered crossings interpolate beneath the overlying road embankment;
 * these same intervals are hidden by the track and vehicle renderers. */
export function createRailProfile(city:CityData,path:RailPath):RailProfile{
  const covered:CoveredRail[]=[];
  const crossings=[...(path.covered??[]),...roadCrossings(city,path)];
  if(path.line==='Green-D'){
    if(Math.abs(ground(city,path,12)-ground(city,path,0))>1.8)crossings.push({start:0,end:12});
    if(Math.abs(ground(city,path,path.length)-ground(city,path,path.length-12))>1.8)crossings.push({start:path.length-12,end:path.length});
  }
  for(const span of crossings.sort((a,b)=>a.start-b.start)){
    let start=clamp(span.start-COVERED_MARGIN,0,path.length),end=clamp(span.end+COVERED_MARGIN,0,path.length);
    if(path.line==='Green-D'){
      // Road grading can extend its ridge beyond the mapped bridge itself.
      // Hide just that steep shoulder too, rather than draw track through it.
      const before=start,after=end;
      for(let d=Math.max(0,before-30);d<before;d+=2)if(Math.abs(ground(city,path,d+4)-ground(city,path,d))>.48)start=Math.min(start,Math.max(0,d-4));
      for(let d=after;d<Math.min(path.length,after+30);d+=2)if(Math.abs(ground(city,path,d+4)-ground(city,path,d))>.48)end=Math.max(end,Math.min(path.length,d+8));
    }
    if(end<=start)continue;
    const last=covered.at(-1);
    if(last&&start<=last.end)last.end=Math.max(last.end,end);else covered.push({start,end});
  }
  const count=Math.ceil(path.length/STEP)+1,raw=new Float64Array(count);
  for(let i=0;i<count;i++)raw[i]=ground(city,path,Math.min(path.length,i*STEP));
  const commonwealth=path.line==='Green-B'?(city.roads??[]).filter(r=>r.elevations&&r.name==='Commonwealth Avenue'):[];
  for(const span of path.bridges??[]){
    // Street deck ramps extend beyond OSM's bridge-tagged rail way. Include
    // their approaches so a trolley cannot step up at the bridge way's seam.
    const approach=commonwealth.length?50:0,start=clamp(span.start-approach,0,path.length),end=clamp(span.end+approach,0,path.length);if(end<=start)continue;
    const a=ground(city,path,start),b=ground(city,path,end);
    for(let i=Math.ceil(start/STEP);i<count&&i*STEP<=end;i++){
      const distance=i*STEP,p=point(path,distance),decks=commonwealth.filter(r=>{
        const hit=roadProjection(r,...p);
        return hit.distance<=r.width/2+12&&!((hit.index===0&&hit.t===0)||(hit.index===r.points.length-2&&hit.t===1));
      });
      if(decks.length){
        const deck=Math.max(...decks.map(r=>sampleRoadElevation(city,r,...p))),edge=Math.min((distance-start)/approach,(end-distance)/approach,1),blend=edge*edge*(3-2*edge);
        raw[i]=Math.max(raw[i],raw[i]+(deck-raw[i])*blend);
      }else if(distance>=span.start&&distance<=span.end)raw[i]=Math.max(raw[i],a+(b-a)*(distance-start)/(end-start));
    }
    if(commonwealth.length){
      // The separately surveyed carriageways have short, mismatched ramps.
      // A shared median rail support rounds those ramps across both tracks.
      const first=Math.max(0,Math.floor((span.start-100)/STEP)),last=Math.min(count-1,Math.ceil((span.end+100)/STEP));
      for(let i=first+1;i<=last;i++)raw[i]=Math.max(raw[i],raw[i-1]-.14*STEP);
      for(let i=last-1;i>=first;i--)raw[i]=Math.max(raw[i],raw[i+1]-.14*STEP);
    }
  }
  for(const span of covered){
    const a=ground(city,path,span.start),b=ground(city,path,span.end);
    for(let i=Math.ceil(span.start/STEP);i<count&&i*STEP<=span.end;i++)raw[i]=a+(b-a)*(i*STEP-span.start)/(span.end-span.start);
  }
  const heights=raw.slice();
  for(let i=2;i<count-2;i++){
    const distance=i*STEP;if(railCovered({covered},distance))continue;
    // A 10 m triangle filter rounds small hollows without lifting long sections
    // onto an artificial viaduct or changing an approach's surveyed elevation.
    let total=0,weight=0;
    for(let j=-2;j<=2;j++){const k=clamp(i+j,0,count-1),w=3-Math.abs(j);total+=raw[k]*w;weight+=w;}
    heights[i]=Math.max(raw[i],Math.min(raw[i]+.25,total/weight));
  }
  return{city,path,step:STEP,heights,covered};
}

function height(profile:RailProfile,distance:number){
  const {path,step,heights}=profile,d=clamp(distance,0,path.length),i=Math.min(heights.length-2,Math.floor(d/step));
  const end=Math.min(path.length,(i+1)*step),t=(d-i*step)/(end-i*step||1);
  const support=heights[i]+(heights[i+1]-heights[i])*t;
  // Grid triangle boundaries need not fall on profile sample positions.
  return railCovered(profile,d)?support:Math.max(support,ground(profile.city,path,d));
}

/** Longitudinal pitch follows the rail; DEM slopes beside an embankment never
 * bank the trolley sideways. Four-metre support spacing avoids per-cell jitter. */
export function railSurface(profile:RailProfile,distance:number){
  const d=clamp(distance,0,profile.path.length),lo=Math.max(0,d-4),hi=Math.min(profile.path.length,d+4);
  const a=point(profile.path,lo),b=point(profile.path,hi),dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz)||1;
  const slope=(height(profile,hi)-height(profile,lo))/length,gx=dx/length*slope,gz=dz/length*slope,n=Math.hypot(gx,1,gz);
  return{height:height(profile,d),normal:{x:-gx/n,y:1/n,z:-gz/n}};
}
