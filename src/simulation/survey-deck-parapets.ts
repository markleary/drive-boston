import type {CityData,Road} from '../types';
import type {TileBuildingGeometry} from './tile-format.ts';
import type {DeckStation} from './survey-deck-lanes.ts';
import {sampleElevation} from './terrain.ts';
import {sampleRoadElevation} from './road-surfaces.ts';
import {drain} from '../render/pacing.ts';

/** A straight concrete parapet box: `x, y, z` its centre, `yaw` its heading
 * and `slope` its pitch, set like a deck rail (`bridgeBarriers`). */
export interface DeckParapet{x:number;y:number;z:number;yaw:number;slope:number;length:number;width:number;height:number;}

/** Parapet top over the deck and its foot under it: the survey's own parapets
 * stand 0.9 m over the Charlestown deck, and the foot hides the slab's edge. */
const TOP=.9,FOOT=.3,MIN_WIDTH=.45,MAX_WIDTH=1.2,CELL=4;

/** Transverse rails set back from the survey's open deck ends near Cambridge
 * Street. The raised west fork narrows beside the lower southbound deck;
 * the separate ramp below the east side has a survey-only end. Both spans
 * join the side parapets without crossing either modeled carriageway. */
const CHARLESTOWN_ENDS=[
  {a:[-195.1,-3619.65],b:[-183.9,-3618.53],y:32.224},
  {a:[-158.4,-3492.05],b:[-148.05,-3490.55],y:16.974},
];

/** Height queries on every triangle of a surveyed structure, either winding:
 * many of its barrier tops face down, and its parapets are vertical walls.
 * Built in steps, a pause every 20,000 grid entries (a few triangles span a
 * thousand cells each). */
function* surveyGeometrySteps(data:TileBuildingGeometry){
  const v=data.positions,list:number[]=[],cells=new Map<number,number[]>(),key=(cx:number,cz:number)=>(cx+32768)*65536+cz+32768;let work=0;
  for(const indices of [data.roof,data.facade])for(let i=0;i<indices.length;i+=3){
    if(++work>=20000){work=0;yield;}
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3,f=list.length/9;
    list.push(v[a],v[a+1],v[a+2],v[b],v[b+1],v[b+2],v[c],v[c+1],v[c+2]);
    for(let cx=Math.floor(Math.min(v[a],v[b],v[c])/CELL);cx<=Math.floor(Math.max(v[a],v[b],v[c])/CELL);cx++)for(let cz=Math.floor(Math.min(v[a+2],v[b+2],v[c+2])/CELL);cz<=Math.floor(Math.max(v[a+2],v[b+2],v[c+2])/CELL);cz++){
      work++;const k=key(cx,cz),cell=cells.get(k);if(cell)cell.push(f);else cells.set(k,[f]);
    }
  }
  const t=Float64Array.from(list),seen=new Set<number>();
  /** Heights of the faces over (x, z) that are not walls. */
  const heights=(x:number,z:number,out:number[])=>{
    out.length=0;
    for(const f of cells.get(key(Math.floor(x/CELL),Math.floor(z/CELL)))??[]){
      const o=f*9,dx1=t[o+3]-t[o],dz1=t[o+5]-t[o+2],dx2=t[o+6]-t[o],dz2=t[o+8]-t[o+2],det=dx1*dz2-dz1*dx2;if(Math.abs(det)<1e-6)continue;
      const u=((x-t[o])*dz2-(z-t[o+2])*dx2)/det,w=(dx1*(z-t[o+2])-dz1*(x-t[o]))/det;
      if(u>=-1e-4&&w>=-1e-4&&u+w<=1+1e-4)out.push(t[o+1]+u*(t[o+4]-t[o+1])+w*(t[o+7]-t[o+1]));
    }
    return out;
  };
  /** Whether any face or wall crossing the plan segment a-b stands between `low` and `high`. */
  const standing=(ax:number,az:number,bx:number,bz:number,low:number,high:number)=>{
    const dx=bx-ax,dz=bz-az,l2=dx*dx+dz*dz,l=Math.sqrt(l2),mx=-dz/l,mz=dx/l;seen.clear();
    for(let cx=Math.floor(Math.min(ax,bx)/CELL);cx<=Math.floor(Math.max(ax,bx)/CELL);cx++)for(let cz=Math.floor(Math.min(az,bz)/CELL);cz<=Math.floor(Math.max(az,bz)/CELL);cz++)for(const f of cells.get(key(cx,cz))??[]){
      if(seen.has(f))continue;seen.add(f);const o=f*9;
      // The triangle cut by the vertical plane through a-b: points (s along a-b, y).
      const d0=(t[o]-ax)*mx+(t[o+2]-az)*mz,d1=(t[o+3]-ax)*mx+(t[o+5]-az)*mz,d2=(t[o+6]-ax)*mx+(t[o+8]-az)*mz;
      if((d0>0&&d1>0&&d2>0)||(d0<0&&d1<0&&d2<0))continue;
      let s0=Infinity,s1=-Infinity,y0=0,y1=0,yMin=Infinity,yMax=-Infinity;
      const cut=(p:number,q:number,dp:number,dq:number)=>{
        if((dp>0&&dq>0)||(dp<0&&dq<0))return;
        const g=dp===dq?0:dp/(dp-dq),x=t[p]+(t[q]-t[p])*g,y=t[p+1]+(t[q+1]-t[p+1])*g,z=t[p+2]+(t[q+2]-t[p+2])*g,s=((x-ax)*dx+(z-az)*dz)/l2;
        if(s<s0){s0=s;y0=y;}if(s>s1){s1=s;y1=y;}yMin=Math.min(yMin,y);yMax=Math.max(yMax,y);
      };
      cut(o,o+3,d0,d1);cut(o+3,o+6,d1,d2);cut(o+6,o,d2,d0);
      if(s1<0||s0>1)continue;
      // A wall meets the plane in a vertical span; a face in a line, clipped to a-b.
      if(s1-s0>1e-6){const at=(s:number)=>y0+(y1-y0)*(s-s0)/(s1-s0),ya=at(Math.max(0,s0)),yb=at(Math.min(1,s1));yMin=Math.min(ya,yb);yMax=Math.max(ya,yb);}
      if(yMax>low&&yMin<high)return true;
    }
    return false;
  };
  return{heights,standing};
}

/** Road decks near the structure (tunnel roadways too, which meet it at the
 * Central Artery portals), for the levels a survey edge may meet. Built in
 * steps, a pause after each elevated road and every 500 roads. */
function* deckLevelSteps(city:CityData,box:{minX:number;maxX:number;minZ:number;maxZ:number}){
  const cells=new Map<string,{road:Road;i:number;reach:number}[]>(),size=8;let n=0;
  for(const road of city.roads){
    if(++n%500===0)yield;
    if(!road.elevations)continue;
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],reach=Math.max(road.deckWidths?.[i-1]??road.width,road.deckWidths?.[i]??road.width)/2;
      if(Math.max(a[0],b[0])+reach<box.minX||Math.min(a[0],b[0])-reach>box.maxX||Math.max(a[1],b[1])+reach<box.minZ||Math.min(a[1],b[1])-reach>box.maxZ)continue;
      for(let cx=Math.floor((Math.min(a[0],b[0])-reach)/size);cx<=Math.floor((Math.max(a[0],b[0])+reach)/size);cx++)for(let cz=Math.floor((Math.min(a[1],b[1])-reach)/size);cz<=Math.floor((Math.max(a[1],b[1])+reach)/size);cz++){
        const k=`${cx},${cz}`,list=cells.get(k),entry={road,i,reach};if(list)list.push(entry);else cells.set(k,[entry]);
      }
    }
    yield;
  }
  return(x:number,z:number,out:number[])=>{
    out.length=0;
    for(const {road,i,reach} of cells.get(`${Math.floor(x/size)},${Math.floor(z/size)}`)??[]){
      const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],s=((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1);
      if(s<-.02||s>1.02||Math.abs((x-a[0])*dz-(z-a[1])*dx)/(Math.hypot(dx,dz)||1)>reach)continue;
      out.push(sampleRoadElevation(city,road,x,z));
    }
    return out;
  };
}

/** Why a traced edge needs no parapet (the survey's own barrier, deck carrying
 * on, a step down, the ground, or a road deck whose own rails close the edge),
 * or how far out the deck ends. */
export type EdgeKind={kind:'barrier'|'deck'|'step'|'ground'|'road'}|{kind:'drop';drop:number};
/** The generated parapets, and the edge test that placed them. */
export interface SurveyParapets{parapets:DeckParapet[];classify:(s:DeckStation,side:number)=>EdgeKind;}

/** The parapets a surveyed structure (the Zakim and its Charlestown viaduct)
 * leaves out: wherever a traced carriageway's edge has nothing standing on or
 * just beyond it, its deck stops within 6 m (no neighbouring deck or road deck
 * carries on at its level), no road deck reaches that end (its own rails stand
 * there) and what lies beyond is more than 1.2 m down (not a step onto a lower
 * deck, nor the ground at a ramp's foot), a concrete box runs along the deck's
 * end, as high as the survey's own parapets. It runs in steps, pausing at every
 * edge station, so a paced tile build spreads it across frames. */
export function* surveyDeckParapetSteps(city:CityData,data:TileBuildingGeometry,carriageways:DeckStation[][]):Generator<void,SurveyParapets>{
  const survey=yield* surveyGeometrySteps(data);
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const stations of carriageways)for(const s of stations){minX=Math.min(minX,s.x);maxX=Math.max(maxX,s.x);minZ=Math.min(minZ,s.z);maxZ=Math.max(maxZ,s.z);}
  const roads=yield* deckLevelSteps(city,{minX:minX-40,maxX:maxX+40,minZ:minZ-40,maxZ:maxZ+40}),found:number[]=[],decks:number[]=[];
  const level=(x:number,z:number,y:number)=>survey.heights(x,z,found).some(h=>Math.abs(h-y)<=.4)||roads(x,z,decks).some(h=>Math.abs(h-y)<=.4);
  /** The highest surface under `y` at (x, z): the ground, a road deck or the survey. */
  const below=(x:number,z:number,y:number)=>{
    let top=sampleElevation(city,x,z);
    for(const h of survey.heights(x,z,found))if(h<y-.4&&h>top)top=h;
    for(const h of roads(x,z,decks))if(h<y-.4&&h>top)top=h;
    return top;
  };
  const classify=(s:DeckStation,side:number):EdgeKind=>{
    const nx=-s.tz*side,nz=s.tx*side,y=side>0?s.yLeft:s.yRight,ex=s.x+nx*s.half,ez=s.z+nz*s.half;
    if(survey.standing(ex-nx*.3,ez-nz*.3,ex+nx*1.5,ez+nz*1.5,y+.25,y+3.5))return{kind:'barrier'};
    // Out to where no deck carries on for a metre: a flush ledge beyond the
    // measured edge belongs to the deck, a merging carriageway does not end.
    let drop=NaN;
    for(let d=0;d<=6&&Number.isNaN(drop);d+=.1){
      if(level(ex+nx*d,ez+nz*d,y))continue;
      let gap=true;for(let e=.1;e<=1.001&&gap;e+=.1)gap=!level(ex+nx*(d+e),ez+nz*(d+e),y);
      if(gap)drop=d;
    }
    if(Number.isNaN(drop))return{kind:'deck'};
    // A road deck reaching the end draws its own rail along it (the northbound I-93 deck leaving the viaduct).
    const inside=drop>=.1?drop-.1:-.1;if(roads(ex+nx*inside,ez+nz*inside,decks).some(h=>Math.abs(h-y)<=.4))return{kind:'road'};
    let lowest=Infinity;for(const e of [.4,1,2])lowest=Math.min(lowest,y-below(ex+nx*(drop+e),ez+nz*(drop+e),y));
    if(lowest<1.2)return{kind:sampleElevation(city,ex+nx*(drop+.4),ez+nz*(drop+.4))>y-1.2?'ground':'step'};
    return{kind:'drop',drop};
  };
  const out:DeckParapet[]=[];
  for(const stations of carriageways)for(const side of [1,-1]){
    // Runs of open stations; each becomes boxes between its stations' deck ends.
    const edges:EdgeKind[]=[];for(const s of stations){yield;edges.push(classify(s,side));}
    const ends=stations.map((s,i)=>{
      const edge=edges[i];if(edge.kind!=='drop')return undefined;
      const nx=-s.tz*side,nz=s.tx*side,outer=s.half+edge.drop,inner=Math.max(outer-MAX_WIDTH,Math.min(s.half,outer-MIN_WIDTH)),middle=(inner+outer)/2;
      return{x:s.x+nx*middle,z:s.z+nz*middle,y:side>0?s.yLeft:s.yRight,width:outer-inner,tx:s.tx,tz:s.tz};
    });
    for(let i=0;i<ends.length;){
      if(!ends[i]){i++;continue;}
      let j=i;while(j+1<ends.length&&ends[j+1])j++;
      // A run reaches a metre past its first and last stations, to the barrier
      // the survey resumes with (a single open station is two metres long), or
      // 3 m on toward a station where a road deck's rail takes over, since that
      // rail starts with the road somewhere before the station.
      const run=ends.slice(i,j+1) as NonNullable<typeof ends[number]>[],first=run[0],last=run.at(-1)!,reach=(k:number)=>edges[k]?.kind==='road'?3:1;
      const points=[{...first,x:first.x-first.tx*reach(i-1),z:first.z-first.tz*reach(i-1)},...run,{...last,x:last.x+last.tx*reach(j+1),z:last.z+last.tz*reach(j+1)}];
      for(let k=1;k<points.length;k++){
        const a=points[k-1],b=points[k],dx=b.x-a.x,dz=b.z-a.z,dy=b.y-a.y,length=Math.hypot(dx,dz);if(length<.05)continue;
        out.push({x:(a.x+b.x)/2,y:(a.y+b.y)/2+(TOP-FOOT)/2,z:(a.z+b.z)/2,yaw:Math.atan2(dx,dz),slope:Math.atan2(dy,length),length:Math.hypot(length,dy)+.06,width:(a.width+b.width)/2,height:TOP+FOOT});
      }
      i=j+1;
    }
  }
  for(const {a,b,y} of CHARLESTOWN_ENDS){
    const dx=b[0]-a[0],dz=b[1]-a[1],x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
    if(!level(x,z,y))continue;
    out.push({x,y:y+(TOP-FOOT)/2,z,yaw:Math.atan2(dx,dz),slope:0,length:Math.hypot(dx,dz),width:.6,height:TOP+FOOT});
  }
  return{parapets:out,classify};
}
/** The whole set at once, for tests and tools. */
export function surveyDeckParapets(city:CityData,data:TileBuildingGeometry,carriageways:DeckStation[][]){return drain(surveyDeckParapetSteps(city,data,carriageways));}
