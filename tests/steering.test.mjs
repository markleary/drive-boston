import assert from 'node:assert/strict';
import test from 'node:test';
import {Vector3,Quaternion} from 'three';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {createBike} from '../src/render/bike.ts';
const city={bounds:{minX:-10000,maxX:10000,minZ:-10000,maxZ:10000},buildings:[],spawn:{x:0,z:0,yaw:0}};
const released={throttle:0,brake:0,steer:0,handbrake:false};
async function turn(kind,speed,steer,dt=1/60){
 const p=await DrivingPhysics.create(city);p.setVehicleType(kind);
 try{
  for(let i=0;i<120;i++)p.step(released,1/60);
  p.body.setLinvel({x:0,y:0,z:speed},true);let yaw=0,distance=0;
  for(let i=0;i<Math.round(2/dt);i++){
   const before=p.getState();p.step({...released,throttle:.25,steer},dt);const after=p.getState();
   yaw+=Math.atan2(Math.sin(after.yaw-before.yaw),Math.cos(after.yaw-before.yaw));distance+=Math.hypot(after.x-before.x,after.z-before.z);
  }
  return {state:p.getState(),yaw,radius:distance/Math.abs(yaw),front:p.controller.wheelSteering(0),rear:p.controller.wheelSteering(kind==='car'?2:1)};
 }finally{p.dispose();}
}

test('car full-lock arcs are slightly tighter at parking and road speeds in either direction',async()=>{
 // Previous measured radii were 6.74 m and 31.71 m with this input trace.
 for(const [speed,low,high] of [[3,6,6.6],[15,28,30.5]])for(const steer of [-1,1]){
  const result=await turn('car',speed,steer);
  assert.ok(result.radius>low&&result.radius<high,`${speed} m/s, steer ${steer}: radius ${result.radius}`);
  assert.ok(result.yaw*steer>.7,'tire forces must change the heading');assert.equal(result.rear,0);
 }
});

test('Ultra Bee steers its front tire and leans into a tighter physical arc in either direction',async()=>{
 // Old steering attenuation measured 4.35 m and 41.60 m respectively.
 for(const [speed,low,high] of [[3,3,3.6],[15,30,34]])for(const steer of [-1,1]){
  const result=await turn('ultrabee',speed,steer),s=result.state;
  assert.ok(result.radius>low&&result.radius<high,`${speed} m/s, steer ${steer}: radius ${result.radius}`);
  assert.ok(result.yaw*steer>.5,'the bike must change heading as well as lean');
  assert.ok(Math.abs(result.front-s.steering)<1e-6,'lean must not reduce the commanded tire angle');assert.equal(result.rear,0);
  const up=new Vector3(0,1,0).applyQuaternion(new Quaternion(s.rotation.x,s.rotation.y,s.rotation.z,s.rotation.w));
  const bank=Math.atan2(up.x*Math.cos(s.yaw)-up.z*Math.sin(s.yaw),up.y);
  assert.ok(bank*steer>.25&&Math.abs(bank-s.lean)<.1,'the physical bank follows the steering demand');
 }
});

test('turning remains consistent between 60 and 120 Hz',async()=>{
 for(const kind of ['car','ultrabee']){
  const a=await turn(kind,8,1),b=await turn(kind,8,1,1/120);
  assert.ok(Math.abs(a.radius-b.radius)/a.radius<.04,`${kind} turn radius must not depend on step frequency`);
 }
});

test('Ultra Bee front assembly turns together and the rider keeps both hands on the grips',async()=>{
 const model=createBike(),steering=model.group.getObjectByName('UltraBeeSteering'),wheel=model.group.getObjectByName('FrontWheel');
 for(const steer of [-.5,0,.5]){
  model.update({x:2,y:1,z:3,rotation:{x:0,y:Math.sin(.4),z:0,w:Math.cos(.4)},steering:steer,suspension:[.17,.17],wheelAngles:[0,0],wheelie:.3,lean:steer,braking:false},false);
  model.group.updateMatrixWorld(true);
  assert.equal(wheel.parent,steering,'forks and wheel must share the steering pivot');
  assert.ok(wheel.getWorldQuaternion(new Quaternion()).angleTo(steering.getWorldQuaternion(new Quaternion()))<1e-6);
  for(const side of [-1,1]){
   const expected=steering.localToWorld(new Vector3(side*.37,.25,-.09));
   const actual=model.group.getObjectByName(side<0?'LeftGlove':'RightGlove').getWorldPosition(new Vector3());
   assert.ok(expected.distanceTo(actual)<1e-6,`hand must stay on its grip at steering ${steer}`);
  }
 }
 model.update({x:0,y:0,z:0,rotation:{x:0,y:0,z:0,w:1},steering:0,suspension:[],wheelAngles:[],wheelie:0,lean:0,braking:false},false,true);
 assert.equal(model.helmet.visible,false,'helmet stays hidden in rider-eye view');
});
