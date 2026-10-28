import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {createTransit,transitPoint} from '../src/simulation/transit.ts';
import {signalAxis,signalPhase} from '../src/simulation/signals.ts';
import {pointInside} from '../src/simulation/roads.ts';
import {meshBuildingIds} from '../src/simulation/building-collisions.ts';

import {loadCentralCity} from './helpers/metro-city.mjs';
test('perpendicular signal approaches never receive green together and include clearance time',()=>{
 for(let time=0;time<64;time+=.05){
  const north=signalPhase(time,0),east=signalPhase(time,Math.PI/2);
  assert.ok(!(north==='green'&&east==='green'));
  assert.equal(signalPhase(time,Math.PI),north);assert.equal(signalPhase(time,-Math.PI/2),east);
 }
 assert.equal(signalPhase(12,0),'amber');assert.equal(signalPhase(15,0),'red');assert.equal(signalPhase(15,Math.PI/2),'red');assert.equal(signalPhase(17,Math.PI/2),'green');
 assert.equal(signalAxis(0),0);assert.equal(signalAxis(Math.PI/2),1);
});

test('mapped Green Line uses separate surface tracks and full route39 stays within coverage',async()=>{
 const city=await loadCentralCity();
 const data=JSON.parse(readFileSync(new URL('../public/data/transit.json',import.meta.url),'utf8'));
 // Concave source complexes whose convex footprint proxies span public streets
 // collide as exact source meshes at runtime (the Prudential and 145 Dartmouth
 // here); tests/street-corridors.test.mjs drives the open street corridors.
 const exactMeshBuildings=meshBuildingIds;
 assert.equal(data.routes.filter(r=>r.kind==='tram').length,2);assert.equal(data.routes.filter(r=>r.kind==='bus').length,2);
 for(const route of data.routes){
  assert.ok(route.points.length>80);assert.ok(route.stops.length>=8);
  if(route.kind==='bus')assert.ok(route.length>4900,'both complete Back Bay bus shapes must be retained');
  for(const stop of route.stops)assert.ok(stop.distance>0&&stop.distance<route.length);
  const distances=[0];for(let i=1;i<route.points.length;i++)distances.push(distances.at(-1)+Math.hypot(route.points[i][0]-route.points[i-1][0],route.points[i][1]-route.points[i-1][1]));
  const path={...route,distances};
  for(let s=10;s<route.length-10;s+=8){
   const point=transitPoint(path,s);
   assert.ok(city.coverage.some(r=>pointInside(point,r)),'transit must remain inside existing map');
   assert.ok(!city.buildings.some(b=>!exactMeshBuildings.has(b.id)&&Math.abs(b.center[0]-point[0])<350&&Math.abs(b.center[1]-point[1])<350&&pointInside(point,b.footprint)),'track/bus centerline must not cross a building hull');
  }
 }
 const mfa=data.routes.filter(r=>r.kind==='tram').map(r=>r.stops.find(s=>s.name==='Museum of Fine Arts').position);
 const separation=Math.hypot(mfa[0][0]-mfa[1][0],mfa[0][1]-mfa[1][1]);
 assert.ok(separation>2.7&&separation<8,`opposing tracks need distinct geometry (${separation}m)`);
});

test('bus dwells at a stop, brakes for a parked player, and departs after clearance',async()=>{
 const city={bounds:{minX:-100,maxX:100,minZ:-100,maxZ:300},roads:[],buildings:[],landmarks:[],curbs:[],signals:[],sources:[],spawn:{x:0,z:110,yaw:0}};
 const route={id:'fixture',kind:'bus',line:'39',destination:'39 TEST',points:[[0,0],[0,200]],length:200,stops:[{id:'stop',name:'Mapped stop',distance:100,position:[0,100]}]};
 const physics=await DrivingPhysics.create(city),scene=new THREE.Scene(),transit=createTransit(scene,city,physics,{routes:[route],sources:[],notes:''});
 let dwellSeen=false,closest=Infinity;
 try{
  for(let i=0;i<25*60;i++){
   transit.update(1/60,physics.getState());physics.step({throttle:0,brake:1,steer:0,handbrake:true},1/60);
   const bus=transit.snapshot()[0];dwellSeen||=bus.dwell>0;closest=Math.min(closest,110-bus.z);
  }
  assert.ok(dwellSeen,'the bus must perform an actual station dwell');assert.ok(closest>9.5,'front bumper must leave a gap to the parked car');assert.ok(Math.abs(physics.getState().z-110)<.15,'a stopped player must not be pushed');
  const stopped=transit.snapshot()[0].z;physics.reset(60,110,0);
  for(let i=0;i<8*60;i++){transit.update(1/60,physics.getState());physics.step({throttle:0,brake:1,steer:0,handbrake:true},1/60);}
  assert.ok(transit.snapshot()[0].z>stopped+12,'the bus should move after the lane clears');
 }finally{transit.dispose();physics.dispose();}
});
