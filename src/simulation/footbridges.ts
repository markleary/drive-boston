import type {CityData,ParkPath,Point2,Road} from '../types';
import {sampleElevation} from './terrain.ts';
import {pointInside} from './roads.ts';
import {FOOTBRIDGE_SLAB,roadProjection,roadWidthAt,sampleRoadElevation} from './road-surfaces.ts';
export {FOOTBRIDGE_SLAB};

/** One profile for the visible slab and wheel/aircraft collision. A path with
 * stored heights (a bridge over a road: build-footbridges.py) is its deck as
 * stored; any other is one arch between its ends on the ground. Keep mapped
 * bends and meet the adjoining path instead of straightening the span. */
export function footbridgeRoad(city:CityData,path:ParkPath):Road|undefined{
  if(!path.bridge||path.points.length<2)return;
  // Tiles own only their clipped fragment, but its arch and shore datums belong
  // to the complete crossing. A tile seam must never become a new landing.
  const profile=path.bridgePoints??path.points;
  const distances=[0];
  for(let i=1;i<profile.length;i++)distances.push(distances[i-1]+Math.hypot(profile[i][0]-profile[i-1][0],profile[i][1]-profile[i-1][1]));
  const length=distances.at(-1)!;if(length<1)return;
  const locate=(p:Point2)=>{
    let best={distance:Infinity,along:0,index:0,t:0};
    for(let i=1;i<profile.length;i++){
      const a=profile[i-1],b=profile[i],dx=b[0]-a[0],dz=b[1]-a[1],square=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(square||1))),distance=Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);
      if(distance<best.distance)best={distance,along:distances[i-1]+Math.sqrt(square)*t,index:i-1,t};
    }return best;
  };
  const stored=path.elevations?.length===path.points.length;
  // A stored line names its own stations: only its two ends are looked up on the complete crossing, for the seam's direction.
  const locations=stored?[locate(path.points[0]),locate(path.points.at(-1)!)]:path.points.map(locate),direction=locations.at(-1)!.along>=locations[0].along?1:-1;
  const tangent=(hit:ReturnType<typeof locate>):Point2=>{
    const vertex=hit.t<1e-6?hit.index:hit.t>1-1e-6?hit.index+1:undefined;
    const a=profile[vertex===undefined?hit.index:Math.max(0,vertex-1)],b=profile[vertex===undefined?hit.index+1:Math.min(profile.length-1,vertex+1)];
    return[(b[0]-a[0])*direction,(b[1]-a[1])*direction];
  };
  const deckTangents=path.bridgePoints?{start:tangent(locations[0]),end:tangent(locations.at(-1)!)}:undefined,bridge={id:path.id,thickness:FOOTBRIDGE_SLAB,clearanceEstimated:true};
  if(stored)return{id:`footbridge:${path.id}`,name:path.name||'Footbridge',points:path.points,elevations:path.elevations!,width:path.width,oneway:0,deckTangents,bridge};
  const points:Point2[]=[],elevations:number[]=[],start=sampleElevation(city,...profile[0])+.052,end=sampleElevation(city,...profile.at(-1)!)+.052;
  const height=(along:number)=>along<=0?start:along>=length?end:start+(end-start)*along/length+Math.sin(along/length*Math.PI)*Math.min(1.9,length*.035);
  for(let i=1;i<path.points.length;i++){
    const a=path.points[i-1],b=path.points[i],segment=Math.hypot(b[0]-a[0],b[1]-a[1]);if(segment<.001)continue;
    const count=Math.ceil(segment/1.5);
    for(let j=0;j<count;j++){const t=j/count;points.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);elevations.push(height(locations[i-1].along+(locations[i].along-locations[i-1].along)*t));}
  }
  points.push(path.points.at(-1)!);elevations.push(height(locations.at(-1)!.along));
  return{id:`footbridge:${path.id}`,name:'Park footbridge',points,elevations,width:path.width,oneway:0,deckTangents,bridge};
}

/** A column under a footbridge's deck with the crosshead that carries the slab. */
export interface FootbridgeSupport{x:number;z:number;bottom:number;top:number;yaw:number;width:number;}
/** The column is COLUMN square; the crosshead HEAD deep and HEAD_LENGTH along the deck. */
export const FOOTBRIDGE_COLUMN=.5,FOOTBRIDGE_HEAD=.3,FOOTBRIDGE_HEAD_LENGTH=.7;
const RISE=1.2,      // a deck this far over the ground stands on columns
  SPACING=9,         // no further apart than this where they may stand
  EDGE=3,            // a stretch between two roadways shorter than this has one column, not one at each edge
  CLEAR=.8;          // kept between a column and the edge of a roadway
/** Columns under a deck with stored heights: none in a roadway or in water, one at
 * each edge of the roadways it crosses (between two carriageways where the median
 * leaves the room) and every SPACING metres along the ramps. The arched park
 * bridges, a slab between two banks, have none. */
export function footbridgeSupports(city:CityData,road:Road,path:ParkPath):FootbridgeSupport[]{
  if(!road.elevations||path.elevations?.length!==path.points.length)return[];
  const thickness=road.bridge?.thickness??FOOTBRIDGE_SLAB,p=road.points,reach=40;
  let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;for(const [x,z]of p){x0=Math.min(x0,x);x1=Math.max(x1,x);z0=Math.min(z0,z);z1=Math.max(z1,z);}
  // The roads a column could stand in, with the stations of each for its roofed stretches.
  const near=city.roads.filter(r=>r.points.some(([x,z])=>x>x0-reach&&x<x1+reach&&z>z0-reach&&z<z1+reach)).map(r=>{const stations=[0];for(let i=1;i<r.points.length;i++)stations.push(stations[i-1]+Math.hypot(r.points[i][0]-r.points[i-1][0],r.points[i][1]-r.points[i-1][1]));return{r,stations};});
  const waters=(city.water??[]).filter(w=>w.rings[0]?.some(([x,z])=>x>x0-reach&&x<x1+reach&&z>z0-reach&&z<z1+reach));
  const blocked=(x:number,z:number,top:number)=>waters.some(w=>pointInside([x,z],w.rings[0])&&!w.rings.slice(1).some(ring=>pointInside([x,z],ring)))||near.some(({r,stations})=>{
    const hit=roadProjection(r,x,z);if(hit.distance>=roadWidthAt(r,x,z)/2+CLEAR+FOOTBRIDGE_COLUMN/2)return false;
    if(sampleRoadElevation(city,r,x,z)>top-1)return false; // a street the ramp lands beside, at the deck's own height
    // On a roofed stretch of a tunnel record the column stands on the roof.
    const at=stations[hit.index]+(stations[hit.index+1]-stations[hit.index])*hit.t;return !r.tunnel?.covered?.some(([a,b])=>at>=a&&at<=b);
  });
  const samples:{x:number;z:number;top:number;along:number;yaw:number;needs:boolean;clear:boolean}[]=[];let along=0;
  for(let i=1;i<p.length;i++){
    const a=p[i-1],b=p[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<1e-6)continue;
    const yaw=Math.atan2(b[0]-a[0],b[1]-a[1]);
    for(let d=Math.ceil(along)-along;d<length;d+=1){
      const t=d/length,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,top=road.elevations[i-1]+(road.elevations[i]-road.elevations[i-1])*t-thickness,needs=top-sampleElevation(city,x,z)>=RISE;
      samples.push({x,z,top,along:along+d,yaw,needs,clear:needs&&!blocked(x,z,top)});
    }
    along+=length;
  }
  // Each stretch a column may stand under: one at both its ends (where the ramp has risen RISE over the ground, and at the edge of a roadway)
  // and as many between, evenly, as keep them SPACING apart; a stretch shorter than EDGE has one, in its middle.
  const supports:FootbridgeSupport[]=[],stand=(s:typeof samples[number])=>{supports.push({x:s.x,z:s.z,bottom:sampleElevation(city,s.x,s.z)-.4,top:s.top,yaw:s.yaw,width:road.width});};
  for(let a=0;a<samples.length;a++){
    if(!samples[a].clear)continue;
    let b=a;while(b+1<samples.length&&samples[b+1].clear&&samples[b+1].along-samples[b].along<1.5)b++;
    const span=samples[b].along-samples[a].along;
    if(span<EDGE)stand(samples[Math.round((a+b)/2)]);
    else{const n=Math.ceil(span/SPACING);for(let k=0;k<=n;k++)stand(samples[Math.round(a+(b-a)*k/n)]);}
    a=b;
  }
  return supports;
}

/** A tread of a flight of steps: a box lying on the inclined slab, its top level with the slab's height at its upper edge. */
export interface FootbridgeTread{x:number;y:number;z:number;yaw:number;width:number;height:number;depth:number;}
const RISER=.17;
/** The steps of a stored bridge's `steps` ranges, drawn on the slab that is their collision: a walker and a
 * bike climb the incline beneath them. */
export function footbridgeTreads(road:Road,path:ParkPath):FootbridgeTread[]{
  if(!road.elevations||path.elevations?.length!==path.points.length)return[];
  const treads:FootbridgeTread[]=[],p=road.points,e=road.elevations;
  for(const [from,to] of path.steps??[]){
    const stations=[0];for(let i=from+1;i<=to;i++)stations.push(stations.at(-1)!+Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]));
    const length=stations.at(-1)!,count=Math.max(1,Math.round(Math.abs(e[to]-e[from])/RISER));if(length<.3)continue;
    const at=(d:number)=>{
      let i=1;while(i<stations.length-1&&stations[i]<d)i++;
      const t=(d-stations[i-1])/(stations[i]-stations[i-1]||1),a=p[from+i-1],b=p[from+i];
      return{x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,y:e[from+i-1]+(e[from+i]-e[from+i-1])*t,yaw:Math.atan2(b[0]-a[0],b[1]-a[1])};
    };
    for(let k=0;k<count;k++){
      const depth=length/count,low=at(k*depth),high=at((k+1)*depth),mid=at((k+.5)*depth),bottom=Math.min(low.y,high.y),top=Math.max(low.y,high.y);
      if(top-bottom<.02)continue;
      treads.push({x:mid.x,y:(top+bottom)/2,z:mid.z,yaw:mid.yaw,width:road.width-.3,height:top-bottom,depth});
    }
  }
  return treads;
}
