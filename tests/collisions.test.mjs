import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {DrivingPhysics,IMPACT_THRESHOLD,CRASH_KICK} from '../src/physics/vehicle.ts';
import {createTraffic,KNOCK_SPEED} from '../src/simulation/traffic.ts';
import {createStreetLife,PEDESTRIAN_HIT_SPEED} from '../src/render/street-life.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {loadCentralCity} from './helpers/metro-city.mjs';

const released={throttle:0,brake:0,steer:0,handbrake:false};
const road=(id,z,oneway=0)=>({id,name:id,width:10,oneway,points:[[-400,z],[400,z]]});
const flat={bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000},buildings:[],roads:[road('Straight',0)],spawn:{x:-150,z:0,yaw:Math.PI/2}};
const upY=s=>1-2*(s.rotation.x*s.rotation.x+s.rotation.z*s.rotation.z);
const city=await loadCentralCity();
const routeDistance=person=>{const {start,end}=person.route,dx=end[0]-start[0],dz=end[1]-start[1],t=((person.position.x-start[0])*dx+(person.position.z-start[1])*dz)/(dx*dx+dz*dz);return {t,distance:Math.hypot(person.position.x-start[0]-dx*t,person.position.z-start[1]-dz*t)};};

test('a hard frontal hit is reported with its contacts and the crash kick dips the nose without flipping the car',async()=>{
  const p=await DrivingPhysics.create(flat);
  try{
    const wall=p.world.createCollider(RAPIER.ColliderDesc.cuboid(1.25,1.3,5.9).setTranslation(0,1.6,0).setFriction(.5),p.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()));
    let impacts=[],minUp=1,maxY=0,quiet=0;
    for(let i=0;i<60*12;i++){
      p.step({...released,throttle:impacts.length?0:1},1/60);const s=p.getState();
      const knocks=p.takeImpacts();if(!impacts.length&&!knocks.length)quiet++;impacts.push(...knocks);
      if(impacts.length){minUp=Math.min(minUp,upY(s));maxY=Math.max(maxY,s.y);}
    }
    assert.ok(quiet>200,'ordinary acceleration on level ground must not register impacts');
    assert.ok(impacts.length>=1&&impacts[0].severity>15&&impacts[0].speed>18,`the wall hit is a severe impact: ${JSON.stringify(impacts[0])}`);
    assert.ok(impacts[0].colliders.includes(wall.handle),'the impact names the collider that was struck');
    assert.ok(impacts.every(i=>i.severity>=IMPACT_THRESHOLD));
    assert.ok(minUp<.92&&maxY>1.1,`the nose dives and the tail lifts (minUp ${minUp.toFixed(2)}, peak height ${maxY.toFixed(2)})`);
    const after=p.getState();assert.ok(upY(after)>.95&&after.y<1,'the car settles back on its wheels');
    assert.ok(p.terrainColliders.size===1&&!p.terrainColliders.has(wall.handle),'ground colliders are tracked separately from the obstacle');
    assert.equal(p.takeImpacts().length,0,'impacts are handed over once');
  }finally{p.dispose();}
});

test('the crash kick scales with the hit and stays off for the bike',async()=>{
  const original={...CRASH_KICK};
  try{
    for(const [kind,scale] of [['car',0],['car',CRASH_KICK.scale],['ultrabee',CRASH_KICK.scale]]){
      Object.assign(CRASH_KICK,original,{scale});
      const p=await DrivingPhysics.create(flat);p.setVehicleType(kind);
      try{
        p.world.createCollider(RAPIER.ColliderDesc.cuboid(1.25,1.3,5.9).setTranslation(0,1.6,0).setFriction(.5),p.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()));
        let hit=false,minUp=1;
        for(let i=0;i<60*10;i++){p.step({...released,throttle:hit?0:1},1/60);if(p.takeImpacts().length)hit=true;if(hit&&kind==='car')minUp=Math.min(minUp,upY(p.getState()));}
        assert.ok(hit,`${kind} reaches the wall`);
        if(kind==='car')assert.ok(scale?minUp<.92:minUp>.97,`kick ${scale} gives nose dip ${minUp.toFixed(3)}`);
      }finally{p.dispose();}
    }
  }finally{Object.assign(CRASH_KICK,original);}
});

test('a struck traffic car is shoved as a dynamic body, then eases back into its lane as a lane keeper',async()=>{
  const physics=await DrivingPhysics.create(city),scene=new THREE.Scene(),traffic=createTraffic(scene,city,physics);
  try{
    const far={...physics.getState(),x:city.bounds.minX+40,z:city.bounds.minZ+40};
    for(let i=0;i<120;i++)traffic.update(1/60,far,far,[]);
    const index=traffic.snapshot().findIndex(a=>a.speed>4),before=traffic.snapshot()[index];assert.ok(index>=0,'a moving lane keeper is available');
    assert.equal(before.knocked,false);assert.equal(before.dynamic,false);
    // Launch the player at the car from six metres behind it along its heading.
    const fx=Math.sin(before.yaw),fz=Math.cos(before.yaw),x=before.x-fx*6,z=before.z-fz*6;
    physics.body.setTranslation({x,y:sampleElevation(city,x,z)+.78,z},true);physics.body.setRotation({x:0,y:Math.sin(before.yaw/2),z:0,w:Math.cos(before.yaw/2)},true);
    physics.body.setLinvel({x:fx*16,y:0,z:fz*16},true);physics.body.setAngvel({x:0,y:0,z:0},true);
    let knockedAt=-1,peakSpeed=0,impacts=[],restoredAt=-1;
    for(let i=0;i<60*16;i++){
      const state=physics.getState();traffic.update(1/60,state,state,[]);physics.step({...released,brake:i>30?1:0},1/60);
      impacts.push(...physics.takeImpacts());
      const now=traffic.snapshot()[index];
      if(now.knocked&&knockedAt<0){knockedAt=i;assert.equal(now.dynamic,true,'a knocked car runs on Rapier');}
      if(now.knocked)peakSpeed=Math.max(peakSpeed,now.speed);
      if(knockedAt>=0&&restoredAt<0&&!now.knocked&&!now.rejoining){restoredAt=i;assert.equal(now.dynamic,false,'the lane keeper is kinematic again');}
      assert.ok([now.x,now.z,now.yaw].every(Number.isFinite));
    }
    assert.ok(knockedAt>=0&&knockedAt<120,`the collision knocks the car within two seconds (step ${knockedAt})`);
    assert.ok(impacts.some(i=>i.colliders.some(h=>traffic.colliders.has(h))),'the player impact names the traffic collider');
    assert.ok(restoredAt>knockedAt,'the car comes to rest and rejoins its lane');
    assert.ok(restoredAt-knockedAt>60,'the car slides for a while before rejoining');
    assert.ok(peakSpeed>before.speed+2,`the hit accelerates the struck car from ${before.speed.toFixed(1)} to ${peakSpeed.toFixed(1)} m/s`);
    const after=traffic.snapshot()[index];assert.equal(after.knocked,false);assert.equal(after.dynamic,false);
    assert.ok(traffic.obstacles().every(o=>[o.x,o.y,o.z].every(Number.isFinite)));
    assert.ok(Math.abs(physics.getState().speed)<KNOCK_SPEED+30);
  }finally{traffic.dispose();physics.dispose();}
});

test('a struck walker is thrown, lies flat, gets up and rejoins a sidewalk route',()=>{
  const scene=new THREE.Scene(),life=createStreetLife(scene,city);
  try{
    const person=life.pedestrians[0],start=person.position.clone(),dt=1/60;let t=0;
    // A car heading east passes straight over the walker at 12 m/s.
    life.update(dt,t+=dt,undefined,{x:start.x,z:start.z,y:start.y,yaw:Math.PI/2,speed:12,halfLength:2.1,halfWidth:.95});
    assert.ok(person.knocked&&person.knocked.phase==='air','the walker is knocked into the air');
    assert.deepEqual(life.takeHits(),[12]);assert.equal(person.sprawl,1);assert.ok(person.orientation);
    const away={x:start.x+500,z:start.z+500,yaw:0,speed:0},phases=new Set(),up=new THREE.Vector3();
    let flat=false,maxHip=0,resumedAt=-1;
    for(let i=0;i<60*14;i++){
      life.update(dt,t+=dt,undefined,away);
      const k=person.knocked;
      if(k){
        phases.add(k.phase);const ground=sampleElevation(city,k.hip.x,k.hip.z);maxHip=Math.max(maxHip,k.hip.y-ground);
        assert.ok(k.hip.y>=ground+.3-1e-6,'the body never sinks into the road');
        if(k.phase==='down'&&Math.abs(up.set(0,1,0).applyQuaternion(k.orientation).y)<.15)flat=true;
      }else if(resumedAt<0)resumedAt=i;
      assert.ok([person.position.x,person.position.y,person.position.z].every(Number.isFinite));
    }
    assert.ok(phases.has('air')&&phases.has('down')&&phases.has('rising'),`all phases play out: ${[...phases]}`);
    assert.ok(maxHip>1.2,`thrown clear of the road (${maxHip.toFixed(2)} m)`);
    assert.ok(flat,'lies flat on the ground before getting up');
    assert.ok(resumedAt>60&&resumedAt<60*12,`back on their feet within twelve seconds (${resumedAt} steps)`);
    assert.equal(person.sprawl,0);assert.equal(person.orientation,undefined);
    assert.ok(person.position.distanceTo(start)>1,'thrown away from the point of impact');
    const route=routeDistance(person);assert.ok(route.distance<1e-5&&route.t>=-1e-6&&route.t<=1+1e-6,`walking a sidewalk route again after the rejoin fade (${route.distance.toFixed(3)} m off)`);
    const here=person.position.clone();life.update(dt,t+=dt,undefined,away);assert.ok(person.position.distanceTo(here)>1e-4,'walking resumed');
    assert.equal(life.takeHits().length,0);
    const jackets=scene.getObjectByName('Tailored jackets'),matrix=new THREE.Matrix4();jackets.getMatrixAt(0,matrix);assert.ok(matrix.elements.every(Number.isFinite));
    // A slow car only makes a walker wait, and a car without a heading has no box to hit with.
    const other=life.pedestrians[1];
    life.update(dt,t+=dt,undefined,{x:other.position.x,z:other.position.z,yaw:0,speed:PEDESTRIAN_HIT_SPEED-.1});assert.ok(!other.knocked);
    life.update(dt,t+=dt,undefined,{x:other.position.x,z:other.position.z,speed:9});assert.ok(!other.knocked);
    life.update(0,t,undefined,{x:other.position.x,z:other.position.z,yaw:0,speed:9});assert.ok(!other.knocked,'a paused frame cannot strike');
  }finally{life.dispose();}
});
