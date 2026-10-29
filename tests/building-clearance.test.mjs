import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {Ray} from '@dimforge/rapier3d-compat';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {usesExactBuildingCollision} from '../src/simulation/building-collisions.ts';

test('compiled exact-mesh metadata preserves driving below an overhead building and collision with its deck',async()=>{
  const building={id:'survey-over-road',name:'Overhead building',center:[0,25],height:10,baseElevation:0,footprint:[[-8,15],[8,15],[8,35],[-8,35]],collision:'mesh'};
  const city={bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100},roads:[],buildings:[building],spawn:{x:0,z:0,yaw:0}};
  const physics=await DrivingPhysics.create(city);
  try{
    assert.ok(usesExactBuildingCollision(building));
    assert.ok(physics.meshBuildingIds.has(building.id),'flight must also ignore the false convex envelope');
    const deck=new THREE.BoxGeometry(16,4,20).translate(0,8,25);
    const collider=physics.addStaticMesh(new Float32Array(deck.attributes.position.array),Uint32Array.from(deck.index.array));deck.dispose();
    physics.world.step();
    const hit=physics.world.castRay(new Ray({x:0,y:2,z:25},{x:0,y:1,z:0}),10,true);
    assert.equal(hit?.collider.handle,collider.handle,'the underside remains solid overhead');
    assert.ok(Math.abs(hit.timeOfImpact-4)<.01);
    for(let frame=0;frame<5*60;frame++)physics.step({throttle:1,brake:0,steer:0,handbrake:false},1/60);
    const state=physics.getState();
    assert.ok(state.z>40&&state.y<1,`the car must clear the entire building at street level: ${JSON.stringify(state)}`);
    assert.equal(physics.addBuildingHull({...building,id:'streamed-over-road'}),undefined,'new streamed metadata must also bypass the convex proxy');
    assert.ok(physics.addBuildingHull({...building,id:'ordinary-building',collision:undefined,center:[30,25],footprint:building.footprint.map(([x,z])=>[x+30,z])}),'ordinary walls retain their collision');
  }finally{physics.dispose();}
});
