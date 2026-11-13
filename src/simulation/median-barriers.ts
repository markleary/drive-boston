import type {CityData,Point2,Road} from '../types';
import {isHighwayDeck,stations} from './motorway.ts';
import {JERSEY,MOUTH_REACH,RAIL_LIP,RAIL_RUN,deckEdge,deckEdgeElevation,roadProjection,sampleRoadElevation} from './road-surfaces.ts';
import {sampleElevation} from './terrain.ts';
import {decksLieOpen,tunnelCoveredAt,tunnelStations} from './tunnels.ts';

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
/** Two walled cuts whose pavements overlap share a median up to this far apart in height: `unionWalls` takes each one's wall
 * out of the other's excavation whatever their levels, which leaves a bare ledge between the two roads (the Turnpike's west
 * of the Prudential tunnel, 0.8 to 1.0 m). Decks further apart than `MEDIAN_LEVEL` have their own rails. */
export const MEDIAN_STEP=1.5;
/** Where two pavements overlap a step apart the higher slab ends in a ledge inside the lower road, and the row stands on
 * that ledge instead of on the middle of the overlap: not at all up to the first height, all the way from the second. */
export const MEDIAN_LEDGE=[.1,.35];
/** Ground that stands in the strip between two pavements (one of them a cut's: a deck's ground is graded under it) is
 * covered by the foot up to `RAIL_LIP` over the higher pavement, this much over the ground. Higher ground is retained by
 * the cut's own wall as before, and the row gives way to it (`blockedStretches`). */
export const MEDIAN_COVER=.03;

/** A deck that takes part in a median: a generated highway deck without a surveyed roadway. One with a `Road.roadway`
 * (Storrow Drive, a ramp between its curbs) is a street's pavement on its ground and carries no rail there either. */
const deckParty=(road:Road)=>isHighwayDeck(road)&&!road.roadway;
/** A walled cut takes part like a deck along its open stretches, where its road's decks are such decks: a `highway` tunnel
 * record of a carriageway that is railed along the ground (`decksLieOpen` in tunnels.ts says which roads are not; the
 * Turnpike's carriageways are). Its own wall is not built along the median (`medianSpans`, `tunnelGeometry`). */
const cutParty=(city:CityData,road:Road)=>!!road.tunnel&&!!road.highway&&road.lanes!==undefined&&!!road.elevations&&!decksLieOpen(city,road);
const party=(city:CityData,road:Road)=>road.tunnel?cutParty(city,road):deckParty(road);
/** A deck's ends on a street: the first `MOUTH_REACH` metres from one are the street's junction, as for its rails. */
const landings=(road:Road)=>[road.startLevel===0?road.points[0]:undefined,road.endLevel===0?road.points[road.points.length-1]:undefined].filter((p):p is Point2=>p!==undefined);

const CELL=64,indexes=new WeakMap<CityData,Map<string,Road[]>>();
function partiesNear(city:CityData,x:number,z:number){
  let cells=indexes.get(city);
  if(!cells){
    cells=new Map();
    for(const road of city.roads){
      if(!party(city,road))continue;const margin=Math.max(road.width,...(road.deckWidths??[]))/2+MEDIAN_REACH+1;
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
    // (a cut takes part where it is open to the sky)
    if(other.tunnel&&tunnelCoveredAt(other,tunnelStations(other)[hit.index]+length*hit.t))continue;
    const height=sampleRoadElevation(city,other,x,z);
    if(Math.abs(height-y)>(gap<=0&&road.tunnel&&other.tunnel?MEDIAN_STEP:MEDIAN_LEVEL)||landings(other).some(m=>Math.hypot(m[0]-x,m[1]-z)<MOUTH_REACH))continue;
    best={other,gap,height};
  }
  return best;
}

/** A cross-section of a median barrier: the middle of its row on the higher of the two pavements (x, z, y), the unit vector
 * across it from the deck that carries it toward the other (nx, nz), how far each pavement lies under `y` (the carrying
 * deck's, the other's) and half the width of its foot; `foot` where its top stands higher than `MEDIAN_FOOT`, over ground in the strip. */
export interface MedianSection {x:number;z:number;y:number;nx:number;nz:number;drop:[number,number];half:number;foot?:number}
interface Median {city:CityData;hidden:Map<string,[number,number][]>;runs:MedianSection[][]}
const medians=new WeakMap<Road,Median>();
/** Of two decks on one median the one that carries the row: the lower id, so that both name the same one whichever is asked. */
const carries=(road:Road,other:Road)=>road.id<other.id||road.id===other.id&&(road.points[0][0]-other.points[0][0]||road.points[0][1]-other.points[0][1])<0;

/** How far the ground that is drawn between two pavements stands over `top`, along the line from a point of one's edge
 * (unit normal (ox, oz) out of its pavement) to the other's, `gap` metres on. The terrain is cut away 0.3 m beyond a cut's
 * pavement (its portal), so only what lies beyond that counts, and a deck's pavement covers what the foot laps onto.
 * -Infinity where no ground is left between the two. */
function stripRise(city:CityData,x:number,z:number,ox:number,oz:number,gap:number,top:number,cut:boolean,otherCut:boolean){
  const from=cut?.3:MEDIAN_LAP,to=gap-(otherCut?.3:MEDIAN_LAP);if(to<=from)return -Infinity;
  let rise=-Infinity;const count=Math.max(1,Math.ceil((to-from)/.25));
  for(let k=0;k<=count;k++){const d=from+(to-from)*k/count;rise=Math.max(rise,sampleElevation(city,x+ox*d,z+oz*d)-top);}
  return rise;
}
/** A point of a record's edge between stations i - 1 and i: where, how high, and the unit normal out of its pavement. */
function edgePoint(road:Road,i:number,t:number,side:number){
  const a=deckEdge(road,i-1,side),b=deckEdge(road,i,side),pa=road.points[i-1],pb=road.points[i],u=Math.max(0,Math.min(1,t));
  let ox=(a[0]-pa[0])*(1-u)+(b[0]-pb[0])*u,oz=(a[1]-pa[1])*(1-u)+(b[1]-pb[1])*u;const length=Math.hypot(ox,oz)||1;ox/=length;oz/=length;
  return{x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,y:deckEdgeElevation(road,i-1,side)*(1-t)+deckEdgeElevation(road,i,side)*t,ox,oz};
}
const blockedSides=new WeakMap<Road,{city:CityData;sides:Map<number,[number,number][]>}>();
/** The stretches of one side of a record, by station, where it shares no median with the party that faces it although that
 * party is within reach, one of the two a cut. Ground stands more than `RAIL_LIP` over the higher pavement in the strip
 * between them: under a street bridge and at a portal the terrain between two cuts is the street's or the roof's, and the
 * cuts' own walls hold it as before. Or the strip is clear for less than a rail's run (`RAIL_RUN`) with no median either
 * side of it: a row that short would stand alone between two walls. Reckoned every metre along the record that carries
 * the row and asked of that record by both (`blocked`), so the two agree where the row gives way. */
function blockedStretches(city:CityData,road:Road,side:number){
  let known=blockedSides.get(road);if(!known||known.city!==city)blockedSides.set(road,known={city,sides:new Map()});
  const cached=known.sides.get(side);if(cached)return cached;
  const out:[number,number][]=[],along=stations(road.points);known.sides.set(side,out);
  // every metre: 0 nothing faces the edge, 1 a median between two decks, 2 a median with a cut on one side or both, 3 ground in the strip
  const at:number[]=[],state:number[]=[];
  for(let i=1;i<road.points.length;i++){
    const length=along[i]-along[i-1],count=Math.max(1,Math.ceil(length));
    for(let k=i===1?0:1;k<=count;k++){
      const t=k/count,s=along[i-1]+length*t,e=edgePoint(road,i,t,side);at.push(s);
      const found=road.tunnel&&tunnelCoveredAt(road,s)?undefined:facing(city,road,e.x,e.z,e.y,e.oz*side,-e.ox*side,e.ox,e.oz,MEDIAN_REACH);
      state.push(!found?0:!road.tunnel&&!found.other.tunnel?1:stripRise(city,e.x,e.z,e.ox,e.oz,found.gap,Math.max(e.y,found.height),!!road.tunnel,!!found.other.tunnel)<=RAIL_LIP?2:3);
    }
  }
  // (a short clear stretch that reaches an end of the record may carry on in the next one: only one that lies within it is judged)
  for(let j=0;j<state.length;j++){
    if(state[j]!==1&&state[j]!==2)continue;let k=j;while(k+1<state.length&&(state[k+1]===1||state[k+1]===2))k++;
    if(j>0&&k<state.length-1&&at[k]-at[j]<RAIL_RUN&&state.slice(j,k+1).includes(2))state.fill(3,j,k+1);
    j=k;
  }
  for(let j=0;j<state.length;j++){if(state[j]!==3)continue;const last=out[out.length-1];if(last&&at[j]-last[1]<1.5)last[1]=at[j]+.5;else out.push([at[j]-.5,at[j]+.5]);}
  return out;
}
/** Whether ground stands in the strip at a point (x, z) of `road`'s edge on `side`, facing `other`: asked of the record that carries the row. */
function blocked(city:CityData,road:Road,side:number,station:number,other:Road,x:number,z:number){
  if(!road.tunnel&&!other.tunnel)return false;
  if(carries(road,other))return blockedStretches(city,road,side).some(([a,b])=>station>=a&&station<=b);
  const hit=roadProjection(other,x,z),a=other.points[hit.index],b=other.points[hit.index+1]??a,length=Math.hypot(b[0]-a[0],b[1]-a[1]);
  // (deckEdge sets the edge off by (-dz, dx) * side: the side of `other` this point lies on)
  const facingSide=(x-hit.x)*-(b[1]-a[1])+(z-hit.z)*(b[0]-a[0])>0?1:-1,s=tunnelStations(other)[hit.index]+length*hit.t;
  return blockedStretches(city,other,facingSide).some(([lo,hi])=>s>=lo&&s<=hi);
}

function median(city:CityData,road:Road){
  const cached=medians.get(road);if(cached?.city===city)return cached;
  const result:Median={city,hidden:new Map(),runs:[]};medians.set(road,result);
  if(!party(city,road)||road.points.length<2)return result;
  const mouths=landings(road),along=stations(road.points),last=road.points.length-1;
  for(const side of [-1,1]){
    // What faces a point of this edge between stations i - 1 and i (t beyond 0 to 1: the edge taken straight on past the record's end).
    const face=(i:number,t:number,reach:number)=>{
      const {x,z,y,ox,oz}=edgePoint(road,i,t,side),station=along[i-1]+(along[i]-along[i-1])*Math.max(0,Math.min(1,t));
      if(mouths.some(m=>Math.hypot(m[0]-x,m[1]-z)<MOUTH_REACH))return;
      // (a cut takes part where it is open to the sky)
      if(road.tunnel&&tunnelCoveredAt(road,station))return;
      // (travel runs along (oz, -ox) * side: deckEdge sets the edge off by (-dz, dx) * side)
      const found=facing(city,road,x,z,y,oz*side,-ox*side,ox,oz,reach);
      // (and not where ground stands between the two pavements, which a cut's own wall holds)
      return found&&!blocked(city,road,side,station,found.other,x,z)?{...found,x,z,y,ox,oz}:undefined;
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
      const {x,z,y,ox,oz,gap}=found,top=Math.max(y,found.height),step=y-found.height;
      // Along the normal this record's edge is at 0 and the other's at `gap`. Where the two overlap a step apart, the row moves from the middle
      // of the overlap to the higher pavement's edge, its base flush with the slab's face (`MEDIAN_LEDGE`).
      const w=gap<0?Math.max(0,Math.min(1,(Math.abs(step)-MEDIAN_LEDGE[0])/(MEDIAN_LEDGE[1]-MEDIAN_LEDGE[0]))):0,ledge=step>0?-JERSEY.base/2:gap+JERSEY.base/2,place=gap/2+(ledge-gap/2)*w*w*(3-2*w);
      const section:MedianSection={x:x+ox*place,z:z+oz*place,y:top,nx:ox,nz:oz,drop:[top-y,top-found.height],half:Math.max(JERSEY.base/2,gap/2+MEDIAN_LAP)};
      if(road.tunnel||found.other.tunnel){
        // (ground in the strip, here and a step along the edge either way: the foot's top is lofted between sections)
        let rise=stripRise(city,x,z,ox,oz,gap,top,!!road.tunnel,!!found.other.tunnel);
        for(const d of [-1.5,1.5])rise=Math.max(rise,stripRise(city,x-oz*d,z+ox*d,ox,oz,gap,top,!!road.tunnel,!!found.other.tunnel));
        if(rise+MEDIAN_COVER>MEDIAN_FOOT)section.foot=Math.min(RAIL_LIP,rise)+MEDIAN_COVER;
      }
      return{other:found.other,section};
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
/** The stretches of one side of a record that lie on a median, by station along it: a cut builds no wall of its own there
 * (`tunnelGeometry`), as a deck has no rail. */
export function medianSpans(city:CityData,road:Road,side:number){
  const {hidden}=median(city,road),along=stations(road.points),out:[number,number][]=[];
  for(let i=1;i<road.points.length;i++)for(const [a,b]of hidden.get(`${i},${side}`)??[]){
    const from=along[i-1]+(along[i]-along[i-1])*a,to=along[i-1]+(along[i]-along[i-1])*b,last=out[out.length-1];
    if(last&&from-last[1]<1e-6)last[1]=Math.max(last[1],to);else out.push([from,to]);
  }
  return out;
}

/** The barrier's outline at a cross-section, clockwise from its near bottom corner, as [metres across from the middle of
 * the row, metres over the higher pavement]: a foot from just under the slabs' undersides to `MEDIAN_FOOT` over the pavement,
 * as wide as what lies between the pavements, and the precast profile (`JERSEY`) standing on it. Where the foot is no wider
 * than the profile its top has no width and only its sides show: under the two slabs, or as the face of a step between them. */
function outline(s:MedianSection,thickness:number):[number,number][]{
  const b=JERSEY.base/2,t=JERSEY.top/2,h=JERSEY.height,bottom=-Math.max(s.drop[0],s.drop[1])-thickness-MEDIAN_UNDER,f=s.foot??MEDIAN_FOOT;
  // (a foot raised over ground in the strip buries the profile's toe)
  return[[-s.half,bottom],[-s.half,f],[-b,f],[-b,Math.max(f,.075)],[-t-.03,Math.max(f,.33)],[-t,h],[t,h],[t+.03,Math.max(f,.33)],[b,Math.max(f,.075)],[b,f],[s.half,f],[s.half,bottom]];
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
    const foot=Math.max(a.foot??MEDIAN_FOOT,b.foot??MEDIAN_FOOT);
    if(half>JERSEY.base/2+.02)boxes.push({...placed,y:y+(foot-drop-thickness)/2,width:half*2,height:foot+drop+thickness});
  }
  return boxes;
}
