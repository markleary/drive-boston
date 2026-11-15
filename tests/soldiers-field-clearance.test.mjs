import assert from 'node:assert/strict';
import test from 'node:test';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {sampleRoadElevation} from '../src/simulation/road-surfaces.ts';
import {loadMetroCity,windowCity} from './helpers/metro-city.mjs';

const bounds={minX:-3800,maxX:-3400,minZ:-1800,maxZ:-950};
const metro=await loadMetroCity({bounds}),city=windowCity(metro,bounds);
const sites=[
 {name:'Western Avenue',deck:'10309-0-0',x:-3568.281,z:-1545.054,yaw:.025},
 {name:'River Street',deck:'10287-0-0',x:-3535.04,z:-1186.747,yaw:.09},
];
for(const site of sites)test(`Soldiers Field Road is drivable under ${site.name}`,async()=>{
 const upper=city.roads.find(r=>r.id===site.deck),ground=sampleElevation(city,site.x,site.z);
 const clearance=sampleRoadElevation(city,upper,site.x,site.z)-upper.bridge.thickness-ground;
 assert.ok(clearance>4.2,`${site.name}: ${clearance.toFixed(2)} m below slab`);
 const physics=await DrivingPhysics.create(city);
 try{
  const x=site.x-Math.sin(site.yaw)*35,z=site.z-Math.cos(site.yaw)*35;
  physics.reset(x,z,site.yaw);
  for(let i=0;i<60;i++)physics.step({throttle:0,brake:1,steer:0,handbrake:false},1/60);
  for(let i=0;i<300;i++)physics.step({throttle:1,brake:0,steer:0,handbrake:false},1/60);
  const end=physics.getState();
  assert.ok(end.z>site.z+15,`car must pass completely underneath: ${JSON.stringify(end)}`);
  assert.ok(end.speed>10,'slab and parapets cannot block the lower road');
  assert.ok(Math.abs(end.y-sampleElevation(city,end.x,end.z)-.67)<.25,'the car stays on the continuous roadbed');
 }finally{physics.dispose();}
});
