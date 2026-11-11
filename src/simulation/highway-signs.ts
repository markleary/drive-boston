import type {CityData,HighwaySign,Road} from '../types';
import {tunnelCoveredAt,tunnelPointAt,tunnelStations} from './tunnels.ts';

/** A posted warning of the highway sidecar where it stands: on its record, `station` metres along it. */
export interface HighwaySignPlacement {sign:HighwaySign;road:Road;approach:ReturnType<typeof tunnelPointAt>}

/** Storrow Drive's CARS ONLY and LOW CLEARANCE signs (`city.highwaySigns`, from boston-highways.json) on the
 * records that carry them. One whose station lies under a tunnel's roof is left out: the post stands at the roadside
 * in the open, ahead of the structure it warns of. */
export function planHighwaySigns(city:Pick<CityData,'roads'|'highwaySigns'>):HighwaySignPlacement[]{
  if(!city.highwaySigns?.length)return[];
  const roads=new Map(city.roads.map(road=>[road.id,road])),out:HighwaySignPlacement[]=[];
  for(const sign of city.highwaySigns){
    const road=roads.get(sign.road);if(!road?.elevations||road.points.length<2)continue;
    const station=Math.max(0,Math.min(tunnelStations(road).at(-1)!,sign.station));
    if(road.tunnel&&tunnelCoveredAt(road,station))continue;
    out.push({sign,road,approach:tunnelPointAt(road,station)});
  }
  return out;
}
/** The lines a warning sign carries, top to bottom. */
export function warningLegend(sign:HighwaySign):string[]{
  return sign.kind==='cars-only'?['CARS','ONLY']:['LOW','CLEARANCE',sign.clearance??`10'-0"`];
}
