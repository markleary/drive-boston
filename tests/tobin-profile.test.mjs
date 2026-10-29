import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {addTobinBridgeDetails} from '../src/render/tobin-bridge.ts';
import {DrivingPhysics,carSteeringLimit} from '../src/physics/vehicle.ts';
import {sampleDriveSurface,sampleRoadElevation,roadDeckGeometry} from '../src/simulation/road-surfaces.ts';
import {loadMetroCity,windowCity,readJson,installExactMeshes} from './helpers/metro-city.mjs';
import {meshBuildingIds} from '../src/simulation/building-collisions.ts';
import {roadGraph} from '../src/simulation/traffic.ts';
import {pointInside} from '../src/simulation/roads.ts';
const bounds={minX:500,maxX:3300,minZ:-5000,maxZ:-2100};
const metro=await loadMetroCity({bounds}),city=windowCity(metro,bounds);city.geometry=metro.geometry;
const byId=new Map(city.roads.map(r=>[r.id,r])),source=readJson('tobin-bridge-source.json');
const lower=byId.get('tobin-lower'),upper=byId.get('tobin-upper');

test('Tobin traffic traverses the narrow one-way approaches on the correct deck',()=>{
 const {edges}=roadGraph(city),edge=id=>edges.find(e=>e.road.id===id);
 for(const id of ['tobin-boston-north','tobin-chelsea-north','tobin-chelsea-south','tobin-boston-south','tobin-lower','tobin-upper'])assert.ok(edge(id),'traffic missing '+id);
 assert.equal(edge('tobin-boston-north').end,edge('tobin-lower').start);assert.equal(edge('tobin-lower').end,edge('tobin-chelsea-north').start);
 assert.equal(edge('tobin-chelsea-south').end,edge('tobin-upper').start);assert.equal(edge('tobin-upper').end,edge('tobin-boston-south').start);
 assert.notEqual(edge('tobin-lower').start,edge('tobin-upper').end,'stacked decks must not share a graph level');
});

test('Tobin stacked decks retain six metres of vehicle clearance and independent support selection',()=>{
 assert.ok(lower&&upper,'shipped package includes both Tobin decks');assert.deepEqual(lower.points,upper.points);
 for(let i=0;i<lower.points.length;i++){
  assert.ok(Math.abs(upper.elevations[i]-lower.elevations[i]-6.8)<.0002);
  const [x,z]=lower.points[i];assert.equal(sampleDriveSurface(city,x,z,lower.elevations[i]+.7).road?.id,'tobin-lower');assert.equal(sampleDriveSurface(city,x,z,upper.elevations[i]+.7).road?.id,'tobin-upper');
 }
 assert.ok(upper.elevations[300]-upper.bridge.thickness-lower.elevations[300]>6);
});

test('all Tobin ramp joins match both deck edges exactly and land on connected streets',()=>{
 const section=(r,i)=>{const mesh=roadDeckGeometry(city,r);if(i===-1)i=r.points.length-1;return [Array.from(mesh.vertices.slice(i*6,i*6+3)),Array.from(mesh.vertices.slice(i*6+3,i*6+6))].sort((a,b)=>a[0]-b[0]);};
 for(const route of source.routes){
  const r=byId.get(route.id),j=route.joins,parent=byId.get(j.id);assert.deepEqual(section(r,j.index),section(parent,j.parentIndex),route.id+' deck seam');
  const endpoint=r.points.at(route.landing.index),existing=city.roads.filter(p=>p.name===route.landing.name&&!p.id.startsWith('tobin-'));
  assert.ok(existing.some(p=>[p.points[0],p.points.at(-1)].some(q=>Math.hypot(q[0]-endpoint[0],q[1]-endpoint[1])<.002)),route.id+' street graph landing');
  for(let i=1;i<r.points.length;i++)assert.ok(Math.abs(r.elevations[i]-r.elevations[i-1])<=Math.hypot(r.points[i][0]-r.points[i-1][0],r.points[i][1]-r.points[i-1][1])*.0601+.0002,'approach grade stays at or below 6%');
 }
});

test('adapted open Boston approaches clear the unchanged surveyed buildings over the original tunnels',()=>{
 for(const route of source.routes)for(const zone of route.clearanceZones??[]){
  const building=city.buildings.find(b=>b.id===zone.sourceBuilding),r=byId.get(route.id);assert.ok(building,'retained source shell '+zone.sourceBuilding);
  const roof=building.baseElevation+building.height,points=r.points.filter(p=>pointInside(p,building.footprint));assert.ok(points.length,'source tunnel/building overlap fixture remains relevant');
  for(const [x,z]of points)assert.ok(sampleRoadElevation(city,r,x,z)-r.bridge.thickness>roof+.25,'open game approach must clear the roof, not carve or hide the source shell');
 }
});

for(const southbound of [false,true])test(`complete Tobin ${southbound?'southbound':'northbound'} drive reaches the opposite city through actual survey collision`,async()=>{
 const route=(southbound?['tobin-chelsea-south','tobin-upper','tobin-boston-south']:['tobin-boston-north','tobin-lower','tobin-chelsea-north']).map(id=>byId.get(id));
 const points=route.flatMap((r,j)=>{const p=r.points.map(p=>({x:p[0],z:p[1],road:r}));if(r.oneway<0)p.reverse();return j?p.slice(1):p;});
 const physics=await DrivingPhysics.create(city,{meshBuildingIds}),scene=new THREE.Scene();installExactMeshes(physics,city,scene);
 for(const collision of addTobinBridgeDetails(scene,city).collisions)physics.addStaticMesh(collision.vertices,collision.indices);
 const held={throttle:0,brake:0,steer:0,handbrake:false};
 try{
  const [a,b]=points;physics.reset(a.x,a.z,Math.atan2(b.x-a.x,b.z-a.z),a.road.id);
  for(let i=0;i<60;i++)physics.step({...held,brake:1},1/60);
  let cursor=1,lastProgress=0;
  for(let frame=0;frame<650*60;frame++){
   const s=physics.getState(),before=cursor;while(cursor<points.length-1&&Math.hypot(s.x-points[cursor].x,s.z-points[cursor].z)<4)cursor++;
   if(cursor>before)lastProgress=frame;
   assert.ok(frame-lastProgress<600,`blocked on ${points[cursor].road.id} at ${s.x.toFixed(2)},${s.z.toFixed(2)} y=${s.y.toFixed(2)} near point ${cursor}`);
   if(cursor===points.length-1&&Math.hypot(s.x-points[cursor].x,s.z-points[cursor].z)<4)return;
   let target=cursor,look=0;while(target<points.length-1&&look<9){look+=Math.hypot(points[target+1].x-points[target].x,points[target+1].z-points[target].z);target++;}
   const p=points[target],distance=Math.hypot(p.x-s.x,p.z-s.z),angle=Math.atan2(Math.sin(Math.atan2(p.x-s.x,p.z-s.z)-s.yaw),Math.cos(Math.atan2(p.x-s.x,p.z-s.z)-s.yaw)),steer=Math.atan2(2*2.66*Math.sin(angle),Math.max(4,distance)),limit=carSteeringLimit(s.speed);
   const speed=Math.abs(angle)>.35?5:9;
   physics.step({...held,throttle:s.speed<speed?.75:0,brake:s.speed>speed+1?.2:0,steer:Math.max(-1,Math.min(1,steer/limit))},1/60);
  }
  assert.fail('did not finish the full crossing');
 }finally{physics.dispose();scene.traverse(o=>o.geometry?.dispose());}
});
