import type { CityData, Point2, Road, TravelMode, VehicleState } from '../types';
import { sampleElevation } from './terrain.ts';
import { closestRoad } from './roads.ts';

/** GPS routing over every road centerline. The traffic graph (`roadGraph` in traffic.ts) leaves
 * out narrow side streets, so the GPS keeps its own graph: each road is split at every vertex it
 * shares with another road at the same level (within a metre, as in next-intersection.ts), so an
 * overpass never joins the street beneath it. A route is an A* search over directed edges, which
 * lets it price turns (left turns cost more than right ones) and refuse U-turns except at dead ends. */

export interface RouteEdge { a:number; b:number; road:Road; points:Point2[]; along:number[]; length:number; /** Seconds per metre at the road's assumed speed. */ pace:number; component:number; }
export interface RouteGraph { nodes:Point2[]; edges:RouteEdge[]; outStart:Int32Array; outList:Int32Array; degree:Int32Array; /** Unit headings per edge: start x,z then end x,z, in the a-to-b direction. */ headings:Float32Array; segments:Map<Road,{edge:Int32Array;offset:Float64Array}>; components:Map<Road,number>; main:number; }
/** A point on the graph: `offset` metres from the edge's `a` end. */
export interface RouteAnchor { edge:number; offset:number; point:Point2; distance:number; }
export type TurnDirection = 'straight'|'slight-left'|'slight-right'|'left'|'right'|'sharp-left'|'sharp-right'|'uturn';
export interface RouteStep { kind:'depart'|'turn'|'arrive'; /** Metres along the route where the maneuver starts. */ at:number; turn:TurnDirection; road:string|null; text:string; }
export interface RoutePlan { points:Point2[]; along:number[]; times:number[]; length:number; duration:number; steps:RouteStep[]; destination:Point2; /** Index of the destination anchor reached. */ target:number; /** True when no legal route existed and a one-way street is driven against its direction. */ wrongWay:boolean; }

/** Assumed speeds (m/s) by OpenStreetMap class; Boston GIS segments carry no class and go by width. */
const SPEEDS:Record<string,number> = { motorway:24.6, motorway_link:15.6, trunk:20.1, trunk_link:13.4, primary:13.4, primary_link:11.2, secondary:12.5, secondary_link:11.2, tertiary:11.6, tertiary_link:11.2, residential:11.2, unclassified:11.2, living_street:4.5 };
export const MAX_SPEED = 24.6;
const WRONG_WAY = 12, START_UTURN = 25, DEAD_END_UTURN = 25;
const minorRoad = (road:Road) => /alley|private|driveway|parking|service/i.test(road.name);
function speedOf(road:Road){
  if(minorRoad(road)) return 4.5;
  return SPEEDS[road.kind??''] ?? (road.width>=14?13.4:road.width>=10?12.5:road.width>=7?11.2:6.7);
}
const distance = (a:Point2,b:Point2) => Math.hypot(b[0]-a[0],b[1]-a[1]);
const key = (p:Point2) => `${Math.round(p[0]*2)},${Math.round(p[1]*2)}`;
function pointOn(edge:Pick<RouteEdge,'points'|'along'>,s:number):Point2{
  const {points,along}=edge;let i=1;while(i<along.length-1&&along[i]<s)i++;
  const a=points[i-1],b=points[i],span=along[i]-along[i-1]||1,t=Math.max(0,Math.min(1,(s-along[i-1])/span));
  return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
}
const unit = (a:Point2,b:Point2):Point2 => { const l=distance(a,b)||1; return [(b[0]-a[0])/l,(b[1]-a[1])/l]; };

const graphs = new WeakMap<CityData,RouteGraph>();
export function routeGraph(city:CityData):RouteGraph{
  const cached=graphs.get(city);if(cached)return cached;
  const nodes:Point2[]=[],heights:number[]=[],uses:number[]=[],buckets=new Map<string,number[]>();
  const nodeAt=(p:Point2,height:number)=>{
    const k=key(p),list=buckets.get(k);if(list)for(const n of list)if(Math.abs(heights[n]-height)<1)return n;
    const n=nodes.length;nodes.push(p);heights.push(height);uses.push(0);if(list)list.push(n);else buckets.set(k,[n]);return n;
  };
  const roads=city.roads.filter(road=>road.points.length>=2);
  const vertexNodes=roads.map(road=>{let previous=-1;return road.points.map((p,i)=>{const n=nodeAt(p,road.elevations?.[i]??sampleElevation(city,p[0],p[1]));if(n!==previous)uses[n]++;previous=n;return n;});});
  const edges:RouteEdge[]=[],segments=new Map<Road,{edge:Int32Array;offset:Float64Array}>();
  roads.forEach((road,r)=>{
    const ids=vertexNodes[r],edge=new Int32Array(road.points.length-1).fill(-1),offset=new Float64Array(road.points.length-1),pace=1/speedOf(road);
    let first=0;
    for(let i=1;i<ids.length;i++){
      if(i<ids.length-1&&uses[ids[i]]<2)continue;
      const points=road.points.slice(first,i+1),along=[0];for(let j=1;j<points.length;j++)along.push(along[j-1]+distance(points[j-1],points[j]));
      const length=along[along.length-1];
      if(length>.05){const id=edges.length;edges.push({a:ids[first],b:ids[i],road,points,along,length,pace,component:-1});for(let j=first;j<i;j++){edge[j]=id;offset[j]=along[j-first];}}
      first=i;
    }
    segments.set(road,{edge,offset});
  });
  // Directed edge d = 2e runs a to b and leaves a; d = 2e + 1 runs b to a and leaves b.
  const degree=new Int32Array(nodes.length),outStart=new Int32Array(nodes.length+1);
  for(const e of edges){degree[e.a]++;degree[e.b]++;outStart[e.a+1]++;outStart[e.b+1]++;}
  for(let i=0;i<nodes.length;i++)outStart[i+1]+=outStart[i];
  const outList=new Int32Array(edges.length*2),fill=outStart.slice(0,nodes.length);
  edges.forEach((e,i)=>{outList[fill[e.a]++]=2*i;outList[fill[e.b]++]=2*i+1;});
  const headings=new Float32Array(edges.length*4);
  edges.forEach((e,i)=>{const reach=Math.min(15,e.length),s=unit(e.points[0],pointOn(e,reach)),t=unit(pointOn(e,e.length-reach),e.points[e.points.length-1]);headings.set([s[0],s[1],t[0],t[1]],i*4);});
  // Undirected components: destinations snap to the largest so a click beside a stray survey patch still routes.
  const parent=Int32Array.from({length:nodes.length},(_,i)=>i),find=(i:number)=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  for(const e of edges){const x=find(e.a),y=find(e.b);if(x!==y)parent[x]=y;}
  const sizes=new Map<number,number>(),components=new Map<Road,number>();
  for(const e of edges){e.component=find(e.a);sizes.set(e.component,(sizes.get(e.component)??0)+e.length);components.set(e.road,e.component);}
  let main=-1,largest=-1;for(const [component,size] of sizes)if(size>largest){largest=size;main=component;}
  const graph={nodes,edges,outStart,outList,degree,headings,segments,components,main};graphs.set(city,graph);return graph;
}

function project(graph:RouteGraph,road:Road,x:number,z:number):RouteAnchor|undefined{
  const segment=graph.segments.get(road);if(!segment)return undefined;
  let best:RouteAnchor|undefined;
  for(let j=0;j<road.points.length-1;j++){
    if(segment.edge[j]<0)continue;
    const a=road.points[j],b=road.points[j+1],dx=b[0]-a[0],dz=b[1]-a[1],len2=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/len2));
    const point:Point2=[a[0]+dx*t,a[1]+dz*t],d=Math.hypot(point[0]-x,point[1]-z);
    if(!best||d<best.distance)best={edge:segment.edge[j],offset:segment.offset[j]+Math.sqrt(len2)*t,point,distance:d};
  }
  return best;
}
/** The nearest point of the main road network to (x,z). With a height (the player's), stacked
 * carriageways and tunnels are told apart; without one, as for a map click, only surface roads count. */
export function anchorAt(city:CityData,x:number,z:number,height?:number):RouteAnchor|undefined{
  const graph=routeGraph(city),near=closestRoad(city,x,z,false,{height,accept:p=>graph.components.get(p.road)===graph.main});
  return Number.isFinite(near.distance)?project(graph,near.road,x,z):undefined;
}
/** Surface streets around a map click, nearest first: the nearest and up to `count - 1` others within
 * `reach` metres more. Routing picks the first one it can reach legally, since a few source
 * one-ways start at a dead end or have no legal way in (the Science Park stub, Cambridge Street at Harvard). */
export function destinationAnchors(city:CityData,x:number,z:number,count=6,reach=60):RouteAnchor[]{
  const graph=routeGraph(city),out:RouteAnchor[]=[],used=new Set<Road>();
  for(let k=0;k<count;k++){
    const near=closestRoad(city,x,z,false,{maxDistance:out.length?out[0].distance+reach:Infinity,accept:p=>!used.has(p.road)&&graph.components.get(p.road)===graph.main});
    if(!Number.isFinite(near.distance)||used.has(near.road))break;
    used.add(near.road);const anchor=project(graph,near.road,x,z);if(anchor)out.push(anchor);
  }
  return out;
}

const allowed = (graph:RouteGraph,d:number) => { const oneway=graph.edges[d>>1].road.oneway; return d&1?oneway<=0:oneway>=0; };
const endNode = (graph:RouteGraph,d:number) => d&1?graph.edges[d>>1].a:graph.edges[d>>1].b;
/** Signed turn angle (radians, right positive) from arriving on directed edge `from` to leaving on `to`. World z runs south, so a positive cross product is a clockwise, right-hand turn on the map. */
function turnAngle(graph:RouteGraph,from:number,to:number){
  const h=graph.headings,i=(from>>1)*4,o=(to>>1)*4;
  const ix=from&1?-h[i]:h[i+2],iz=from&1?-h[i+1]:h[i+3],ox=to&1?-h[o+2]:h[o],oz=to&1?-h[o+3]:h[o+1];
  return Math.atan2(ix*oz-iz*ox,ix*ox+iz*oz);
}
function turnCost(angle:number){const a=Math.abs(angle);return a<.52?0:a<1.05?3:a<2.44?(angle>0?6:10):16;}

/** Seconds added per metre an alternative destination lies further from the click than the nearest one. */
const DETOUR = .5;
/** Directed edges to the cheapest of `targets` and the index of the one reached, or null when none can be. */
function search(graph:RouteGraph,from:RouteAnchor,targets:RouteAnchor[],heading:number|undefined,wrongWay:boolean){
  const {edges,nodes,outStart,outList,degree}=graph,count=edges.length*2,target=targets[0].point,nearest=Math.min(...targets.map(t=>t.distance));
  const byEdge=new Map<number,number[]>();targets.forEach((t,i)=>{const list=byEdge.get(t.edge);if(list)list.push(i);else byEdge.set(t.edge,[i]);});
  const extra=(i:number)=>(targets[i].distance-nearest)*DETOUR;
  const g=new Float64Array(count).fill(Infinity),previous=new Int32Array(count).fill(-1),closed=new Uint8Array(count);
  let heapKeys=new Float64Array(1024),heapValues=new Int32Array(1024),size=0;
  const push=(k:number,v:number)=>{
    if(size===heapKeys.length){const keys=new Float64Array(size*2),values=new Int32Array(size*2);keys.set(heapKeys);values.set(heapValues);heapKeys=keys;heapValues=values;}
    let i=size++;while(i>0){const p=(i-1)>>1;if(heapKeys[p]<=k)break;heapKeys[i]=heapKeys[p];heapValues[i]=heapValues[p];i=p;}heapKeys[i]=k;heapValues[i]=v;
  };
  const pop=()=>{
    const top=heapValues[0],k=heapKeys[--size],v=heapValues[size];let i=0;
    for(;;){let c=2*i+1;if(c>=size)break;if(c+1<size&&heapKeys[c+1]<heapKeys[c])c++;if(heapKeys[c]>=k)break;heapKeys[i]=heapKeys[c];heapValues[i]=heapValues[c];i=c;}
    heapKeys[i]=k;heapValues[i]=v;return top;
  };
  const pace=(d:number)=>edges[d>>1].pace*(allowed(graph,d)?1:WRONG_WAY);
  const usable=(d:number)=>wrongWay||allowed(graph,d);
  const estimate=(n:number)=>distance(nodes[n],target)/MAX_SPEED;
  let best=Infinity,via=-1,last=-1,reached=-1;
  const startEdge=edges[from.edge];
  for(const dir of [0,1]){
    const d=2*from.edge+dir;if(!usable(d))continue;
    // Setting off against the car's heading means turning around first.
    let penalty=0;if(heading!==undefined){const h=graph.headings,i=from.edge*4,fx=Math.sin(heading),fz=Math.cos(heading),sx=h[i]+h[i+2],sz=h[i+1]+h[i+3];if((sx*fx+sz*fz)*(dir?-1:1)<-.3*Math.hypot(sx,sz))penalty=START_UTURN;}
    const cost=(dir?from.offset:startEdge.length-from.offset)*pace(d)+penalty;
    g[d]=cost;previous[d]=-2;push(cost+estimate(endNode(graph,d)),d);
    for(const i of byEdge.get(from.edge)??[]){const to=targets[i];if(dir?to.offset<=from.offset:to.offset>=from.offset){const direct=Math.abs(to.offset-from.offset)*pace(d)+penalty+extra(i);if(direct<best){best=direct;via=-2;last=d;reached=i;push(direct,-1);}}}
  }
  while(size){
    const d=pop();if(d===-1)break;if(closed[d])continue;closed[d]=1;
    const node=endNode(graph,d);
    for(let k=outStart[node];k<outStart[node+1];k++){
      const o=outList[k];if(!usable(o))continue;
      let turn:number;
      if(o===(d^1)){if(degree[node]>1)continue;turn=DEAD_END_UTURN;}else turn=turnCost(turnAngle(graph,d,o));
      const e=edges[o>>1],base=g[d]+turn;
      for(const i of byEdge.get(o>>1)??[]){const to=targets[i],cost=base+(o&1?e.length-to.offset:to.offset)*pace(o)+extra(i);if(cost<best){best=cost;via=d;last=o;reached=i;push(best,-1);}}
      const cost=base+e.length*pace(o);
      if(cost<g[o]){g[o]=cost;previous[o]=d;push(cost+estimate(endNode(graph,o)),o);}
    }
  }
  if(last<0)return null;
  const sequence=[last];for(let d=via;d>=0;d=previous[d])sequence.push(d);
  return {sequence:sequence.reverse(),reached};
}

/** The fastest route from `from` to one of `to` (the nearest preferred). `heading` (the car's yaw)
 * prices setting off backwards; `target` (the clicked point) decides which side the destination is on. */
export function planRoute(city:CityData,from:RouteAnchor,to:RouteAnchor|RouteAnchor[],options:{heading?:number;target?:Point2}={}):RoutePlan|null{
  const graph=routeGraph(city),targets=Array.isArray(to)?to:[to];if(!targets.length)return null;
  let wrongWay=false,found=search(graph,from,targets,options.heading,false);
  if(!found){found=search(graph,from,targets,options.heading,true);wrongWay=true;}
  if(!found)return null;
  const {sequence}=found,end=targets[found.reached];
  const points:Point2[]=[],along:number[]=[],times:number[]=[],legs:Leg[]=[];
  sequence.forEach((d,k)=>{
    const e=graph.edges[d>>1],reverse=(d&1)===1;
    // Metres along the edge in its own a-to-b direction where this piece of the route starts and ends.
    const u0=k===0?from.offset:reverse?e.length:0,u1=k===sequence.length-1?end.offset:reverse?0:e.length;
    const lo=Math.min(u0,u1),hi=Math.max(u0,u1),piece:Point2[]=[pointOn(e,lo)];
    for(let i=1;i<e.points.length-1;i++)if(e.along[i]>lo&&e.along[i]<hi)piece.push(e.points[i]);
    piece.push(pointOn(e,hi));if(reverse)piece.reverse();
    const pace=e.pace*(allowed(graph,d)?1:WRONG_WAY),start=along.length?along[along.length-1]:0;
    for(const p of piece){
      if(!points.length){points.push(p);along.push(0);times.push(0);continue;}
      const step=distance(points[points.length-1],p);if(step<.05)continue;
      points.push(p);along.push(along[along.length-1]+step);times.push(times[times.length-1]+step*pace);
    }
    legs.push({road:e.road,start,end:along[along.length-1],node:endNode(graph,d)});
  });
  if(points.length<2){points.push(end.point);along.push(0);times.push(0);}
  const length=along[along.length-1];
  const plan:RoutePlan={points,along,times,length,duration:times[times.length-1],steps:[],destination:end.point,target:found.reached,wrongWay};
  let uturn=false;
  if(options.heading!==undefined&&length>1){const [dx,dz]=direction(plan,0,Math.min(15,length));uturn=dx*Math.sin(options.heading)+dz*Math.cos(options.heading)<-.3;}
  plan.steps=routeSteps(plan,legs,graph,{uturn,target:options.target});
  return plan;
}

interface Leg { road:Road; start:number; end:number; node:number; }
/** Street name as the HUD says it: the first part of a compound name, `null` for an unnamed way. */
export function streetName(road:Pick<Road,'name'>){const name=road.name.split(' · ')[0].trim();return !name||/^unnamed\b/i.test(name)?null:name;}
const isRamp = (road:Road) => /_link$/.test(road.kind??'')||/\b(ramp|entrance|exit)\b/i.test(road.name);
const SUFFIXES:Record<string,string> = { Street:'St', Avenue:'Ave', Boulevard:'Blvd', Road:'Rd', Drive:'Dr', Place:'Pl', Square:'Sq', Parkway:'Pkwy', Highway:'Hwy', Lane:'Ln', Court:'Ct', Terrace:'Ter', Expressway:'Expy', Turnpike:'Tpke', Circle:'Cir' };
/** "Boylston Street" to "Boylston St", the way a navigation display abbreviates it. */
export function abbreviateStreet(name:string){return name.replace(/\b(\w+)$/,word=>SUFFIXES[word]??word);}

export function pointAlong(plan:Pick<RoutePlan,'points'|'along'>,s:number):Point2{
  const {points,along}=plan;let lo=0,hi=along.length-1;
  while(lo+1<hi){const mid=(lo+hi)>>1;if(along[mid]<=s)lo=mid;else hi=mid;}
  const a=points[lo],b=points[hi],span=along[hi]-along[lo]||1,t=Math.max(0,Math.min(1,(s-along[lo])/span));
  return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
}
function direction(plan:Pick<RoutePlan,'points'|'along'>,s0:number,s1:number):Point2{return unit(pointAlong(plan,s0),pointAlong(plan,s1));}
function signedAngle(a:Point2,b:Point2){return Math.atan2(a[0]*b[1]-a[1]*b[0],a[0]*b[0]+a[1]*b[1]);}
export function classifyTurn(angle:number):TurnDirection{
  const a=Math.abs(angle)*180/Math.PI,side=angle>0?'right':'left';
  return a<20?'straight':a<45?`slight-${side}`:a<140?side:a<170?`sharp-${side}`:'uturn';
}
const COMPASS = ['north','northeast','east','southeast','south','southwest','west','northwest'];
/** Compass word for a heading vector in world axes (x east, z south). */
export function compass(dx:number,dz:number){const bearing=(Math.atan2(dx,-dz)*180/Math.PI+360)%360;return COMPASS[Math.round(bearing/45)%8];}

function turnText(turn:TurnDirection,road:string|null,ramp:boolean,fromRamp=false){
  const side=turn.endsWith('left')?'left':'right',name=road?abbreviateStreet(road):null;
  const onto=name?` on ${name}`:ramp?' onto the ramp':'';
  if(fromRamp&&name&&/^(straight|slight)/.test(turn))return `Merge onto ${name}`;
  switch(turn){
    case 'straight': return name?`Continue on ${name}`:ramp?'Take the ramp':'Continue straight';
    case 'slight-left':case 'slight-right': return ramp&&!name?`Take the ramp on the ${side}`:`Bear ${side}${onto}`;
    case 'left':case 'right': return `Turn ${side}${onto}`;
    case 'sharp-left':case 'sharp-right': return `Make a sharp ${side}${onto}`;
    default: return `Make a U-turn${name?` on ${name}`:''}`;
  }
}

/** Maneuvers along a route. Consecutive pieces of one street merge; an unnamed connector or a
 * named stub shorter than 25 m between two streets folds into the turn onto the next street; a
 * piece named apart from the street it carries straight on both ends (the Harvard Bridge on
 * Massachusetts Avenue) folds into that street; and a street that turns at an intersection keeping
 * its name still gets an instruction. */
function routeSteps(plan:RoutePlan,legs:Leg[],graph:RouteGraph,options:{uturn:boolean;target?:Point2}):RouteStep[]{
  interface Run { name:string|null; ramp:boolean; start:number; end:number; joins:number[]; }
  const runs:Run[]=[];
  for(const leg of legs){
    const name=streetName(leg.road),last=runs[runs.length-1];
    if(last&&last.name===name){last.joins.push(last.end);last.end=leg.end;last.ramp||=isRamp(leg.road);}
    else runs.push({name,ramp:isRamp(leg.road),start:leg.start,end:leg.end,joins:[]});
  }
  // Each join records where one leg meets the next; keep the node to test for an intersection.
  const nodeAt=new Map<number,number>();for(const leg of legs)nodeAt.set(leg.end,leg.node);
  const length=plan.length,steps:RouteStep[]=[];
  const angleAt=(before:number,after:number)=>signedAngle(direction(plan,Math.max(0,before-20),before),direction(plan,after,Math.min(length,after+20)));
  const straight=(at:number)=>classifyTurn(angleAt(at,at))==='straight';
  for(let i=1;i<runs.length-1;i++)if(runs[i].name&&runs[i].end-runs[i].start<25&&runs[i].name!==runs[i-1].name&&runs[i].name!==runs[i+1].name)runs[i].name=null;
  for(let i=1;i<runs.length;i++){
    const a=runs[i-1],b=runs[i],c=runs[i+1];
    if(c&&a.name!==null&&a.name===c.name&&(b.name===null||(straight(b.start)&&straight(b.end)))){a.joins.push(a.end,b.end,...b.joins,...c.joins);a.end=c.end;a.ramp||=b.ramp||c.ramp;runs.splice(i,2);i--;continue;}
    if(a.name===b.name){a.joins.push(a.end,...b.joins);a.end=b.end;a.ramp||=b.ramp;runs.splice(i,1);i--;}
  }
  const add=(at:number,after:number,road:string|null,ramp:boolean,fromRamp:boolean)=>{
    if(at<1||at>length-1)return;
    const turn=classifyTurn(angleAt(at,after)),previous=steps.length?steps[steps.length-1].road:runs[0].name;
    if(turn==='straight'&&(road===previous||(!road&&!ramp)))return;
    steps.push({kind:'turn',at,turn,road,text:turnText(turn,road,ramp,fromRamp)});
  };
  for(let i=1;i<runs.length;i++){
    const run=runs[i],next=runs[i+1];
    if(run.name===null&&next&&run.end-run.start<=60){add(run.start,run.end,next.name,run.ramp||next.ramp,runs[i-1].ramp);i++;continue;}
    add(run.start,run.start,run.name,run.ramp,runs[i-1].ramp);
  }
  // A street that turns at an intersection without changing its name.
  for(const run of runs)if(run.name)for(const at of run.joins){
    const node=nodeAt.get(at);if(node===undefined||graph.degree[node]<3||steps.some(step=>Math.abs(step.at-at)<20))continue;
    const angle=angleAt(at,at);if(Math.abs(angle)>.96){const turn=classifyTurn(angle);steps.push({kind:'turn',at,turn,road:run.name,text:turnText(turn,run.name,false)});}
  }
  steps.sort((a,b)=>a.at-b.at);
  const first=runs[0]?.name??null,[dx,dz]=direction(plan,0,Math.min(20,length));
  steps.unshift({kind:'depart',at:0,turn:options.uturn?'uturn':'straight',road:first,text:options.uturn?'Make a U-turn':`Head ${compass(dx,dz)}${first?` on ${abbreviateStreet(first)}`:''}`});
  let arrive='Arrive at your destination';
  if(options.target&&length>2){const end=plan.points[plan.points.length-1],[hx,hz]=direction(plan,Math.max(0,length-15),length),ox=options.target[0]-end[0],oz=options.target[1]-end[1];if(Math.hypot(ox,oz)>4)arrive=`Your destination is on the ${hx*oz-hz*ox>0?'right':'left'}`;}
  steps.push({kind:'arrive',at:length,turn:'straight',road:null,text:arrive});
  return steps;
}

/** What the HUD shows: the next maneuver and what remains of the trip. */
export interface Guidance { mode:'road'|'direct'; step:RouteStep|null; /** Metres to the next maneuver (or, flying, to the destination). */ distance:number; remaining:number; /** Seconds of driving left at the assumed street speeds. */ time:number; /** Flying: the destination's bearing relative to the heading, radians, right positive. */ bearing?:number; heading?:string; arrived?:boolean; }
/** Metres: leaving the route by more recalculates; arriving within ends guidance; a click further than SNAP from any street sets nothing. */
const OFF_ROUTE = 35, ARRIVE = 15, ARRIVE_FLYING = 40, REROUTE_EVERY = 2000, SNAP = 400;

/** A destination and the route to it, kept current as the player drives: progress follows the
 * route, leaving it (or driving the wrong way along it) recalculates, and flying shows the
 * straight line instead of streets. */
export function createNavigator(city:CityData){
  // `anchors` are the streets around the click; once a route reaches one legally it is kept alone so the pin stays put.
  let destination:{target:Point2;anchors:RouteAnchor[];all:RouteAnchor[]}|null=null,plan:RoutePlan|null=null;
  let progress=0,index=0,lastRoute=-Infinity,offSince=-1,wrongSince=-1,flying=false,reroutes=0,position:Point2=[0,0];
  function route(state:VehicleState,now:number){
    lastRoute=now;offSince=-1;wrongSince=-1;progress=0;index=0;
    if(!destination)return;
    const from=anchorAt(city,state.x,state.z,state.y),options={heading:state.speed<-1?state.yaw+Math.PI:state.yaw,target:destination.target};
    let targets=destination.anchors;plan=from?planRoute(city,from,targets,options):null;
    if(from&&plan?.wrongWay&&targets.length<destination.all.length){targets=destination.all;plan=planRoute(city,from,targets,options);}
    if(!plan)return;
    if(!plan.wrongWay)destination.anchors=[targets[plan.target]];
    track(state,true);
  }
  /** Moves `progress` to the player's projection on the route, searching a window ahead of the last one. */
  function track(state:VehicleState,full=false){
    if(!plan)return Infinity;
    const {points,along}=plan,limit=full?points.length-1:Math.min(points.length-1,index+400);
    let best=Infinity,bestIndex=index,bestS=progress;
    for(let i=full?0:Math.max(0,index-3);i<limit;i++){
      if(!full&&along[i]>progress+250)break;
      const a=points[i],b=points[i+1],dx=b[0]-a[0],dz=b[1]-a[1],len2=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((state.x-a[0])*dx+(state.z-a[1])*dz)/len2));
      const d=Math.hypot(a[0]+dx*t-state.x,a[1]+dz*t-state.z);if(d<best){best=d;bestIndex=i;bestS=along[i]+Math.sqrt(len2)*t;}
    }
    index=bestIndex;progress=bestS;return best;
  }
  return {
    /** Snaps (x,z) to the nearest surface street and plans a route there. Returns the snapped point, or null with no street nearby. */
    setDestination(x:number,z:number,state:VehicleState,travel:TravelMode,now=performance.now()):Point2|null{
      const anchors=destinationAnchors(city,x,z);if(!anchors.length||anchors[0].distance>SNAP)return null;
      destination={target:[x,z],anchors,all:anchors};plan=null;flying=travel==='helicopter';position=[state.x,state.z];
      if(!flying)route(state,now);
      return destination.anchors[0].point;
    },
    clear(){destination=null;plan=null;progress=0;index=0;},
    get active(){return !!destination;},
    get destination(){return destination?.anchors[0].point??null;},
    /** Name of the street the destination is on, or null for an unnamed way. */
    get street(){return destination?streetName(routeGraph(city).edges[destination.anchors[0].edge].road):null;},
    get plan(){return flying?null:plan;},
    /** The route still ahead of the player, for the maps: the straight line while flying. */
    remaining():Point2[]{
      if(!destination)return [];
      if(flying||!plan)return [position,destination.anchors[0].point];
      const out:Point2[]=[pointAlong(plan,progress)];for(let i=index+1;i<plan.points.length;i++)out.push(plan.points[i]);return out;
    },
    update(state:VehicleState,travel:TravelMode,now=performance.now()):Guidance|null{
      if(!destination)return null;
      position=[state.x,state.z];
      const target=destination.anchors[0].point;
      if(travel==='helicopter'){
        flying=true;const dx=target[0]-state.x,dz=target[1]-state.z,d=Math.hypot(dx,dz);
        const fx=Math.sin(state.yaw),fz=Math.cos(state.yaw),bearing=Math.atan2(fx*dz-fz*dx,fx*dx+fz*dz);
        return {mode:'direct',step:null,distance:d,remaining:d,time:0,bearing,heading:compass(dx,dz),arrived:d<ARRIVE_FLYING};
      }
      if(flying||!plan){flying=false;route(state,now);}
      if(!plan)return {mode:'road',step:null,distance:Math.hypot(target[0]-state.x,target[1]-state.z),remaining:0,time:0};
      const off=track(state);
      // Off the route: recalculate at once after a teleport, otherwise once it has lasted a moment.
      if(off>OFF_ROUTE){if(offSince<0)offSince=now;if((off>150||now-offSince>1200)&&now-lastRoute>REROUTE_EVERY){reroutes++;route(state,now);}}else offSince=-1;
      if(plan&&plan.length>1){
        const [dx,dz]=direction(plan,Math.max(0,progress-5),Math.min(plan.length,progress+5)),forward=(dx*Math.sin(state.yaw)+dz*Math.cos(state.yaw))*Math.sign(state.speed);
        if(forward<-.5&&Math.abs(state.speed)>2){if(wrongSince<0)wrongSince=now;if(now-wrongSince>2500&&now-lastRoute>REROUTE_EVERY){reroutes++;route(state,now);}}else wrongSince=-1;
      }
      if(!plan)return null;
      const remaining=Math.max(0,plan.length-progress);
      const timeAt=(()=>{const {along,times}=plan;let i=Math.max(0,Math.min(index,along.length-2));const span=along[i+1]-along[i]||1;return times[i]+(times[i+1]-times[i])*Math.max(0,Math.min(1,(progress-along[i])/span));})();
      const arrived=remaining<ARRIVE||Math.hypot(target[0]-state.x,target[1]-state.z)<ARRIVE;
      // The depart step stays up only while it asks for a U-turn; otherwise show the next maneuver ahead.
      const step=plan.steps.find(s=>s.kind==='depart'?s.turn==='uturn'&&progress<10:s.at>progress+2)??plan.steps[plan.steps.length-1];
      return {mode:'road',step,distance:Math.max(0,step.at-progress),remaining,time:Math.max(0,plan.duration-timeAt),arrived};
    },
    snapshot(){return {active:!!destination,destination:destination?.anchors[0].point??null,target:destination?.target??null,flying,progress,reroutes,length:plan?.length??0,duration:plan?.duration??0,wrongWay:plan?.wrongWay??false,steps:plan?.steps.map(s=>({...s}))??[]};},
  };
}
export type Navigator = ReturnType<typeof createNavigator>;
