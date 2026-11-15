/** Population settings for the ambient cars and sidewalk walkers. Each step up doubles the population:
 * the fleet's pool and every activity target scale by the factor. Low cars are the fleet the game always had
 * (77 cars), medium walkers the walkers it always had (112). */
export type DensityLevel='low'|'medium'|'high';
export const DENSITY_LEVELS:readonly DensityLevel[]=['low','medium','high'];
export const TRAFFIC_DENSITY:Readonly<Record<DensityLevel,number>>={low:1,medium:2,high:4};
export const PEDESTRIAN_DENSITY:Readonly<Record<DensityLevel,number>>={low:.5,medium:1,high:2};
export const DEFAULT_TRAFFIC_DENSITY:DensityLevel='low',DEFAULT_PEDESTRIAN_DENSITY:DensityLevel='medium';
export const isDensityLevel=(value:unknown):value is DensityLevel=>typeof value==='string'&&(DENSITY_LEVELS as readonly string[]).includes(value);
/** The members a pool keeps when it shrinks to `size`, in their pool order. Of those within `radius` of the observer it
 * keeps no more than `local` (the new neighborhood target), taken evenly through the pool's order so the scene thins
 * rather than emptying at one edge; the rest of the pool is filled with the nearest of the others. */
export function shrinkPool<T>(pool:readonly T[],size:number,distance:(item:T)=>number,radius:number,local:number):T[]{
  if(pool.length<=size)return [...pool];
  const ranged=pool.map((item,index)=>({item,index,d:distance(item)})),near=ranged.filter(o=>o.d<radius),keepNear=Math.max(0,Math.min(near.length,local,size));
  const kept=near.filter((_,i)=>Math.floor((i+1)*keepNear/near.length)>Math.floor(i*keepNear/near.length));
  const others=ranged.filter(o=>o.d>=radius).sort((a,b)=>a.d-b.d||a.index-b.index);
  kept.push(...others.slice(0,size-kept.length));
  // Where the others cannot fill the pool, the nearby members left out make it up.
  if(kept.length<size){const taken=new Set(kept);kept.push(...near.filter(o=>!taken.has(o)).slice(0,size-kept.length));}
  return kept.sort((a,b)=>a.index-b.index).map(o=>o.item);
}
