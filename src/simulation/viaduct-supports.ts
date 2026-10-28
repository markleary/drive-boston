import type {CityData,Point2} from '../types';
import type {TileBuildingGeometry} from './tile-format.ts';
import {sampleElevation} from './terrain.ts';
import {pointInside} from './roads.ts';
import {roadProjection,sampleRoadElevation} from './road-surfaces.ts';
import {buildingAt} from './city-tiles.ts';

export interface ViaductSupport{x:number;z:number;bottom:number;top:number;width:number;yaw:number;}
/** Slice the surveyed land-side deck ribbons, keeping their actual elevations.
 * Water/cable span and the southern tunnel mouth are deliberately excluded.
 * This augments the floating survey viaducts; it never rewrites the Zakim mesh. */
export function surveyViaductSupports(city:CityData,data:TileBuildingGeometry){
  const v=data.positions,triangles:{p:number[][];minX:number;maxX:number;minZ:number;maxZ:number}[]=[];
  for(let i=0;i<data.roof.length;i+=3){
    const p=[0,1,2].map(j=>Array.from(v.slice(data.roof[i+j]*3,data.roof[i+j]*3+3)));
    const a=p[1].map((n,k)=>n-p[0][k]),b=p[2].map((n,k)=>n-p[0][k]);
    const ny=a[2]*b[0]-a[0]*b[2],nx=a[1]*b[2]-a[2]*b[1],nz=a[0]*b[1]-a[1]*b[0];
    if(ny<.01||Math.hypot(nx,nz)/ny>.3)continue;
    triangles.push({p,minX:Math.min(...p.map(p=>p[0])),maxX:Math.max(...p.map(p=>p[0])),minZ:Math.min(...p.map(p=>p[2])),maxZ:Math.max(...p.map(p=>p[2]))});
  }
  const wet=(p:Point2)=>(city.water??[]).some(w=>pointInside(p,w.rings[0])&&!w.rings.slice(1).some(r=>pointInside(p,r)));
  const deckHeight=(x:number,z:number)=>{
    let y=Infinity;
    for(const t of triangles){
      if(x<t.minX||x>t.maxX||z<t.minZ||z>t.maxZ)continue;
      const [a,b,c]=t.p,dx1=b[0]-a[0],dz1=b[2]-a[2],dx2=c[0]-a[0],dz2=c[2]-a[2],det=dx1*dz2-dz1*dx2;
      const u=((x-a[0])*dz2-(z-a[2])*dx2)/det,w=(dx1*(z-a[2])-dz1*(x-a[0]))/det;
      if(u>=-.001&&w>=-.001&&u+w<=1.001)y=Math.min(y,a[1]+u*(b[1]-a[1])+w*(c[1]-a[1]));
    }
    return y;
  };
  const result:ViaductSupport[]=[];
  for(const axis of [2,0])for(let section=-4200;section<=1900;section+=34){
    const across=axis===2?0:2,intervals:{lo:number;hi:number;y:number}[]=[];
    for(const t of triangles){
      if(section<(axis===2?t.minZ:t.minX)||section>(axis===2?t.maxZ:t.maxX))continue;
      const hits:number[][]=[];
      for(let i=0;i<3;i++){const a=t.p[i],b=t.p[(i+1)%3];if((a[axis]<=section&&b[axis]>section)||(b[axis]<=section&&a[axis]>section)){const f=(section-a[axis])/(b[axis]-a[axis]);hits.push(a.map((n,k)=>n+(b[k]-n)*f));}}
      if(hits.length===2)intervals.push({lo:Math.min(hits[0][across],hits[1][across]),hi:Math.max(hits[0][across],hits[1][across]),y:(hits[0][1]+hits[1][1])/2});
    }
    intervals.sort((a,b)=>a.lo-b.lo);const merged:typeof intervals=[];
    for(const interval of intervals){const found=merged.find(p=>interval.lo<=p.hi+.25&&interval.hi>=p.lo-.25&&Math.abs(p.y-interval.y)<1);if(found){found.lo=Math.min(found.lo,interval.lo);found.hi=Math.max(found.hi,interval.hi);found.y=Math.min(found.y,interval.y);}else merged.push({...interval});}
    for(const p of merged){
      const width=p.hi-p.lo,x=axis===2?(p.lo+p.hi)/2:section,z=axis===2?section:(p.lo+p.hi)/2;
      // No work on the cable bridge over the Charles, or its Big Dig mouth.
      if(z>-1580||width<5||width>42||wet([x,z]))continue;
      const surface=deckHeight(x,z);
      // An upper-ramp pier cannot pass through another surveyed deck below it.
      if(!Number.isFinite(surface)||surface<p.y-1)continue;
      const bottom=sampleElevation(city,x,z)-.5,top=surface-.55;
      if(top-bottom<4||result.some(s=>Math.hypot(s.x-x,s.z-z)<25))continue;
      if(buildingAt(city,x,z))continue;
      if(city.roads.some(r=>roadProjection(r,x,z).distance<r.width/2+2.2&&sampleRoadElevation(city,r,x,z)<top+1))continue;
      result.push({x,z,bottom,top,width,yaw:axis===2?0:Math.PI/2});
    }
  }
  return result;
}
