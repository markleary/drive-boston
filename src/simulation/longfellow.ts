import type {CityData,Point2} from '../types';
import {roadProjection,sampleRoadElevation} from './road-surfaces.ts';

/** Shared horizontal bridge frame, including the Cambridge transition to Main Street. */
const x0=-372.57,z0=-1296.11,dx=506.2,dz=46.95;
export const LONGFELLOW_LENGTH=Math.hypot(dx,dz);
const ux=dx/LONGFELLOW_LENGTH,uz=dz/LONGFELLOW_LENGTH;
export const LONGFELLOW_YAW=Math.atan2(ux,uz);
export function longfellowPoint(along:number,across=0):Point2{return[x0+ux*along-uz*across,z0+uz*along+ux*across];}
export function inLongfellowCorridor(x:number,z:number,margin=4){
  const along=(x-x0)*ux+(z-z0)*uz,across=-(x-x0)*uz+(z-z0)*ux;
  return along>=-25-margin&&along<=LONGFELLOW_LENGTH+25+margin&&Math.abs(across)<=20+margin;
}
/** The decoration must clear BOTH independently graded carriageways. A fixed
 * basin deck datum puts crossheads above the Cambridge approach pavement. */
export function longfellowProfile(city:CityData){
  const roads=city.roads.filter(r=>r.name==='Longfellow Bridge');
  return(along:number)=>{
    const heights=[-7,7].map(side=>{
      const p=longfellowPoint(along,side);let chosen=roads[0],distance=Infinity;
      for(const road of roads){const hit=roadProjection(road,...p);if(hit.distance<distance){distance=hit.distance;chosen=road;}}
      return sampleRoadElevation(city,chosen,...p);
    });
    return Math.min(...heights);
  };
}
