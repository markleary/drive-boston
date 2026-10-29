import type {CityData,Point2} from '../types';
import {createRailProfile,railCovered,railSurface,type RailProfile} from './transit-rail-surface.ts';

interface CorridorRoute {kind:string;line?:string;points:Point2[];covered?:{start:number;end:number}[];bridges?:{start:number;end:number}[];}
interface CorridorPath extends CorridorRoute {distances:number[];length:number;}
interface CorridorSegment {a:Point2;b:Point2;start:number;length:number;path:CorridorPath;}
interface CorridorNetwork {city:CityData;cells:Map<string,CorridorSegment[]>;profiles:Map<CorridorPath,RailProfile>;}
const corridors=new WeakMap<CityData,CorridorNetwork>();
/** Reserve the rail vehicle envelope when placing sidewalk props and people. */
export function reserveTransitCorridors(city:CityData,routes:CorridorRoute[]){
  const cells=new Map<string,CorridorSegment[]>();
  for(const route of routes.filter(r=>r.kind==='tram')){
    const distances=[0];for(let i=1;i<route.points.length;i++)distances.push(distances[i-1]+Math.hypot(route.points[i][0]-route.points[i-1][0],route.points[i][1]-route.points[i-1][1]));
    const path:CorridorPath={...route,distances,length:distances.at(-1)!};
    for(let i=1;i<route.points.length;i++){
      const a=route.points[i-1],b=route.points[i],segment={a,b,start:distances[i-1],length:distances[i]-distances[i-1],path};
      for(let x=Math.floor((Math.min(a[0],b[0])-3)/32);x<=Math.floor((Math.max(a[0],b[0])+3)/32);x++)for(let z=Math.floor((Math.min(a[1],b[1])-3)/32);z<=Math.floor((Math.max(a[1],b[1])+3)/32);z++){
        const key=`${x},${z}`,list=cells.get(key)??[];list.push(segment);cells.set(key,list);
      }
    }
  }
  corridors.set(city,{city,cells,profiles:new Map()});
}
/** A tile-local city view answers corridor queries from the metro's reservation. */
export function shareTransitCorridors(target:CityData,source:CityData){const network=corridors.get(source);if(network)corridors.set(target,network);}
export function inTransitCorridor(city:CityData,x:number,z:number){
  return(corridors.get(city)?.cells.get(`${Math.floor(x/32)},${Math.floor(z/32)}`)??[]).some(({a,b})=>{
    const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
    return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)<2.6;
  });
}

/** Bridge-edge openings use the car's narrower envelope (including mirrors and
 * barrier thickness), and only the matching rail level. A road over a covered
 * railway must retain its parapets. Profiles are built only for a nearby rail
 * candidate, and tile views share the metro's elevations and profile cache. */
export function inTransitClearance(city:CityData,x:number,z:number,y:number){
  const network=corridors.get(city);if(!network)return false;
  return(network.cells.get(`${Math.floor(x/32)},${Math.floor(z/32)}`)??[]).some(({a,b,start,length,path})=>{
    const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(length*length||1)));
    if(Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)>=1.8)return false;
    let profile=network.profiles.get(path);
    if(!profile){profile=createRailProfile(network.city,path);network.profiles.set(path,profile);}
    const distance=start+length*t;
    return !railCovered(profile,distance)&&Math.abs(railSurface(profile,distance).height-y)<.8;
  });
}
