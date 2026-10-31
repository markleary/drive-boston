/** Right of way between NPC lane keepers. Each car samples the next stretch of
 * its route; where two cars' footprints would meet (a crossing, a merge, a
 * corner, or simply the car ahead) exactly one of them keeps going and the other
 * stops short of the first contact. A pairwise rule that let both wait is what
 * left cars locked together in junctions. */
export interface Pose {x:number;z:number;yaw:number;}
export interface Footprint {halfLength:number;halfWidth:number;}
/** Poses every `step` metres of travel from the current one (poses[0]); `pose`
 * answers any travel in between, for refining the first contact. */
export interface Trajectory extends Footprint {poses:Pose[];pose:(travel:number)=>Pose;}
/** One side of a conflict: `travel` to the first contact, whether the car will
 * stop before it anyway (a red light or the end of its route), whether it holds
 * deadlock-breaking priority, and whether the other car's center lies ahead of it. */
export interface Claim {index:number;travel:number;speed:number;stopsShort:boolean;forced:boolean;otherAhead:boolean;}

/** Sample spacing, footprint margins (m), the yielding car's stand-off before
 * the contact and its comfortable deceleration (as the car-following rule), the
 * hardest braking a lane keeper does, and the look-ahead range. */
export const CONFLICT={step:1.5,lengthMargin:.6,widthMargin:.15,buffer:1.1,decel:3.8,brake:5.5,minHorizon:14,maxHorizon:34};

/** Separating-axis test of two inflated oriented footprints. */
export function footprintsOverlap(a:Pose,fa:Footprint,b:Pose,fb:Footprint){
  const al=fa.halfLength+CONFLICT.lengthMargin,aw=fa.halfWidth+CONFLICT.widthMargin,bl=fb.halfLength+CONFLICT.lengthMargin,bw=fb.halfWidth+CONFLICT.widthMargin;
  const afx=Math.sin(a.yaw),afz=Math.cos(a.yaw),bfx=Math.sin(b.yaw),bfz=Math.cos(b.yaw),dx=b.x-a.x,dz=b.z-a.z;
  // Forward (sin, cos) and right (cos, -sin) of each car.
  for(const [ux,uz] of [[afx,afz],[afz,-afx],[bfx,bfz],[bfz,-bfx]]){
    const ra=al*Math.abs(afx*ux+afz*uz)+aw*Math.abs(afz*ux-afx*uz),rb=bl*Math.abs(bfx*ux+bfz*uz)+bw*Math.abs(bfz*ux-bfx*uz);
    if(Math.abs(dx*ux+dz*uz)>ra+rb)return false;
  }
  return true;
}

function touchesAny(p:Pose,a:Footprint,b:Trajectory,reach:number){
  for(const q of b.poses)if(Math.abs(q.x-p.x)<=reach&&Math.abs(q.z-p.z)<=reach&&footprintsOverlap(p,a,q,b))return true;
  return false;
}

/** Travel along `a` before its footprint first meets any sampled pose of `b`
 * (0 when it already does), or undefined when the routes stay clear. */
export function firstContact(a:Trajectory,b:Trajectory){
  const reach=Math.hypot(a.halfLength+CONFLICT.lengthMargin,a.halfWidth+CONFLICT.widthMargin)+Math.hypot(b.halfLength+CONFLICT.lengthMargin,b.halfWidth+CONFLICT.widthMargin);
  for(let k=0;k<a.poses.length;k++){
    if(!touchesAny(a.poses[k],a,b,reach))continue;
    if(k===0)return 0;
    let clear=(k-1)*CONFLICT.step,hit=k*CONFLICT.step;
    for(let i=0;i<5;i++){const mid=(clear+hit)/2;if(touchesAny(a.pose(mid),a,b,reach))hit=mid;else clear=mid;}
    return clear;
  }
}

/** Travel along `a`, from its first contact `entry`, at which it has passed
 * clear of every sampled pose of `b`; Infinity when it is still in the way at
 * the end of its look-ahead (the two routes merge or run together). */
export function clearance(a:Trajectory,b:Trajectory,entry:number){
  const reach=Math.hypot(a.halfLength+CONFLICT.lengthMargin,a.halfWidth+CONFLICT.widthMargin)+Math.hypot(b.halfLength+CONFLICT.lengthMargin,b.halfWidth+CONFLICT.widthMargin);
  for(let k=Math.max(0,Math.ceil(entry/CONFLICT.step));k<a.poses.length;k++)if(!touchesAny(a.poses[k],a,b,reach))return k*CONFLICT.step;
  return Infinity;
}

/** Whether two cars meet across each other's path (a junction crossing or a
 * turn across a lane) rather than merging into or following along one lane. */
export function crossing(a:Pose,b:Pose){return Math.abs(Math.cos(a.yaw-b.yaw))<.8;}

const committed=(c:Claim)=>!c.stopsShort&&c.speed*c.speed/(2*CONFLICT.brake)>c.travel-CONFLICT.buffer;
const eta=(c:Claim)=>c.stopsShort?Infinity:c.travel/Math.max(c.speed,2);

/** Which car goes first, or undefined when both may (they are moving apart).
 * In order: deadlock priority; for cars already touching, the one with nothing
 * in front; a car already in the other's path; a car too fast to stop; the
 * decision remembered from the previous step, so the order cannot flip while
 * both brake; then the earlier arrival. Index breaks every remaining tie. */
export function rightOfWay(i:Claim,j:Claim,remembered?:number){
  if(i.forced!==j.forced)return i.forced?i.index:j.index;
  const iIn=i.travel<=0,jIn=j.travel<=0;
  if(iIn&&jIn){
    if(!i.otherAhead&&!j.otherAhead)return;
    if(i.otherAhead!==j.otherAhead)return i.otherAhead?j.index:i.index;
    return remembered??Math.min(i.index,j.index);
  }
  if(iIn!==jIn)return iIn?i.index:j.index;
  const ic=committed(i),jc=committed(j);if(ic!==jc)return ic?i.index:j.index;
  if(remembered!==undefined)return remembered;
  const ie=eta(i),je=eta(j);if(ie!==je)return ie<je?i.index:j.index;
  return Math.min(i.index,j.index);
}

/** Speed at which the yielding car can still stop `CONFLICT.buffer` short of the contact. */
export const yieldSpeed=(travel:number)=>Math.sqrt(Math.max(0,2*CONFLICT.decel*(travel-CONFLICT.buffer)));

/** Find a cycle of cars each stopped for the next (`blockers[i]`, -1 for none)
 * that includes or is reached from `start`; the cars in it, or undefined. */
export function blockingCycle(start:number,blockers:ArrayLike<number>){
  const chain=[start];let next=blockers[start];
  while(next>=0&&!chain.includes(next)&&chain.length<16){chain.push(next);next=blockers[next];}
  return next>=0&&chain.includes(next)?chain.slice(chain.indexOf(next)):undefined;
}
