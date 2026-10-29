import type {CityData,ParkPath,Point2,Road} from '../types';
import {sampleElevation} from './terrain.ts';

/** One arched profile for the visible slab and wheel/aircraft collision. Keep
 * mapped bends and meet the adjoining path instead of straightening the span. */
export function footbridgeRoad(city:CityData,path:ParkPath):Road|undefined{
  if(!path.bridge||path.points.length<2)return;
  const distances=[0];
  for(let i=1;i<path.points.length;i++)distances.push(distances[i-1]+Math.hypot(path.points[i][0]-path.points[i-1][0],path.points[i][1]-path.points[i-1][1]));
  const length=distances.at(-1)!;if(length<1)return;
  const points:Point2[]=[],elevations:number[]=[],start=sampleElevation(city,...path.points[0])+.052,end=sampleElevation(city,...path.points.at(-1)!)+.052;
  const height=(along:number)=>start+(end-start)*along/length+Math.sin(along/length*Math.PI)*Math.min(1.9,length*.035);
  for(let i=1;i<path.points.length;i++){
    const a=path.points[i-1],b=path.points[i],segment=distances[i]-distances[i-1];if(segment<.001)continue;
    const count=Math.ceil(segment/1.5);
    for(let j=0;j<count;j++){const t=j/count;points.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);elevations.push(height(distances[i-1]+segment*t));}
  }
  points.push(path.points.at(-1)!);elevations.push(end);
  return{id:`footbridge:${path.id}`,name:'Park footbridge',points,elevations,width:path.width,oneway:0,bridge:{id:path.id,thickness:.22,clearanceEstimated:true}};
}
