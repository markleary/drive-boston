import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {lowClearanceCrossings,lowClearanceAt,clearanceLegend,LONGFELLOW_CLEARANCE,TWELVE_FEET} from '../src/simulation/low-clearance.ts';
import {addLowClearanceDetails} from '../src/render/low-clearance.ts';
import {addCharlesBridgeDetails} from '../src/render/charles-bridges.ts';
import {resolveCity} from '../src/simulation/city-tiles.ts';
import {read,readJson,windowCity,loadMetroCity} from './helpers/metro-city.mjs';
import {sampleRoadElevation} from '../src/simulation/road-surfaces.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
const metro=await resolveCity(readJson('city.json'),read);
const release={throttle:0,brake:0,steer:0,handbrake:false};

test('cars-only low bridge catalog covers all three parkways and warns below, never above, the modeled clearance',()=>{
 const sites=lowClearanceCrossings(metro);assert.ok(sites.length>=18);
 for(const name of ['Storrow Drive','Soldiers Field Road','Memorial Drive'])assert.ok(sites.some(s=>metro.roads.find(r=>r.id===s.roadId).name.startsWith(name)),name);
 for(const site of sites){assert.ok(site.clearance<TWELVE_FEET||site.kind==='longfellow');assert.ok(site.clearance>2);assert.equal(lowClearanceAt(metro,site.x,site.z)?.id,site.id);const [feet,inches]=site.posted.match(/\d+/g).map(Number);assert.ok((feet*12+inches)*.0254<=site.clearance+.00001);}
 assert.equal(clearanceLegend(LONGFELLOW_CLEARANCE),`10'-6"`);
 assert.equal(lowClearanceAt(metro,10000,10000),undefined);
});

test('every low bridge has a mounted clearance board and the photograph Longfellow portals have solid steel ribs',()=>{
 const scene=new THREE.Scene(),details=addLowClearanceDetails(scene,metro),sites=lowClearanceCrossings(metro),boards=new Set();
 details.group.traverse(o=>{if(o.name.endsWith('bridge clearance board'))boards.add(o.userData.clearanceId);});
 assert.equal(boards.size,sites.length);
 const portals=sites.filter(s=>s.kind==='longfellow');assert.equal(portals.length,2);
 const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),ray=new THREE.Raycaster();
 for(const site of portals){
  assert.equal(site.posted,site.roadId==='13519-0-0'?`12'-0"`:`10'-6"`);const meshes=details.collisions.filter(c=>c.id===site.id).map(c=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(c.vertices,3));g.setIndex(new THREE.BufferAttribute(c.indices,1));return new THREE.Mesh(g,material);});
  assert.ok(meshes.length>50);
  for(const across of [-4,0,4])for(const along of [-site.halfDepth,0,site.halfDepth]){
   const x=site.x+across*Math.cos(site.yaw)+along*Math.sin(site.yaw),z=site.z-across*Math.sin(site.yaw)+along*Math.cos(site.yaw),road=metro.roads.find(r=>r.id===site.roadId),ground=sampleRoadElevation(metro,road,x,z);
   ray.set(new THREE.Vector3(x,ground+2,z),new THREE.Vector3(0,1,0));const hit=ray.intersectObjects(meshes,false)[0];assert.ok(hit,'visible arch must be physical');assert.ok(hit.point.y-ground>2.6,'cars retain headroom');if(site.roadId!=='13519-0-0')assert.ok(hit.point.y-ground<3.66,'the moving truck reaches the steel');
  }
  meshes.forEach(m=>m.geometry.dispose());
 }
 scene.traverse(o=>o.geometry?.dispose());material.dispose();
});

for(const reverse of [false,true])test(`car crosses the Longfellow Boston arch ${reverse?'northbound':'southbound'}`,async()=>{
 const city=windowCity(metro,{minX:90,maxX:255,minZ:-1335,maxZ:-1160}),site=lowClearanceCrossings(city).find(s=>s.roadId==='13519-0-0'),physics=await DrivingPhysics.create(city,{buildingColliders:false}),scene=new THREE.Scene();
 try{
  const details=addLowClearanceDetails(scene,city);for(const c of details.collisions)physics.addStaticMesh(c.vertices,c.indices);
  const direction=reverse?-1:1,yaw=site.yaw+(reverse?Math.PI:0),start=-direction*30;physics.reset(site.x+Math.sin(site.yaw)*start,site.z+Math.cos(site.yaw)*start,yaw,'13519-0-0');
  for(let i=0;i<60;i++)physics.step({...release,brake:1},1/60);
  for(let i=0;i<720;i++){const state=physics.getState();physics.step({...release,throttle:state.speed<6?.3:0,brake:state.speed>7?.15:0},1/60);}
  const state=physics.getState(),along=(state.x-site.x)*Math.sin(site.yaw)+(state.z-site.z)*Math.cos(site.yaw);
  assert.ok(along*direction>site.halfDepth+5,`arch must not block car: ${JSON.stringify(state)}`);assert.equal(state.storrowed,false);
 }finally{physics.dispose();scene.traverse(o=>o.geometry?.dispose());}
});

test('Longfellow source-label correction changes only the verified Storrow carriageways',async()=>{
 const original=readJson('city.json'),separate={id:'real-charlesbank-side-street',name:'Charlesbank Road',points:[[0,0],[0,12]],width:5,oneway:0};original.roads.push(separate);
 const city=await resolveCity(original,read);
 for(const [id,direction]of [['8890-0-0','West'],['13519-0-0','West'],['13128-0-0','East'],['13129-0-0','East'],['13133-0-0','West'],['13134-0-0','East'],['13136-0-0','West'],['8541-0-0','West']])assert.equal(city.roads.find(r=>r.id===id).name,`Storrow Drive ${direction}`);
 assert.equal(separate.name,'Charlesbank Road');assert.equal(separate.kind,undefined);
});

for(const reverse of [false,true])test(`moving truck strikes the actual Longfellow steel and repairs beyond it (${reverse?'opposite':'legal'} approach)`,async()=>{
 const city=windowCity(metro,{minX:90,maxX:265,minZ:-1340,maxZ:-1150}),site=lowClearanceCrossings(city).find(s=>s.roadId==='13128-0-0'),physics=await DrivingPhysics.create(city,{buildingColliders:false}),scene=new THREE.Scene();
 try{
  const details=addLowClearanceDetails(scene,city);for(const c of details.collisions)physics.addStaticMesh(c.vertices,c.indices);
  physics.setCar('moving-truck');const direction=reverse?-1:1,yaw=site.yaw+(reverse?Math.PI:0);
  physics.reset(reverse?204:195.8,reverse?-1280:-1201,yaw,reverse?'13128-0-0':'13129-0-0');
  for(let i=0;i<60;i++)physics.step({...release,brake:1},1/60);
  for(let i=0;i<900&&!physics.getState().storrowed;i++)physics.step({...release,throttle:1},1/60);
  const damaged=physics.getState();assert.equal(damaged.storrowed,true,'cargo contact with the rendered arch must register');assert.ok(damaged.storrowDamage>0);assert.equal(physics.takeStorrowStrikes().length,1);
  for(let i=0;i<120;i++)physics.step({...release,throttle:1},1/60);assert.equal(physics.takeStorrowStrikes().length,0,'a wedged truck cannot repeat the event');
  physics.resetToRoad();const reset=physics.getState(),along=(reset.x-site.x)*Math.sin(site.yaw)+(reset.z-site.z)*Math.cos(site.yaw);
  assert.equal(reset.storrowed,false);assert.equal(reset.storrowDamage,0);assert.ok(along*direction>site.halfDepth+3.8,`repair must put the whole truck beyond the bridge: ${JSON.stringify(reset)}`);
  assert.ok(Math.abs(reset.y-sampleRoadElevation(city,city.roads.find(r=>r.id===site.roadId),reset.x,reset.z))<1.2,'recovery stays on the lower carriageway');
 }finally{physics.dispose();scene.traverse(o=>o.geometry?.dispose());}
});


test('Longfellow masonry leaves the full ground-level Paul Dudley White path corridor open',async()=>{
 const loaded=await loadMetroCity({tiles:['0_-2']}),city=windowCity(loaded,{minX:90,maxX:255,minZ:-1335,maxZ:-1160}),physics=await DrivingPhysics.create(city,{buildingColliders:false}),scene=new THREE.Scene();
 try{
  const path=city.parkPaths.find(p=>p.id.startsWith('osm-way-150052469-'));assert.ok(path);assert.equal(path.bridge,false);
  const details=addLowClearanceDetails(scene,city),river=addCharlesBridgeDetails(scene,city),handles=new Set([...details.collisions,...river.collisions].map(c=>physics.addStaticMesh(c.vertices,c.indices).handle));physics.world.step();
  const space=new RAPIER.Cuboid(.28,1.08,.28),rotation={x:0,y:0,z:0,w:1};let checked=0;
  for(let i=1;i<path.points.length;i++){
   const a=path.points[i-1],b=path.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(!length)continue;
   for(let along=0;along<=length;along+=1)for(const across of [-path.width/2+.3,0,path.width/2-.3]){
    const x=a[0]+dx*along/length-dz/length*across,z=a[1]+dz*along/length+dx/length*across;if(z<-1276||z>-1220)continue;
    const y=sampleElevation(city,x,z)+1.13,hit=physics.world.intersectionWithShape({x,y,z},rotation,space,undefined,undefined,undefined,undefined,c=>handles.has(c.handle));
    assert.ok(!hit,`pier or arch intrudes on bike path at ${x},${z}`);checked++;
   }
  }
  assert.ok(checked>150,'test the actual mapped path width throughout the underpass');
 }finally{physics.dispose();scene.traverse(o=>o.geometry?.dispose());}
});
