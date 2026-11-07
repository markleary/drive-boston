import type {Point2,Road} from '../types';

/** Highway records: every deck carrying a `lanes` count (I-93) and the Central
 * Artery's motorway tunnels. Their traffic runs lane by lane at highway speed,
 * and they carry no signals, pedestrians or street furniture. */
export const isMotorway=(road:Road)=>road.lanes!==undefined||(!!road.tunnel&&/^motorway(_link)?$/.test(road.kind??''));
/** 2 for a highway carriageway, 1 for its ramps, 0 for every other street. */
export const speedClass=(road:Road)=>!isMotorway(road)?0:road.kind==='motorway_link'?1:2;
export const LANE_WIDTH=3.65;
/** Lane centre offsets, right of the centreline positive (traffic.lane's
 * convention): `lanes` centred on the centreline 3.65 m apart, closer only
 * where a deck is too narrow to keep each outer lane 1.2 m inside its edge. */
export function motorwayLanes(road:Road){
  const n=Math.max(1,Math.round(road.lanes??1)),spacing=n>1?Math.min(LANE_WIDTH,(road.width-2.4)/(n-1)):0;
  return Array.from({length:n},(_,k)=>(k-(n-1)/2)*spacing);
}
/** Metres from a closed end (`Road.closed`, or a tunnel cap) to the middle of
 * the barrier there: the tunnel caps' concrete block stands 5 m inside theirs. */
export const CLOSURE_SETBACK=5;
/** Metres past the middle of that barrier where a car driving into the closed
 * end vanishes: through the barrier and short of the deck's end. */
export const SINK_BEYOND=3;

/** Cumulative metres along a polyline. */
export function stations(points:readonly Point2[]){
  const out=[0];for(let i=1;i<points.length;i++)out.push(out[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));return out;
}
/** The point `s` metres along a polyline (clamped to its ends) and the unit
 * direction of the segment it lies on. */
export function pointAtDistance(points:readonly Point2[],s:number,along=stations(points)){
  const total=along[along.length-1];s=Math.max(0,Math.min(total,s));
  let lo=0,hi=along.length-1;while(lo+1<hi){const mid=(lo+hi)>>1;if(along[mid]<s)lo=mid;else hi=mid;}
  const a=points[lo],b=points[hi]??a,span=along[hi]-along[lo],t=span>0?(s-along[lo])/span:0,dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz)||1;
  return{p:[a[0]+dx*t,a[1]+dz*t] as Point2,dir:[dx/length,dz/length] as Point2};
}
