import type {CityData,Point2,Road} from '../types';
import type {TileBuildingGeometry} from './tile-format.ts';
import {sampleElevation} from './terrain.ts';
import {pointInside} from './roads.ts';
import {roadProjection,sampleRoadElevation} from './road-surfaces.ts';
import {buildingAt} from './city-tiles.ts';
import {drain} from '../render/pacing.ts';

/** `width` and `capX`/`capZ` describe the cap, which may sit off the column's centre.
 * `columns`, when set, replace the single column at (x, z): a straddle bent's
 * two legs, either side of a deck that passes beneath the cap. */
export interface ViaductSupport{x:number;z:number;bottom:number;top:number;width:number;yaw:number;capX:number;capZ:number;columns?:{x:number;z:number;bottom:number}[];}
/** Slice the surveyed land-side deck ribbons, keeping their actual elevations.
 * Water/cable span and the southern tunnel mouth are deliberately excluded.
 * This augments the floating survey viaducts; it never rewrites the Zakim mesh.
 * It runs in steps, pausing at every section and between batches of triangles
 * and roads, so a paced tile build spreads it across frames. */
export function* surveyViaductSupportSteps(city:CityData,data:TileBuildingGeometry):Generator<void,ViaductSupport[]>{
  const v=data.positions,triangles:{p:number[][];minX:number;maxX:number;minZ:number;maxZ:number}[]=[];
  for(let i=0;i<data.roof.length;i+=3){
    if(i%3000===2997)yield;
    const p=[0,1,2].map(j=>Array.from(v.slice(data.roof[i+j]*3,data.roof[i+j]*3+3)));
    const a=p[1].map((n,k)=>n-p[0][k]),b=p[2].map((n,k)=>n-p[0][k]);
    const ny=a[2]*b[0]-a[0]*b[2],nx=a[1]*b[2]-a[2]*b[1],nz=a[0]*b[1]-a[1]*b[0];
    if(ny<.01||Math.hypot(nx,nz)/ny>.3)continue;
    triangles.push({p,minX:Math.min(...p.map(p=>p[0])),maxX:Math.max(...p.map(p=>p[0])),minZ:Math.min(...p.map(p=>p[2])),maxZ:Math.max(...p.map(p=>p[2]))});
  }
  const wet=(p:Point2)=>(city.water??[]).some(w=>pointInside(p,w.rings[0])&&!w.rings.slice(1).some(r=>pointInside(p,r)));
  const cells=new Map<string,typeof triangles>();
  let work=0;
  for(const t of triangles){
    if(++work>=20000){work=0;yield;}
    for(let cx=Math.floor(t.minX/8);cx<=Math.floor(t.maxX/8);cx++)for(let cz=Math.floor(t.minZ/8);cz<=Math.floor(t.maxZ/8);cz++){work++;const k=`${cx},${cz}`,list=cells.get(k);if(list)list.push(t);else cells.set(k,[t]);}
  }
  const deckHeight=(x:number,z:number)=>{
    let y=Infinity;
    for(const t of cells.get(`${Math.floor(x/8)},${Math.floor(z/8)}`)??[]){
      if(x<t.minX||x>t.maxX||z<t.minZ||z>t.maxZ)continue;
      const [a,b,c]=t.p,dx1=b[0]-a[0],dz1=b[2]-a[2],dx2=c[0]-a[0],dz2=c[2]-a[2],det=dx1*dz2-dz1*dx2;
      const u=((x-a[0])*dz2-(z-a[2])*dx2)/det,w=(dx1*(z-a[2])-dz1*(x-a[0]))/det;
      if(u>=-.001&&w>=-.001&&u+w<=1.001)y=Math.min(y,a[1]+u*(b[1]-a[1])+w*(c[1]-a[1]));
    }
    return y;
  };
  const result:ViaductSupport[]=[];
  // Streets a pier must keep clear of, with their reach: only those near the structure.
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const t of triangles){minX=Math.min(minX,t.minX);maxX=Math.max(maxX,t.maxX);minZ=Math.min(minZ,t.minZ);maxZ=Math.max(maxZ,t.maxZ);}
  // Survey traces lie on the structure itself; they are no street beneath it.
  const streets:{r:Road;x0:number;x1:number;z0:number;z1:number}[]=[];let scanned=0;
  for(const r of city.roads){
    if(++scanned%1000===0)yield;
    if(r.surveyDeck)continue;
    const reach=r.width/2+2.2;let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;for(const [x,z]of r.points){x0=Math.min(x0,x);x1=Math.max(x1,x);z0=Math.min(z0,z);z1=Math.max(z1,z);}
    if(x1+reach>=minX&&x0-reach<=maxX&&z1+reach>=minZ&&z0-reach<=maxZ)streets.push({r,x0:x0-reach,x1:x1+reach,z0:z0-reach,z1:z1+reach});
  }
  for(const axis of [2,0])for(let section=-4200;section<=1900;section+=34){
    yield;
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
      // The cap carries only its own deck: it grows out from the column while
      // the deck above it stays level with the column's surface (a slope across
      // a skewed section, or a lower carriageway beside it, ends it) and sits
      // below the lowest point of what it spans, so it never shows through.
      const ux=axis===2?1:0,uz=axis===2?0:1,carried=(u:number)=>{
        let lowest=Infinity;
        for(const w of [-1.65,-.8,0,.8,1.65]){const y=deckHeight(x+ux*u+uz*w,z+uz*u+ux*w);if(!(y>=surface-.35&&y<surface+3))return NaN;lowest=Math.min(lowest,y);}
        return lowest;
      };
      let lo=0,hi=0,lowest=carried(0);
      for(let y=0;lo>-width/2&&!Number.isNaN(y=carried(lo-.25));lo-=.25)lowest=Math.min(lowest,y);
      for(let y=0;hi<width/2&&!Number.isNaN(y=carried(hi+.25));hi+=.25)lowest=Math.min(lowest,y);
      if(!Number.isFinite(lowest)||lo>-1.5||hi<1.5)continue;
      const bottom=sampleElevation(city,x,z)-.5,top=lowest-.55;
      if(top-bottom<4||result.some(s=>Math.hypot(s.x-x,s.z-z)<25))continue;
      if(buildingAt(city,x,z))continue;
      const beneath=(px:number,pz:number,clear:number)=>streets.filter(({r,x0,x1,z0,z1})=>px>=x0&&px<=x1&&pz>=z0&&pz<=z1&&roadProjection(r,px,pz).distance<r.width/2+clear&&sampleRoadElevation(city,r,px,pz)<top+1);
      const under=beneath(x,z,2.2);
      if(!under.length){result.push({x,z,bottom,top,width:hi-lo,yaw:axis===2?0:Math.PI/2,capX:x+ux*(lo+hi)/2,capZ:z+uz*(lo+hi)/2});continue;}
      // A deck beneath (the Charlestown lower deck under the upper one) gets a
      // straddle bent: a leg clear of it on each side, on open ground, and the
      // cap reaching both legs while no surveyed deck lies above or just over it.
      if(under.some(({r})=>!r.elevations||r.tunnel))continue;
      const inside=(u:number)=>under.some(({r})=>roadProjection(r,x+ux*u,z+uz*u).distance<r.width/2+.3);
      let a=0,b=0;while(a>-30&&inside(a-.25))a-=.25;while(b<30&&inside(b+.25))b+=.25;
      // Lorries pass under the cap: 4.4 m between the deck and the cap's soffit.
      let headroom=true;for(let u=a;u<=b+1e-6&&headroom;u+=.5)headroom=under.every(({r})=>sampleRoadElevation(city,r,x+ux*u,z+uz*u)<=top-.85-4.4);
      if(!headroom)continue;
      const legs=[a-1.5,b+1.5],from=Math.min(lo,legs[0]-1.1),to=Math.max(hi,legs[1]+1.1);
      if(a<=-30||b>=30||to-from>46||lo-from>3.5||to-hi>3.5)continue;
      const capClear=(u:number)=>[-1.65,0,1.65].every(w=>{const y=deckHeight(x+ux*u+uz*w,z+uz*u+ux*w);return !Number.isFinite(y)||y>=top-.05;});
      let open=true;for(let u=from;u<=to+1e-6&&open;u+=.5)if(u<lo||u>hi)open=capClear(u);
      const columns=legs.map(u=>{const cx=x+ux*u,cz=z+uz*u;return{x:cx,z:cz,bottom:sampleElevation(city,cx,cz)-.5};});
      if(!open||columns.some(c=>top-c.bottom<4||buildingAt(city,c.x,c.z)||wet([c.x,c.z])||beneath(c.x,c.z,1.3).length))continue;
      result.push({x,z,bottom:Math.min(...columns.map(c=>c.bottom)),top,width:to-from,yaw:axis===2?0:Math.PI/2,capX:x+ux*(from+to)/2,capZ:z+uz*(from+to)/2,columns});
    }
  }
  return result;
}
/** The supports at once, for tests and tools. */
export function surveyViaductSupports(city:CityData,data:TileBuildingGeometry){return drain(surveyViaductSupportSteps(city,data));}
