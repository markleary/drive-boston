import data from '../data/castle-island.json' with { type: 'json' };
import type { Point2 } from '../types.ts';
import { pointInside } from './roads.ts';

export const points = (r: number[][]): Point2[] => r.map(([x,z]) => [x,z]);
export const FORT_ID = data.fort.id;
export const fortOutline = points(data.fort.rings[0]);
export const fortCourt = points(data.fort.court);
export const fortTerrainCuts = [[fortOutline]];
export const pleasureBayTerrainCuts = data.waterCuts.map(r => r.map(points));
export const FORT_FLOOR = 6.7, FORT_TOP = 14;
export const fortEntrance: Point2 = [5195.25,1295.05];
const T: Point2 = [.261,.965], N: Point2 = [.965,-.261];
export const gatePoint = (along: number, inward: number): Point2 => [fortEntrance[0]+T[0]*along+N[0]*inward,fortEntrance[1]+T[1]*along+N[1]*inward];
export const insideFort = (x: number,z: number) => x>5160&&x<5360&&z>1190&&z<1375&&pointInside([x,z],fortOutline);


/** The narrow exposed Head Island causeway is a walking loop, not a wooded
 * park. Reserve it from procedural trees and incidental furniture. */
export const castleIslandReserved=(x:number,z:number)=>insideFort(x,z)||(x>4340&&x<5200&&z>1910&&z<2180)||(x>5075&&x<5210&&z>1650&&z<=1910);

// Exact mapped sea-defense edges; a small spatial grid keeps shoreline queries
// cheap while the tile renderer samples thousands of water vertices.
const shoreCells=new Map<string,[Point2,Point2][]>(),shoreCell=24;
for(const line of data.coast)for(let i=1;i<line.length;i++){
  const a=line[i-1] as Point2,b=line[i] as Point2;
  for(let x=Math.floor((Math.min(a[0],b[0])-10)/shoreCell);x<=Math.floor((Math.max(a[0],b[0])+10)/shoreCell);x++)for(let z=Math.floor((Math.min(a[1],b[1])-10)/shoreCell);z<=Math.floor((Math.max(a[1],b[1])+10)/shoreCell);z++){
    const key=`${x},${z}`,list=shoreCells.get(key)??[];list.push([a,b]);shoreCells.set(key,list);
  }
}
export function castleIslandShoreDistance(x:number,z:number){
  if(x<4890||x>5430||z<1140||z>2180)return Infinity;
  let distance=Infinity;
  for(const [a,b] of shoreCells.get(`${Math.floor(x/shoreCell)},${Math.floor(z/shoreCell)}`)??[]){
    const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
    distance=Math.min(distance,Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz));
  }
  return distance;
}
