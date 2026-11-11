import type {Road} from '../types';
import {tunnelCoveredAt,tunnelPointAt,tunnelStations} from './tunnels.ts';

/** Metres between the Turnpike's lighting masts along each carriageway. */
export const MAST_SPACING=40;
/** Height of the luminaire over the roadway and how far its arm reaches in from the mast. */
export const MAST_HEIGHT=10.5,MAST_ARM=2.6;
/** A lighting mast at the right edge of a carriageway: its foot, the road surface there and the heading of traffic. */
export interface HighwayMast {x:number;y:number;z:number;yaw:number}
/** How far the middle of the luminaire's head hangs under the mast's nominal height. */
const HEAD_DROP=.43;
/** The luminaire of a mast: the middle of its head, at the end of the arm over the lanes. */
export function mastHead(mast:HighwayMast){return {x:mast.x+Math.cos(mast.yaw)*MAST_ARM,y:mast.y+MAST_HEIGHT-HEAD_DROP,z:mast.z-Math.sin(mast.yaw)*MAST_ARM};}

/** What a pooled night light takes from the lamp it stands in for (world.ts moves a few point lights to the lamps nearest
 * the player): how high it hangs over the lamp's position on the ground, its intensity and its reach. */
export interface LampLight {rise:number;intensity:number;distance:number}
/** A street lamp's light, inside the globe on its 5.7 m pole. */
export const STREET_LIGHT:LampLight={rise:5.6,intensity:70,distance:21};
/** A Turnpike luminaire's light: in the middle of the head (`mastHead`), as a street lamp's is in its globe, so the fixture
 * glows by its own material and is not lit by the light it holds. It hangs 4.5 m higher than a street lamp's, so it is
 * stronger and reaches farther: the road right under it is lit about 0.6 times as brightly as under a street lamp, in a wider pool. */
export const MAST_LIGHT:LampLight={rise:MAST_HEIGHT-HEAD_DROP,intensity:135,distance:30};

/** The Massachusetts Turnpike is lit along its whole length through Boston: a mast every MAST_SPACING metres on the
 * right of each carriageway record (`i90-eb-…`, `i90-wb-…`), on its decks and in its open cut alike. A stretch under
 * a roof has the tunnel's own fixtures instead, and a mast keeps half a spacing clear of each portal; one that would
 * stand under a street bridge over the road is left out. */
export function highwayMasts(road:Road,overhead?:(x:number,z:number,above:number)=>number):HighwayMast[]{
  if(!/^i90-(eb|wb)-\d+$/.test(road.id)||!road.elevations||road.points.length<2)return[];
  const total=tunnelStations(road).at(-1)!,out:HighwayMast[]=[];
  for(let s=MAST_SPACING/2;s<total;s+=MAST_SPACING){
    if(road.tunnel&&[s-MAST_SPACING/2,s,s+MAST_SPACING/2].some(at=>tunnelCoveredAt(road,Math.max(0,Math.min(total,at)))))continue;
    const p=tunnelPointAt(road,s),out_=p.width/2+.55,mast={x:p.x-Math.cos(p.yaw)*out_,y:p.y,z:p.z+Math.sin(p.yaw)*out_,yaw:p.yaw};
    // None under a bridge over the road: `overhead` gives the underside of whatever stands over a point (deckUndersideAt), at the foot and at the luminaire.
    if(overhead&&[0,MAST_ARM].some(d=>overhead(mast.x+Math.cos(p.yaw)*d,mast.z-Math.sin(p.yaw)*d,p.y+2.5)<p.y+MAST_HEIGHT+.5))continue;
    out.push(mast);
  }
  return out;
}
