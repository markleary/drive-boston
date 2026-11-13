import type {CityData,HighwaySign,Road} from '../types';
import {tunnelCoveredAt,tunnelPointAt,tunnelStations} from './tunnels.ts';
import {roadProjection,roadWidthAt,sampleRoadElevation} from './road-surfaces.ts';

/** Where a roadside structure stands along a road (`tunnelPointAt`), with the offset of its post from the centre line once a place clear of every lane is found (`clearRoadside`). */
export type Roadside=ReturnType<typeof tunnelPointAt>&{post?:number};
/** A posted warning of the highway sidecar where it stands: on its record, `station` metres along it. */
export interface HighwaySignPlacement {sign:HighwaySign;road:Road;approach:Roadside}
/** A warning sign's post stands this far beyond its road's edge. */
export const WARNING_POST=.75;
/** A post keeps this far from every lane at its own level (a surface within `POST_LEVEL` of the road it serves), and a roadside structure
 * looks no further than `ROADSIDE_REACH` beyond its road's edge for a place to stand. */
export const POST_ROOM=.4,POST_LEVEL=1.5,ROADSIDE_REACH=9;

/** The roadside point `offset` metres from a road's centre line, on the right of traffic, where signs and masts stand. With x east and z south
 * that is the +n side, n = (-tz, tx) for travel along (tx, tz): the side a pavement record and `Road.roadway` list first and call "left",
 * as a plan read with z up names it. (`tunnelPointAt`'s `edge` is the roadway's extent on that same side.) */
export function roadsidePoint(p:{x:number;z:number;yaw:number},offset:number){return{x:p.x-Math.cos(p.yaw)*offset,z:p.z+Math.sin(p.yaw)*offset};}
/** Whether (x, z) lies in the lanes of one of `roads` at the level `y`, or within `room` of them: a deck or an open cut by its own width, a
 * street by its measured roadway. A street far under a viaduct, a bridge overhead and a roofed tunnel stretch are no lanes a post at this
 * roadside stands in, and the paving beside a deck's lanes (`Road.roadway`) is shoulder or gore, where a post may stand. */
export function inLanes(city:CityData,roads:readonly Road[],x:number,z:number,y:number,room=POST_ROOM){
  for(const road of roads){
    if(road.points.length<2)continue;
    const hit=roadProjection(road,x,z),half=(road.elevations||road.tunnel?roadWidthAt(road,x,z):road.pavedWidth??road.width)/2;
    if(hit.distance>=half+room||Math.abs(sampleRoadElevation(city,road,x,z)-y)>POST_LEVEL)continue;
    if(road.tunnel){const along=tunnelStations(road),i=Math.min(hit.index,along.length-2);if(tunnelCoveredAt(road,along[i]+(along[i+1]-along[i])*hit.t))continue;}
    return true;
  }
  return false;
}
/** `approach` with the place of its post: `out` beyond the road's edge, or as much further out, half a metre at a time, as it takes to stand
 * clear of what `blocked` holds (the lanes of the roads around it: at a gore the ramp's pavement begins where the shoulder would be, and a cut
 * as wide as its surveyed trench has a street at its rim). Undefined when no place is found within ROADSIDE_REACH. */
export function clearRoadside<T extends Roadside>(approach:T,out:number,blocked:(x:number,z:number)=>boolean,reach=ROADSIDE_REACH):(T&{post:number})|undefined{
  for(let more=0;more<=reach+1e-9;more+=.5){const post=approach.edge+out+more,q=roadsidePoint(approach,post);if(!blocked(q.x,q.z))return{...approach,post};}
  return undefined;
}

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
