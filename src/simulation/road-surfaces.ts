import type {CityData,Point2,Road} from '../types';
import {isHarvardBridgeRoad} from './harvard-bridge.ts';
import {sampleElevation,sampleTerrainNormal,rotationFromNormal} from './terrain.ts';
import {inTransitClearance} from './transit-corridors.ts';
import {inTunnelPortal,openCutFloorAt,tunnelAt,tunnelsNear} from './tunnels.ts';
import {CLOSURE_SETBACK,LANE_WIDTH,isHighwayDeck,motorwayLanes,pointAtDistance,speedClass,stations} from './motorway.ts';
import {medianStretches} from './median-barriers.ts';

/** Bounding boxes of 16-segment runs of a long polyline (a highway deck has
 * hundreds of points and is projected for every car on it every step). */
const RUN=16,runBoxes=new WeakMap<object,{count:number;boxes:Float64Array}>();
function boxesOf(points:readonly Point2[]){
  let entry=runBoxes.get(points);
  if(!entry||entry.count!==points.length){
    const runs=Math.ceil((points.length-1)/RUN),boxes=new Float64Array(runs*4);
    for(let r=0;r<runs;r++){
      let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
      for(let i=r*RUN,end=Math.min(points.length-1,(r+1)*RUN);i<=end;i++){const p=points[i];if(p[0]<minX)minX=p[0];if(p[0]>maxX)maxX=p[0];if(p[1]<minZ)minZ=p[1];if(p[1]>maxZ)maxZ=p[1];}
      boxes[r*4]=minX;boxes[r*4+1]=minZ;boxes[r*4+2]=maxX;boxes[r*4+3]=maxZ;
    }
    entry={count:points.length,boxes};runBoxes.set(points,entry);
  }
  return entry.boxes;
}
const boxGap=(boxes:Float64Array,r:number,x:number,z:number)=>Math.hypot(Math.max(boxes[r*4]-x,0,x-boxes[r*4+2]),Math.max(boxes[r*4+1]-z,0,z-boxes[r*4+3]));
/** The nearest point of a polyline: every segment in order, the first of equal
 * distances winning. A long line skips the runs whose box lies farther than
 * the best segment of the nearest box, which cannot change the answer. */
export function roadProjection(road:Pick<Road,'points'>,x:number,z:number){
  const points=road.points,n=points.length;
  let distance=Infinity,index=0,t=0,px=points[0]?.[0]??x,pz=points[0]?.[1]??z;
  let boxes:Float64Array|undefined,bound=Infinity;
  if(n>RUN*3){
    boxes=boxesOf(points);let nearest=0,gap=Infinity;
    for(let r=0;r<boxes.length/4;r++){const g=boxGap(boxes,r,x,z);if(g<gap){gap=g;nearest=r;}}
    for(let i=nearest*RUN+1,end=Math.min(n-1,(nearest+1)*RUN);i<=end;i++){
      const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],len=dx*dx+dz*dz,u=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(len||1)));
      bound=Math.min(bound,Math.hypot(x-a[0]-dx*u,z-a[1]-dz*u));
    }
  }
  for(let i=1;i<n;i++){
    if(boxes&&(i-1)%RUN===0&&boxGap(boxes,(i-1)/RUN,x,z)>bound){i+=RUN-1;continue;}
    const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],len=dx*dx+dz*dz;
    const u=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(len||1))),qx=a[0]+dx*u,qz=a[1]+dz*u,d=Math.hypot(x-qx,z-qz);
    if(d<distance){distance=d;index=i-1;t=u;px=qx;pz=qz;}
  }
  return{distance,index,t,x:px,z:pz};
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
 * an overpass stays below it; explicit road IDs make deck destination resets unambiguous
 * (a survey trace's ID too: only sampleVehicleSurface picks one unasked). */
export function sampleDriveSurface(city:CityData,x:number,z:number,yReference=sampleElevation(city,x,z)+.4,roadId?:string){
  const registered=streamedSurfaces.get(city),chosen=roadId?city.roads?.find(r=>r.id===roadId)??city.surveyRoads?.find(r=>r.id===roadId)??registered?.get(roadId)?.road:undefined;
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
/** sampleDriveSurface for a vehicle's own support, which may be a drivable survey mesh
 * (the Zakim) where no road record lies: a trace over it (`city.surveyRoads`, within
 * 0.1 m of the mesh across its lanes) counts as the support there, so a car change, the
 * bike or a saved arrival keeps the deck and a knocked traffic car keeps its tyres on it.
 * Skid marks use it to find the deck but lie on the wheel's own contact with the mesh;
 * nothing else drawn or collided uses it. */
export function sampleVehicleSurface(city:CityData,x:number,z:number,yReference=sampleElevation(city,x,z)+.4,roadId?:string){
  const surface=sampleDriveSurface(city,x,z,yReference,roadId);
  if(roadId!==undefined&&surface.road?.id===roadId)return surface;
  let best=surface;
  for(const road of city.surveyRoads??[]){
    if(roadProjection(road,x,z).distance>roadWidthAt(road,x,z)/2+.05)continue;
    const h=sampleRoadElevation(city,road,x,z);
    if(h>best.height&&h<=yReference+.4)best={height:h,normal:roadNormal(city,road,x,z),road};
  }
  return best;
}

/** The generated highway decks that hold a point at about height `y` (within `reach`) and run the way (`dx`, `dz`) runs:
 * the deck a walled cut carries on as, or a sibling that forks from it and comes out of the ground a few metres earlier.
 * `margin` is how far beyond the deck's pavement edge the point may lie (negative: that far inside it, `DECK_LANES` for its
 * lanes). A cut's wall or curb that crosses such a deck's lanes does not stand in its pavement. The other carriageway
 * alongside runs the other way and is none of them: this test leaves alone what stands between the two, which is for
 * `bareStretches` in tunnels.ts to decide (a wall where it retains ground or guards a drop, a curb where the two lie level).
 * `cut` is the record the point belongs to: the deck that carries it on, or that it carries on, is none of them beyond
 * their common end. */
export function highwayDecksBeside(city:CityData,x:number,z:number,y:number,dx:number,dz:number,margin=DECK_LANES,cut?:Road,reach=.75){
  const decks:Road[]=[],same=(p:Point2,q:Point2)=>p[0]===q[0]&&p[1]===q[1];
  for(const road of elevatedNear(city,x,z)){
    if(!isHighwayDeck(road)||!road.elevations)continue;
    const hit=roadProjection(road,x,z),a=road.points[hit.index],b=road.points[Math.min(road.points.length-1,hit.index+1)],tx=b[0]-a[0],tz=b[1]-a[1],length=Math.hypot(tx,tz)||1;
    // Across the deck's line, also a lane's length before its first station or beyond its last: a sibling's wall ends in the
    // deck's mouth there. The walls of the cut the deck carries on from run up to it, though: where that cut is the
    // narrower of the two, the deck's width held back over its last metres would open them (Interstate 90 West in Allston).
    let across=hit.distance;
    if((hit.index===0&&hit.t<=1e-6)||(hit.index>=road.points.length-2&&hit.t>=1-1e-6)){
      const first=hit.t<=1e-6,end=first?a:b;
      if(cut&&same(end,first?cut.points[cut.points.length-1]:cut.points[0]))continue;
      if(Math.abs((x-end[0])*tx+(z-end[1])*tz)/length>LANE_WIDTH)continue;
      across=Math.abs((x-end[0])*tz-(z-end[1])*tx)/length;
    }
    if(across>roadWidthAt(road,x,z)/2+margin)continue;
    if(tx*dx+tz*dz<SAME_WAY*length*Math.hypot(dx,dz))continue;
    if(Math.abs(sampleRoadElevation(city,road,x,z)-y)<=reach)decks.push(road);
  }
  return decks;
}
/** A point in a deck's lanes lies this far inside its pavement edge at least (`highwayDecksBeside`). */
export const DECK_LANES=-.3;
/** Whether the line of any generated highway deck passes within `reach` of a point, by the boxes of its runs: the cheap
 * test before `highwayDecksBeside` is asked all along a wall (12 m covers the widest deck's pavement and its mouth). */
export function highwayDeckNear(city:CityData,x:number,z:number,reach=12){
  for(const road of elevatedNear(city,x,z)){
    if(!isHighwayDeck(road))continue;
    const boxes=boxesOf(road.points);
    for(let r=0;r<boxes.length/4;r++)if(boxGap(boxes,r,x,z)<reach)return true;
  }
  return false;
}
/** Cosine between two roads that run the same way (40 degrees). */
const SAME_WAY=.77;
/** The slab under a footbridge's deck (footbridges.py reckons the room under it with the same number). */
export const FOOTBRIDGE_SLAB=.22;
const footbridgeDecks=new WeakMap<object,{points:Point2[];elevations:number[];width:number;minX:number;maxX:number;minZ:number;maxZ:number}[]>();
/** The slab underside of the lowest deck standing over a point with its surface above `above` (a street bridge
 * over a highway's cut, parapets included, or a footbridge the city lists); Infinity where none does. Walls,
 * masts and signs beneath stop under it. */
export function deckUndersideAt(city:CityData,x:number,z:number,above:number){
  let under=Infinity;
  for(const road of elevatedNear(city,x,z)){
    if(!road.elevations||road.tunnel||roadProjection(road,x,z).distance>roadWidthAt(road,x,z)/2+.45)continue;
    const h=sampleRoadElevation(city,road,x,z);if(h>above)under=Math.min(under,h-(road.bridge?.thickness??.75));
  }
  if(city.footbridges?.length){
    let decks=footbridgeDecks.get(city.footbridges);
    if(!decks)footbridgeDecks.set(city.footbridges,decks=city.footbridges.map(d=>({...d,minX:Math.min(...d.points.map(p=>p[0])),maxX:Math.max(...d.points.map(p=>p[0])),minZ:Math.min(...d.points.map(p=>p[1])),maxZ:Math.max(...d.points.map(p=>p[1]))})));
    for(const deck of decks){
      const reach=deck.width/2+.45;if(x<deck.minX-reach||x>deck.maxX+reach||z<deck.minZ-reach||z>deck.maxZ+reach)continue;
      // A ramp that turns back passes over itself: every stretch over the point counts, not only the nearest.
      for(let i=1;i<deck.points.length;i++){
        const a=deck.points[i-1],b=deck.points[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
        if(Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)>reach)continue;
        const h=deck.elevations[i-1]+(deck.elevations[i]-deck.elevations[i-1])*t;if(h>above)under=Math.min(under,h-FOOTBRIDGE_SLAB);
      }
    }
  }
  return under;
}

/** Optional per-section widths taper shore ramps without a step in the deck edge. */
export function roadWidthAt(road:Road,x:number,z:number){
  if(!road.deckWidths)return road.width;
  const hit=roadProjection(road,x,z),a=road.deckWidths?.[hit.index]??road.width,b=road.deckWidths?.[hit.index+1]??road.width;return a+(b-a)*hit.t;
}
/** The surface of the generated highway deck whose pavement, or `margin` beyond its edge (a wall's thickness: a gap that narrow is
 * no drop, the cut's curb fills it), holds a point within `reach` of height `y`: beside the deck, not beyond its end. A cut that
 * runs beside such a deck has that pavement for its ground (`bareStretches` in tunnels.ts). */
export function highwayDeckAt(city:CityData,x:number,z:number,y:number,margin=.4,reach=1.5){
  let best:number|undefined;
  for(const road of elevatedNear(city,x,z)){
    if(!isHighwayDeck(road))continue;
    const hit=roadProjection(road,x,z),a=road.deckWidths?.[hit.index]??road.width,b=road.deckWidths?.[hit.index+1]??road.width;
    if(hit.distance>(a+(b-a)*hit.t)/2+margin||(hit.index===0&&hit.t<=0)||(hit.index>=road.points.length-2&&hit.t>=1))continue;
    const h=sampleRoadElevation(city,road,x,z);if(Math.abs(h-y)<=reach&&(best===undefined||Math.abs(h-y)<Math.abs(best-y)))best=h;
  }
  return best;
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
 * centerline; rails probe outside the deck to retain coincident outer edges.
 * `hidden` names further stretches to leave out, as fractions of the edge from
 * station `index - 1` to `index` (a median: `medianStretches`). */
export function bridgeEdgeSections(city:CityData,road:Road,inset:number,probeInset=inset,levelTolerance=.8,hidden?:(index:number,side:number)=>readonly [number,number][]|undefined){
  if(!road.elevations)return[];
  const cells=deckIndex(city),parts:{a:Point2;b:Point2;ya:number;yb:number;side:number;index:number}[]=[];
  for(let i=1;i<road.points.length;i++)for(const side of [-1,1]){
    const a=deckEdge(road,i-1,side,inset),b=deckEdge(road,i,side,inset),ya=road.deckEdgeElevations?sampleRoadElevation(city,road,...a):deckEdgeElevation(road,i-1,side),yb=road.deckEdgeElevations?sampleRoadElevation(city,road,...b):deckEdgeElevation(road,i,side);
    const outsideA=deckEdge(road,i-1,side,probeInset),outsideB=deckEdge(road,i,side,probeInset);
    const probeYa=road.deckEdgeElevations?sampleRoadElevation(city,road,...outsideA):ya,probeYb=road.deckEdgeElevations?sampleRoadElevation(city,road,...outsideB):yb;
    const candidates=new Set<DeckTriangle>();
    for(let x=Math.floor(Math.min(outsideA[0],outsideB[0])/DECK_CELL);x<=Math.floor(Math.max(outsideA[0],outsideB[0])/DECK_CELL);x++)for(let z=Math.floor(Math.min(outsideA[1],outsideB[1])/DECK_CELL);z<=Math.floor(Math.max(outsideA[1],outsideB[1])/DECK_CELL);z++)for(const triangle of cells.get(`${x},${z}`)??[])if(triangle.road!==road)candidates.add(triangle);
    const covered:[number,number][]=[...hidden?.(i,side)??[]];
    for(const triangle of candidates){const interval=coveredDeckInterval(outsideA,outsideB,probeYa,probeYb,triangle,levelTolerance);if(interval)covered.push(interval);}
    covered.sort((a,b)=>a[0]-b[0]);
    const exposed:[number,number][]=[];let cursor=0;
    for(const [low,high]of covered){if(low>cursor)exposed.push([cursor,low]);cursor=Math.max(cursor,high);}
    if(cursor<1)exposed.push([cursor,1]);
    const dx=b[0]-a[0],dz=b[1]-a[1],dy=yb-ya,distance=Math.hypot(dx,dz),length=Math.hypot(distance,dy);
    for(const [start,end]of exposed){
      if((end-start)*length<.12)continue;
      parts.push({a:[a[0]+dx*start,a[1]+dz*start],b:[a[0]+dx*end,a[1]+dz*end],ya:ya+dy*start,yb:ya+dy*end,side,index:i});
    }
  }
  return parts;
}

/** How far a deck edge must stand above the ground beside it before it gets a
 * parapet: about two curb heights. */
export const RAIL_LIP=.35;
/** A deck edge on the ground still gets its parapet when the ground falls more
 * than this, a rail's height, within `SHELF_REACH` metres of it: the graded
 * verge beside a bridge approach is a shelf a few metres wide over an
 * embankment (Alford Street climbing to the Mystic), not a street. */
export const SHELF_DROP=.75,SHELF_REACH=[4,7];
/** Within this distance of a junction the shelf test is waived: the ground
 * beyond a narrow cross street falls away too, and the crosswalk station lies
 * 8 m along the road, so a rail there would stand across its landing. */
export const MOUTH_REACH=12;
/** Beside a deck's paved roadway (`Road.roadway`) a rail stands only in runs this long, pieces closer than `RAIL_GAP` counting as one. */
export const RAIL_RUN=12,RAIL_GAP=.6;

/** Whether a deck edge at (x, z, y) sits on the ground: the terrain just outside
 * the rail and 1.5 m further out, along the unit outward normal (ox, oz), lies
 * within `RAIL_LIP` of it, and, away from a junction mouth, the terrain 4 and
 * 7 m out has not fallen away by more than `SHELF_DROP`. The rule for the
 * barriers and for the tests that sweep them. `ground` is the surface probed:
 * the terrain, unless the caller knows of another one there. */
export function deckEdgeGrounded(city:CityData,x:number,z:number,y:number,ox:number,oz:number,mouth=false,ground=(x:number,z:number)=>sampleElevation(city,x,z)){
  return y-ground(x+ox*.3,z+oz*.3)<RAIL_LIP&&y-ground(x+ox*1.5,z+oz*1.5)<RAIL_LIP&&(mouth||SHELF_REACH.every(reach=>y-ground(x+ox*reach,z+oz*reach)<SHELF_DROP));
}

const roadEnds=new WeakMap<CityData,Map<string,Road[]>>();
const endKey=(x:number,z:number)=>`${Math.round(x*2)},${Math.round(z*2)}`;
/** The road's endpoints that are street junctions: another road ends within
 * 0.5 m of them that is not the same street continuing (a bridge piece meeting
 * its own approach, like Alford Street's, has no crosswalk and is no mouth). */
export function junctionMouths(city:CityData,road:Road){
  let ends=roadEnds.get(city);
  if(!ends){ends=new Map();for(const r of city.roads)for(const p of [r.points[0],r.points[r.points.length-1]]){const k=endKey(p[0],p[1]);const list=ends.get(k);if(list)list.push(r);else ends.set(k,[r]);}roadEnds.set(city,ends);}
  const mouths:[number,number][]=[];
  for(const p of [road.points[0],road.points[road.points.length-1]]){
    const others:Road[]=[];
    for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const r of ends.get(`${Math.round(p[0]*2)+i},${Math.round(p[1]*2)+j}`)??[]){
      if(r===road||others.includes(r))continue;
      if([r.points[0],r.points[r.points.length-1]].some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<.5))others.push(r);
    }
    if(others.length>1||others.some(r=>r.name!==road.name))mouths.push([p[0],p[1]]);
  }
  return mouths;
}

/** Parapets along exposed deck edges. The limited-access I-93 decks keep their
 * concrete along embankments and through cuts, even where the terrain rises
 * to the shoulder. Their street landings still use the ground test. Other
 * structures lose the parapet wherever the deck sits on the ground: the first
 * metres of a ramp mouth, an at-grade approach or a preserved surface street run
 * within centimetres of the terrain: a 0.76 m wall there stands across the
 * junction's sidewalk and crosswalk landings (the Tobin ramps at New Rutherford
 * Avenue, the McGrath Highway stubs). `deckEdgeGrounded` probes the ground just
 * outside the rail, 1.5 m further out and up to 7 m out, so an edge beside a
 * drop, over water or on a narrow shelf above an embankment keeps its rail, while
 * the first `MOUTH_REACH` metres from a junction (`junctionMouths`) stay open
 * whatever lies beyond the cross street. Along a median, where a highway deck
 * running the opposite way lies within `MEDIAN_REACH` of the edge at its level,
 * neither deck has a rail of its own: one barrier row stands between the two
 * (`medianBarriers` in median-barriers.ts). `whole` is the whole city where
 * `city` is a tile's road view, which may not hold the deck across the median. */
export function bridgeBarriers(city:CityData,road:Road,whole=city){
  if(isHarvardBridgeRoad(road))return[]; // Outer sidewalk parapets are built in harvard-bridge.ts.
  const interstate=isHighwayDeck(road);
  const mouths=interstate
    ? [road.startLevel===0?road.points[0]:undefined,road.endLevel===0?road.points.at(-1):undefined].filter(p=>p!==undefined)
    : junctionMouths(city,road);
  // The outside probe preserves protection on the union's exposed perimeter,
  // including where two source road ribbons share the same outer edge.
  const along=road.roadway?stations(road.points):undefined;
  // A break in the surveyed roadway shorter than a rail's run, with roadway on both sides of it: its stretches are seams too (see below).
  const breaks=new Set<number>();
  if(road.roadway&&along)for(let i=1;i<road.roadway.length-1;i++){
    if(road.roadway[i])continue;let j=i;while(j+1<road.roadway.length&&!road.roadway[j+1])j++;
    if(road.roadway[i-1]&&j<road.roadway.length-1&&along[j+1]-along[i-1]<RAIL_RUN)for(let k=i+1;k<=j;k++)breaks.add(k);
    i=j;
  }
  const rails=bridgeEdgeSections(city,road,.18,-.06,.8,interstate?medianStretches(whole,road):undefined).flatMap(({a,b,ya,yb,side,index})=>{
    const dx=b[0]-a[0],dz=b[1]-a[1],dy=yb-ya,distance=Math.hypot(dx,dz),ox=-dz/(distance||1)*side,oz=dx/(distance||1)*side;
    // A highway deck on the ground with a surveyed roadway (`Road.roadway`: Storrow Drive, a ramp between its curbs) is a street's pavement there, not a railed carriageway.
    // Where that roadway begins or ends (a `seam`: one station of the two has none, the deck carries on as a walled cut there or goes under a bridge)
    // the edge is judged by its ground as well, the shelf beyond it included: a cut's side with nothing to retain has no wall (`bareStretches`
    // in tunnels.ts), and a rail's length would stand alone at every such joint.
    const surveyed=[!!road.roadway?.[index-1],!!road.roadway?.[index]],paved=surveyed[0]&&surveyed[1],seam=surveyed[0]!==surveyed[1]||breaks.has(index);
    // (beside such a roadway a probe in an open cut's excavation finds the higher of the terrain and the cut's floor: the cut's own wall rises to that
    // terrain where its floor lies lower, and a ramp that merges with the deck at its level is the same pavement, whatever the terrain between the two)
    const reach=SHELF_REACH[SHELF_REACH.length-1]+1,cuts=(paved||seam)&&tunnelsNear(city,Math.min(a[0],b[0])-reach,Math.max(a[0],b[0])+reach,Math.min(a[1],b[1])-reach,Math.max(a[1],b[1])+reach);
    const beside=cuts?(x:number,z:number)=>Math.max(sampleElevation(city,x,z),openCutFloorAt(city,x,z)??-Infinity):(x:number,z:number)=>sampleElevation(city,x,z);
    const grounded=(t:number)=>{
      const x=a[0]+dx*t,z=a[1]+dz*t,mouth=mouths.some(m=>Math.hypot(m[0]-x,m[1]-z)<MOUTH_REACH);
      // (on the terrain first: the cut's floor only ever stands in for lower ground, and most of a roadway lies on its own)
      return (!interstate||mouth||paved||seam)&&(deckEdgeGrounded(city,x,z,ya+dy*t,ox,oz,mouth||paved)||cuts&&deckEdgeGrounded(city,x,z,ya+dy*t,ox,oz,mouth||paved,beside));
    };
    const clear=(t:number)=>grounded(t)||inTransitClearance(city,a[0]+dx*t,a[1]+dz*t,ya+dy*t),steps=Math.max(1,Math.ceil(distance/.4));
    const exposed:[number,number][]=[],boundary=(low:number,high:number,state:boolean)=>{
      for(let i=0;i<12;i++){const middle=(low+high)/2;if(clear(middle)===state)low=middle;else high=middle;}return(low+high)/2;
    };
    let previous=clear(0),start=0;
    for(let i=1;i<=steps;i++){
      const t=i/steps,current=clear(t);if(current===previous)continue;
      const edge=boundary((i-1)/steps,t,previous);if(!previous)exposed.push([start,edge]);else start=edge;previous=current;
    }
    if(!previous)exposed.push([start,1]);
    const from=along?.[index-1]??0,span=along?along[index]-from:0;
    // (`drop`: how far the deck stands over the ground just outside along a rail at a seam)
    const drop=(lo:number,hi:number)=>Math.max(...[lo,(lo+hi)/2,hi].flatMap(t=>[.3,1.5].map(d=>ya+dy*t-beside(a[0]+dx*t+ox*d,a[1]+dz*t+oz*d))));
    return exposed.filter(([lo,hi])=>(hi-lo)*distance>.12).map(([lo,hi])=>{
      const center=(lo+hi)/2;return{x:a[0]+dx*center,y:ya+dy*center+.38,z:a[1]+dz*center,length:Math.hypot(distance,dy)*(hi-lo)+.008,yaw:Math.atan2(dx,dz),slope:Math.atan2(dy,distance),side,paved,seam,drop:seam?drop(lo,hi):0,from:from+lo*span,to:from+hi*span};
    });
  });
  if(!along)return rails;
  // Beside a paved roadway the ground comes and goes within RAIL_LIP of the deck (a twin carriageway a step lower, a verge the grid could not
  // bring up): a rail there stands only as a run of RAIL_RUN or more, or as part of one that goes on along a stretch with no roadway. No stubs.
  // A run with a rail at a seam is the end of what stands beyond the roadway: it stays where it guards a rail's height (`SHELF_DROP`), or makes
  // a run with what it carries on beyond the record's end (the wall of the cut the deck becomes): the same edge taken straight on at its end
  // grade, for as far as it still stands off its ground, as `bareStretches` measures the cut's wall at the same joint.
  const kept=new Set<number>(),total=along[along.length-1];
  const beyond=(side:number,atStart:boolean)=>{
    const i=atStart?0:road.points.length-1,j=atStart?1:i-1,e=deckEdge(road,i,side,.18),inner=deckEdge(road,j,side,.18),length=Math.hypot(e[0]-inner[0],e[1]-inner[1])||1,ux=(e[0]-inner[0])/length,uz=(e[1]-inner[1])/length;
    const y=deckEdgeElevation(road,i,side),grade=(y-deckEdgeElevation(road,j,side))/length,forward=atStart?-1:1,ox=-uz*forward*side,oz=ux*forward*side;
    let d=0;while(d<RAIL_RUN&&!deckEdgeGrounded(city,e[0]+ux*(d+1),e[1]+uz*(d+1),y+grade*(d+1),ox,oz,true))d++;
    return d;
  };
  for(const side of new Set(rails.map(r=>r.side))){
    const mine=rails.map((r,i)=>({r,i})).filter(e=>e.r.side===side).sort((p,q)=>p.r.from-q.r.from);let run:typeof mine=[];
    const close=()=>{
      if(run.length){
        const first=run[0].r,last=run.at(-1)!.r,span=last.to-first.from;
        const joined=()=>span+(first.from<RAIL_GAP?beyond(side,true):0)+(last.to>total-RAIL_GAP?beyond(side,false):0)>=RAIL_RUN;
        if(span>=RAIL_RUN||run.some(e=>!e.r.paved&&!e.r.seam)||run.some(e=>e.r.seam)&&(run.some(e=>e.r.drop>=SHELF_DROP)||joined()))for(const e of run)kept.add(e.i);
      }
      run=[];
    };
    for(const e of mine){if(run.length&&e.r.from-run.at(-1)!.r.to>RAIL_GAP)close();run.push(e);}
    close();
  }
  return rails.filter((_,i)=>kept.has(i));
}

/** A precast concrete barrier unit (New Jersey profile): height, base and top
 * widths, and the longest unit a closure row is divided into. */
export const JERSEY={height:1.07,base:.62,top:.2,length:3.8};
export interface ClosureUnit {x:number;y:number;z:number;yaw:number;roll:number;length:number}
/** The barrier row across a closed deck end (`Road.closed`), `CLOSURE_SETBACK`
 * metres in from it as at the tunnel caps: units spanning the whole deck, each
 * seated on it (x, y, z the middle of its base) and rolled to its crossfall,
 * `yaw` the road's heading with the unit's long axis across it; plus the row's
 * middle and `face`, the heading its face looks along (back up the open road),
 * for the reflectors and the closure sign. */
export function closedEndBarriers(city:CityData,road:Road){
  if(!road.closed||road.points.length<2)return;
  const along=stations(road.points),total=along[along.length-1],end=road.closed==='end';
  const station=end?Math.max(0,total-CLOSURE_SETBACK):Math.min(total,CLOSURE_SETBACK),{p,dir}=pointAtDistance(road.points,station,along);
  const width=roadWidthAt(road,p[0],p[1]),count=Math.max(1,Math.ceil(width/JERSEY.length)),length=width/count,rx=-dir[1],rz=dir[0],yaw=Math.atan2(dir[0],dir[1]),units:ClosureUnit[]=[];
  for(let k=0;k<count;k++){
    const c=length*(k+.5)-width/2,x=p[0]+rx*c,z=p[1]+rz*c,h=length/2;
    const left=sampleRoadElevation(city,road,x-rx*h,z-rz*h),right=sampleRoadElevation(city,road,x+rx*h,z+rz*h);
    units.push({x,y:(left+right)/2,z,yaw,roll:Math.atan2(left-right,length),length:length-.04});
  }
  return{units,station,width,x:p[0],y:sampleRoadElevation(city,road,p[0],p[1]),z:p[1],face:end?yaw+Math.PI:yaw};
}

/** Lane line offsets of a deck with a `lanes` count, right of the centreline
 * positive: the n + 1 edges of the lanes `motorwayLanes` centres. */
export function laneEdges(road:Road){
  const centres=motorwayLanes(road),spacing=centres.length>1?centres[1]-centres[0]:LANE_WIDTH;
  return[...centres.map(c=>c-spacing/2),centres[centres.length-1]+spacing/2];
}
const laneEndIndexes=new WeakMap<CityData,Map<string,Road[]>>();
/** The deck of the same class (carriageway or ramp) with a lane count that
 * continues `road` across its end (or leads into its start), heading its way. */
export function laneContinuation(city:CityData,road:Road,atEnd:boolean){
  let ends=laneEndIndexes.get(city);
  if(!ends){ends=new Map();for(const r of city.roads)if(r.lanes!==undefined&&r.points.length>1)for(const p of [r.points[0],r.points[r.points.length-1]]){const k=endKey(p[0],p[1]),list=ends.get(k);if(list)list.push(r);else ends.set(k,[r]);}laneEndIndexes.set(city,ends);}
  const n=road.points.length,sign=atEnd?1:-1,p=road.points[atEnd?n-1:0],q=road.points[atEnd?n-2:1],dx=(p[0]-q[0])*sign,dz=(p[1]-q[1])*sign,length=Math.hypot(dx,dz)||1;
  let best:Road|undefined,score=.9;
  for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const r of ends.get(`${Math.round(p[0]*2)+i},${Math.round(p[1]*2)+j}`)??[]){
    if(r===road||speedClass(r)!==speedClass(road))continue;
    const m=r.points.length,a=r.points[atEnd?0:m-1],b=r.points[atEnd?1:m-2];if(Math.hypot(a[0]-p[0],a[1]-p[1])>.5)continue;
    const ex=(b[0]-a[0])*sign,ez=(b[1]-a[1])*sign,cos=(dx*ex+dz*ez)/(length*(Math.hypot(ex,ez)||1));
    if(cos>score){score=cos;best=r;}
  }
  return best;
}
/** Measure the uninterrupted lane count across source splits, and carry the
 * dash phase across seams with a unique continuation in both directions. */
function laneMarkingChain(city:CityData,road:Road,atEnd:boolean){
  const seen=new Set([road]);
  let previous=road,next=laneContinuation(city,road,atEnd),distance=0,phase=0,boundary:Road|undefined;
  while(next&&!seen.has(next)){
    if(!boundary&&next.lanes!==road.lanes)boundary=next;
    if((atEnd&&boundary)||laneContinuation(city,next,!atEnd)!==previous)break;
    const length=stations(next.points).at(-1)??0;
    if(!boundary)distance+=length;
    if(!atEnd)phase=(phase+length)%LANE_DASH[1];
    seen.add(next);previous=next;next=laneContinuation(city,next,atEnd);
  }
  return{distance,phase,boundary};
}
/** Dashed lane dividers: 3 m of paint in every 12 m. */
export const LANE_DASH=[3,12];
export interface LaneLine {points:Point2[];color:'white'|'yellow';kind:'left'|'right'|'divider'}
/** Painted lines of a one-way deck with a `lanes` count, as polylines on it:
 * dashed dividers between the lanes and solid edge lines, white on the right
 * and yellow on the left. Where the same class of deck carries on with fewer
 * lanes, the extra ones taper out on the right over up to 150 m of the
 * continuous lane run while the others slide over to meet its lines. A very
 * short run cannot form a full-width extra lane between two tapers. A line is
 * cut where another deck covers it: a ramp's lines
 * inside the carriageway it leaves or joins and a carriageway's edge line across
 * a ramp's mouth; a carriageway's dividers give way only to another carriageway,
 * and the deck a line continues onto never cuts it. `continuationCity` keeps
 * tapers and dash phase continuous when clipping uses only tile-local roads. */
export function laneMarkings(city:CityData,road:Road,continuationCity=city){
  const lines:LaneLine[]=[];
  if(road.lanes===undefined||road.oneway===0||road.points.length<2)return lines;
  const own=laneEdges(road),n=own.length-1,along=stations(road.points),total=along[along.length-1],count=road.points.length;
  const neighbours=([false,true] as const).map(atEnd=>laneContinuation(continuationCity,road,atEnd));
  const [before,after]=([false,true] as const).map(atEnd=>laneMarkingChain(continuationCity,road,atEnd));
  const tapers=[before,after].flatMap(({boundary,distance},j)=>{
    const edges=boundary&&laneEdges(boundary);
    return edges&&edges.length<own.length?[{atEnd:j===1,distance,edges}]:[];
  });
  const laneRunLength=before.distance+total+after.distance;
  const taperShare=laneRunLength/Math.max(1,tapers.length);
  const sameTargets=tapers.length===2&&tapers[0].edges.length===tapers[1].edges.length&&tapers[0].edges.every((edge,k)=>edge===tapers[1].edges[k]);
  // The minimum reach allows the same taper to fade in and out without a
  // sharp jog where a lane count briefly spikes between two equal widths.
  const reach=Math.min(150,sameTargets?Math.max(60,taperShare):taperShare);
  const firstTaperedDivider=Math.min(n,...tapers.map(t=>t.edges.length-1));
  // At a seam the lines run square to the mean of both decks' headings, so they meet their continuation's.
  const unit=(a:Point2,b:Point2):Point2=>{const dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz)||1;return[dx/l,dz/l];};
  const seam=(i:number,j:number):Point2=>{const next=neighbours[j],own=unit([0,0],deckDirection(road,i) as Point2);if(!next||(j?road.deckTangents?.end:road.deckTangents?.start))return own;const m=next.points.length,other=j?unit(next.points[0],next.points[1]):unit(next.points[m-2],next.points[m-1]);return[own[0]+other[0],own[1]+other[1]];};
  const centre=road.points.map((p,i)=>{const [dx,dz]=i===0?seam(i,0):i===count-1?seam(i,1):deckDirection(road,i),l=Math.hypot(dx,dz)||1;return{p,rx:-dz/l,rz:dx/l};});
  const offsets=own.map((base,k)=>along.map((s,i)=>{
    let o=base;
    for(const t of tapers){const d=t.distance+(t.atEnd?total-s:s);if(d<reach){const u=1-d/reach;o+=(t.edges[Math.min(k,t.edges.length-1)]-o)*u*u*(3-2*u);}}
    const half=(road.deckWidths?.[i]??road.width)/2-.25;return Math.max(-half,Math.min(half,o));
  }));
  const cells=deckIndex(city),cls=speedClass(road);
  for(let k=0;k<=n;k++){
    const pts=centre.map(({p,rx,rz},i):Point2=>[p[0]+rx*offsets[k][i],p[1]+rz*offsets[k][i]]);
    const edge=k===0||k===n,cuts=(other:Road)=>!neighbours.includes(other)&&(edge||cls!==2||speedClass(other)===2),visible:[number,number][]=[];
    for(let i=1;i<count;i++){
      const covered:[number,number][]=[];
      if(k>=firstTaperedDivider&&!edge){
        // The extra divider would otherwise lie directly over the shoulder
        // line as its lane closes. Keep it where at least half a lane fits.
        const a=offsets[n][i-1]-offsets[k][i-1]-LANE_WIDTH/2,b=offsets[n][i]-offsets[k][i]-LANE_WIDTH/2;
        if(a<0&&b<0)continue;
        if(a<0)covered.push([0,a/(a-b)]);
        if(b<0)covered.push([a/(a-b),1]);
      }
      const a=pts[i-1],b=pts[i],ya=sampleRoadElevation(city,road,a[0],a[1]),yb=sampleRoadElevation(city,road,b[0],b[1]),candidates=new Set<DeckTriangle>();
      for(let x=Math.floor(Math.min(a[0],b[0])/DECK_CELL);x<=Math.floor(Math.max(a[0],b[0])/DECK_CELL);x++)for(let z=Math.floor(Math.min(a[1],b[1])/DECK_CELL);z<=Math.floor(Math.max(a[1],b[1])/DECK_CELL);z++)for(const triangle of cells.get(`${x},${z}`)??[])if(triangle.road!==road&&cuts(triangle.road))candidates.add(triangle);
      for(const triangle of candidates){const interval=coveredDeckInterval(a,b,ya,yb,triangle);if(interval)covered.push(interval);}
      covered.sort((p,q)=>p[0]-q[0]);
      let cursor=0;const span=along[i]-along[i-1],open=(lo:number,hi:number)=>{const s0=along[i-1]+span*lo,s1=along[i-1]+span*hi,last=visible[visible.length-1];if(last&&s0-last[1]<1e-6)last[1]=s1;else visible.push([s0,s1]);};
      for(const [lo,hi]of covered){if(lo>cursor)open(cursor,lo);cursor=Math.max(cursor,hi);}
      if(cursor<1)open(cursor,1);
    }
    const at=(s:number):Point2=>{let lo=0,hi=count-1;while(lo+1<hi){const mid=(lo+hi)>>1;if(along[mid]<s)lo=mid;else hi=mid;}const t=(s-along[lo])/((along[hi]-along[lo])||1);return[pts[lo][0]+(pts[hi][0]-pts[lo][0])*t,pts[lo][1]+(pts[hi][1]-pts[lo][1])*t];};
    const piece=(s0:number,s1:number)=>{if(s1-s0<.3)return;const points=[at(s0)];for(let i=0;i<count;i++)if(along[i]>s0+1e-6&&along[i]<s1-1e-6)points.push(pts[i]);points.push(at(s1));lines.push({points,color:k===0?'yellow':'white',kind:k===0?'left':k===n?'right':'divider'});};
    for(const [s0,s1]of visible){
      if(edge){piece(s0,s1);continue;}
      for(let d=Math.floor((s0+before.phase)/LANE_DASH[1])*LANE_DASH[1]-before.phase;d<s1;d+=LANE_DASH[1])piece(Math.max(s0,d),Math.min(s1,d+LANE_DASH[0]));
    }
  }
  return lines;
}
