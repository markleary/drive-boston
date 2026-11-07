/** Static Orange Line and Haverhill Line track (public/data/rail.json, written by
 * scripts/build-rail-tracks.py): the document's types, a validity check, and the
 * non-visual queries the renderer and colliders share. Track distances are the
 * generator's arc lengths; `points` are top-of-rail samples at equal steps over
 * `length`, so sample k sits at k*length/(points.length-1). */

export type RailLine='orange'|'express'|'commuter'|'yard';
export interface RailSpan{start:number;end:number}
export interface RailCovered extends RailSpan{kind:'tunnel'|'underpass'}
/** `half`: deck half widths left/right of the centreline (to the midpoint toward a
 * parallel track's deck, else the full deck edge); `walls`: 1 where that side is open. */
export interface RailBridge extends RailSpan{piers:number[];kind:'deck'|'through';half:[number,number];walls:[number,number];over:string[]}
export interface RailTrack{
 id:string;line:RailLine;name:string;length:number;points:[number,number,number][];
 ends:[string,string];bridges:RailBridge[];covered:RailCovered[];crossings:RailSpan[];
 /** [start, end, side] runs of contact rail, side +1 right of the direction of travel. */
 thirdRail:[number,number,number][];
}
/** `ring` clockwise in plan; `edges[i]` the ring edge i to i+1 along a track; `canopy`
 * [x0, z0, x1, z1, width] down the platform's long axis. */
export interface RailPlatform{id:string;name:string;line:'orange'|'commuter';level:'orange'|'high'|'low';ring:[number,number][];top:number;edges:number[];canopy:[number,number,number,number,number]|null;island:boolean;covered:boolean}
/** A portal face at (x, z) facing `yaw` (out of the covered span), spanning `width`. */
export interface RailPortal{x:number;z:number;yaw:number;width:number;bottom:number;top:number;tor:number;kind:string;tracks:string[]}
/** A street crossed at grade: centre, road direction `yaw`, the tracks' extent along the road (`half`) and the road's half width. */
export interface RailCrossing{name:string;x:number;z:number;yaw:number;half:number;road:number;y:number;tracks:string[]}
/** A buffer stop facing `yaw`, out of the track end. */
export interface RailBumper{x:number;z:number;yaw:number;y:number;track:string}
export interface RailData{version:number;gauge:number;notes?:string;tracks:RailTrack[];platforms:RailPlatform[];portals:RailPortal[];crossings:RailCrossing[];bumpers:RailBumper[]}

const finite=(...values:unknown[])=>values.every(v=>typeof v==='number'&&Number.isFinite(v));
/** A rail document this build can draw (version 1, every track with at least two finite samples). */
export function isRailData(value:unknown):value is RailData{
 const d=value as RailData;
 if(!d||typeof d!=='object'||d.version!==1||!Array.isArray(d.tracks)||!Array.isArray(d.platforms)||!Array.isArray(d.portals)||!Array.isArray(d.crossings)||!Array.isArray(d.bumpers))return false;
 return d.tracks.every(t=>t&&typeof t.id==='string'&&finite(t.length)&&t.length>0&&Array.isArray(t.points)&&t.points.length>=2&&t.points.every(p=>Array.isArray(p)&&finite(p[0],p[1],p[2]))&&Array.isArray(t.bridges)&&Array.isArray(t.covered)&&Array.isArray(t.crossings)&&Array.isArray(t.thirdRail));
}

export interface RailSample{x:number;y:number;z:number;/** Unit plan tangent. */tx:number;tz:number;/** Rise per metre. */grade:number}
const inside=(spans:readonly RailSpan[],s:number)=>spans.find(p=>s>=p.start&&s<=p.end);

/** One track prepared for queries by distance along it. */
export class RailPath{
 readonly track:RailTrack;readonly step:number;
 constructor(track:RailTrack){this.track=track;this.step=track.length/(track.points.length-1);}
 get length(){return this.track.length;}
 /** Position, plan tangent and grade at distance s (clamped to the track). */
 sample(s:number,out:RailSample={x:0,y:0,z:0,tx:0,tz:1,grade:0}):RailSample{
  const p=this.track.points,n=p.length-1,f=Math.min(n,Math.max(0,s/this.step)),k=Math.min(n-1,Math.floor(f)),u=f-k,a=p[k],b=p[k+1];
  const dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz)||1;
  out.x=a[0]+dx*u;out.z=a[1]+dz*u;out.y=a[2]+(b[2]-a[2])*u;out.tx=dx/l;out.tz=dz/l;out.grade=(b[2]-a[2])/l;return out;
 }
 covered(s:number){return inside(this.track.covered,s) as RailCovered|undefined;}
 bridge(s:number){return inside(this.track.bridges,s) as RailBridge|undefined;}
 crossing(s:number){return inside(this.track.crossings,s);}
 /** The contact rail side at s (0 where there is none). */
 thirdRailSide(s:number){for(const [a,b,side]of this.track.thirdRail)if(s>=a&&s<=b)return side;return 0;}
 /** Span boundaries inside [from, to] where the drawn cross-section changes. */
 breaks(from:number,to:number){
  const out:number[]=[];
  for(const list of [this.track.bridges,this.track.covered,this.track.crossings])for(const p of list)for(const v of [p.start,p.end])if(v>from&&v<to)out.push(v);
  for(const [a,b]of this.track.thirdRail)for(const v of [a,b])if(v>from&&v<to)out.push(v);
  return out;
 }
}

/** Stations from `from` to `to` about `spacing` apart, with every span boundary between them included exactly. */
export function railStations(path:RailPath,from:number,to:number,spacing:number){
 const marks=[from,...path.breaks(from,to),to].sort((a,b)=>a-b),out:number[]=[];
 for(let i=0;i<marks.length-1;i++){
  const a=marks[i],b=marks[i+1];if(b-a<1e-6)continue;
  const n=Math.max(1,Math.ceil((b-a)/spacing));for(let k=0;k<n;k++)out.push(a+(b-a)*k/n);
 }
 out.push(to);return out;
}

/** Runs of the stations that share one drawing state: open track, on a bridge, or hidden in a covered span. */
export function railRuns(path:RailPath,stations:number[]){
 const runs:{kind:'open'|'bridge'|'covered';bridge?:RailBridge;stations:number[]}[]=[];
 for(let i=0;i<stations.length-1;i++){
  const mid=(stations[i]+stations[i+1])/2,bridge=path.bridge(mid),kind=path.covered(mid)?'covered':bridge?'bridge':'open',last=runs[runs.length-1];
  if(last&&last.kind===kind&&last.bridge===bridge)last.stations.push(stations[i+1]);else runs.push({kind,bridge,stations:[stations[i],stations[i+1]]});
 }
 return runs;
}

export interface RailCell{key:string;cx:number;cz:number;/** Track pieces: [track index, from, to]. */pieces:[number,number,number][];platforms:number[];portals:number[];crossings:number[];bumpers:number[]}
/** The document partitioned into square cells: each track segment belongs to the cell
 * of its midpoint (contiguous segments merge into pieces); every fixture to the cell of its anchor. */
export function railCells(data:RailData,size:number){
 const cells=new Map<string,RailCell>();
 const cellAt=(x:number,z:number)=>{
  const i=Math.floor(x/size),j=Math.floor(z/size),key=`${i},${j}`;let cell=cells.get(key);
  if(!cell)cells.set(key,cell={key,cx:(i+.5)*size,cz:(j+.5)*size,pieces:[],platforms:[],portals:[],crossings:[],bumpers:[]});return cell;
 };
 data.tracks.forEach((track,t)=>{
  const path=new RailPath(track),p=track.points;let open:[number,number,number]|undefined,openCell:RailCell|undefined;
  for(let k=0;k<p.length-1;k++){
   const cell=cellAt((p[k][0]+p[k+1][0])/2,(p[k][1]+p[k+1][1])/2),a=k*path.step,b=Math.min(track.length,(k+1)*path.step);
   if(open&&openCell===cell)open[2]=b;else{open=[t,a,b];openCell=cell;cell.pieces.push(open);}
  }
 });
 data.platforms.forEach((platform,i)=>{
  let x=0,z=0;for(const [px,pz]of platform.ring){x+=px;z+=pz;}cellAt(x/platform.ring.length,z/platform.ring.length).platforms.push(i);
 });
 data.portals.forEach((portal,i)=>cellAt(portal.x,portal.z).portals.push(i));
 data.crossings.forEach((crossing,i)=>cellAt(crossing.x,crossing.z).crossings.push(i));
 data.bumpers.forEach((bumper,i)=>cellAt(bumper.x,bumper.z).bumpers.push(i));
 return cells;
}

/** The nearest drawn (not covered) track point within `reach` of (x, z), for diagnostics and specs. */
export function nearestRail(paths:readonly RailPath[],x:number,z:number,reach=30){
 let best:{track:string;s:number;distance:number;y:number}|undefined;
 for(const path of paths){
  const p=path.track.points;
  for(let k=0;k<p.length-1;k++){
   const ax=p[k][0],az=p[k][1],dx=p[k+1][0]-ax,dz=p[k+1][1]-az;
   if(Math.min(ax,ax+dx)>x+reach||Math.max(ax,ax+dx)<x-reach||Math.min(az,az+dz)>z+reach||Math.max(az,az+dz)<z-reach)continue;
   const l2=dx*dx+dz*dz||1,u=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l2)),distance=Math.hypot(x-ax-dx*u,z-az-dz*u),s=(k+u)*path.step;
   if(distance<=reach&&(!best||distance<best.distance)&&!path.covered(s))best={track:path.track.id,s,distance,y:path.sample(s).y};
  }
 }
 return best;
}
