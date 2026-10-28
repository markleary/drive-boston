import assert from 'node:assert/strict';
import test from 'node:test';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {ULTRA_BEE} from '../src/physics/bike.ts';
import {loadCentralCity} from './helpers/metro-city.mjs';
const flat={bounds:{minX:-10000,maxX:10000,minZ:-10000,maxZ:10000},buildings:[],spawn:{x:0,z:0,yaw:0}};
const released={throttle:0,brake:0,steer:0,handbrake:false};
function advance(p,seconds,input={},dt=1/60){for(let i=0;i<Math.round(seconds/dt);i++)p.step({...released,...input},dt);return p.getState();}
async function bike(city=flat){const p=await DrivingPhysics.create(city);p.setVehicleType('ultrabee');advance(p,2);return p;}
const pitch=s=>-Math.asin(2*(s.rotation.w*s.rotation.x-s.rotation.y*s.rotation.z));

test('Ultra Bee physical mass, two wheels, acceleration and speed match original reference specs',async()=>{
  const p=await bike();try{
    assert.equal(p.body.mass(),ULTRA_BEE.curbMass+ULTRA_BEE.riderMass);
    assert.equal(p.controller.numWheels(),2);
    assert.ok([0,1].every(i=>p.controller.wheelIsInContact(i)));
    let time=0;while(p.getState().speed<50/3.6&&time<5){advance(p,1/60,{throttle:1});time+=1/60;}
    assert.ok(Math.abs(time-2.3)<.15,`0–50 km/h: ${time.toFixed(3)} s`);
    const fast=advance(p,25,{throttle:1});
    assert.ok(fast.speed>24.5&&fast.speed<=25,`top speed ${fast.speed*3.6} km/h`);
    assert.ok(Math.abs(p.controller.wheelEngineForce(0))<.001,'front wheel is unpowered');
    const stopped=advance(p,5,{handbrake:true});assert.ok(Math.abs(stopped.speed)<.05);
    const reverse=advance(p,4,{throttle:-1});assert.ok(reverse.speed<-.5&&reverse.speed>=-1.6,'walking-speed reverse assist');
  }finally{p.dispose();}
});

test('wheelie physically lifts the front tire, ends after three seconds, cannot retrigger while held, and brakes cancel it',async()=>{
  const p=await bike();try{
    advance(p,1,{throttle:1,wheelie:true});assert.equal(p.getState().wheelieRemaining,0,'cannot trigger at rest or queue a held key');
    advance(p,.2,{throttle:1});
    const lifted=advance(p,1,{throttle:1,wheelie:true});
    assert.ok(pitch(lifted)>.3,'chassis must pitch back');
    assert.equal(p.controller.wheelIsInContact(0),false,'front tire must leave the ground');
    assert.equal(p.controller.wheelIsInContact(1),true,'rear tire supports the wheelie');
    assert.ok(lifted.wheelieRemaining>1.8&&lifted.wheelieRemaining<2.1);
    const landed=advance(p,5,{throttle:.3,wheelie:true});assert.equal(landed.wheelieRemaining,0);assert.ok(Math.abs(pitch(landed))<.12);
    assert.ok([0,1].every(i=>p.controller.wheelIsInContact(i)));
    p.reset(0,0,0);advance(p,2);advance(p,1,{throttle:1});advance(p,.7,{throttle:1,wheelie:true});
    assert.ok(pitch(p.getState())>.2);advance(p,.8,{handbrake:true,wheelie:true});
    assert.equal(p.getState().wheelieRemaining,0);assert.ok(Math.abs(pitch(p.getState()))<.2);
  }finally{p.dispose();}
});

test('motorcycle banks into both turns and the rider balances it upright after releasing steering',async()=>{
  for(const steer of [-1,1]){const p=await bike();try{
    advance(p,2,{throttle:1});const turning=advance(p,3,{throttle:.5,steer});
    assert.ok(turning.yaw*steer>.7,'tire forces turn the bike in the requested direction');
    const upX=2*(turning.rotation.x*turning.rotation.y-turning.rotation.w*turning.rotation.z),upZ=2*(turning.rotation.y*turning.rotation.z+turning.rotation.w*turning.rotation.x);
    assert.ok((upX*Math.cos(turning.yaw)-upZ*Math.sin(turning.yaw))*steer>.3,'actual chassis banks into the turn');
    assert.ok(turning.rotation.x**2+turning.rotation.z**2<.3,'bike remains balanced');
    const straight=advance(p,3);assert.ok(straight.rotation.x**2+straight.rotation.z**2<.002,'release stands the bike up');
  }finally{p.dispose();}}
});

test('bike fixed steps agree, reset clears stunts, and switching restores the car collider and four-wheel controller',async()=>{
  const states=[];for(const dt of [1/60,1/120]){const p=await bike();try{states.push(advance(p,3,{throttle:1},dt));}finally{p.dispose();}}
  assert.ok(Math.abs(states[0].speed-states[1].speed)<.3);assert.ok(Math.abs(states[0].z-states[1].z)<.5);
  const p=await bike();try{
    advance(p,1,{throttle:1});advance(p,.5,{throttle:1,wheelie:true});p.reset(0,0,0);
    assert.equal(p.getState().wheelieRemaining,0);assert.equal(p.getState().wheelie,0);assert.equal(p.getState().speed,0);
    for(let i=0;i<3;i++){p.setVehicleType('car');assert.equal(p.body.mass(),1240);assert.equal(p.controller.numWheels(),4);assert.equal(p.chassisCollider.shape.halfExtents.x,.85);advance(p,1);p.setVehicleType('ultrabee');assert.equal(p.body.mass(),155);assert.equal(p.controller.numWheels(),2);}
  }finally{p.dispose();}
});

test('bike rides real Boston terrain and brakes on Mission Hill',async()=>{
  const city=await loadCentralCity(),p=await bike(city);try{
    const s=advance(p,1,{throttle:1});assert.ok(s.speed>4);assert.ok([s.x,s.y,s.z].every(Number.isFinite));
    const start=city.landmarks.find(l=>l.id==='mission-hill').driveStart;p.reset(start.x,start.z,start.yaw);advance(p,2,{handbrake:true});
    const riding=advance(p,1.5,{throttle:1});assert.ok(riding.speed>3,'bike climbs the real grade');
    const stopped=advance(p,3,{handbrake:true});assert.ok(Math.abs(stopped.speed)<.2,'brakes hold the bike on the grade');
  }finally{p.dispose();}
});

test('bike collides with a building and cannot tunnel through it at speed',async()=>{
  const city={...flat,buildings:[{id:'wall',height:8,center:[0,35],footprint:[[-10,34],[10,34],[10,36],[-10,36]]}]};
  const p=await bike(city);try{advance(p,5,{throttle:1});assert.ok(p.getState().z<34,'building hull must stop the physical bike');assert.ok(Number.isFinite(p.getState().y));}finally{p.dispose();}
});

test('the complete bike model has valid merged meshes and metric proportions',async()=>{
  const {createBike}=await import('../src/render/bike.ts');const {Box3,Vector3,Mesh}=await import('three');
  const bike=createBike(),size=new Box3().setFromObject(bike.group).getSize(new Vector3());
  assert.ok(size.x>.8&&size.x<.9);assert.ok(size.z>2&&size.z<2.1);
  let meshes=0;bike.group.traverse(o=>{if(o instanceof Mesh){meshes++;assert.ok(o.geometry.getAttribute('position').count>0);for(const n of o.geometry.getAttribute('position').array)assert.ok(Number.isFinite(n));}});
  assert.ok(meshes>15&&meshes<45,'bike detail must be batched into a bounded number of draws');
});
