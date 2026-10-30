import './helpers/npc-fleet.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DrivingPhysics } from '../src/physics/vehicle.ts';
import { createTraffic } from '../src/simulation/traffic.ts';
import { createStreetLife } from '../src/render/street-life.ts';
import { sampleElevation,buildTerrainGeometryData } from '../src/simulation/terrain.ts';

import {loadCentralCity} from './helpers/metro-city.mjs';
const ground=(x,z)=>8+.06*x+.035*z;
const expectedUp=new THREE.Vector3(-.06,1,-.035).normalize();
function slopedDistrict(){
  const originX=-200,originZ=-200,cellSize=250,width=4,height=4;
  return {
    origin:{xFeet:0,yFeet:0,longitude:-71.08,latitude:42.35},
    bounds:{minX:-120,maxX:120,minZ:-150,maxZ:350},
    roads:[
      {id:'east-west',name:'Boylston Street',width:14,oneway:0,points:[[-105,0],[105,0]]},
      {id:'north-south',name:'Dartmouth Street',width:14,oneway:0,points:[[0,-135],[0,335]]},
    ],buildings:[],landmarks:[],curbs:[],signals:[],sources:[],spawn:{x:10,z:0,yaw:Math.PI/2},
    elevation:{originX,originZ,cellSize,width,height,heights:Array.from({length:width*height},(_,i)=>ground(originX+(i%width)*cellSize,originZ+Math.floor(i/width)*cellSize))},
  };
}

test('ambient actors and collision bodies share the measured road grade',async()=>{
  const city=slopedDistrict(),scene=new THREE.Scene(),physics=await DrivingPhysics.create(city);
  const traffic=createTraffic(scene,city,physics),life=createStreetLife(scene,city,physics);
  try{
    traffic.update(1/60,physics.getState());physics.step({throttle:0,brake:1,steer:0,handbrake:true},1/60);
    const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
    const trafficMesh=scene.getObjectByName('AmbientTraffic').children[0];
    const bodies=[];physics.world.forEachRigidBody(body=>{if(body.isKinematic())bodies.push(body);});
    assert.equal(bodies.length,traffic.count);
    for(let i=0;i<traffic.count;i++){
      trafficMesh.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);
      assert.ok(Math.abs(position.y-ground(position.x,position.z))<.002,'traffic mesh contact point must follow the ground');
      const up=new THREE.Vector3(0,1,0).applyQuaternion(rotation);
      assert.ok(up.dot(expectedUp)>.99999,'traffic must pitch and roll with the road');
      const center=position.clone().addScaledVector(expectedUp,.65);
      const closest=bodies.reduce((best,body)=>Math.min(best,center.distanceTo(new THREE.Vector3().copy(body.translation()))),Infinity);
      assert.ok(closest<.02,'kinematic collision body must remain aligned with the visible car');
    }
    assert.ok(life.parkedCount>0&&life.count>0,'fixture must exercise parked cars and walkers');
    const parkedMesh=scene.getObjectByName('ParkedVehicles').children[0];
    const parkedBodies=[...new Set([...life.parkedColliders].map(handle=>physics.world.getCollider(handle).parent()))];
    assert.equal(parkedBodies.length,life.parkedCount);
    for(let i=0;i<life.parkedCount;i++){
      const car=life.parked[i];parkedMesh.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);
      const expected=new THREE.Vector3(car.x,ground(car.x,car.z),car.z);
      assert.ok(position.distanceTo(expected)<.002,'parked car shell must rest on the grade');
      assert.ok(new THREE.Vector3(0,1,0).applyQuaternion(rotation).dot(expectedUp)>.99999);
      const colliderCenter=new THREE.Vector3(car.x,ground(car.x,car.z),car.z).addScaledVector(expectedUp,.65);
      assert.ok(parkedBodies.some(body=>new THREE.Vector3().copy(body.translation()).distanceTo(colliderCenter)<.04),'parked collision shape must match its sloped visible body');
    }
    for(const time of [0,8,19,37]){
      life.update(1,time);
      for(const person of life.pedestrians)assert.ok(Math.abs(person.position.y-ground(person.position.x,person.position.z)-.035)<1e-5,'walking feet must track the terrain throughout their route');
    }
  }finally{life.dispose();traffic.dispose();physics.dispose();}
});

test('parked cars survive missing streamed ground and remain movable after it reloads',async()=>{
  const city=slopedDistrict(),scene=new THREE.Scene(),physics=await DrivingPhysics.create(city,{streaming:true}),life=createStreetLife(scene,city,physics);
  const raw=buildTerrainGeometryData(city),bodies=[...new Set([...life.parkedColliders].map(h=>physics.world.getCollider(h).parent()))];
  const step=(frames)=>{for(let i=0;i<frames;i++){physics.world.step();life.update(1/60);}};
  const registrations=life.parked.map(v=>v.registration),initial=bodies.map(b=>b.translation());
  try{
    assert.ok(bodies.length>0,'fixture must have parked cars');
    // Startup can place the fleet before the supporting tile has arrived.
    step(240);
    bodies.forEach((b,i)=>assert.ok(Math.abs(b.translation().y-initial[i].y)<.05,'missing initial terrain must not let parked cars fall'));
    for(let cycle=0;cycle<2;cycle++){
      const terrain=physics.addTerrainTile(raw.vertices,raw.indices);step(90);
      assert.ok(bodies.every(b=>b.isDynamic()),'loaded terrain must restore collision response');
      const body=bodies[0],start=body.translation(),mass=body.mass();
      body.applyImpulse({x:mass*2,y:0,z:0},true);step(30);
      assert.ok(body.translation().x-start.x>.15,'a restored parked car must still respond to an impact');
      const supported=bodies.map(b=>b.translation());
      physics.removeColliders([terrain]);
      // Render updates follow physics and may follow several substeps.
      physics.world.step();physics.world.step();step(240);
      bodies.forEach((b,i)=>assert.ok(Math.abs(b.translation().y-supported[i].y)<.05,'unloading support must preserve the last supported pose'));
      assert.deepEqual(life.parked.map(v=>v.registration),registrations);
      assert.ok(Math.abs(body.mass()-mass)<.01,'suspension must retain the vehicle mass');
    }
  }finally{life.dispose();physics.dispose();}
});

test('the fixed traffic fleet follows a distant neighborhood outside a protected nearby area',async()=>{
  const city=await loadCentralCity();
  const destination=city.landmarks.find(landmark=>landmark.id==='mission-hill');
  assert.ok(destination,'the expanded map must include Mission Hill');
  const physics=await DrivingPhysics.create(city),scene=new THREE.Scene(),traffic=createTraffic(scene,city,physics);
  try{
    const mesh=scene.getObjectByName('AmbientTraffic').children[0],matrix=new THREE.Matrix4();
    const positions=()=>Array.from({length:traffic.count},(_,i)=>{mesh.getMatrixAt(i,matrix);return{x:matrix.elements[12],z:matrix.elements[14]};});
    traffic.update(1/60,physics.getState());
    let previous=positions();
    assert.equal(traffic.count,77,'the map should retain a fixed seventy-seven-vehicle desktop budget');
    assert.ok(previous.filter(p=>Math.hypot(p.x-city.spawn.x,p.z-city.spawn.z)<650).length>=48,'busy Back Bay should have forty-eight local cars');
    for(let i=0;i<previous.length;i++) {
      assert.ok(Math.hypot(previous[i].x-city.spawn.x,previous[i].z-city.spawn.z)>34.9,'initial traffic must clear the player');
      for(let j=0;j<i;j++)assert.ok(Math.hypot(previous[i].x-previous[j].x,previous[i].z-previous[j].z)>17.9,'initial traffic must preserve spawn spacing');
    }
    const observer={x:destination.position[0],z:destination.position[1],y:sampleElevation(city,...destination.position)+.7};
    const distance=p=>Math.hypot(p.x-observer.x,p.z-observer.z);
    let relocations=0;
    for(let i=0;i<360;i++){
      traffic.update(1/60,physics.getState(),observer);
      physics.step({throttle:0,brake:1,steer:0,handbrake:true},1/60);
      const next=positions();
      next.forEach((point,index)=>{if(Math.hypot(point.x-previous[index].x,point.z-previous[index].z)>50){
        relocations++;assert.ok(distance(previous[index])>650,'nearby neighborhood cars must never be relocated');assert.ok(distance(point)>260,'replacement cars must enter outside the protected nearby area');
      }});
      previous=next;
    }
    assert.ok(relocations>0,'a long trip must move the ambient pool to the active neighborhood');
    assert.equal(traffic.count,77,'neighborhood relocation must never grow the physics fleet');
    assert.ok(previous.filter(p=>distance(p)<650).length>=12,'Mission Hill should regain a dozen nearby cars with the same fleet');
  }finally{traffic.dispose();physics.dispose();}
});

test('crowded initial roads never accept an overlapping last spawn attempt',async()=>{
  for(const spawn of [{x:0,z:12,yaw:0},{x:0,z:-200,yaw:0}]) {
    const city={bounds:{minX:-100,maxX:100,minZ:-250,maxZ:150},roads:[{id:'short',name:'Test Street',width:12,oneway:1,points:[[0,0],[0,25]]}],buildings:[],landmarks:[],signals:[],curbs:[],sources:[],spawn};
    const physics=await DrivingPhysics.create(city),scene=new THREE.Scene(),traffic=createTraffic(scene,city,physics);
    try {
      const cars=traffic.snapshot();
      assert.ok(cars.length<20,'a short occupied road must be allowed to run below the fleet cap');
      if(spawn.z===12)assert.equal(cars.length,0,'no placement is clear of the player on this road');
      else assert.equal(cars.length,1,'only one car fits this short road with the required spacing');
      for(let i=0;i<cars.length;i++) {
        assert.ok(Math.hypot(cars[i].x-spawn.x,cars[i].z-spawn.z)>=35);
        for(let j=0;j<i;j++)assert.ok(Math.hypot(cars[i].x-cars[j].x,cars[i].z-cars[j].z)>=18);
      }
    } finally {traffic.dispose();physics.dispose();}
  }
});
