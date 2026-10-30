import './helpers/npc-fleet.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {headOnThreat,advanceEvasion} from '../src/simulation/traffic-evasion.ts';
import {createTraffic} from '../src/simulation/traffic.ts';
import {DrivingPhysics} from '../src/physics/vehicle.ts';

test('head-on prediction distinguishes a collision course from ordinary passing and other levels',()=>{
  const car={x:0,y:.65,z:0,yaw:0,speed:6,halfLength:2.4,halfWidth:.95};
  const player={x:0,y:.7,z:35,yaw:Math.PI,speed:14,steering:0};
  assert.ok(headOnThreat(car,player));
  for(const change of [{x:4.5},{yaw:0},{yaw:Math.PI/2},{speed:0},{speed:-14},{y:7},{z:-30},{z:100}])assert.equal(headOnThreat(car,{...player,...change}),undefined,JSON.stringify(change));
  assert.equal(headOnThreat(car,{...player,x:1.5,yaw:Math.PI-.2}),undefined,'an opposing driver already steering clear is not a collision course');
});

test('lateral evasion accelerates smoothly and never slides a stopped vehicle sideways',()=>{
  const state={offset:0,velocity:0,target:2.4,holdUntil:0};
  for(let i=0;i<120;i++){const next=advanceEvasion(state,1/60,6);assert.ok(Math.abs(next.velocity-state.velocity)<=2.6/60+1e-8);assert.ok(Math.abs(next.velocity)<=1.8);Object.assign(state,next);}
  assert.ok(state.offset>2&&state.offset<=2.4);
  const stopped=advanceEvasion(state,1/60,0);assert.equal(stopped.offset,state.offset);assert.equal(stopped.velocity,0);
  state.target=0;
  for(let i=0;i<360;i++)Object.assign(state,advanceEvasion(state,1/60,6));
  assert.ok(Math.abs(state.offset)<.02,'the car returns without overshooting its lane');
});

async function fixture(){
  const city={bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000},buildings:[],roads:[{id:'straight',name:'Test Street',width:14,oneway:0,points:[[-400,0],[400,0]]}],spawn:{x:-150,z:0,yaw:Math.PI/2}};
  const physics=await DrivingPhysics.create(city),traffic=createTraffic(new THREE.Scene(),city,physics),far={x:700,y:.65,z:700,yaw:0,speed:0,steering:0};
  physics.body.setTranslation(far,true);
  for(let i=0;i<180;i++){traffic.update(1/60,far,far);physics.world.step();}
  const index=traffic.snapshot().findIndex(a=>a.speed>4&&a.type==='compact'&&Math.sin(a.yaw)>.99),actor=traffic.snapshot()[index];assert.ok(actor,'a rolling compact is available');
  return{physics,traffic,far,index,actor,dispose(){traffic.dispose();physics.dispose();}};
}

test('an NPC steers away from a predicted head-on, stays on pavement, then rejoins its lane',async()=>{
  const f=await fixture();
  try{
    const {actor}=f,fx=Math.sin(actor.yaw),fz=Math.cos(actor.yaw),player={...f.far,x:actor.x+fx*42,z:actor.z+fz*42,yaw:actor.yaw+Math.PI,speed:14};
    let peak=0,steer=0,firstOffset=0;
    for(let i=0;i<540;i++){
      f.traffic.update(1/60,player,f.far);f.physics.world.step();player.x-=fx*14/60;player.z-=fz*14/60;
      const now=f.traffic.snapshot()[f.index];peak=Math.max(peak,Math.abs(now.evasion));steer=Math.max(steer,Math.abs(now.steering));if(!firstOffset&&now.evasion)firstOffset=now.evasion;
      const corner=Math.abs(now.z)+now.halfWidth*Math.abs(Math.sin(now.yaw))+now.halfLength*Math.abs(Math.cos(now.yaw));
      assert.ok(corner<6.81,`the entire car stays clear of the curb: ${corner}`);
    }
    assert.ok(firstOffset<0,'a centered threat favors the NPC’s own curb');
    assert.ok(peak>.8,`the car visibly swerves (${peak} m)`);assert.ok(steer>.05,'front wheels steer during the maneuver');
    assert.ok(Math.abs(f.traffic.snapshot()[f.index].evasion)<.03,'the car returns to its lane after the player passes');
  }finally{f.dispose();}
});

test('an NPC brakes instead of swerving through a blocked escape corridor',async()=>{
  const f=await fixture();
  try{
    const {actor}=f;
    for(const side of [-1,1])f.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(35,1,.15).setTranslation(actor.x+15,1,actor.z+side*1.3));
    f.physics.world.step();
    const player={...f.far,x:actor.x+35,z:actor.z,yaw:actor.yaw+Math.PI,speed:14};let peak=0,minSpeed=actor.speed;
    for(let i=0;i<120;i++){
      f.traffic.update(1/60,player,f.far);f.physics.world.step();player.x-=14/60;
      const now=f.traffic.snapshot()[f.index];peak=Math.max(peak,Math.abs(now.evasion));minSpeed=Math.min(minSpeed,now.speed);
    }
    assert.ok(peak<.05,`the walls prevent an unsafe escape (${peak} m)`);assert.ok(minSpeed<actor.speed-1,'braking remains active');
  }finally{f.dispose();}
});
