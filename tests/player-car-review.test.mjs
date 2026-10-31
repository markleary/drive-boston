import './helpers/npc-fleet.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {createStreetLife} from '../src/render/street-life.ts';

const city={bounds:{minX:-500,maxX:500,minZ:-500,maxZ:500},buildings:[],spawn:{x:0,z:0,yaw:0},roads:[{id:'test',name:'Test Street',width:10,oneway:0,points:[[-150,0],[150,0]]}]};

test('the physics footprint catches walkers at the longer bumpers of every performance car',async()=>{
  const physics=await DrivingPhysics.create(city);
  try{
    for(const id of ['harbor-s4','mclaren-gt','mclaren-720s','supra-mk4'])for(const direction of [-1,1]){
      physics.setCar(id);physics.reset(0,0,0);physics.body.setLinvel({x:0,y:0,z:direction*12},true);
      const state=physics.getState(),life=createStreetLife(new THREE.Scene(),city);
      try{
        const person=life.pedestrians[0];assert.ok(person,'fixture has a walker');
        // Outside the former 2.1 m box + .3 m margin, inside each performance-car bumper zone.
        person.position.set(state.x,state.y,state.z+direction*2.52);
        life.update(1/60,0,undefined,state);
        assert.equal(Boolean(person.knocked),id!=='harbor-s4',`${id} ${direction<0?'rear':'front'} bumper`);
        assert.equal(life.takeHits().length,id!=='harbor-s4'?1:0);
      }finally{life.dispose();}
    }
  }finally{physics.dispose();}
});
