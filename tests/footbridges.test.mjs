import assert from 'node:assert/strict';
import test from 'node:test';
import {Ray} from '@dimforge/rapier3d-compat';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {footbridgeRoad} from '../src/simulation/footbridges.ts';
import {roadSlabGeometry,roadDeckGeometry,roadNormal,sampleDriveSurface,sampleRoadElevation} from '../src/simulation/road-surfaces.ts';
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

test('tile fragments share one arch and identical slab cross-sections at a mapped bend',()=>{
 const flat={...city,elevation:undefined},bridgePoints=[[-12,0],[0,0],[8,8],[14,8]];
 const paths=[{id:'left',width:2.6,bridge:true,bridgePoints,points:bridgePoints.slice(0,2)},{id:'right',width:2.6,bridge:true,bridgePoints,points:bridgePoints.slice(1)}],roads=paths.map(p=>footbridgeRoad(flat,p));
 const left=roads[0],right=roads[1],height=left.elevations.at(-1);
 assert.ok(height>.8,'a tile boundary in the middle of the span is not a ground landing');assert.equal(height,right.elevations[0]);
 const a=roadDeckGeometry(flat,left),b=roadDeckGeometry(flat,right);
 assert.deepEqual([...a.vertices.slice(-6)],[...b.vertices.slice(0,6)],'both complete width edges meet even at a bend');
 assert.ok(left.points.every(p=>p[0]<=0)&&right.points.every(p=>p[0]>=0),'each owner retains only its own fragment');
 for(const [road,mesh]of [[left,a],[right,b]]){
  for(let i=0;i<mesh.indices.length;i+=3){const [a,b,c]=[0,1,2].map(j=>mesh.indices[i+j]*3),p=mesh.vertices;assert.ok((p[b+2]-p[a+2])*(p[c]-p[a])-(p[b]-p[a])*(p[c+2]-p[a+2])>0,'top face normals point upward');}
  const n=roadNormal(flat,road,0,0);assert.ok(n.y>.99,'a seam cannot introduce a steep ramp wall');
 }
 const reversed=footbridgeRoad(flat,{...paths[1],points:[...paths[1].points].reverse()}),end=roadDeckGeometry(flat,reversed).vertices.slice(-6);
 const edgePairs=values=>[0,3].map(i=>[...values.slice(i,i+3)].join(',')).sort();
 assert.deepEqual(edgePairs(end),edgePairs(b.vertices.slice(0,6)),'reversed source orientation preserves the same seam');
});

test('the shipped split Riverway bridge carries shared metadata and exact seam geometry',async()=>{
 const bounds={minX:-3020,maxX:-2970,minZ:450,maxZ:505},metro=await loadMetroCity({bounds}),local=windowCity(metro,bounds),paths=local.parkPaths.filter(p=>p.id.startsWith('osm-way-1176608877-0-'));
 assert.equal(paths.length,2);assert.deepEqual(paths[0].bridgePoints,paths[1].bridgePoints);assert.ok(paths[0].bridgePoints?.length>=2);
 const roads=paths.map(p=>footbridgeRoad(local,p)),seam=roads.map(road=>({road,index:road.points.findIndex(p=>p[0]===-3000)}));
 assert.ok(seam.every(s=>s.index===0||s.index===s.road.points.length-1));
 const heights=seam.map(s=>s.road.elevations[s.index]);assert.ok(Math.abs(heights[0]-heights[1])<1e-9);assert.ok(heights[0]>sampleElevation(local,-3000,472.4)+.3,'the old duplicate shore landing is gone');
 const edges=seam.map(({road,index})=>{const p=roadDeckGeometry(local,road).vertices;return[0,3].map(i=>[...p.slice(index*6+i,index*6+i+3)].join(',')).sort();});assert.deepEqual(edges[0],edges[1]);
});

for(const reverse of [false,true])test(`Ultra Bee crosses a real streamed-tile seam ${reverse?'eastbound':'westbound'} without a dip`,async()=>{
 const bounds={minX:-3020,maxX:-2970,minZ:450,maxZ:505},metro=await loadMetroCity({bounds}),local=windowCity(metro,bounds),paths=local.parkPaths.filter(p=>p.id.startsWith('osm-way-1176608877-0-'));
 const source=paths[0].bridgePoints;assert.ok(source?.length>=2);const ends=[[-2992.205,481.463],[-3002.825,469.115]],a=ends[reverse?1:0],b=ends[reverse?0:1],length=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=(b[0]-a[0])/length,dz=(b[1]-a[1])/length,yaw=Math.atan2(dx,dz);
 Object.assign(local,{roads:[],buildings:[],parkPaths:paths,spawn:{x:a[0]-dx*4,z:a[1]-dz*4,yaw}});
 const full=footbridgeRoad(local,{id:'full',points:source,width:paths[0].width,bridge:true}),physics=await DrivingPhysics.create(local);physics.setVehicleType('ultrabee');
 try{
  settle(physics);let arrived=false,seamSamples=0;
  for(let i=0;i<600;i++){
   const s=physics.getState(),along=(s.x-a[0])*dx+(s.z-a[1])*dz;
   if(along>length+3){arrived=true;break;}
   if(Math.abs(s.x+3000)<.8){const deck=sampleRoadElevation(local,full,s.x,s.z);assert.ok(s.y>deck+.4&&s.y<deck+.8,'suspension follows the continuous full-span profile');assert.ok([0,1].every(j=>physics.controller.wheelIsInContact(j)));seamSamples++;}
   const desired=Math.atan2(b[0]+dx*6-s.x,b[1]+dz*6-s.z),error=Math.atan2(Math.sin(desired-s.yaw),Math.cos(desired-s.yaw));
   physics.step({...released,throttle:s.speed<4?.4:0,brake:s.speed>5?.1:0,steer:Math.max(-1,Math.min(1,error*3))},1/60);
  }
  assert.ok(arrived);assert.ok(seamSamples>15,'drive through the cross-tile join, not merely inspect its endpoints');
 }finally{physics.dispose();}
});
