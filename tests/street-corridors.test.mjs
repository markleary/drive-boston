import assert from 'node:assert/strict';
import test from 'node:test';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {meshBuildingIds} from '../src/simulation/building-collisions.ts';
import {createHelicopterFlight} from '../src/simulation/helicopter.ts';
import {closestRoad,pointInside} from '../src/simulation/roads.ts';
import {rotationFromNormal,sampleElevation} from '../src/simulation/terrain.ts';
import {sampleDriveSurface} from '../src/simulation/road-surfaces.ts';
import {loadMetroCity,windowCity,installExactMeshes} from './helpers/metro-city.mjs';

// Survey complexes whose convex footprint proxies would wall off about 200 m of a
// major street each. Like the Prudential across Huntington (tests/bridges.test.mjs)
// they collide as their real source triangles instead: the BUMC ambulatory care
// center links its wings 28 m above Massachusetts Avenue, and NEXUS is an L whose
// hull closes Western Avenue although none of its triangles covers the roadway.
// `launch` is a distance along the street, still inside the proxy, with open sky
// above: a helicopter placed under the link settles on top of the real link.
const SITES=[
 {id:'BOS-HO11N-VJBYE-3RDXF',street:'Massachusetts Avenue',bounds:{minX:-400,maxX:600,minZ:1400,maxZ:2100},x:50,z:1780,launch:60},
 {id:'BOS-3R76C-CGBE8-V3V1H',street:'Western Avenue',bounds:{minX:-5300,maxX:-4500,minZ:-1800,maxZ:-1100},x:-4880,z:-1440,launch:0},
];
const released={throttle:0,brake:0,steer:0,handbrake:false};
function run(physics,seconds,input={}){for(let i=0;i<seconds*60;i++)physics.step({...released,...input},1/60);return physics.getState();}

for(const site of SITES)test(`${site.street} stays open through the source mesh of ${site.id}`,async()=>{
 const metro=await loadMetroCity({bounds:site.bounds}),city=windowCity(metro,site.bounds);city.geometry=metro.geometry;
 const building=city.buildings.find(b=>b.id===site.id);assert.ok(building,`${site.id} is in the loaded tiles`);
 const spot=closestRoad(city,site.x,site.z);
 assert.ok(spot.distance<15&&spot.road.name===site.street,`the probe point lies on ${site.street}: ${spot.road.name} at ${spot.distance.toFixed(1)} m`);
 assert.ok(pointInside([spot.x,spot.z],building.footprint),'the convex footprint proxy would cover the street');
 city.spawn={x:spot.x,z:spot.z,yaw:spot.yaw};
 const physics=await DrivingPhysics.create(city,{meshBuildingIds});
 try{
  assert.ok(installExactMeshes(physics,city).has(site.id),'the complex collides as its source triangles');
  physics.world.step();
  // A chassis placed as reset() places it must touch nothing along 100 m of the street each way.
  let probed=0;
  for(let s=-100;s<=100;s+=10){
   const on=closestRoad(city,spot.x+Math.sin(spot.yaw)*s,spot.z+Math.cos(spot.yaw)*s);
   if(on.road.name!==site.street)continue;
   const surface=sampleDriveSurface(city,on.x,on.z,undefined,on.road.id),n=surface.normal,hits=[];
   physics.world.intersectionsWithShape({x:on.x,y:surface.height+.78/Math.max(.5,n.y),z:on.z},rotationFromNormal(n,on.yaw),physics.chassisCollider.shape,c=>{if(c!==physics.chassisCollider)hits.push(c.shape.type);return true;});
   assert.deepEqual(hits,[],`a collider occupies ${site.street} at (${on.x.toFixed(0)}, ${on.z.toFixed(0)})`);probed++;
  }
  assert.ok(probed>=15,`the probe follows ${site.street} (${probed} samples)`);
  for(const yaw of [spot.yaw,spot.yaw+Math.PI]){
   physics.reset(spot.x,spot.z,yaw);const start=run(physics,1,{brake:1}),end=run(physics,4,{throttle:1});
   assert.ok(Math.hypot(start.x-spot.x,start.z-spot.z)<.1,'settling cannot push the car out of a false convex obstruction');
   assert.ok(Math.abs(start.y-sampleElevation(city,spot.x,spot.z)-.67)<.2,'the street remains grounded beneath the source building');
   assert.ok(Math.hypot(end.x-start.x,end.z-start.z)>40&&end.speed>15,`the car must drive ${site.street}: ${JSON.stringify(end)}`);
  }
  // The far index flags the complex exact-mesh, so flight clearance ignores its hull as well.
  const pad=closestRoad(city,spot.x+Math.sin(spot.yaw)*site.launch,spot.z+Math.cos(spot.yaw)*site.launch);
  assert.ok(pad.road.name===site.street&&pointInside([pad.x,pad.z],building.footprint),'the launch pad lies on the street inside the proxy');
  const hulls=metro.index.near(pad.x,pad.z,0).filter(b=>b.height>10&&pointInside([pad.x,pad.z],b.footprint));
  assert.ok(hulls.length>0&&hulls.every(b=>b.exactMesh),`far hulls over ${site.street} carry the exact-mesh flag`);
  const flight=createHelicopterFlight(metro,physics);
  try{
   const ground=sampleElevation(city,pad.x,pad.z);flight.reset({x:pad.x,z:pad.z,y:ground+18},0);
   assert.ok(flight.state.y<ground+30,`launch above ${site.street} must not jump to the false convex roof (${(flight.state.y-ground).toFixed(1)} m up)`);
  }finally{flight.dispose();}
 }finally{physics.dispose();}
});
