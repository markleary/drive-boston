import RAPIER from '@dimforge/rapier3d-compat';
import type { DriveInput } from '../types';

/** Original Ultra Bee X, 19-inch wheels, Sport output. SI units throughout.
 * https://sur-ronglobal.com/surron-ultra-bee/ — 85 kg, 12.5 kW, 440 Nm,
 * 90 km/h, 1.38 m wheelbase, 240 mm travel, 0–50 km/h in 2.3 s.
 * Add the manufacturer's 70 kg reference rider to the moving body. */
export const ULTRA_BEE = {
  curbMass:85, riderMass:70, peakPower:12500, wheelTorque:440,
  maxSpeed:25, reverseSpeed:1.5, wheelbase:1.38, wheelRadius:.322,
  suspensionRest:.24, suspensionTravel:.24, spawnHeight:.64,
  wheelieDuration:3, wheelieAngle:.48,
  maxSteering:.60, maxLateralAcceleration:6.8,
};
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));

/** Two actual wheel rays and rear-wheel drive. The virtual rider supplies balance
 * torques, not position/velocity overrides: tires, gravity and impacts still own motion. */
export class BikeDynamics {
  readonly controller:RAPIER.DynamicRayCastVehicleController;
  private world:RAPIER.World;
  private body:RAPIER.RigidBody;
  private collider:RAPIER.Collider;
  steering=0; braking=false; lean=0; wheelie=0; wheelieRemaining=0;
  private wheelieHeld=false;
  private cooldown=0;
  private pedal=0;
  constructor(world:RAPIER.World,body:RAPIER.RigidBody,collider:RAPIER.Collider){
    this.world=world;this.body=body;this.collider=collider;
    collider.setShape(new RAPIER.Cuboid(.16,.24,.59));
    collider.setMassProperties(ULTRA_BEE.curbMass+ULTRA_BEE.riderMass,{x:0,y:.12,z:0},{x:45,y:65,z:18},{x:0,y:0,z:0,w:1});
    body.setLinearDamping(.015);body.setAngularDamping(.5);
    const c=this.controller=world.createVehicleController(body);c.indexUpAxis=1;c.setIndexForwardAxis=2;
    for(const z of [ULTRA_BEE.wheelbase/2,-ULTRA_BEE.wheelbase/2]){
      const i=c.numWheels();c.addWheel({x:0,y:-.06,z},{x:0,y:-1,z:0},{x:-1,y:0,z:0},ULTRA_BEE.suspensionRest,ULTRA_BEE.wheelRadius);
      c.setWheelSuspensionStiffness(i,100);c.setWheelSuspensionCompression(i,5);c.setWheelSuspensionRelaxation(i,6);
      c.setWheelMaxSuspensionTravel(i,ULTRA_BEE.suspensionTravel/2);c.setWheelMaxSuspensionForce(i,5000);
      c.setWheelFrictionSlip(i,2.2);c.setWheelSideFrictionStiffness(i,1.3);
    }
  }
  reset(){this.steering=0;this.braking=false;this.lean=0;this.wheelie=0;this.wheelieRemaining=0;this.wheelieHeld=false;this.cooldown=0;this.pedal=0;}
  step(input:DriveInput,dt:number,speed:number,yaw:number){
    const c=this.controller,b=this.body,v=Math.abs(speed),throttle=clamp(input.throttle,-1,1);
    const reversing=throttle*speed<-.2,brake=Math.max(clamp(input.brake,0,1),input.handbrake?1:0,reversing?1:0);
    this.braking=brake>.05;
    const rearContact=c.wheelIsInContact(1),grounded=rearContact||c.wheelIsInContact(0);
    this.cooldown=Math.max(0,this.cooldown-dt);
    if(input.wheelie&&!this.wheelieHeld&&this.cooldown===0&&rearContact&&speed>2&&speed<20&&throttle>.2&&!this.braking){this.wheelieRemaining=ULTRA_BEE.wheelieDuration;this.cooldown=ULTRA_BEE.wheelieDuration+.8;}
    this.wheelieHeld=!!input.wheelie;
    this.wheelieRemaining=Math.max(0,this.wheelieRemaining-dt);
    if(this.braking||throttle<.1||speed<1||speed>22||!grounded)this.wheelieRemaining=0;
    const pitchTarget=ULTRA_BEE.wheelieAngle*Math.min(1,this.wheelieRemaining/.5);
    this.wheelie+=(pitchTarget-this.wheelie)*(1-Math.exp(-6*dt));
    // Bar steering at walking pace, tighter arcs at road speeds. Both the tire and
    // rider use this same angle so banking cannot silently reduce steering again.
    // The lifted front tire cannot steer, so wheelies have very limited turn authority.
    const lock=Math.min(ULTRA_BEE.maxSteering,Math.atan(ULTRA_BEE.maxLateralAcceleration*ULTRA_BEE.wheelbase/(v*v+5)));
    const requested=clamp(input.steer,-1,1)*lock*(this.wheelieRemaining>0?.25:1);
    this.steering+=(requested-this.steering)*(1-Math.exp(-5*dt));
    const leanTarget=grounded?clamp(Math.atan(speed*speed*Math.tan(this.steering)/(ULTRA_BEE.wheelbase*9.81)),-.6,.6):0;
    this.lean+=(leanTarget-this.lean)*(1-Math.exp(-4*dt));
    this.pedal+=(throttle-this.pedal)*(1-Math.exp(-18*dt));
    const powerLimit=throttle>=0?ULTRA_BEE.maxSpeed:ULTRA_BEE.reverseSpeed;
    const governor=clamp((powerLimit-v)/.3,0,1);
    // Sport delivery/traction allowance accounts for drivetrain losses and SRTC;
    // calibrated with the 70 kg rider against the published 2.3-second sprint.
    const drive=brake>.1?0:this.pedal*Math.min(ULTRA_BEE.wheelTorque/ULTRA_BEE.wheelRadius,ULTRA_BEE.peakPower/Math.max(1,v))*.82*governor;
    c.setWheelSteering(0,this.steering);c.setWheelSteering(1,0);
    c.setWheelEngineForce(0,0);c.setWheelEngineForce(1,drive);
    const regen=Math.abs(throttle)<.05?35:0;
    for(let i=0;i<2;i++)c.setWheelBrake(i,((brake*155*9)*(i===0?.65:.35)+regen)*dt);
    c.updateVehicle(dt,undefined,undefined,collider=>collider.handle!==this.collider.handle);
    const vel=b.linvel(),horizontal=Math.hypot(vel.x,vel.z);
    if(horizontal>.01){const drag=(.32*horizontal*horizontal+14)*dt;b.applyImpulse({x:-vel.x/horizontal*drag,y:0,z:-vel.z/horizontal*drag},true);}
    if(!grounded)return;
    // Desired up vector follows the actual supporting surface, then banks into the
    // turn and pitches back for a wheelie. A PD rider balances about pitch/roll only.
    const normals=[0,1].filter(i=>c.wheelIsInContact(i)).map(i=>c.wheelContactNormal(i)!);
    if(!normals.length)return;
    const n=normals.reduce((a,v)=>({x:a.x+v.x,y:a.y+v.y,z:a.z+v.z}),{x:0,y:0,z:0});
    const len=Math.hypot(n.x,n.y,n.z)||1;n.x/=len;n.y/=len;n.z/=len;
    if(n.y<.5)return;
    const sx=Math.sin(yaw),cz=Math.cos(yaw),bank=Math.tan(this.lean),pitch=Math.tan(this.wheelie);
    const target={x:n.x+cz*bank-sx*pitch,y:n.y,z:n.z-sx*bank-cz*pitch};
    const tl=Math.hypot(target.x,target.y,target.z);target.x/=tl;target.y/=tl;target.z/=tl;
    const q=b.rotation(),up={x:2*(q.x*q.y-q.w*q.z),y:1-2*(q.x*q.x+q.z*q.z),z:2*(q.y*q.z+q.w*q.x)};
    const error={x:up.y*target.z-up.z*target.y,y:up.z*target.x-up.x*target.z,z:up.x*target.y-up.y*target.x},w=b.angvel();
    const rollError=error.x*sx+error.z*cz,rollRate=w.x*sx+w.z*cz;
    const pitchError=error.x*cz-error.z*sx,pitchRate=w.x*cz-w.z*sx;
    const roll=clamp(rollError*6000-rollRate*650,-1600,1600)*dt;
    const pitchTorque=clamp(pitchError*2700-pitchRate*430,-2200,2200)*dt;
    b.applyTorqueImpulse({x:sx*roll+cz*pitchTorque,y:0,z:cz*roll-sx*pitchTorque},true);
  }
}
