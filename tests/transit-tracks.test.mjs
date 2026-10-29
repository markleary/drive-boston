import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createTransitTracks,reservedTrack} from '../src/render/transit-tracks.ts';
import {transitPoint,createTransit} from '../src/simulation/transit.ts';
import {DrivingPhysics} from '../src/physics/vehicle.ts';

const city={bounds:{minX:-10000,maxX:2000,minZ:-1000,maxZ:1000},roads:[],buildings:[],landmarks:[],curbs:[],signals:[],sources:[],spawn:{x:100,z:100,yaw:0}};
const route=(line,points)=>({id:line,line,kind:'tram',destination:`${line.slice(-1)} TEST`,points,distances:[0,1000],length:1000,stops:[]});

test('each western branch gets reserved rail and catenary while Heath Street stays street running',()=>{
 for(const line of ['Green-B','Green-C','Green-D'])assert.equal(reservedTrack({line},[-6000,500]),true);
 assert.equal(reservedTrack({line:'Green-E'},[-2600,1500]),false);
 assert.equal(reservedTrack({line:'Green-E'},[-2200,1000]),true);
 const tracks=createTransitTracks(city,['Green-B','Green-C','Green-D'].map((line,i)=>route(line,[[-6000,i*100],[-5000,i*100]])),transitPoint,()=>0);
 tracks.group.updateMatrixWorld(true);
 for(const z of [0,100,200]){
  const ray=new THREE.Raycaster(new THREE.Vector3(-5500,10,z),new THREE.Vector3(0,-1,0));
  assert.ok(ray.intersectObject(tracks.group,true).some(h=>h.object.name==='Reserved Green Line rail bed'));
 }
 const poles=tracks.group.children.filter(o=>o.name==='Catenary poles');
 for(const z of [0,100,200])assert.ok(poles.some(p=>{p.geometry.computeBoundingBox();return p.geometry.boundingBox.min.z<z&&p.geometry.boundingBox.max.z>z;}),'each branch needs its own supports');
 tracks.updateVisibility(0,0);assert.ok(tracks.group.children.every(m=>!m.visible));
 tracks.updateVisibility(-5500,0);assert.ok(tracks.group.children.every(m=>m.visible));
 for(const mesh of tracks.group.children){mesh.geometry.computeBoundingBox();assert.ok(mesh.geometry.boundingBox.max.x-mesh.geometry.boundingBox.min.x<330,'geometry remains locally cullable');}
});

test('one articulated car per service follows its track and the D ignores overhead road signals',async()=>{
 const sample=async line=>{
  const fixture={...city,signals:[[320,0]]},physics=await DrivingPhysics.create(fixture),scene=new THREE.Scene();
  const transit=createTransit(scene,fixture,physics,{routes:[route(line,[[0,0],[1000,0]])],sources:[],notes:''});
  try{
   assert.equal(transit.tramCount,1);assert.equal(transit.snapshot()[0].carCount,1);
   for(let i=0;i<14*60;i++){transit.update(1/60,physics.getState());physics.step({throttle:0,brake:1,steer:0,handbrake:true},1/60);}
   return transit.snapshot()[0];
  }finally{transit.dispose();physics.dispose();}
 };
 const d=await sample('Green-D'),c=await sample('Green-C');
 assert.ok(d.x>320,'the D keeps moving below an unrelated road signal');
 assert.ok(c.x<300&&c.speed<.2,'the street-level C still observes its crossing signal');
});

test('covered D sections cannot become invisible obstacles for the road above',async()=>{
 const physics=await DrivingPhysics.create({...city,spawn:{x:290,z:0,yaw:0}}),scene=new THREE.Scene();
 const path={...route('Green-D',[[0,0],[1000,0]]),covered:[{start:230,end:300}]};
 const transit=createTransit(scene,city,physics,{routes:[path],sources:[],notes:''});
 try{
  assert.equal(transit.snapshot()[0].covered,true);assert.equal(transit.obstacles().length,0);
  const train=scene.getObjectByName('Green Line single articulated trolley D TEST');
  assert.ok(train.children.every(section=>!section.visible));
  let maxSpeed=0;
  for(let i=0;i<17*60;i++){
   transit.update(1/60,physics.getState());physics.step({throttle:0,brake:1,steer:0,handbrake:true},1/60);
   physics.world.forEachRigidBody(body=>{if(body.isKinematic()&&body.isEnabled()){const v=body.linvel();maxSpeed=Math.max(maxSpeed,Math.hypot(v.x,v.y,v.z));}});
  }
  assert.ok(maxSpeed<8.1,`emerging sections must keep normal travel velocity, got ${maxSpeed} m/s`);
  assert.ok(transit.snapshot()[0].x>320,'a car on the road cannot stop the train beneath it');
  assert.ok(Math.abs(physics.getState().x-290)<.15,'the hidden car cannot push traffic above');
  assert.equal(transit.obstacles().length,1);assert.ok(train.children.every(section=>section.visible),'the complete car emerges again');
 }finally{transit.dispose();physics.dispose();}
});
