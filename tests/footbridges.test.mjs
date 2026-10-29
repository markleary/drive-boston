import assert from 'node:assert/strict';
import test from 'node:test';
import {Ray} from '@dimforge/rapier3d-compat';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {footbridgeRoad} from '../src/simulation/footbridges.ts';
import {roadSlabGeometry,sampleDriveSurface,sampleRoadElevation} from '../src/simulation/road-surfaces.ts';
import {buildTerrainGeometryData,sampleElevation} from '../src/simulation/terrain.ts';
import {loadMetroCity,windowCity} from './helpers/metro-city.mjs';

const bounds={minX:-1820,maxX:-1700,minZ:1020,maxZ:1160},metro=await loadMetroCity({bounds});
const city=windowCity(metro,bounds),path=city.parkPaths.find(p=>p.id==='osm-way-87890606-0--2_1_0');
city.buildings=[];city.roads=[];city.parkPaths=[path];
const road=footbridgeRoad(city,path),released={throttle:0,brake:0,steer:0,handbrake:false};
function settle(p){for(let i=0;i<60;i++)p.step({...released,brake:1},1/60);}

test('footbridge slab preserves mapped bends, meets the path and is a closed solid',()=>{
 const flat={...city,elevation:undefined},bend={id:'bent',width:2.6,bridge:true,points:[[0,0],[4,6],[0,12]]},profile=footbridgeRoad(flat,bend);
 assert.ok(profile.points.some(p=>p[0]===4&&p[1]===6),'mapped bend stays in the bridge');
 assert.equal(profile.elevations[0],.052);assert.equal(profile.elevations.at(-1),.052);
 assert.ok(Math.max(...profile.elevations)>.5);
 const slab=roadSlabGeometry(flat,profile),edges=new Map();
 for(let i=0;i<slab.indices.length;i+=3)for(let j=0;j<3;j++){
  const a=slab.indices[i+j],b=slab.indices[i+(j+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(':');
  edges.set(key,(edges.get(key)??0)+(a<b?1:-1));
 }
 assert.ok([...edges.values()].every(n=>n===0),'closed top, edges and underside share opposite face directions');
 assert.equal(footbridgeRoad(flat,{...bend,bridge:false}),undefined);
});

for(const reverse of [false,true])test(`Ultra Bee rides across the actual screenshot footbridge ${reverse?'northbound':'southbound'}`,async()=>{
 const a=path.points[reverse?1:0],b=path.points[reverse?0:1],length=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=(b[0]-a[0])/length,dz=(b[1]-a[1])/length,yaw=Math.atan2(dx,dz);
 const local={...city,spawn:{x:a[0]-dx*5,z:a[1]-dz*5,yaw}},p=await DrivingPhysics.create(local);p.setVehicleType('ultrabee');
 try{
  settle(p);let supported=0,arrived=false;
  for(let i=0;i<600;i++){
   const s=p.getState(),along=(s.x-a[0])*dx+(s.z-a[1])*dz;
   if(along>length+4){arrived=true;break;}
   if(along>2&&along<length-2){
    const deck=sampleRoadElevation(local,road,s.x,s.z);
    assert.ok(s.y>deck+.4&&s.y<deck+.8,'bike remains above the deck, rather than following the riverbed');
    assert.ok([0,1].every(j=>p.controller.wheelIsInContact(j)),'both wheel rays hit the bridge');supported++;
   }
   const desired=Math.atan2(b[0]+dx*8-s.x,b[1]+dz*8-s.z),error=Math.atan2(Math.sin(desired-s.yaw),Math.cos(desired-s.yaw));
   p.step({...released,throttle:s.speed<4?.4:0,brake:s.speed>5?.1:0,steer:Math.max(-1,Math.min(1,error*3))},1/60);
  }
  assert.ok(arrived,'ride from one bank to the opposite bank');assert.ok(supported>100,'support checked continuously across the span');
 }finally{p.dispose();}
});

test('streamed footbridge collision matches the visible deck and is removed with its support query',async()=>{
 const local={...city,spawn:{x:-1770,z:1089,yaw:0}},p=await DrivingPhysics.create(local,{streaming:true});
 const terrain=buildTerrainGeometryData(local);p.addTerrainTile(terrain.vertices,terrain.indices);
 const colliders=p.addFootbridge(local,path),x=(path.points[0][0]+path.points[1][0])/2,z=(path.points[0][1]+path.points[1][1])/2,deck=sampleRoadElevation(local,road,x,z),ground=sampleElevation(local,x,z);
 try{
  p.setVehicleType('ultrabee');p.reset(x,z,0,road.id);settle(p);
  const hit=p.world.castRay(new Ray({x,y:5,z},{x:0,y:-1,z:0}),15,true,undefined,undefined,p.chassisCollider,p.body);
  assert.ok(Math.abs(5-hit.timeOfImpact-deck)<.001,'the exact rendered slab is the physical support');
  const saved=p.getState(),support=sampleDriveSurface(local,x,z,saved.y);
  assert.equal(support.road.id,road.id);assert.ok(saved.y>deck+.4);
  p.setVehicleType('car');settle(p);assert.ok(p.getState().y>deck+.5,'switching vehicles preserves the bridge layer');
  p.setVehicleType('ultrabee');settle(p);assert.ok(p.getState().y>deck+.4);
  p.reset(x,z,0,support.road.id);settle(p);assert.ok(Math.abs(p.getState().y-saved.y)<.02,'saved bridge ID restores deck height');
  p.removeColliders(colliders);
  assert.equal(sampleDriveSurface(local,x,z,deck+1).road,undefined,'unloaded bridge cannot leave an invisible support');
  assert.equal(sampleDriveSurface(local,x,z,undefined,road.id).height,ground,'a stale saved bridge ID falls back to terrain');
  assert.ok(colliders.every(c=>!p.detailedColliders.has(c.handle)));
 }finally{p.dispose();}
});
