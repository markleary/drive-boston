import type {Point2,Road} from '../types';

/** Highway records: every deck carrying a `lanes` count (I-93) and the Central
 * Artery's motorway tunnels. Their traffic runs lane by lane at highway speed,
 * and they carry no signals, pedestrians or street furniture. */
export const isMotorway=(road:Road)=>road.lanes!==undefined||(!!road.tunnel&&/^motorway(_link)?$/.test(road.kind??''));
/** A generated highway deck (I-93, the Turnpike, Storrow Drive): a `lanes` deck that is not a tunnel. Its rails
 * stand along embankments and cuts too, and open only where a ramp lands on a street. */
export const isHighwayDeck=(road:Road)=>road.lanes!==undefined&&!!road.bridge&&!road.tunnel;
/** The stretches of a tunnel record that lie open to the sky, as polylines. A walled cut of the Turnpike is a tunnel
 * record too (the runtime cuts the ground at its pavement and walls it); `tunnel.covered` lists its roofed parts. */
export function openStretches(road:Road):Point2[][]{
  if(!road.tunnel||road.points.length<2)return[];
  const along=stations(road.points),total=along[along.length-1],out:Point2[][]=[];
  const at=(s:number):Point2=>{let i=1;while(i<along.length-1&&along[i]<s)i++;const t=(s-along[i-1])/((along[i]-along[i-1])||1),a=road.points[i-1],b=road.points[i];return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];};
  const piece=(a:number,b:number)=>{if(b-a<1)return;out.push([at(a),...road.points.filter((_,i)=>along[i]>a+1e-6&&along[i]<b-1e-6),at(b)]);};
  let cursor=0;
  for(const [a,b]of [...(road.tunnel.covered??[[0,total]])].sort((p,q)=>p[0]-q[0])){piece(cursor,Math.min(a,total));cursor=Math.max(cursor,b);}
  piece(cursor,total);return out;
}
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
