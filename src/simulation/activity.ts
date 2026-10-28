import type {CityData,Point2} from '../types';
import {pointInside} from './roads.ts';

export interface ActivityProfile {
  level:'busy'|'mixed'|'residential';
  traffic:number;
  pedestrians:number;
}

// Game population targets, not measured traffic counts. These use the same
// official Boston neighborhood polygons as the atlas and neighborhood HUD.
export const ACTIVITY:Record<ActivityProfile['level'],Readonly<ActivityProfile>>={
  busy:{level:'busy',traffic:48,pedestrians:72},
  mixed:{level:'mixed',traffic:32,pedestrians:44},
  residential:{level:'residential',traffic:18,pedestrians:26},
};

export function createActivityProfile(city:CityData){
  const areas=(city.neighborhoods??[]).map(area=>{
    const level:ActivityProfile['level']=/^(Back Bay|Downtown|Chinatown|Leather District)$/.test(area.name)?'busy':
      /^(Fenway|Longwood)$/.test(area.name)?'mixed':'residential';
    const rings=area.rings.map(points=>({points,minX:Math.min(...points.map(p=>p[0])),maxX:Math.max(...points.map(p=>p[0])),minZ:Math.min(...points.map(p=>p[1])),maxZ:Math.max(...points.map(p=>p[1]))}));
    return {profile:ACTIVITY[level],rings};
  });
  return (x:number,z:number):Readonly<ActivityProfile>=>{
    const point:Point2=[x,z];
    for(const area of areas){
      // Match the atlas's even/odd fill, including holes and disjoint pieces.
      let inside=false;
      for(const ring of area.rings)if(x>=ring.minX&&x<=ring.maxX&&z>=ring.minZ&&z<=ring.maxZ&&pointInside(point,ring.points))inside=!inside;
      if(inside)return area.profile;
    }
    return ACTIVITY.residential;
  };
}
