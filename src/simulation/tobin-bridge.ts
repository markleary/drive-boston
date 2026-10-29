import type {CityData,Road} from '../types';
import {sampleRoadElevation} from './road-surfaces.ts';

export const isTobinBridgeRoad=(road:Road)=>road.bridge?.id==='tobin';

/** One station system for the two stacked carriageways and the structural
 * model. Their source directions may differ; height is sampled from each deck. */
export function tobinBridgeSpine(city:CityData){
  const layout=city.tobinBridge;if(!layout)return;
  const lower=city.roads.find(r=>r.id===layout.lowerRoadId),upper=city.roads.find(r=>r.id===layout.upperRoadId);
  if(!lower?.elevations||!upper?.elevations||lower.points.length<2)return;
  const stations=[0];for(let i=1;i<lower.points.length;i++)stations.push(stations[i-1]+Math.hypot(lower.points[i][0]-lower.points[i-1][0],lower.points[i][1]-lower.points[i-1][1]));
  const length=stations.at(-1)!;
  const directions=lower.points.map((_,i)=>{
    const a=lower.points[Math.max(0,i-1)],b=lower.points[Math.min(lower.points.length-1,i+1)],n=Math.hypot(b[0]-a[0],b[1]-a[1])||1;return[(b[0]-a[0])/n,(b[1]-a[1])/n];
  });
  const sample=(station:number,across=0)=>{
    const s=Math.max(0,Math.min(length,station));let i=1;while(i<stations.length-1&&stations[i]<s)i++;
    const a=lower.points[i-1],b=lower.points[i],distance=stations[i]-stations[i-1],t=distance?(s-stations[i-1])/distance:0;
    // Interpolate the same endpoint normals as roadDeckGeometry, so the steel
    // and maintenance walks meet the rendered deck through source bends.
    const dx=directions[i-1][0]+(directions[i][0]-directions[i-1][0])*t,dz=directions[i-1][1]+(directions[i][1]-directions[i-1][1])*t;
    const cx=a[0]+(b[0]-a[0])*t,cz=a[1]+(b[1]-a[1])*t,x=cx-dz*across,z=cz+dx*across;
    return{x,z,lower:lower.elevations![i-1]+(lower.elevations![i]-lower.elevations![i-1])*t,upper:sampleRoadElevation(city,upper,cx,cz),yaw:Math.atan2(dx,dz),dx,dz};
  };
  return{layout,lower,upper,stations,length,sample};
}
