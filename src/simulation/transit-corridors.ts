import type {CityData,Point2} from '../types';

const corridors=new WeakMap<CityData,Map<string,{a:Point2;b:Point2}[]>>();
/** Reserve the rail vehicle envelope when placing sidewalk props and people. */
export function reserveTransitCorridors(city:CityData,routes:{kind:string;points:Point2[]}[]){
  const cells=new Map<string,{a:Point2;b:Point2}[]>();
  for(const route of routes.filter(r=>r.kind==='tram'))for(let i=1;i<route.points.length;i++){
    const a=route.points[i-1],b=route.points[i];
    for(let x=Math.floor((Math.min(a[0],b[0])-3)/32);x<=Math.floor((Math.max(a[0],b[0])+3)/32);x++)for(let z=Math.floor((Math.min(a[1],b[1])-3)/32);z<=Math.floor((Math.max(a[1],b[1])+3)/32);z++){
      const key=`${x},${z}`,list=cells.get(key)??[];list.push({a,b});cells.set(key,list);
    }
  }
  corridors.set(city,cells);
}
export function inTransitCorridor(city:CityData,x:number,z:number){
  return(corridors.get(city)?.get(`${Math.floor(x/32)},${Math.floor(z/32)}`)??[]).some(({a,b})=>{
    const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
    return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)<2.6;
  });
}
