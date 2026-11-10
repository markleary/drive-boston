import * as THREE from 'three';

/** A struck person: thrown through the air as a tumbling body, lying still, then rising.
 * Shared by the sidewalk walkers and the player on foot, so both fall the same way. */
export interface KnockedDown { phase:'air'|'down'|'rising'; hip:THREE.Vector3; velocity:THREE.Vector3; spin:THREE.Vector3; orientation:THREE.Quaternion; timer:number; rest?:THREE.Quaternion; upright?:THREE.Quaternion; }
/** The moving vehicle a person can be struck by: its yaw and box are needed for the hit test. */
export interface KnockThreat { x:number; z:number; y?:number; speed?:number; yaw?:number; halfLength?:number; halfWidth?:number; }
/** Vehicle speed (m/s) below which touching a person does not knock them over. */
export const KNOCK_SPEED = 1.5;
/** Hip height of a standing body of height 1, and of one lying on the ground. */
export const HIP = .9, LYING = .32;
const UP = new THREE.Vector3(0, 1, 0), tumbleAxis = new THREE.Vector3(), tumbleStep = new THREE.Quaternion(), halfBody = new THREE.Vector3(), candidate = new THREE.Quaternion();
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Signed offset across the vehicle when (x, z) is inside its moving footprint (plus `margin`) at its level, else undefined. */
export function struckBy(x:number,y:number,z:number,threat:KnockThreat,margin=.3){
  if(threat.yaw===undefined||Math.abs(threat.speed??0)<=KNOCK_SPEED)return undefined;
  const dx=x-threat.x,dz=z-threat.z,fx=Math.sin(threat.yaw),fz=Math.cos(threat.yaw),along=dx*fx+dz*fz,across=dx*fz-dz*fx;
  return Math.abs(along)<(threat.halfLength??2.1)+margin&&Math.abs(across)<(threat.halfWidth??.95)+margin&&(threat.y===undefined||Math.abs(y-threat.y)<2.5)?across:undefined;
}
/** The flat pose nearest to `orientation`: on the back or the front, head pointing where the body's up axis leans. */
function lyingPose(orientation:THREE.Quaternion){
  const up=halfBody.set(0,1,0).applyQuaternion(orientation),forward=new THREE.Vector3(0,0,1).applyQuaternion(orientation);
  const head=Math.hypot(up.x,up.z)>.15?[up.x,up.z]:[forward.x,forward.z];
  const back=new THREE.Quaternion().setFromAxisAngle(UP,Math.atan2(-head[0],-head[1])).multiply(candidate.setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2));
  const front=new THREE.Quaternion().setFromAxisAngle(UP,Math.atan2(head[0],head[1])).multiply(candidate.setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2));
  return Math.abs(orientation.dot(back))>=Math.abs(orientation.dot(front))?back:front;
}
/** Thrown with the vehicle's motion plus a sideways shove off its line and a hop over the
 * hood, tumbling about the axis across the car. `feet` is the standing position; speeds are m/s. */
export function startKnock(feet:{x:number;y:number;z:number},yaw:number,height:number,threat:KnockThreat,across:number,random:()=>number):KnockedDown{
  const speed=Math.abs(threat.speed??0),direction=Math.sign(threat.speed??1)||1,fx=Math.sin(threat.yaw??0)*direction,fz=Math.cos(threat.yaw??0)*direction;
  const side=Math.sign(across)||1,px=fz*side,pz=-fx*side,shove=1.2+speed*.08;
  const velocity=new THREE.Vector3(fx*speed*.85+px*shove,1.3+Math.min(5,speed*.22),fz*speed*.85+pz*shove);
  const spin=new THREE.Vector3(fz,0,-fx).multiplyScalar(1.5+speed*.3);spin.y=(random()-.5)*2.5;
  return {phase:'air',hip:new THREE.Vector3(feet.x,feet.y+HIP*height,feet.z),velocity,spin,orientation:new THREE.Quaternion().setFromAxisAngle(UP,yaw),timer:0};
}
export interface KnockStep {
  /** Ground height under the body. */
  ground:number;
  /** 0..1 limp posture for the model. */
  sprawl:number;
  /** True on the step the body has stood back up; the caller clears its knocked state. */
  done:boolean;
}
/** Advance a knocked body by `dt`. `ground(x, z)` is the surface it lands on; `getUp()` is called
 * once when it starts to rise and returns the yaw to stand up facing. Writes the feet position
 * of the tumbling body to `feet`. */
export function stepKnock(k:KnockedDown,dt:number,height:number,ground:(x:number,z:number)=>number,getUp:()=>number,random:()=>number,feet:THREE.Vector3):KnockStep{
  const floor=ground(k.hip.x,k.hip.z),rest=floor+LYING;let sprawl=1,done=false;
  if(k.phase==='air'){
    k.velocity.y-=9.81*dt;k.hip.addScaledVector(k.velocity,dt);k.timer+=dt;
    const rate=k.spin.length();if(rate>1e-6){tumbleStep.setFromAxisAngle(tumbleAxis.copy(k.spin).divideScalar(rate),rate*dt);k.orientation.premultiply(tumbleStep).normalize();}
    let grounded=false;
    if(k.hip.y<=rest){
      grounded=true;const landing=k.hip.y<rest-.01;k.hip.y=rest;
      if(landing){if(k.velocity.y<0)k.velocity.y=-k.velocity.y*.25;k.velocity.x*=.7;k.velocity.z*=.7;k.spin.multiplyScalar(.55);}
      const slide=Math.exp(-5*dt);k.velocity.x*=slide;k.velocity.z*=slide;k.spin.multiplyScalar(Math.exp(-4*dt));
    }
    if((grounded&&k.velocity.length()<.35&&k.spin.length()<.6)||k.timer>6){k.phase='down';k.timer=1.2+random()*.9;k.rest=lyingPose(k.orientation);k.hip.y=rest;}
  }else if(k.phase==='down'){
    k.orientation.slerp(k.rest!,1-Math.exp(-8*dt));k.hip.y=rest;k.timer-=dt;
    if(k.timer<=0){k.phase='rising';k.timer=0;k.upright=new THREE.Quaternion().setFromAxisAngle(UP,getUp());}
  }else{
    k.timer+=dt;const u=Math.min(1,k.timer/1.1);
    k.orientation.slerp(k.upright!,1-Math.exp(-4.5*dt));k.hip.y=THREE.MathUtils.lerp(rest,floor+HIP*height,smooth(u));sprawl=1-smooth(u);
    if(u>=1){done=true;sprawl=0;k.orientation.copy(k.upright!);k.hip.y=floor+HIP*height;}
  }
  // Feet sit a body half-length below the hip along the body's own axis.
  halfBody.set(0,-HIP*height,0).applyQuaternion(k.orientation);feet.copy(k.hip).add(halfBody);
  return {ground:floor,sprawl,done};
}
