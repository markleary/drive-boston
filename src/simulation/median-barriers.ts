import type {CityData,Point2,Road} from '../types';
import {isHighwayDeck,stations} from './motorway.ts';
import {JERSEY,MOUTH_REACH,RAIL_RUN,deckEdge,deckEdgeElevation,roadProjection,sampleRoadElevation} from './road-surfaces.ts';

/** Two highway decks that run opposite ways with no more than this between their pavements (overlapping ones too) share one
 * median: a single barrier row stands between them and neither carries a rail of its own along that edge. Interstate 93's
 * pavements lie 0.9 m into each other to 1.9 m apart from the Somerville line to Roosevelt Circle and the Turnpike's 0.75 m
 * apart (the surveyed barrier's footprint) with bulges to 2.5 m; beyond 3 m the two roads part and each keeps its rail. */
export const MEDIAN_REACH=3;
/** ... and within this of one height, the height `bridgeEdgeSections` takes two decks for one surface up to. */
export const MEDIAN_LEVEL=.8;
/** A widening of up to this much beyond the reach is bridged where the two pavements come within reach again inside a rail's
 * run (`RAIL_RUN`) on both sides of it: the row carries on instead of giving way to two rails for a few metres (where the
 * Turnpike's carriageways part in East Boston what lies between them passes 3 m, comes back to 2 m and leaves for good). */
export const MEDIAN_WIDENING=1;
/** The foot laps this far onto each pavement and stands this far over the higher one (clear of the lane paint, 4 cm over a
 * deck, at any distance the depth buffer has to tell the two apart) and under the slabs' undersides. */
export const MEDIAN_LAP=.05,MEDIAN_FOOT=.06,MEDIAN_UNDER=.02;
/** The largest cosine between two directions of travel that still run opposite ways. Two that cross or part at an angle do
 * so at different levels or at a street landing; the slack is for surveyed pavements that jog (60 degrees off). */
const OPPOSED=-.5;

/** A deck that takes part in a median: a generated highway deck without a surveyed roadway. One with a `Road.roadway`
 * (Storrow Drive, a ramp between its curbs) is a street's pavement on its ground and carries no rail there either. */
const party=(road:Road)=>isHighwayDeck(road)&&!road.roadway;
/** A deck's ends on a street: the first `MOUTH_REACH` metres from one are the street's junction, as for its rails. */
const landings=(road:Road)=>[road.startLevel===0?road.points[0]:undefined,road.endLevel===0?road.points[road.points.length-1]:undefined].filter((p):p is Point2=>p!==undefined);

const CELL=64,indexes=new WeakMap<CityData,Map<string,Road[]>>();
function partiesNear(city:CityData,x:number,z:number){
  let cells=indexes.get(city);
  if(!cells){
    cells=new Map();
    for(const road of city.roads){
      if(!party(road))continue;const margin=Math.max(road.width,...(road.deckWidths??[]))/2+MEDIAN_REACH+1;
      for(let i=1;i<road.points.length;i++){
        const a=road.points[i-1],b=road.points[i];
        for(let cx=Math.floor((Math.min(a[0],b[0])-margin)/CELL);cx<=Math.floor((Math.max(a[0],b[0])+margin)/CELL);cx++)for(let cz=Math.floor((Math.min(a[1],b[1])-margin)/CELL);cz<=Math.floor((Math.max(a[1],b[1])+margin)/CELL);cz++){
          const key=`${cx},${cz}`,list=cells.get(key);if(!list)cells.set(key,[road]);else if(list[list.length-1]!==road)list.push(road);
        }
      }
    }
    indexes.set(city,cells);
  }
  return cells.get(`${Math.floor(x/CELL)},${Math.floor(z/CELL)}`)??[];
}

interface Facing {other:Road;gap:number;height:number}
/** The deck running the opposite way whose pavement lies nearest beyond a point (x, z, y) of `road`'s edge, (tx, tz) the
 * road's direction of travel there and (ox, oz) the unit normal out of its pavement: `gap` metres to that pavement (negative
 * inside it), `height` its surface. Undefined where none lies within `reach` and `MEDIAN_LEVEL`, and within a junction
 * mouth's reach of a street landing of either deck (two ramps leaving one street node part like its two halves). */
function facing(city:CityData,road:Road,x:number,z:number,y:number,tx:number,tz:number,ox:number,oz:number,reach:number){
  let best:Facing|undefined;
  for(const other of partiesNear(city,x,z)){
    if(other===road)continue;
    const hit=roadProjection(other,x,z),a=other.points[hit.index],b=other.points[hit.index+1]??a,dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz)||1;
    if((tx*dx+tz*dz)/length>OPPOSED)continue;
    // (beside it, not beyond its end: the record it carries on as takes over there, and half a metre of both closes the joint)
    if(hit.index===0&&hit.t<=0&&((x-a[0])*dx+(z-a[1])*dz)/length<-.5||hit.index>=other.points.length-2&&hit.t>=1&&((x-b[0])*dx+(z-b[1])*dz)/length>.5)continue;
    const wa=other.deckWidths?.[hit.index]??other.width,wb=other.deckWidths?.[hit.index+1]??other.width,gap=hit.distance-(wa+(wb-wa)*hit.t)/2;
    if(gap>reach||(hit.x-x)*ox+(hit.z-z)*oz<=0||best&&gap>=best.gap)continue;
    const height=sampleRoadElevation(city,other,x,z);
    if(Math.abs(height-y)>MEDIAN_LEVEL||landings(other).some(m=>Math.hypot(m[0]-x,m[1]-z)<MOUTH_REACH))continue;
    best={other,gap,height};
  }
  return best;
}

/** A cross-section of a median barrier: the middle of its row on the higher of the two pavements (x, z, y), the unit vector
 * across it from the deck that carries it toward the other (nx, nz), how far each pavement lies under `y` (the carrying
 * deck's, the other's) and half the width of its foot. */
export interface MedianSection {x:number;z:number;y:number;nx:number;nz:number;drop:[number,number];half:number}
interface Median {city:CityData;hidden:Map<string,[number,number][]>;runs:MedianSection[][]}
const medians=new WeakMap<Road,Median>();
/** Of two decks on one median the one that carries the row: the lower id, so that both name the same one whichever is asked. */
const carries=(road:Road,other:Road)=>road.id<other.id||road.id===other.id&&(road.points[0][0]-other.points[0][0]||road.points[0][1]-other.points[0][1])<0;

function median(city:CityData,road:Road){
  const cached=medians.get(road);if(cached?.city===city)return cached;
  const result:Median={city,hidden:new Map(),runs:[]};medians.set(road,result);
  if(!party(road)||road.points.length<2)return result;
  const mouths=landings(road),along=stations(road.points),last=road.points.length-1;
  for(const side of [-1,1]){
    // What faces a point of this edge between stations i - 1 and i (t beyond 0 to 1: the edge taken straight on past the record's end).
    const face=(i:number,t:number,reach:number)=>{
      const a=deckEdge(road,i-1,side),b=deckEdge(road,i,side),pa=road.points[i-1],pb=road.points[i],x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,u=Math.max(0,Math.min(1,t));
      let ox=(a[0]-pa[0])*(1-u)+(b[0]-pb[0])*u,oz=(a[1]-pa[1])*(1-u)+(b[1]-pb[1])*u;const length=Math.hypot(ox,oz)||1;ox/=length;oz/=length;
      const y=deckEdgeElevation(road,i-1,side)*(1-t)+deckEdgeElevation(road,i,side)*t;
      if(mouths.some(m=>Math.hypot(m[0]-x,m[1]-z)<MOUTH_REACH))return;
      // (travel runs along (oz, -ox) * side: deckEdge sets the edge off by (-dz, dx) * side)
      const found=facing(city,road,x,z,y,oz*side,-ox*side,ox,oz,reach);return found&&{...found,x,z,y,ox,oz};
    };
    // Whether the two come within reach `d` metres along the edge from that point, or within three more steps of `d`.
    const again=(i:number,t:number,d:number)=>{
      for(let k=1;k<=4;k++){
        let s=along[i-1]+(along[i]-along[i-1])*t+d*k,j=i;
        while(j<last&&along[j]<s)j++;while(j>1&&along[j-1]>s)j--;
        if(face(j,(s-along[j-1])/((along[j]-along[j-1])||1),MEDIAN_REACH))return true;
      }
      return false;
    };
    const probe=(i:number,t:number)=>{
      const found=face(i,t,MEDIAN_REACH+MEDIAN_WIDENING);if(!found||found.gap>MEDIAN_REACH&&!(again(i,t,-RAIL_RUN/4)&&again(i,t,RAIL_RUN/4)))return;
      const {x,z,y,ox,oz}=found,top=Math.max(y,found.height);
      return{other:found.other,section:{x:x+ox*found.gap/2,z:z+oz*found.gap/2,y:top,nx:ox,nz:oz,drop:[top-y,top-found.height],half:Math.max(JERSEY.base/2,found.gap/2+MEDIAN_LAP)} as MedianSection};
    };
    const faced=road.points.map((_,i)=>i?probe(i,1):probe(1,0));let run:MedianSection[]|undefined;
    for(let i=1;i<road.points.length;i++){
      let from=faced[i-1],to=faced[i],start=0,end=1;
      if(!from&&!to){run=undefined;continue;}
      if(!from||!to){
        // The stretch begins or ends between the two stations: where, to a millimetre of this 3 m.
        let inside=from?0:1,outside=1-inside,edge=from??to;
        for(let k=0;k<12;k++){const middle=(inside+outside)/2,found=probe(i,middle);if(found){inside=middle;edge=found;}else outside=middle;}
        if(from){end=inside;to=edge;}else{start=inside;from=edge;}
      }
      const a=from!.section,b=to!.section;
      if(Math.hypot(b.x-a.x,b.z-a.z)<.12){run=undefined;continue;}
      const key=`${i},${side}`,list=result.hidden.get(key);if(list)list.push([start,end]);else result.hidden.set(key,[[start,end]]);
      if(carries(road,from!.other)){
        if(run&&start===0)run.push(b);else result.runs.push(run=[a,b]);
        if(end<1)run=undefined;
      }else run=undefined;
    }
  }
  return result;
}

/** The stretches of a deck edge that lie on a median, as fractions of the edge from station `index - 1` to `index`:
 * neither deck carries a rail of its own there (`bridgeBarriers`). `city` is the whole city, never a tile's road view:
 * the deck across the median may lie outside one. */
export function medianStretches(city:CityData,road:Road){
  const {hidden}=median(city,road);return(index:number,side:number)=>hidden.get(`${index},${side}`);
}
/** The median barrier rows a deck carries, each a run of cross-sections along the middle line between its pavement edge
 * and that of the deck running the opposite way beside it. Exactly one of the two decks carries the row (`carries`),
 * whatever lies between them: pavements that overlap, a slot between two viaducts, a strip of ground. `city` is the
 * whole city. A run ends flat where the other deck ends, parts beyond `MEDIAN_REACH` or leaves the level. */
export function medianBarriers(city:CityData,road:Road){return median(city,road).runs;}

/** The barrier's outline at a cross-section, clockwise from its near bottom corner, as [metres across from the middle of
 * the row, metres over the higher pavement]: a foot from just under the slabs' undersides to `MEDIAN_FOOT` over the pavement,
 * as wide as what lies between the pavements, and the precast profile (`JERSEY`) standing on it. Where the foot is no wider
 * than the profile its top has no width and only its sides show: under the two slabs, or as the face of a step between them. */
function outline(s:MedianSection,thickness:number):[number,number][]{
  const b=JERSEY.base/2,t=JERSEY.top/2,h=JERSEY.height,bottom=-Math.max(s.drop[0],s.drop[1])-thickness-MEDIAN_UNDER,f=MEDIAN_FOOT;
  return[[-s.half,bottom],[-s.half,f],[-b,f],[-b,.075],[-t-.03,.33],[-t,h],[t,h],[t+.03,.33],[b,.075],[b,f],[s.half,f],[s.half,bottom]];
}
const END_FACE=[[0,1,2],[0,2,9],[0,9,10],[0,10,11],[2,3,8],[2,8,9],[3,4,7],[3,7,8],[4,5,6],[4,6,7]];
/** The rows as one closed triangle list (x, y, z per corner, wound outward), for drawing: each run lofted along its
 * sections with a face at both ends. `thickness` is the deck slab's. */
export function medianBarrierMesh(runs:readonly MedianSection[][],thickness=.75){
  const out:number[]=[],same=(a:number[],b:number[])=>a[0]===b[0]&&a[1]===b[1]&&a[2]===b[2];
  const triangle=(a:number[],b:number[],c:number[],flip:boolean)=>{if(same(a,b)||same(b,c)||same(a,c))return;if(flip)out.push(...a,...c,...b);else out.push(...a,...b,...c);};
  for(const run of runs){
    if(run.length<2)continue;
    const rings=run.map(s=>outline(s,thickness).map(([u,v])=>[s.x+s.nx*u,s.y+v,s.z+s.nz*u]));
    // (across, up, along) is right-handed where the other deck lies to the left of the run
    const righthanded=(k:number)=>{const a=run[Math.max(0,k-1)],b=run[Math.max(1,k)];return a.nx*(b.z-a.z)-a.nz*(b.x-a.x)>0;};
    for(let k=1;k<run.length;k++)for(let j=0;j<12;j++){
      const a=rings[k-1][j],b=rings[k-1][(j+1)%12],c=rings[k][(j+1)%12],d=rings[k][j],flip=righthanded(k);
      triangle(a,b,c,flip);triangle(a,c,d,flip);
    }
    for(const [i,j,k]of END_FACE){triangle(rings[0][i],rings[0][j],rings[0][k],!righthanded(1));const last=rings[rings.length-1];triangle(last[i],last[j],last[k],righthanded(run.length-1));}
  }
  return new Float32Array(out);
}
/** The rows as solid boxes, as `DrivingPhysics.addParapets` takes them (`length` along the heading `yaw`, pitched by
 * `slope`): the profile's full width from the lower pavement to its top and, where the foot is wider, the foot. */
export function medianBarrierBoxes(runs:readonly MedianSection[][],thickness=.75){
  const boxes:{x:number;y:number;z:number;yaw:number;slope:number;length:number;width:number;height:number}[]=[];
  for(const run of runs)for(let k=1;k<run.length;k++){
    const a=run[k-1],b=run[k],dx=b.x-a.x,dz=b.z-a.z,dy=b.y-a.y,distance=Math.hypot(dx,dz);if(distance<.01)continue;
    const placed={x:(a.x+b.x)/2,z:(a.z+b.z)/2,yaw:Math.atan2(dx,dz),slope:Math.atan2(dy,distance),length:Math.hypot(distance,dy)+.008},y=(a.y+b.y)/2;
    const drop=Math.max(a.drop[0],a.drop[1],b.drop[0],b.drop[1]),half=Math.max(a.half,b.half);
    boxes.push({...placed,y:y+(JERSEY.height-drop)/2,width:JERSEY.base,height:JERSEY.height+drop});
    if(half>JERSEY.base/2+.02)boxes.push({...placed,y:y+(MEDIAN_FOOT-drop-thickness)/2,width:half*2,height:MEDIAN_FOOT+drop+thickness});
  }
  return boxes;
}
