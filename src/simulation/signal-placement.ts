import type {CityData,Point2,Road} from '../types';
import {closestRoad,pointInside} from './roads.ts';
import {inTransitCorridor} from './transit-corridors.ts';
import {roadWidthAt,sampleRoadElevation} from './road-surfaces.ts';
import {sampleElevation} from './terrain.ts';

export interface PlacedSignal{position:Point2;source:Point2;road:Road;roadPoint:Point2;yaw:number;armLength:number;armYaw:number;}
const cellSize=48;
function distance(point:Point2,a:Point2,b:Point2){const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(point[0]-a[0]-dx*t,point[1]-a[1]-dz*t);}
/** GIS points identify controlled intersections, not guaranteed curbside poles.
 * Choose the nearest clear sidewalk corner; never leave hardware in a lane. */
export function planTrafficSignals(city:CityData){
  const roads=new Map<string,{a:Point2;b:Point2;width:number;road:Road}[]>(),buildings=new Map<string,CityData['buildings']>();
  function eachCell(minX:number,maxX:number,minZ:number,maxZ:number,fn:(key:string)=>void){for(let x=Math.floor(minX/cellSize);x<=Math.floor(maxX/cellSize);x++)for(let z=Math.floor(minZ/cellSize);z<=Math.floor(maxZ/cellSize);z++)fn(`${x},${z}`);}
  for(const r of city.roads)for(let i=1;i<r.points.length;i++){const a=r.points[i-1],b=r.points[i],width=Math.max(r.width,r.deckWidths?.[i-1]??r.width,r.deckWidths?.[i]??r.width)/2+.55;eachCell(Math.min(a[0],b[0])-width,Math.max(a[0],b[0])+width,Math.min(a[1],b[1])-width,Math.max(a[1],b[1])+width,key=>{const list=roads.get(key)??[];list.push({a,b,width,road:r});roads.set(key,list);});}
  for(const b of city.buildings){const xs=b.footprint.map(p=>p[0]),zs=b.footprint.map(p=>p[1]);eachCell(Math.min(...xs)-.5,Math.max(...xs)+.5,Math.min(...zs)-.5,Math.max(...zs)+.5,key=>{const list=buildings.get(key)??[];list.push(b);buildings.set(key,list);});}
  const clear=(p:Point2,roadHeight:number)=>{
    const key=`${Math.floor(p[0]/cellSize)},${Math.floor(p[1]/cellSize)}`,footing=sampleElevation(city,...p),top=Math.max(footing,roadHeight)+5.65;
    // An elevated junction's mast reaches down to the terrain outside its
    // deck. Keep that entire vertical support clear of lower and upper lanes.
    return !(roads.get(key)??[]).some(s=>{
      const d=distance(p,s.a,s.b);if(d>=s.width||d>=roadWidthAt(s.road,...p)/2+.55)return false;
      const y=sampleRoadElevation(city,s.road,...p);return y>=footing-.55&&y<=top+.55;
    })&&!(buildings.get(key)??[]).some(b=>pointInside(p,b.footprint)||b.footprint.some((a,i)=>distance(p,a,b.footprint[(i+1)%b.footprint.length])<.5));
  };
  const placed:PlacedSignal[]=[];
  for(const source of city.signals){
    const nearest=closestRoad(city,...source);if(!nearest.road||nearest.distance>35)continue;
    const tx=Math.sin(nearest.yaw),tz=Math.cos(nearest.yaw),normal:Point2=[-tz,tx],candidates:{p:Point2;roadPoint:Point2;cost:number}[]=[];
    for(const along of [0,-7,7,-13,13,-20,20,-27,27])for(const side of [-1,1])for(const margin of [1.25,2.0]){
      const roadPoint:Point2=[nearest.x+tx*along,nearest.z+tz*along],width=roadWidthAt(nearest.road,...roadPoint),p:Point2=[roadPoint[0]+normal[0]*side*(width/2+margin),roadPoint[1]+normal[1]*side*(width/2+margin)];
      if(inTransitCorridor(city,...p)||!clear(p,sampleRoadElevation(city,nearest.road,...roadPoint))||placed.some(s=>Math.hypot(s.position[0]-p[0],s.position[1]-p[1])<7))continue;
      candidates.push({p,roadPoint,cost:Math.hypot(p[0]-source[0],p[1]-source[1])+Math.abs(along)*.08});
    }
    candidates.sort((a,b)=>a.cost-b.cost);const best=candidates[0];if(!best)continue;
    const dx=best.roadPoint[0]-best.p[0],dz=best.roadPoint[1]-best.p[1];
    placed.push({position:best.p,source,road:nearest.road,roadPoint:best.roadPoint,yaw:nearest.yaw,armLength:Math.min(7,Math.hypot(dx,dz)-1.2),armYaw:Math.atan2(dx,dz)});
  }
  return placed;
}
