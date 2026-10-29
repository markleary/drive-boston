import type {CityData,ParkPath,Point2,Road} from '../types';
import {sampleElevation} from './terrain.ts';

/** One arched profile for the visible slab and wheel/aircraft collision. Keep
 * mapped bends and meet the adjoining path instead of straightening the span. */
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
  const locations=path.points.map(locate),direction=locations.at(-1)!.along>=locations[0].along?1:-1;
  const tangent=(hit:ReturnType<typeof locate>):Point2=>{
    const vertex=hit.t<1e-6?hit.index:hit.t>1-1e-6?hit.index+1:undefined;
    const a=profile[vertex===undefined?hit.index:Math.max(0,vertex-1)],b=profile[vertex===undefined?hit.index+1:Math.min(profile.length-1,vertex+1)];
    return[(b[0]-a[0])*direction,(b[1]-a[1])*direction];
  };
  const points:Point2[]=[],elevations:number[]=[],start=sampleElevation(city,...profile[0])+.052,end=sampleElevation(city,...profile.at(-1)!)+.052;
  const height=(along:number)=>along<=0?start:along>=length?end:start+(end-start)*along/length+Math.sin(along/length*Math.PI)*Math.min(1.9,length*.035);
  for(let i=1;i<path.points.length;i++){
    const a=path.points[i-1],b=path.points[i],segment=Math.hypot(b[0]-a[0],b[1]-a[1]);if(segment<.001)continue;
    const count=Math.ceil(segment/1.5);
    for(let j=0;j<count;j++){const t=j/count;points.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);elevations.push(height(locations[i-1].along+(locations[i].along-locations[i-1].along)*t));}
  }
  points.push(path.points.at(-1)!);elevations.push(height(locations.at(-1)!.along));
  return{id:`footbridge:${path.id}`,name:'Park footbridge',points,elevations,width:path.width,oneway:0,deckTangents:path.bridgePoints?{start:tangent(locations[0]),end:tangent(locations.at(-1)!)}:undefined,bridge:{id:path.id,thickness:.22,clearanceEstimated:true}};
}
