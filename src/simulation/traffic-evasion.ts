import type {VehicleState} from '../types';

export interface Evasion {offset:number;velocity:number;target:number;holdUntil:number;}
interface Car {x:number;y:number;z:number;yaw:number;speed:number;halfLength:number;halfWidth:number;}
/** Predict an overlapping, opposing approach; ordinary opposing-lane traffic,
 * crossing traffic, reverse motion, and different bridge levels are excluded. */
export function headOnThreat(car:Car,player:VehicleState){
  const heading=Math.cos(player.yaw-car.yaw);
  if(player.speed<3||heading>-.65||Math.abs(player.y-car.y)>2.2)return;
  const dx=player.x-car.x,dz=player.z-car.z,along=dx*Math.sin(car.yaw)+dz*Math.cos(car.yaw),across=dx*Math.cos(car.yaw)-dz*Math.sin(car.yaw);
  const closing=car.speed-player.speed*heading,gap=along-car.halfLength-2.1;
  if(gap<=0||along>65||closing<6)return;
  const time=gap/closing,predictedAcross=across+player.speed*Math.sin(player.yaw-car.yaw)*time;
  if(time<.15||time>2.2||Math.abs(predictedAcross)>car.halfWidth+.9+.25)return;
  return{along,across:predictedAcross,time};
}

/** Accelerate sideways gently, at an angle a rolling car can actually steer.
 * Returning is slower; a stationary/braked car never slides sideways. */
export function advanceEvasion(state:Evasion,dt:number,speed:number){
  const limit=Math.min(state.target===0?.85:1.8,Math.max(0,speed)*.4),error=state.target-state.offset;
  const desired=Math.max(-limit,Math.min(limit,error*2.8));
  let velocity=Math.max(-limit,Math.min(limit,state.velocity+Math.max(-2.6*dt,Math.min(2.6*dt,desired-state.velocity))));
  let offset=state.offset+velocity*dt;
  if((state.target-offset)*error<0){offset=state.target;velocity=0;}
  return{offset,velocity};
}
