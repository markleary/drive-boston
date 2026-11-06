import './helpers/npc-fleet.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createStreetLife} from '../src/render/street-life.ts';

const road={id:'work-street',name:'Boylston Street',width:14,pavedWidth:14,oneway:1,points:[[-400,0],[400,0]]};
const city={bounds:{minX:-500,maxX:500,minZ:-100,maxZ:100},spawn:{x:-150,z:0,yaw:Math.PI/2},roads:[road],buildings:[],signals:[],landmarks:[]};

test('kerbside parking leaves the construction site and its passing lane clear',()=>{
  const before=createStreetLife(new THREE.Scene(),city);
  let after;
  try{
    assert.ok(before.parked.length>0,'fixture supplies parking on the wide street');
    const first=before.parked[0];
    const zone={id:'worksite',roadId:road.id,road,x:first.x,z:0,yaw:Math.PI/2,direction:1,laneOffset:-5,openOffset:-1.7,length:70,workLength:26,taperLength:22,pavedWidth:14,seed:1,vehicleKind:'dump-truck'};
    after=createStreetLife(new THREE.Scene(),city,undefined,[zone]);
    assert.ok(after.parked.length>0,'other blocks retain parked cars');
    assert.ok(!after.parked.some(car=>Math.abs(car.x-zone.x)<zone.length/2+8&&Math.abs(car.z)<zone.pavedWidth/2+2),
      'neither kerb can narrow the lane alongside the worksite');
  }finally{before.dispose();after?.dispose();}
});

test('construction on a separate road level does not remove surface parking',()=>{
  const elevated={...road,id:'upper-road',elevations:[8,8]},zone={id:'upper-work',roadId:elevated.id,road:elevated,x:0,z:0,yaw:Math.PI/2,direction:1,laneOffset:-5,openOffset:-1.7,length:800,workLength:26,taperLength:22,pavedWidth:14,seed:1,vehicleKind:'dump-truck'};
  const before=createStreetLife(new THREE.Scene(),city),after=createStreetLife(new THREE.Scene(),city,undefined,[zone]);
  try{assert.deepEqual(after.parked.map(car=>[car.x,car.z]),before.parked.map(car=>[car.x,car.z]));}
  finally{before.dispose();after.dispose();}
});
