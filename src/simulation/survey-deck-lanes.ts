import type {TileBuildingGeometry} from './tile-format.ts';

/** One measured cross-section of a surveyed carriageway: its centre between the
 * barriers (or deck edges), the unit direction of travel, the half width, the
 * deck height at the centre and at both edges, and the lanes painted there. */
export interface DeckStation{x:number;z:number;y:number;tx:number;tz:number;half:number;yLeft:number;yRight:number;lanes:number;}
export interface DeckCarriageway{stations:DeckStation[];}

const STEP=2,MARCH=.4,REACH=26,LANE=3.65,CELL=4,STRIDE=14;
/** Lanes on a carriageway this wide: a narrow ramp is all lanes, an interstate
 * carriageway keeps shoulders (the Zakim's 19.5 m mainline decks carry four). */
export const deckLanes=(width:number)=>Math.max(1,Math.round((width-Math.min(4.2,Math.max(.6,(width-7)*.35)))/LANE));

/** Height queries on the upward faces of a surveyed structure mesh. Flat faces
 * are drivable deck; any upward face standing .25-3.5 m above the deck (a
 * barrier or parapet top, a tower leg) blocks it. */
export function surveyDeckIndex(data:TileBuildingGeometry){
  const v=data.positions,list:number[]=[],cells=new Map<number,number[]>(),key=(cx:number,cz:number)=>(cx+32768)*65536+cz+32768;
  for(let i=0;i<data.roof.length;i+=3){
    const a=data.roof[i]*3,b=data.roof[i+1]*3,c=data.roof[i+2]*3;
    const ax=v[b]-v[a],ay=v[b+1]-v[a+1],az=v[b+2]-v[a+2],bx=v[c]-v[a],by=v[c+1]-v[a+1],bz=v[c+2]-v[a+2];
    const ny=az*bx-ax*bz,nx=ay*bz-az*by,nz=ax*by-ay*bx;if(ny<=1e-6)continue;
    const f=list.length/STRIDE,minX=Math.min(v[a],v[b],v[c]),maxX=Math.max(v[a],v[b],v[c]),minZ=Math.min(v[a+2],v[b+2],v[c+2]),maxZ=Math.max(v[a+2],v[b+2],v[c+2]);
    list.push(v[a],v[a+1],v[a+2],v[b],v[b+1],v[b+2],v[c],v[c+1],v[c+2],Math.hypot(nx,nz)/ny<=.25?1:0,minX,maxX,minZ,maxZ);
    for(let cx=Math.floor(minX/CELL);cx<=Math.floor(maxX/CELL);cx++)for(let cz=Math.floor(minZ/CELL);cz<=Math.floor(maxZ/CELL);cz++){
      const k=key(cx,cz),cell=cells.get(k);if(cell)cell.push(f);else cells.set(k,[f]);
    }
  }
  const faces=Float64Array.from(list);
  const hits:number[]=[],flat:number[]=[];
  const heights=(x:number,z:number)=>{
    hits.length=0;flat.length=0;
    for(const f of cells.get(key(Math.floor(x/CELL),Math.floor(z/CELL)))??[]){
      const o=f*STRIDE;if(x<faces[o+10]-1e-3||x>faces[o+11]+1e-3||z<faces[o+12]-1e-3||z>faces[o+13]+1e-3)continue;
      const dx1=faces[o+3]-faces[o],dz1=faces[o+5]-faces[o+2],dx2=faces[o+6]-faces[o],dz2=faces[o+8]-faces[o+2],det=dx1*dz2-dz1*dx2;if(Math.abs(det)<1e-9)continue;
      const u=((x-faces[o])*dz2-(z-faces[o+2])*dx2)/det,w=(dx1*(z-faces[o+2])-dz1*(x-faces[o]))/det;
      if(u<-1e-4||w<-1e-4||u+w>1+1e-4)continue;
      const y=faces[o+1]+u*(faces[o+4]-faces[o+1])+w*(faces[o+7]-faces[o+1]);hits.push(y);if(faces[o+9])flat.push(y);
    }
  };
  /** The deck height within `tolerance` of `near`, NaN off the deck or where something stands on it. */
  const deck=(x:number,z:number,near:number,tolerance=.4)=>{
    heights(x,z);let best=NaN;
    for(const y of flat)if(Math.abs(y-near)<=tolerance&&!(Math.abs(y-near)>=Math.abs(best-near)))best=y;
    if(Number.isNaN(best))return NaN;
    for(const y of hits)if(y>best+.25&&y<best+3.5)return NaN;
    return best;
  };
  /** The nearest deck height to `near` regardless of obstructions, for draping paint. */
  const surface=(x:number,z:number,near:number)=>{heights(x,z);let best=near,gap=1.2;for(const y of flat)if(Math.abs(y-near)<gap){gap=Math.abs(y-near);best=y;}return best;};
  return{deck,surface,flatFaces:()=>{const out:number[][]=[];for(let o=0;o<faces.length;o+=STRIDE)if(faces[o+9])out.push(Array.from(faces.subarray(o,o+9)));return out;}};
}

/** Trace every carriageway of a surveyed structure (the Zakim and its
 * Charlestown viaduct) between its barriers. Each walk measures the deck across
 * its direction every 2 m, recentres between the measured edges and stops at a
 * deck end, a split or merge, or a carriageway already traced. `surface` gives
 * the deck height nearest a level, for draping the pavement and its paint. */
export function surveyDeckCarriageways(data:TileBuildingGeometry,{minWidth=2.5,maxWidth=45}={}){
  const index=surveyDeckIndex(data),deck=index.deck;
  const across=(x:number,z:number,y:number,nx:number,nz:number)=>{
    const centre=deck(x,z,y);if(Number.isNaN(centre))return undefined;
    // March out to the first miss, then halve the gap twice: the edge lies
    // within 5 cm of the middle of what remains.
    const side=(sign:number)=>{
      let reach=0,level=centre,miss=REACH+MARCH;
      for(let s=MARCH;s<=REACH;s+=MARCH){const h=deck(x+nx*s*sign,z+nz*s*sign,level,.3);if(Number.isNaN(h)){miss=s;break;}reach=s;level=h;}
      for(let i=0;i<2&&miss<=REACH;i++){const s=(reach+miss)/2,h=deck(x+nx*s*sign,z+nz*s*sign,level,.3);if(Number.isNaN(h))miss=s;else{reach=s;level=h;}}
      return[(reach+Math.min(miss,REACH))/2,level];
    };
    const [right,yRight]=side(-1),[left,yLeft]=side(1);
    return{lo:-right,hi:left,y:centre,yLeft,yRight};
  };
  const occupied=new Map<string,number[]>(),cell=(x:number,z:number)=>`${Math.floor(x/2)},${Math.floor(z/2)}`;
  const taken=(x:number,z:number,y:number)=>(occupied.get(cell(x,z))??[]).some(h=>Math.abs(h-y)<1.5);
  const claim=(s:DeckStation)=>{
    for(let o=-s.half;o<=s.half;o+=1){const x=s.x-s.tz*o,z=s.z+s.tx*o,k=cell(x,z),list=occupied.get(k);if(list)list.push(s.y);else occupied.set(k,[s.y]);}
  };
  const walk=(start:DeckStation,sign:number)=>{
    const out:DeckStation[]=[];let c=start,tx=start.tx*sign,tz=start.tz*sign,grade=0;
    for(let i=0;i<4000;i++){
      const px=c.x+tx*STEP,pz=c.z+tz*STEP,m=across(px,pz,c.y+grade*STEP,-tz,tx);if(!m)break;
      const width=m.hi-m.lo;if(width<minWidth||width>maxWidth)break;
      // A sudden change is a split or a merge: the other branch is its own walk.
      const previous=c.half*2;if(Math.abs(width-previous)>Math.max(3,previous*.3))break;
      const mid=(m.lo+m.hi)/2,x=px-tz*mid,z=pz+tx*mid,y=deck(x,z,m.y);if(Number.isNaN(y)||taken(x,z,y))break;
      // Turn toward the new centre, at most 5 degrees a step (a 23 m radius).
      let dx=x-c.x,dz=z-c.z;const l=Math.hypot(dx,dz)||1;dx/=l;dz/=l;
      const turn=Math.atan2(tx*dz-tz*dx,tx*dx+tz*dz),limited=Math.max(-.087,Math.min(.087,turn)),cos=Math.cos(limited),sin=Math.sin(limited);
      [tx,tz]=[tx*cos-tz*sin,tx*sin+tz*cos];grade=Math.max(-.1,Math.min(.1,(y-c.y)/l));
      const s:DeckStation={x,z,y,tx:tx*sign,tz:tz*sign,half:width/2,yLeft:sign>0?m.yLeft:m.yRight,yRight:sign>0?m.yRight:m.yLeft,lanes:0};
      out.push(s);c={...s,tx,tz};
    }
    return out;
  };
  const result:DeckCarriageway[]=[],tried=new Set<string>();
  for(const f of index.flatFaces()){
    const x=(f[0]+f[3]+f[6])/3,z=(f[2]+f[5]+f[8])/3,y=(f[1]+f[4]+f[7])/3,k=`${cell(x,z)},${Math.round(y)}`;
    if(tried.has(k)||taken(x,z,y))continue;tried.add(k);
    // The narrowest cross-section is square to the carriageway.
    let best:{width:number;angle:number;m:NonNullable<ReturnType<typeof across>>}|undefined;
    const tryAngle=(angle:number)=>{const m=across(x,z,y,Math.cos(angle),Math.sin(angle));if(m&&(!best||m.hi-m.lo<best.width))best={width:m.hi-m.lo,angle,m};return!!m;};
    // Every 12 degrees, then refined to 1.5 degrees around the narrowest.
    for(let a=0;a<180;a+=12)if(!tryAngle(a*Math.PI/180))break;
    for(const step of [6,3,1.5])if(best){const angle=best.angle;tryAngle(angle-step*Math.PI/180);tryAngle(angle+step*Math.PI/180);}
    if(!best||best.width<minWidth||best.width>maxWidth)continue;
    const nx=Math.cos(best.angle),nz=Math.sin(best.angle),mid=(best.m.lo+best.m.hi)/2,sx=x+nx*mid,sz=z+nz*mid,sy=deck(sx,sz,best.m.y);
    if(Number.isNaN(sy)||taken(sx,sz,sy))continue;
    const seed:DeckStation={x:sx,z:sz,y:sy,tx:nz,tz:-nx,half:best.width/2,yLeft:best.m.yLeft,yRight:best.m.yRight,lanes:0};
    const stations=[...walk(seed,-1).reverse(),seed,...walk(seed,1)];
    if(stations.length<4)continue;
    smoothLanes(stations);for(const s of stations)claim(s);result.push({stations});
  }
  return{carriageways:result,surface:index.surface};
}

/** Lane counts follow the width but only change where the new count holds for
 * 30 m, so a width hovering at a threshold does not make the lines flicker. */
function smoothLanes(stations:DeckStation[]){
  const raw=stations.map(s=>deckLanes(s.half*2)),hold=15;
  let current=raw[0];
  for(let i=0;i<stations.length;i++){
    if(raw[i]!==current){let j=i;while(j<stations.length&&raw[j]===raw[i])j++;if(j-i>=hold)current=raw[i];}
    stations[i].lanes=current;
  }
}
