import './helpers/npc-fleet.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {NPC_VEHICLES,NPC_BODY_LIFT,TRAFFIC_CAPACITY} from '../src/simulation/npc-vehicle-specs.ts';
import {createNPCVehicleColliders} from '../src/physics/npc-vehicle.ts';
import {createNPCVehicleBatches} from '../src/render/npc-vehicles.ts';
import {createNPCPlateAtlas} from '../src/render/npc-license-plates.ts';
import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createTraffic} from '../src/simulation/traffic.ts';
import {DrivingPhysics} from '../src/physics/vehicle.ts';

await RAPIER.init();
test('all five rigid bodies have their specified mass, computed inertia, CCD, and grounded tires',()=>{
 for(const spec of NPC_VEHICLES){
  const world=new RAPIER.World({x:0,y:-9.81,z:0});
  try{
   world.createCollider(RAPIER.ColliderDesc.cuboid(50,.5,50).setTranslation(0,-.5,0));
   const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,NPC_BODY_LIFT+.02,0));
   const colliders=createNPCVehicleColliders(world,body,spec);
   assert.ok(Math.abs(body.mass()-spec.mass)<.01,`${spec.type}: ${body.mass()} kg`);
   assert.equal(colliders.length,8);
   assert.ok(body.isCcdEnabled());
   const inertia=body.principalInertia();assert.ok([inertia.x,inertia.y,inertia.z].every(v=>v>0&&Number.isFinite(v)));
   assert.ok(body.localCom().y+NPC_BODY_LIFT>.35,'mass center must lie above the road');
   body.applyImpulse({x:spec.mass,y:0,z:0},true);assert.ok(Math.abs(body.linvel().x-1)<1e-5,'an impulse must accelerate the actual vehicle mass');
   body.setLinvel({x:0,y:0,z:0},true);
   for(let i=0;i<300;i++)world.step();
   assert.ok(Math.abs(body.translation().y-NPC_BODY_LIFT)<.045,`${spec.type}: rests on rendered tires at ${body.translation().y}`);
   const r=body.rotation();assert.ok(1-2*(r.x*r.x+r.z*r.z)>.995,`${spec.type}: settles upright`);
  }finally{world.free();}
 }
});

test('truck collision shapes distinguish the open pickup bed, cab, and tall cargo box',()=>{
 for(const type of ['pickup','box']){
  const spec=NPC_VEHICLES.find(s=>s.type===type),world=new RAPIER.World({x:0,y:0,z:0});
  try{
   const body=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0,NPC_BODY_LIFT,0));createNPCVehicleColliders(world,body,spec);world.step();
   const top=world.castRay(new RAPIER.Ray({x:0,y:5,z:-2},{x:0,y:-1,z:0}),10,true);
   assert.ok(top);const y=5-top.timeOfImpact;
   assert.ok(type==='pickup'?y<1.3:y>3.0,`${type}: rear collision height ${y}`);
  }finally{world.free();}
 }
});

test('traffic uses all approved types, valid stable paint, actual dimensions, and the 20% larger pool',async()=>{
 const {loadCentralCity}=await import('./helpers/metro-city.mjs');const city=await loadCentralCity();
 const physics=await DrivingPhysics.create(city),traffic=createTraffic(new THREE.Scene(),city,physics);
 try{
  assert.equal(TRAFFIC_CAPACITY,77);assert.equal(traffic.count,77);
  const before=traffic.snapshot();assert.equal(new Set(before.map(v=>v.type)).size,5);
  assert.equal(new Set(before.map(v=>v.registration)).size,before.length);
  for(const [i,v] of before.entries()){
   const spec=NPC_VEHICLES.find(s=>s.type===v.type);
   assert.equal(v.mass,spec.mass);assert.ok(spec.colors.includes(Number.parseInt(v.color.slice(1),16)));
   assert.equal(traffic.obstacles()[i].halfLength,spec.length/2);assert.equal(traffic.obstacles()[i].halfWidth,spec.width/2);
  }
  traffic.update(1/60,physics.getState());assert.deepEqual(traffic.snapshot().map(v=>v.color),before.map(v=>v.color));assert.deepEqual(traffic.snapshot().map(v=>v.registration),before.map(v=>v.registration));
 }finally{traffic.dispose();physics.dispose();}
});

test('random Massachusetts registrations are stable, unique across fleets, and occupy separate atlas cells',()=>{
 const moving=createNPCPlateAtlas(77,()=>.42),parked=createNPCPlateAtlas(8,()=>.42);
 try{
  const numbers=[...Array.from({length:77},(_,i)=>moving.assign(i)),...Array.from({length:8},(_,i)=>parked.assign(i))];
  assert.equal(new Set(numbers).size,85);assert.ok(numbers.every(v=>/^[1-9][A-Z]{2} \d{3}$/.test(v)&&v!=='4BK 026'));
  assert.equal(moving.assign(0),numbers[0]);
  const source=new THREE.PlaneGeometry(.305,.1524),a=moving.geometry(source,0),b=moving.geometry(source,1);
  assert.ok(Math.max(...Array.from({length:a.attributes.uv.count},(_,i)=>a.attributes.uv.getX(i)))<Math.min(...Array.from({length:b.attributes.uv.count},(_,i)=>b.attributes.uv.getX(i))));
  source.dispose();a.dispose();b.dispose();
 }finally{moving.dispose();parked.dispose();}
});

test('every baked silhouette retains front and rear plate faces in both detail levels',async()=>{
 const bytes=await readFile(new URL('../public/models/traffic-fleet.glb',import.meta.url)),gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 for(const spec of NPC_VEHICLES)for(const detail of ['near','far']){
  const root=gltf.scene.getObjectByName(`${spec.type}-${detail}`),plate=root.children.find(m=>m.material.name==='registration'),p=plate.geometry.attributes.position,uv=plate.geometry.attributes.uv;
  const z=Array.from({length:p.count},(_,i)=>p.getZ(i));
  assert.ok(Math.max(...z)>spec.length/2-.2,`${spec.type} ${detail}: front plate`);assert.ok(Math.min(...z)<-spec.length/2+.2,`${spec.type} ${detail}: rear plate`);
  assert.ok(uv&&uv.count===p.count);for(const value of uv.array)assert.ok(value>=0&&value<=1);
 }
 gltf.scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
});

test('near/far batches retain actor transforms and paint across different silhouettes',()=>{
 const group=new THREE.Group(),fleet=createNPCVehicleBatches(group,5),matrix=new THREE.Matrix4(),out=new THREE.Matrix4();
 try{
  NPC_VEHICLES.forEach((spec,i)=>{fleet.bind(i,spec.type);fleet.draw(i,matrix.makeTranslation(i*10,2,3),new THREE.Color(spec.colors[0]),i%2?150:20);});fleet.flush();
  const near=group.children.find(m=>m.name==='NPC near paint'),far=group.children.find(m=>m.name==='NPC far paint');
  for(let i=0;i<5;i++){near.getMatrixAt(i,out);assert.equal(out.elements[12],i*10);assert.equal(near.getVisibleAt(i),i%2===0);assert.equal(far.getVisibleAt(i),i%2===1);}
  fleet.setNight(true);assert.ok(group.children.find(m=>m.name==='NPC near lamp').material.emissiveIntensity>2);
 }finally{fleet.dispose();assert.equal(group.children.length,0);}
});

test('moving and parked fleets share model buffers without freeing another pool’s live geometry',()=>{
 const a=new THREE.Group(),b=new THREE.Group(),moving=createNPCVehicleBatches(a,77),parked=createNPCVehicleBatches(b,8);
 const near=a.children.find(m=>m.name==='NPC near paint'),other=b.children.find(m=>m.name==='NPC near paint');let disposed=0;
 near.geometry.addEventListener('dispose',()=>disposed++);
 assert.equal(near.geometry,other.geometry);
 moving.bind(0,'compact');parked.bind(0,'sedan');
 parked.dispose();assert.equal(disposed,0,'the live moving fleet must retain its GPU geometry');
 moving.draw(0,new THREE.Matrix4(),new THREE.Color('white'),0);moving.flush();moving.dispose();assert.equal(disposed,1,'the last owner releases the shared buffers exactly once');
});
