import * as THREE from 'three';
import type {CityArea,Point2,WaterSurface} from '../types';

export interface WaterMotion { strength:number; speed:number; }
const profiles=new WeakMap<CityArea,Map<string,WaterMotion>>();
const bodyKey=(surface:Pick<WaterSurface,'name'|'source'>)=>surface.name.trim()||surface.source;

function extent(rings:Point2[][]){
  let area=0,perimeter=0;
  for(const [index,ring] of rings.entries()){
    let signedArea=0;
    for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];signedArea+=a[0]*b[1]-b[0]*a[1];perimeter+=Math.hypot(b[0]-a[0],b[1]-a[1]);}
    area+=(index?-1:1)*Math.abs(signedArea)/2;
  }
  return {area:Math.max(0,area),perimeter};
}
const smooth=(low:number,high:number,value:number)=>{const t=Math.max(0,Math.min(1,(value-low)/(high-low)));return t*t*(3-2*t);};
function profile(area:number,perimeter:number):WaterMotion{
  // Area limits small ponds; hydraulic width limits long, sheltered waterways
  // such as the Fens. Broad river basins retain the full wind-wave spectrum.
  const width=perimeter>0?4*area/perimeter:0,exposure=smooth(10000,120000,area)*smooth(40,200,width);
  return {strength:.045+.955*exposure,speed:.12+.88*exposure};
}

/** Use complete body outlines, never the current tile's clipped fragment.
 * Named river reaches share a profile even when hydro source or level changes;
 * a tributary in the merged harbour outline keeps its own sheltered profile. */
export function waterMotion(water:CityArea,surface?:Pick<WaterSurface,'name'|'source'>):WaterMotion{
  let byBody=profiles.get(water);
  if(!byBody){
    byBody=new Map();const total=new Map<string,{area:number;perimeter:number}>();
    for(const source of water.surfaces??[]){const key=bodyKey(source),size=extent(source.rings),sum=total.get(key)??{area:0,perimeter:0};sum.area+=size.area;sum.perimeter+=size.perimeter;total.set(key,sum);}
    for(const [key,size] of total)byBody.set(key,profile(size.area,size.perimeter));
    const size=extent(water.rings);byBody.set('',profile(size.area,size.perimeter));profiles.set(water,byBody);
  }
  return byBody.get(surface?bodyKey(surface):'')??byBody.get('')!;
}

/** Preserve one draw/material per tile while carrying each body's settings
 * through geometry merging and spatial static-detail batching. */
export function applyWaterMotion(geometry:THREE.BufferGeometry,motion:WaterMotion){
  const values=new Float32Array(geometry.attributes.position.count*2);
  for(let i=0;i<values.length;i+=2){values[i]=motion.strength;values[i+1]=motion.speed;}
  geometry.setAttribute('waterMotion',new THREE.BufferAttribute(values,2));return geometry;
}
