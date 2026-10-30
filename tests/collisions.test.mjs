import './helpers/npc-fleet.mjs';
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
    assert.ok(minUp>.3&&maxY<2.5,`a full stop against a wall is a nose-stand, not an end-over-end flip (minUp ${minUp.toFixed(2)}, peak height ${maxY.toFixed(2)})`);
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

/** Launch the player at a moving lane keeper: from six metres behind along its
 * heading, from seven metres off its right side aimed at where it will be
 * (`side` true), or from sixteen metres ahead facing it (`side` 'head'). */
async function launchAt(physics,traffic,side,speed=16){
  const far={...physics.getState(),x:city.bounds.minX+40,z:city.bounds.minZ+40};
  for(let i=0;i<120;i++)traffic.update(1/60,far,far,[]);
  const index=traffic.snapshot().findIndex(a=>a.speed>4&&a.type==='compact'),before=traffic.snapshot()[index];assert.ok(index>=0,'a moving lane keeper is available');
  assert.equal(before.knocked,false);assert.equal(before.dynamic,false);
  const fx=Math.sin(before.yaw),fz=Math.cos(before.yaw),rx=fz,rz=-fx;
  const ax=before.x+fx*before.speed*.45,az=before.z+fz*before.speed*.45;
  const head=side==='head',x=head?before.x+fx*16:side?ax+rx*7:before.x-fx*6,z=head?before.z+fz*16:side?az+rz*7:before.z-fz*6;
  const vx=head?-fx*speed:side?-rx*speed:fx*speed,vz=head?-fz*speed:side?-rz*speed:fz*speed,yaw=head?before.yaw+Math.PI:side?Math.atan2(-rx,-rz):before.yaw;
  physics.body.setTranslation({x,y:sampleElevation(city,x,z)+.78,z},true);physics.body.setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},true);
  physics.body.setLinvel({x:vx,y:0,z:vz},true);physics.body.setAngvel({x:0,y:0,z:0},true);
  return {index,before,fx,fz};
}
const mph=v=>v*.44704;

test('at 50 mph a head-on shoves the struck car back and lifts the player\'s tail without flipping, and a T-bone spins the struck car on its tyres',async()=>{
  for(const [kind,speed] of [['head',mph(50)],[true,mph(50)],[true,mph(36)]]){
    const physics=await DrivingPhysics.create(city),scene=new THREE.Scene(),traffic=createTraffic(scene,city,physics);
    try{
      const {index}=await launchAt(physics,traffic,kind,speed),label=`${kind==='head'?'head-on':'T-bone'} at ${(speed/.44704).toFixed(0)} mph`;
      // `rest` is where the struck car lay last while still knocked: once settled it may ease back
      // onto its lane, or respawn elsewhere when a wall blocks the way, before the five seconds end.
      let hit,rest,minUp=1;
      for(let i=0;i<60*5;i++){
        const state=physics.getState();traffic.update(1/60,state,state,[]);physics.step(released,1/60);physics.takeImpacts();
        const now=traffic.snapshot()[index];if(now.knocked){rest={x:now.x,z:now.z,yaw:now.yaw};if(!hit)hit={...rest,player:physics.getState()};}
        if(hit)minUp=Math.min(minUp,upY(physics.getState()));
      }
      assert.ok(hit,`${label}: the struck car is knocked`);
      const now=rest,moved=Math.hypot(now.x-hit.x,now.z-hit.z),sideways=Math.abs((now.x-hit.x)*Math.cos(hit.yaw)-(now.z-hit.z)*Math.sin(hit.yaw));
      const spin=Math.abs(Math.atan2(Math.sin(now.yaw-hit.yaw),Math.cos(now.yaw-hit.yaw)))*180/Math.PI,end=physics.getState();
      if(kind==='head'){
        const ux=Math.sin(hit.player.yaw),uz=Math.cos(hit.player.yaw),back=(now.x-hit.x)*ux+(now.z-hit.z)*uz;
        assert.ok(back>9,`${label}: the struck car is shoved back along the player's path (${back.toFixed(1)} m; a box dragging on the road managed about 6)`);
        assert.ok(minUp<.85&&minUp>.3,`${label}: the player's tail lifts without flipping (minUp ${minUp.toFixed(2)})`);
        assert.ok(upY(end)>.9,`${label}: the player lands back on its wheels`);
      }else if(speed>mph(40))assert.ok(spin>45,`${label}: the struck car spins (${spin.toFixed(0)} degrees; Rapier's box friction held it to about 5)`);
      else assert.ok(sideways>3&&sideways<10,`${label}: its tyres limit the sideways slide (${sideways.toFixed(1)} m)`);
      assert.ok(moved<40,`${label}: the driver brakes, so the struck car does not roll away (${moved.toFixed(1)} m)`);
    }finally{traffic.dispose();physics.dispose();}
  }
});
const park=(physics,x,z)=>{physics.body.setTranslation({x,y:sampleElevation(city,x,z)+.78,z},true);physics.body.setLinvel({x:0,y:0,z:0},true);physics.body.setAngvel({x:0,y:0,z:0},true);};

test('a struck traffic car is shoved as a dynamic body, then eases back into its lane as a lane keeper',async()=>{
  const physics=await DrivingPhysics.create(city),scene=new THREE.Scene(),traffic=createTraffic(scene,city,physics);
  try{
    const {index,before,fx,fz}=await launchAt(physics,traffic,false);
    let knockedAt=-1,peakSpeed=0,impacts=[],restoredAt=-1;
    for(let i=0;i<60*16;i++){
      // Brake after the hit, then back well away so the way to the lane is clear.
      if(i===240)park(physics,before.x-fx*60,before.z-fz*60);
      const state=physics.getState();traffic.update(1/60,state,state,[]);physics.step({...released,brake:i>30?1:0},1/60);
      impacts.push(...physics.takeImpacts());
      const all=traffic.snapshot(),now=all[index];
      // Saint James Avenue traffic passes the parked player 4 m away here; a bounding-box overlap is no hit.
      if(i>240)assert.ok(!all.some((a,k)=>k!==index&&a.knocked),`cars passing the parked player are not knocked (step ${i})`);
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
    for(const handle of traffic.colliders){const c=physics.world.getCollider(handle);assert.ok(c.friction()===.5&&c.frictionCombineRule()===RAPIER.CoefficientCombineRule.Average,'a restored lane keeper has its ordinary friction back');}
    assert.ok(traffic.obstacles().every(o=>[o.x,o.y,o.z].every(Number.isFinite)));
    assert.ok(Math.abs(physics.getState().speed)<KNOCK_SPEED+30);
  }finally{traffic.dispose();physics.dispose();}
});

/** One straight two-way road, at ground level or on an 8 m deck with parapets. The
 * player is aimed at the first moving lane keeper from `offset` metres beyond the
 * usual start: across its path (`kind` 't'), head-on, or along the next lane over
 * with about 25 cm to spare ('miss'). */
async function straightRun(kind,offset,deck=false,speed=mph(50)){
  const y0=deck?8:0,road={id:'Straight',name:'Straight',width:12,oneway:0,points:[[-400,0],[400,0]],...(deck?{elevations:[8,8]}:{})};
  const physics=await DrivingPhysics.create({...flat,roads:[road]}),traffic=createTraffic(new THREE.Scene(),{...flat,roads:[road]},physics);
  try{
    const away={...physics.getState(),x:900,z:900};
    for(let i=0;i<120;i++){traffic.update(1/60,away,away,[]);physics.step(released,1/60);}
    const index=traffic.snapshot().findIndex(a=>a.speed>4&&a.type==='compact'),b=traffic.snapshot()[index],fx=Math.sin(b.yaw),fz=Math.cos(b.yaw),rx=fz,rz=-fx;
    const [x,z,vx,vz]=kind==='head'?[b.x+fx*(16+offset),b.z+fz*(16+offset),-fx,-fz]:kind==='miss'?[b.x+fx*(30+offset)+rx*2.05,b.z+fz*(30+offset)+rz*2.05,-fx,-fz]:[b.x+fx*b.speed*.45+rx*(7+offset),b.z+fz*b.speed*.45+rz*(7+offset),-rx,-rz];
    const yaw=Math.atan2(vx,vz);
    physics.body.setTranslation({x,y:y0+.78,z},true);physics.body.setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},true);physics.body.setLinvel({x:vx*speed,y:0,z:vz*speed},true);
    const result={targetKnocked:false,knocked:0,kinematicAtImpact:false,moved:0,tyreFriction:false,minY:Infinity,insideDeckMinY:Infinity};let start;
    for(let i=0;i<60*3;i++){
      const state=physics.getState();traffic.update(1/60,state,state,[]);physics.step(released,1/60);
      for(const impact of physics.takeImpacts())for(const h of impact.colliders)if(traffic.colliders.has(h)&&!physics.world.getCollider(h).parent().isDynamic())result.kinematicAtImpact=true;
      const all=traffic.snapshot(),now=all[index];result.knocked=Math.max(result.knocked,all.filter(a=>a.knocked).length);
      if(now.knocked)result.targetKnocked=true;
      if(now.knocked&&!start)start={x:now.x,z:now.z,i};
      if(start&&now.knocked){const c=physics.world.getCollider(now.collider);result.minY=Math.min(result.minY,c.parent().translation().y);if(Math.abs(now.z)<4.5)result.insideDeckMinY=Math.min(result.insideDeckMinY,c.parent().translation().y);result.tyreFriction||=c.friction()<.1;result.moved=Math.max(result.moved,Math.hypot(now.x-start.x,now.z-start.z));}
    }
    // Measure the impact while dynamic; a completed lane rejoin may already
    // have returned the vehicle near its starting point before three seconds.
    return result;
  }finally{traffic.dispose();physics.dispose();}
}

test('a fast hit always lands on a struck car that is already dynamic, whatever the 60 Hz step phase, and a close pass knocks nothing',async()=>{
  for(const [kind,minMoved] of [['t',9],['head',9]])for(const offset of [0,.1,.2,.3]){
    const r=await straightRun(kind,offset),label=`${kind==='head'?'head-on':'T-bone'} at 50 mph from ${offset} m further back`;
    assert.equal(r.kinematicAtImpact,false,`${label}: the player never strikes a still-kinematic lane keeper`);
    assert.ok(r.targetKnocked&&r.moved>minMoved,`${label}: the struck car carries the hit (${r.moved.toFixed(1)} m; a late knock left it at 0)`);
  }
  for(const offset of [0,.15,.3])assert.equal((await straightRun('miss',offset)).knocked,0,`a pass with 25 cm to spare (${offset}) is not a hit`);
});

test('compound cars keep bridge support during moderate hits and do not tunnel through a raised deck at high speed',async()=>{
  for(const offset of [0,.2]){
    const r=await straightRun('t',offset,true,mph(25));
    assert.ok(r.targetKnocked&&r.moved>1.5,`the struck car is shoved across the deck (${r.moved.toFixed(1)} m before the parapet)`);
    assert.ok(r.tyreFriction,'upright on the deck counts as on the road, so its tyre model runs instead of the scrape friction');
    assert.ok(r.minY>7.5,`the parapet keeps it on the deck (lowest centre ${r.minY.toFixed(2)} m)`);
    // A 50 mph side hit can vault a realistic compound body over a low
    // parapet; it must still collide with the slab while above its interior.
    const fast=await straightRun('t',offset,true,mph(50));
    assert.ok(fast.insideDeckMinY>7.5,'high-speed impacts must not tunnel through the interior bridge slab');
  }
});

test('a settled car waits while the player sits in its way back, rejoins once they leave, and respawns elsewhere when a wall blocks the way',async()=>{
  for(const obstruction of ['player','wall']){
    const physics=await DrivingPhysics.create(city),scene=new THREE.Scene(),traffic=createTraffic(scene,city,physics);
    try{
      // A side hit shoves the car off its lane; once it slows, the player parks on the lane beside it.
      const {index,before,fx,fz}=await launchAt(physics,traffic,true);
      let knockedAt=-1,parkedAt=-1,clearedAt=-1,rejoinAt=-1,restoredAt=-1,rest,restored,wall;
      for(let i=0;i<60*24;i++){
        const now=traffic.snapshot()[index];
        if(knockedAt>=0&&parkedAt<0&&now.speed<1.5){
          const along=(now.x-before.x)*fx+(now.z-before.z)*fz,lx=before.x+fx*along,lz=before.z+fz*along;
          assert.ok(Math.hypot(now.x-lx,now.z-lz)>3,`${obstruction}: the hit shoves the car well off its lane (${Math.hypot(now.x-lx,now.z-lz).toFixed(1)} m)`);
          park(physics,lx,lz);physics.body.setRotation({x:0,y:Math.sin(before.yaw/2),z:0,w:Math.cos(before.yaw/2)},true);parkedAt=i;
        }
        if(parkedAt>=0&&i===parkedAt+60*10){
          // Ten seconds of sitting there: the way back is not clear, so the car is still Rapier's.
          assert.ok(now.knocked&&now.dynamic&&!now.rejoining,`${obstruction}: a car whose way back is occupied stays dynamic`);
          rest={x:now.x,z:now.z};clearedAt=i;
          const t=physics.body.translation(),r=physics.body.rotation(),state=physics.getState();park(physics,state.x+100,state.z+100);
          if(obstruction==='wall')wall=physics.world.createCollider(RAPIER.ColliderDesc.cuboid(.85,.5,2.02).setTranslation(t.x,t.y,t.z).setRotation(r),physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
        }
        const state=physics.getState();traffic.update(1/60,state,state,[]);physics.step({...released,brake:i>30?1:0},1/60);
        const after=traffic.snapshot()[index];
        if(after.knocked&&knockedAt<0)knockedAt=i;
        if(after.rejoining&&rejoinAt<0)rejoinAt=i;
        if(rest&&restoredAt<0&&!after.knocked&&!after.rejoining){restoredAt=i;restored={x:after.x,z:after.z};}
        assert.ok([after.x,after.z,after.yaw].every(Number.isFinite));
      }
      assert.ok(knockedAt>=0&&knockedAt<120,`${obstruction}: the side hit knocks the car (step ${knockedAt})`);
      assert.ok(parkedAt>=0&&clearedAt>=0,`${obstruction}: the struck car slowed and the player parked in its way`);
      const after=traffic.snapshot()[index];assert.ok(!after.knocked&&!after.dynamic&&!after.rejoining,`${obstruction}: a lane keeper again at the end`);
      assert.ok(restoredAt>clearedAt&&restoredAt<clearedAt+60*5,`${obstruction}: hands back within five seconds of the way clearing (step ${restoredAt}, cleared ${clearedAt})`);
      const moved=Math.hypot(restored.x-rest.x,restored.z-rest.z);
      if(obstruction==='player'){
        assert.ok(rejoinAt>clearedAt,`eases back only after the player has gone (step ${rejoinAt}, cleared ${clearedAt})`);
        assert.ok(moved<12,`rejoins its lane beside where it came to rest (${moved.toFixed(1)} m)`);
      }else{
        assert.equal(rejoinAt,-1,'never eases through the wall');
        assert.ok(moved>60,`respawns well away from the blocked spot (${moved.toFixed(0)} m)`);
        physics.world.removeCollider(wall,true);
      }
    }finally{traffic.dispose();physics.dispose();}
  }
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
