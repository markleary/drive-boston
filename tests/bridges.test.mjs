import assert from 'node:assert/strict';
import test from 'node:test';
import {Ray} from '@dimforge/rapier3d-compat';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {meshBuildingIds,usesExactBuildingCollision} from '../src/simulation/building-collisions.ts';
import {createHelicopterFlight,HELICOPTER} from '../src/simulation/helicopter.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {sampleDriveSurface,sampleRoadElevation,roadDeckGeometry,roadSlabGeometry} from '../src/simulation/road-surfaces.ts';
import {loadCentralCity,installExactMeshes} from './helpers/metro-city.mjs';
// The central window of the shipped package: its grid is already graded offline.
const city=await loadCentralCity();
const released={throttle:0,brake:0,steer:0,handbrake:false};
function run(physics,seconds,input={}){for(let i=0;i<seconds*60;i++)physics.step({...released,...input},1/60);return physics.getState();}

test('actual concave survey meshes leave Huntington and the Dartmouth bus corridor open',async()=>{
 const physics=await DrivingPhysics.create(city,{meshBuildingIds});
 try{
  const installed=installExactMeshes(physics,city),central=new Set(city.buildings.filter(usesExactBuildingCollision).map(b=>b.id));
  assert.deepEqual(installed,central,'all selected source structures must retain their real walls');
  assert.ok(['BOS-KBIA4-2XA04-WNETP','BOS-Q6TUK-T7ZG3-2SJKK','BOS-73AP7-T4BL0-O4QDM'].every(id=>installed.has(id)),'the Prudential, 145 Dartmouth and Fenway are in the central tiles');
  physics.world.step();
  for(const [x,z,yaw]of [[-400,340,Math.atan2(-.65,.76)],[67.477,283.182,-Math.PI/2]]){
   physics.reset(x,z,yaw);const start=run(physics,1,{brake:1}),end=run(physics,4,{throttle:1});
   assert.ok(Math.hypot(start.x-x,start.z-z)<.1,'settling cannot push the car out of a false convex obstruction');
   assert.ok(Math.abs(start.y-sampleElevation(city,x,z)-.67)<.2,'street remains grounded beneath source building openings');
   assert.ok(Math.hypot(end.x-start.x,end.z-start.z)>40,`car must travel through corridor ${x},${z}: start=${JSON.stringify(start)}, end=${JSON.stringify(end)}`);
   assert.ok(end.speed>15,'source geometry must not close the roadway');
  }
  const flight=createHelicopterFlight(city,physics);
  try{
   const ground=sampleElevation(city,-400,340);
   flight.reset({x:-400,z:340,y:ground+18},0);
   assert.ok(flight.state.y<ground+30,'launch above Huntington must not jump to the false convex roof of the Prudential complex');
  }finally{flight.dispose();}
 }finally{physics.dispose();}
});

test('helicopter rotor clearance stops above and beside the actual Bowker deck',async()=>{
 const physics=await DrivingPhysics.create(city),flight=createHelicopterFlight(city,physics);
 const input={forward:0,strafe:0,turn:0,lift:0};
 const fly=(seconds,controls)=>{for(let i=0;i<seconds*60;i++)flight.update(1/60,{...input,...controls});return flight.state;};
 try{
  flight.reset({x:-1439,y:30,z:110},0);const descended=fly(8,{lift:-1});
  assert.ok(descended.y>=6.4+HELICOPTER.verticalClearance&&descended.y<10,'aircraft must stop on the visible elevated structure');
  assert.ok(Math.abs(descended.verticalSpeed)<.01);
  flight.reset({x:-1439,y:3,z:110},0);assert.ok(flight.state.y>=6.4+HELICOPTER.verticalClearance,'a reset inside a deck must find clear air');
  flight.reset({x:-1480,y:4,z:110},Math.PI/2);const side=fly(5,{forward:1});
  assert.ok(side.x>-1465&&side.x<-1450,'low rotor sweep must stop at the deck edge instead of tunneling through it');
 }finally{flight.dispose();physics.dispose();}
});

test('actual Bowker decks and Commonwealth underpass occupy independent collision levels',async()=>{
 const road=city.roads.find(r=>r.id==='19492-0-bridge');assert.ok(road);
 const x=-1439,z=110,y=sampleRoadElevation(city,road,x,z),ground=sampleElevation(city,x,z);
 assert.ok(y-ground>6,'real source crossing has a clear upper and lower route');
 assert.notEqual(sampleDriveSurface(city,x,z,ground+1).road?.bridge?.id,'bowker','a ground actor cannot snap to the upper deck');
 assert.equal(sampleDriveSurface(city,x,z,y+1).road?.bridge?.id,'bowker');
 const physics=await DrivingPhysics.create(city);
 try{
  const upper=physics.world.castRay(new Ray({x,y:20,z},{x:0,y:-1,z:0}),30,true,undefined,undefined,physics.chassisCollider,physics.body);
  const lower=physics.world.castRay(new Ray({x,y:3,z},{x:0,y:-1,z:0}),10,true,undefined,undefined,physics.chassisCollider,physics.body);
  const underside=physics.world.castRay(new Ray({x,y:3,z},{x:0,y:1,z:0}),10,true,undefined,undefined,physics.chassisCollider,physics.body);
  assert.ok(Math.abs((20-upper.timeOfImpact)-y)<.015,'deck render surface equals Rapier top');
  assert.ok(Math.abs((3-lower.timeOfImpact)-ground)<.015,'terrain remains beneath the overpass');
  assert.ok(Math.abs((3+underside.timeOfImpact)-(y-road.bridge.thickness))<.015,'slab has a physical underside');
  physics.reset(-1436.5,210,Math.PI,road.id);const start=run(physics,1,{brake:1});const driven=run(physics,3,{throttle:1});
  assert.ok(start.y>6.8&&driven.y>6.8,'car stays on the elevated road');
  assert.ok(start.z-driven.z>20,'car actually travels along the upper roadway');
  assert.ok([0,1,2,3].every(i=>physics.controller.wheelIsInContact(i)));
  // Commonwealth runs below both carriageways. Drive through their full width.
  physics.reset(-1480,112,Math.PI/2);const underStart=run(physics,1,{brake:1});const underEnd=run(physics,5,{throttle:1});
  assert.ok(underEnd.x>-1425,`ground vehicle failed to pass below bridge: ${underEnd.x}`);
  assert.ok(underEnd.y<3&&underStart.y<3,'underpass car must never jump onto bridge');
 }finally{physics.dispose();}
});

test('bridge ramp arrivals support the car above terrain and preserve the deck on reset',async()=>{
 const landmark=city.landmarks.find(l=>l.id==='bowker-overpass'),arrival=landmark.driveStart,road=city.roads.find(r=>r.id===arrival.roadId);
 assert.ok(road.elevations&&road.startLevel===0&&road.endLevel===1);
 const physics=await DrivingPhysics.create(city);
 try{
  physics.reset(arrival.x,arrival.z,arrival.yaw,arrival.roadId);const start=run(physics,1,{brake:1});const moving=run(physics,2.4,{throttle:1});
  assert.ok(moving.y-start.y>.7,'the car climbs the elevated approach');
  assert.ok(Math.abs(moving.y-sampleRoadElevation(city,road,moving.x,moving.z)-.67)<.2,'suspension stays on ramp deck');
  const saved=JSON.parse(JSON.stringify({x:moving.x,z:moving.z,yaw:moving.yaw,roadId:sampleDriveSurface(city,moving.x,moving.z,moving.y).road?.id}));
  assert.ok(saved.roadId,'save must retain the ramp layer');physics.reset(saved.x,saved.z,saved.yaw,saved.roadId);
  const restored=run(physics,1,{brake:1});assert.ok(Math.abs(restored.y-moving.y)<.15,'saved layer survives reload/reset');
  physics.reset(arrival.x,arrival.z,arrival.yaw,arrival.roadId);const reset=run(physics,1,{brake:1});
  assert.ok(Math.abs(reset.y-start.y)<.02);assert.ok(Math.abs(reset.speed)<.1);
 }finally{physics.dispose();}
 assert.ok(Math.abs(sampleDriveSurface(city,city.spawn.x,city.spawn.z,undefined,road.id).height-sampleElevation(city,city.spawn.x,city.spawn.z))<.01,'a stale remote road ID cannot lift a saved position onto a distant deck');
});

test('deck mesh normals face up and source ramp endpoints meet the terrain',()=>{
 const structures=city.roads.filter(r=>r.elevations),bowker=structures.filter(r=>['bowker','muddy-river'].includes(r.bridge?.id));
 assert.equal(bowker.length,32,'the Bowker Overpass and Muddy River crossings keep their 32 surveyed segments');assert.ok(structures.length>bowker.length,'the central window also holds generic metro decks');
 for(const road of structures){
  const mesh=roadDeckGeometry(city,road);
  for(let i=0;i<mesh.indices.length;i+=3){
   const [a,b,c]=[0,1,2].map(j=>mesh.indices[i+j]*3),p=mesh.vertices;
   const nx=(p[b+2]-p[a+2])*(p[c]-p[a])-(p[b]-p[a])*(p[c+2]-p[a+2]);assert.ok(nx>0,'deck winding must face up');
  }
  // Every oriented edge of a closed outward-facing slab has one reverse pair.
  // This catches invisible inside-out parapet-side or end faces as well as gaps.
  const slab=roadSlabGeometry(city,road),edges=new Map();
  for(let i=0;i<slab.indices.length;i+=3)for(let j=0;j<3;j++){
   const a=slab.indices[i+j],b=slab.indices[i+(j+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(':');
   edges.set(key,(edges.get(key)??0)+(a<b?1:-1));
  }
  assert.ok([...edges.values()].every(n=>n===0),'closed slab faces must share opposite edge directions');
  const inWindow=p=>p[0]>=city.bounds.minX&&p[0]<=city.bounds.maxX&&p[1]>=city.bounds.minZ&&p[1]<=city.bounds.maxZ;
  if(road.startLevel===0&&inWindow(road.points[0]))assert.ok(Math.abs(road.elevations[0]-sampleElevation(city,...road.points[0]))<.005,`${road.id} start meets the graded ground`);
  if(road.endLevel===0&&inWindow(road.points.at(-1)))assert.ok(Math.abs(road.elevations.at(-1)-sampleElevation(city,...road.points.at(-1)))<.005,`${road.id} end meets the graded ground`);
 }
});

test('road-speed steering uses inner/outer front angles and limits lateral demand',async()=>{
 const flat={bounds:{minX:-500,maxX:500,minZ:-500,maxZ:500},buildings:[],roads:[],spawn:{x:0,z:0,yaw:0}},physics=await DrivingPhysics.create(flat);
 try{
  run(physics,1,{steer:1});const parking=physics.getState();
  assert.ok(parking.steering>.50&&parking.steering<.53,'slightly more parking lock gives a tighter turning radius');
  assert.ok(physics.controller.wheelSteering(0)>physics.controller.wheelSteering(1),'inside front wheel turns farther');
  physics.reset(0,0,0);run(physics,6,{throttle:1});const fast=run(physics,.6,{throttle:1,steer:1});
  assert.ok(fast.speed>18);assert.ok(fast.steering<.075,'road speed limits abrupt keyboard oversteer');
  assert.ok(fast.gear>=3&&fast.rpm>1500,'automatic powertrain follows road speed');
  assert.ok(fast.rotation.w>.8,'stable road-speed turn, without overturning');
 }finally{physics.dispose();}
});
