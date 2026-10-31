import type {CityData,Point2,Road} from '../types';
import {isHarvardBridgeRoad} from './harvard-bridge.ts';
import {sampleElevation,sampleTerrainNormal,rotationFromNormal} from './terrain.ts';
import {inTransitClearance} from './transit-corridors.ts';
import {inTunnelPortal,tunnelAt} from './tunnels.ts';

export function roadProjection(road:Pick<Road,'points'>,x:number,z:number){
  let best={distance:Infinity,index:0,t:0,x:road.points[0]?.[0]??x,z:road.points[0]?.[1]??z};
  for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],len=dx*dx+dz*dz;
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(len||1))),px=a[0]+dx*t,pz=a[1]+dz*t,distance=Math.hypot(x-px,z-pz);
    if(distance<best.distance)best={distance,index:i-1,t,x:px,z:pz};
  }
  return best;
}

/** Elevations are road-specific: crossing paths may occupy independent levels. */
export function sampleRoadElevation(city:CityData,road:Road,x:number,z:number){
  if(!road.elevations)return sampleElevation(city,x,z);
  const plane=road.deckEdgeElevations&&deckPlaneAt(road,x,z);if(plane)return plane.height;
  const hit=roadProjection(road,x,z),a=road.elevations[hit.index],b=road.elevations[hit.index+1]??a;
  return a+(b-a)*hit.t;
}
export function roadNormal(city:CityData,road:Road,x:number,z:number){
  if(!road.elevations)return sampleTerrainNormal(city,x,z);
  const plane=road.deckEdgeElevations&&deckPlaneAt(road,x,z);if(plane){const n=Math.hypot(plane.gx,1,plane.gz);return{x:-plane.gx/n,y:1/n,z:-plane.gz/n};}
  const hit=roadProjection(road,x,z),a=road.points[hit.index],b=road.points[hit.index+1]??a;
  const dx=b[0]-a[0],dz=b[1]-a[1],slope=((road.elevations[hit.index+1]??road.elevations[hit.index])-road.elevations[hit.index])/(dx*dx+dz*dz||1);
  const gx=dx*slope,gz=dz*slope,n=Math.hypot(gx,1,gz);return{x:-gx/n,y:1/n,z:-gz/n};
}
export function roadRotation(city:CityData,road:Road,x:number,z:number,yaw:number){return rotationFromNormal(roadNormal(city,road,x,z),yaw);}

const elevatedIndexes=new WeakMap<CityData,Map<string,Road[]>>();
const streamedSurfaces=new WeakMap<CityData,Map<string,{road:Road;references:number}>>();
/** Park paths arrive in tiles, outside city.roads. Keep their support query alive
 * for exactly as long as their physical decks (including overlapping owners). */
export function registerDriveSurface(city:CityData,road:Road){
  let surfaces=streamedSurfaces.get(city);if(!surfaces){surfaces=new Map();streamedSurfaces.set(city,surfaces);}
  const entry=surfaces.get(road.id)??{road,references:0};entry.references++;surfaces.set(road.id,entry);
  return()=>{if(--entry.references===0)surfaces.delete(road.id);};
}
const ELEVATED_CELL=128;
/** Elevated roads near a point, from a per-city cell index: a metro has hundreds
 * of structures, and the surface query runs for every reset, save and actor. */
function elevatedNear(city:CityData,x:number,z:number){
  let cells=elevatedIndexes.get(city);
  if(!cells){
    cells=new Map();const seen=new Set<string>();
    for(const road of city.roads??[]){
      if(!road.elevations)continue;const margin=Math.max(road.width,...(road.deckWidths??[]))/2+1;
      for(let i=1;i<road.points.length;i++){
        const a=road.points[i-1],b=road.points[i];
        for(let cx=Math.floor((Math.min(a[0],b[0])-margin)/ELEVATED_CELL);cx<=Math.floor((Math.max(a[0],b[0])+margin)/ELEVATED_CELL);cx++)for(let cz=Math.floor((Math.min(a[1],b[1])-margin)/ELEVATED_CELL);cz<=Math.floor((Math.max(a[1],b[1])+margin)/ELEVATED_CELL);cz++){
          const key=`${cx},${cz}`;if(seen.has(`${key}|${road.id}`))continue;seen.add(`${key}|${road.id}`);
          const list=cells.get(key)??[];list.push(road);cells.set(key,list);
        }
      }
    }
    elevatedIndexes.set(city,cells);
  }
  return cells.get(`${Math.floor(x/ELEVATED_CELL)},${Math.floor(z/ELEVATED_CELL)}`)??[];
}

/** Highest support no more than 0.4m above the supplied reference. A car below
 * an overpass stays below it; explicit road IDs make deck destination resets unambiguous. */
export function sampleDriveSurface(city:CityData,x:number,z:number,yReference=sampleElevation(city,x,z)+.4,roadId?:string){
  const registered=streamedSurfaces.get(city),chosen=roadId?city.roads?.find(r=>r.id===roadId)??registered?.get(roadId)?.road:undefined;
  if(chosen&&roadProjection(chosen,x,z).distance<=roadWidthAt(chosen,x,z)/2+.3)return{height:sampleRoadElevation(city,chosen,x,z),normal:roadNormal(city,chosen,x,z),road:chosen};
  const ground=sampleElevation(city,x,z),below=tunnelAt(city,x,z,yReference),portal=inTunnelPortal(city,x,z);
  let height=(portal||below&&ground>yReference+.4)?-Infinity:ground,normal=sampleTerrainNormal(city,x,z),road:Road|undefined;
  for(const candidate of [...elevatedNear(city,x,z),...[...(registered?.values()??[])].map(s=>s.road)]){
    if(!candidate.elevations)continue;
    const hit=roadProjection(candidate,x,z);if(hit.distance>roadWidthAt(candidate,x,z)/2+.05)continue;
    const h=sampleRoadElevation(city,candidate,x,z);
    if(h>height&&h<=yReference+.4){height=h;normal=roadNormal(city,candidate,x,z);road=candidate;}
  }
  // A point outside every road footprint still has a stable terrain fallback.
  if(!Number.isFinite(height))height=ground;
  return{height,normal,road};
}

/** Optional per-section widths taper shore ramps without a step in the deck edge. */
export function roadWidthAt(road:Road,x:number,z:number){
  if(!road.deckWidths)return road.width;
  const hit=roadProjection(road,x,z),a=road.deckWidths?.[hit.index]??road.width,b=road.deckWidths?.[hit.index+1]??road.width;return a+(b-a)*hit.t;
}
function deckDirection(road:Road,i:number){
  const override=i===0?road.deckTangents?.start:i===road.points.length-1?road.deckTangents?.end:undefined;
  if(override)return override;const a=road.points[Math.max(0,i-1)],b=road.points[Math.min(road.points.length-1,i+1)];return[b[0]-a[0],b[1]-a[1]];
}

export function deckEdgeElevation(road:Road,index:number,side:number){return road.deckEdgeElevations?.[index]?.[side<0?0:1]??road.elevations?.[index]??0;}

/** Match the rendered/collidable ribbon plane, including crossfall at merges.
 * Centerline projection alone gives the wrong support on a banked ramp or a
 * sloping bend. Only adjacent segments are needed after the road projection. */
function deckPlaneAt(road:Road,x:number,z:number){
  const hit=roadProjection(road,x,z);let best:{height:number;gx:number;gz:number;outside:number}|undefined;
  for(let i=Math.max(0,hit.index-1);i<Math.min(road.points.length-1,hit.index+2);i++){
    const points=[deckEdge(road,i,-1),deckEdge(road,i,1),deckEdge(road,i+1,-1),deckEdge(road,i+1,1)];
    const heights=[deckEdgeElevation(road,i,-1),deckEdgeElevation(road,i,1),deckEdgeElevation(road,i+1,-1),deckEdgeElevation(road,i+1,1)];
    for(const [ia,ib,ic]of [[0,1,2],[1,3,2]]){
      const a=points[ia],b=points[ib],c=points[ic],dx=b[0]-a[0],dz=b[1]-a[1],ex=c[0]-a[0],ez=c[1]-a[1],det=dx*ez-ex*dz;
      if(Math.abs(det)<1e-8)continue;
      const u=((x-a[0])*ez-ex*(z-a[1]))/det,v=(dx*(z-a[1])-(x-a[0])*dz)/det;
      const outside=Math.max(0,-u,-v,u+v-1),gx=((heights[ib]-heights[ia])*ez-(heights[ic]-heights[ia])*dz)/det,gz=(dx*(heights[ic]-heights[ia])-ex*(heights[ib]-heights[ia]))/det;
      const plane={height:heights[ia]+gx*(x-a[0])+gz*(z-a[1]),gx,gz,outside};
      if(outside<1e-7)return plane;
      if(!best||outside<best.outside)best=plane;
    }
  }
  return best;
}

/** Shared exact deck ribbon for rendering and Rapier. Width may include parapets. */
export function roadDeckGeometry(city:CityData,road:Road,width=road.width,offset=0){
  const vertices:number[]=[],indices:number[]=[],uv:number[]=[];let along=0;
  for(let i=0;i<road.points.length;i++){
    const p=road.points[i],[dx,dz]=deckDirection(road,i),length=Math.hypot(dx,dz)||1;
    if(i)along+=Math.hypot(p[0]-road.points[i-1][0],p[1]-road.points[i-1][1]);
    const y=(road.elevations?.[i]??sampleElevation(city,...p))+offset;
    const sectionWidth=(road.deckWidths?.[i]??road.width)+(width-road.width);
    for(const side of [-1,1]){const edgeY=road.deckEdgeElevations?.[i]?.[side<0?0:1];vertices.push(p[0]-dz/length*sectionWidth/2*side,edgeY===undefined?y:edgeY+offset,p[1]+dx/length*sectionWidth/2*side);uv.push((side+1)*sectionWidth/10,along/5);}
    if(i){const j=(i-1)*2;indices.push(j,j+1,j+2,j+1,j+3,j+2);}
  }
  return{vertices:new Float32Array(vertices),indices:new Uint32Array(indices),uv:new Float32Array(uv)};
}

export function deckEdge(road:Road,i:number,side:number,inset=0):Point2{
  const p=road.points[i],[dx,dz]=deckDirection(road,i),length=Math.hypot(dx,dz)||1;
  const width=road.deckWidths?.[i]??road.width;return[p[0]-dz/length*(width/2-inset)*side,p[1]+dx/length*(width/2-inset)*side];
}

/** Closed slab gives both a driving top and a physical underside/edge. */
export function roadSlabGeometry(city:CityData,road:Road){
  const top=roadDeckGeometry(city,road),count=top.vertices.length/3,vertices=new Float32Array(top.vertices.length*2),thickness=road.bridge?.thickness??.75;
  vertices.set(top.vertices);vertices.set(top.vertices,top.vertices.length);
  for(let i=0;i<count;i++)vertices[(count+i)*3+1]-=thickness;
  const indices=[...top.indices];
  for(let i=0;i<top.indices.length;i+=3)indices.push(top.indices[i]+count,top.indices[i+2]+count,top.indices[i+1]+count);
  for(let i=0;i<count-2;i+=2){
    for(const side of [0,1]){
      const a=i+side,b=i+2+side;
      if(side===0)indices.push(a,b,a+count,b,b+count,a+count);
      else indices.push(a,a+count,b,b,a+count,b+count);
    }
  }
  indices.push(0,count,1,1,count,count+1);
  const end=count-2;indices.push(end,end+1,end+count,end+1,end+count+1,end+count);
  return{vertices,indices:new Uint32Array(indices)};
}

export function bridgeSupports(city:CityData,road:Road){
  if(!road.elevations||!road.bridge)return[];
  if(road.name==='Longfellow Bridge')return[]; // Shared granite piers and arch ribs in charles-bridges.ts.
  if(road.id===city.tobinBridge?.lowerRoadId||road.id===city.tobinBridge?.upperRoadId)return[]; // Shared river piers and approach bents in tobin-bridge.ts.
  const supports:{x:number;z:number;bottom:number;top:number;yaw:number;width:number}[]=[];let along=0,next=18;
  for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    while(along+length>=next){
      const t=(next-along)/length,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,top=road.elevations[i-1]+(road.elevations[i]-road.elevations[i-1])*t-road.bridge.thickness,bottom=sampleElevation(city,x,z);
      const excluded=road.bridge.supportExclusions?.some(([start,end])=>next>=start&&next<=end);
      const blocksRoad=city.roads.some(r=>r!==road&&roadProjection(r,x,z).distance<r.width/2+2.1&&sampleRoadElevation(city,r,x,z)<top-1);
      if(top-bottom>2.5&&!blocksRoad&&!excluded)supports.push({x,z,bottom:bottom-.5,top,yaw:Math.atan2(b[0]-a[0],b[1]-a[1]),width:roadWidthAt(road,x,z)});next+=34;
    }
    along+=length;
  }
  return supports;
}

type DeckTriangle={road:Road;points:[Point2,Point2,Point2];y:number;gx:number;gz:number;sign:number};
const deckIndexes=new WeakMap<CityData,Map<string,DeckTriangle[]>>();
const DECK_CELL=24;

/** Index the real ribbon triangles near the structures, including ground-level
 * streets at their arrivals. Elevation is a triangle plane, not a global layer
 * number: ramps gradually merge with the constant-height upper carriageways. */
function deckIndex(city:CityData){
  const cached=deckIndexes.get(city);if(cached)return cached;
  const cells=new Map<string,DeckTriangle[]>(),structures=city.roads.filter(r=>r.elevations);
  const points=structures.flatMap(r=>r.points),margin=30;
  const minX=Math.min(...points.map(p=>p[0]))-margin,maxX=Math.max(...points.map(p=>p[0]))+margin;
  const minZ=Math.min(...points.map(p=>p[1]))-margin,maxZ=Math.max(...points.map(p=>p[1]))+margin;
  for(const road of city.roads){
    if(!road.points.some((p,i)=>{
      const q=road.points[i+1]??p;
      return Math.max(p[0],q[0])>=minX-road.width&&Math.min(p[0],q[0])<=maxX+road.width&&Math.max(p[1],q[1])>=minZ-road.width&&Math.min(p[1],q[1])<=maxZ+road.width;
    }))continue;
    const geometry=roadDeckGeometry(city,road),v=geometry.vertices;
    for(let i=0;i<geometry.indices.length;i+=3){
      const [a,b,c]=[0,1,2].map(j=>geometry.indices[i+j]*3);
      const vertices:[Point2,Point2,Point2]=[[v[a],v[a+2]],[v[b],v[b+2]],[v[c],v[c+2]]];
      const left=Math.min(...vertices.map(p=>p[0])),right=Math.max(...vertices.map(p=>p[0])),top=Math.min(...vertices.map(p=>p[1])),bottom=Math.max(...vertices.map(p=>p[1]));
      if(right<minX||left>maxX||bottom<minZ||top>maxZ)continue;
      const dx1=v[b]-v[a],dz1=v[b+2]-v[a+2],dy1=v[b+1]-v[a+1],dx2=v[c]-v[a],dz2=v[c+2]-v[a+2],dy2=v[c+1]-v[a+1],det=dx1*dz2-dz1*dx2;
      if(Math.abs(det)<1e-8)continue;
      const triangle:DeckTriangle={road,points:vertices,y:v[a+1],gx:(dy1*dz2-dz1*dy2)/det,gz:(dx1*dy2-dy1*dx2)/det,sign:Math.sign(det)};
      for(let x=Math.floor(left/DECK_CELL);x<=Math.floor(right/DECK_CELL);x++)for(let z=Math.floor(top/DECK_CELL);z<=Math.floor(bottom/DECK_CELL);z++){
        const key=`${x},${z}`,list=cells.get(key)??[];list.push(triangle);cells.set(key,list);
      }
    }
  }
  deckIndexes.set(city,cells);return cells;
}

function coveredDeckInterval(a:Point2,b:Point2,ya:number,yb:number,triangle:DeckTriangle,tolerance=.8):[number,number]|undefined{
  let low=0,high=1;
  // Clip against a linear inequality: value + rate*t >= 0.
  const clip=(value:number,rate:number)=>{
    if(Math.abs(rate)<1e-10)return value>=-1e-8;
    const t=-value/rate;if(rate>0)low=Math.max(low,t);else high=Math.min(high,t);
    return high-low>1e-7;
  };
  const dx=b[0]-a[0],dz=b[1]-a[1];
  for(let i=0;i<3;i++){
    const p=triangle.points[i],q=triangle.points[(i+1)%3],ex=q[0]-p[0],ez=q[1]-p[1];
    if(!clip(triangle.sign*(ex*(a[1]-p[1])-ez*(a[0]-p[0])),triangle.sign*(ex*dz-ez*dx)))return;
  }
  const difference=ya-(triangle.y+triangle.gx*(a[0]-triangle.points[0][0])+triangle.gz*(a[1]-triangle.points[0][1]));
  // A ramp's guardrail can project into the adjoining carriageway even when
  // their independently estimated profiles differ by a few decimetres. Use
  // the full 0.76m rail height plus 4cm clearance, not a coplanarity epsilon.
  // Actual upper/lower crossings remain separate by several metres.
  const rate=yb-ya-triangle.gx*dx-triangle.gz*dz;
  if(!clip(tolerance-difference,-rate)||!clip(tolerance+difference,rate))return;
  return[low,high];
}

/** Exposed edge intervals at the requested inset. Markings test their actual
 * centerline; rails probe outside the deck to retain coincident outer edges. */
export function bridgeEdgeSections(city:CityData,road:Road,inset:number,probeInset=inset,levelTolerance=.8){
  if(!road.elevations)return[];
  const cells=deckIndex(city),parts:{a:Point2;b:Point2;ya:number;yb:number}[]=[];
  for(let i=1;i<road.points.length;i++)for(const side of [-1,1]){
    const a=deckEdge(road,i-1,side,inset),b=deckEdge(road,i,side,inset),ya=road.deckEdgeElevations?sampleRoadElevation(city,road,...a):deckEdgeElevation(road,i-1,side),yb=road.deckEdgeElevations?sampleRoadElevation(city,road,...b):deckEdgeElevation(road,i,side);
    const outsideA=deckEdge(road,i-1,side,probeInset),outsideB=deckEdge(road,i,side,probeInset);
    const probeYa=road.deckEdgeElevations?sampleRoadElevation(city,road,...outsideA):ya,probeYb=road.deckEdgeElevations?sampleRoadElevation(city,road,...outsideB):yb;
    const candidates=new Set<DeckTriangle>();
    for(let x=Math.floor(Math.min(outsideA[0],outsideB[0])/DECK_CELL);x<=Math.floor(Math.max(outsideA[0],outsideB[0])/DECK_CELL);x++)for(let z=Math.floor(Math.min(outsideA[1],outsideB[1])/DECK_CELL);z<=Math.floor(Math.max(outsideA[1],outsideB[1])/DECK_CELL);z++)for(const triangle of cells.get(`${x},${z}`)??[])if(triangle.road!==road)candidates.add(triangle);
    const covered:[number,number][]=[];
    for(const triangle of candidates){const interval=coveredDeckInterval(outsideA,outsideB,probeYa,probeYb,triangle,levelTolerance);if(interval)covered.push(interval);}
    covered.sort((a,b)=>a[0]-b[0]);
    const exposed:[number,number][]=[];let cursor=0;
    for(const [low,high]of covered){if(low>cursor)exposed.push([cursor,low]);cursor=Math.max(cursor,high);}
    if(cursor<1)exposed.push([cursor,1]);
    const dx=b[0]-a[0],dz=b[1]-a[1],dy=yb-ya,distance=Math.hypot(dx,dz),length=Math.hypot(distance,dy);
    for(const [start,end]of exposed){
      if((end-start)*length<.12)continue;
      parts.push({a:[a[0]+dx*start,a[1]+dz*start],b:[a[0]+dx*end,a[1]+dz*end],ya:ya+dy*start,yb:ya+dy*end});
    }
  }
  return parts;
}

export function bridgeBarriers(city:CityData,road:Road){
  if(isHarvardBridgeRoad(road))return[]; // Outer sidewalk parapets are built in harvard-bridge.ts.
  // The outside probe preserves protection on the union's exposed perimeter,
  // including where two source road ribbons share the same outer edge.
  return bridgeEdgeSections(city,road,.18,-.06).flatMap(({a,b,ya,yb})=>{
    const dx=b[0]-a[0],dz=b[1]-a[1],dy=yb-ya,distance=Math.hypot(dx,dz);
    const clear=(t:number)=>inTransitClearance(city,a[0]+dx*t,a[1]+dz*t,ya+dy*t),steps=Math.max(1,Math.ceil(distance/.4));
    const exposed:[number,number][]=[],boundary=(low:number,high:number,state:boolean)=>{
      for(let i=0;i<12;i++){const middle=(low+high)/2;if(clear(middle)===state)low=middle;else high=middle;}return(low+high)/2;
    };
    let previous=clear(0),start=0;
    for(let i=1;i<=steps;i++){
      const t=i/steps,current=clear(t);if(current===previous)continue;
      const edge=boundary((i-1)/steps,t,previous);if(!previous)exposed.push([start,edge]);else start=edge;previous=current;
    }
    if(!previous)exposed.push([start,1]);
    return exposed.filter(([lo,hi])=>(hi-lo)*distance>.12).map(([lo,hi])=>{
      const center=(lo+hi)/2;return{x:a[0]+dx*center,y:ya+dy*center+.38,z:a[1]+dz*center,length:Math.hypot(distance,dy)*(hi-lo)+.008,yaw:Math.atan2(dx,dz),slope:Math.atan2(dy,distance)};
    });
  });
}
