import './helpers/npc-fleet.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {createTraffic} from '../src/simulation/traffic.ts';
import {createTransit} from '../src/simulation/transit.ts';
import {PLAYER_CARS} from '../src/simulation/player-cars.ts';

const truck=PLAYER_CARS['moving-truck'];
const far={x:700,y:.65,z:700,yaw:0,speed:0,steering:0};
const city={bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000},buildings:[],signals:[],roads:[{id:'straight',name:'Test Street',width:14,oneway:0,points:[[-400,0],[400,0]]}],spawn:{x:-150,z:0,yaw:Math.PI/2}};

test('NPCs stop behind the full moving box with the normal bumper gap',async()=>{
  const physics=await DrivingPhysics.create(city),traffic=createTraffic(new THREE.Scene(),city,physics);
  try{
    physics.body.setTranslation(far,true);
    for(let i=0;i<180;i++){traffic.update(1/60,far,far);physics.world.step();}
    const fleet=traffic.snapshot();
    const index=fleet.findIndex(a=>a.speed>4&&Math.sin(a.yaw)>.99&&a.x<300&&!fleet.some(b=>b!==a&&b.x>a.x&&b.x<a.x+45&&Math.abs(b.z-a.z)<2));
    const actor=fleet[index];assert.ok(actor,'a rolling NPC has an open road ahead');
    const player={...far,x:actor.x+40,z:actor.z,yaw:actor.yaw,halfLength:truck.halfLength,halfWidth:truck.halfWidth};
    for(let i=0;i<900;i++){traffic.update(1/60,player,player);physics.world.step();}
    const stopped=traffic.snapshot()[index],gap=player.x-stopped.x-stopped.halfLength-truck.halfLength;
    assert.ok(stopped.speed<.05,'the follower settles to a stop');
    assert.ok(gap>2&&gap<2.5,`the NPC leaves its normal 2.3 m bumper gap beyond the truck box (${gap} m)`);
  }finally{traffic.dispose();physics.dispose();}
});

for(const lateral of [0,2.4])test(`a bus stops clear of the truck box ${lateral?'overlapping its lane edge':'directly ahead'}`,async()=>{
  const physics=await DrivingPhysics.create(city);
  const route={id:'test-bus',kind:'bus',line:'39',destination:'39 TEST',points:[[-300,0],[300,0]],length:600,stops:[]};
  const transit=createTransit(new THREE.Scene(),city,physics,{routes:[route],sources:[],notes:''});
  try{
    physics.body.setTranslation(far,true);
    const bus=transit.snapshot()[0];
    const player={...far,x:bus.x+40,z:bus.z+lateral,yaw:bus.yaw,halfLength:truck.halfLength,halfWidth:truck.halfWidth};
    for(let i=0;i<1200;i++){transit.update(1/60,player,player);physics.world.step();}
    const stopped=transit.snapshot()[0],gap=player.x-stopped.x-6-truck.halfLength;
    assert.ok(stopped.speed<.05,'the bus waits behind the truck');
    assert.ok(gap>1.7&&gap<2.2,`the bus keeps its normal 2 m gap beyond the box (${gap} m)`);
  }finally{transit.dispose();physics.dispose();}
});
