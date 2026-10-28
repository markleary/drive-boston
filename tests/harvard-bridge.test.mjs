import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {resolveCity} from '../src/simulation/city-tiles.ts';
import {roadDeckGeometry,deckEdge} from '../src/simulation/road-surfaces.ts';
import {harvardBridgeSpine,HARVARD_BRIDGE_ROADS,smootMarkers,SMOOT_METRES,SMOOT_TOTAL} from '../src/simulation/harvard-bridge.ts';
import {addHarvardBridgeDetails} from '../src/render/harvard-bridge.ts';
import {DrivingPhysics,carSteeringLimit} from '../src/physics/vehicle.ts';
import {read,readJson,windowCity} from './helpers/metro-city.mjs';
const metro=await resolveCity(readJson('city.json'),read),city=windowCity(metro,{minX:-1650,maxX:-1100,minZ:-900,maxZ:0}),spine=harvardBridgeSpine(city);

test('all Harvard Bridge source decks meet at identical full-width cross-sections',()=>{
 assert.ok(spine);const roads=HARVARD_BRIDGE_ROADS.map(id=>city.roads.find(r=>r.id===id));
 for(let i=1;i<roads.length;i++){
  const a=roads[i-1],b=roads[i];let ai,bi;
  for(const x of [0,a.points.length-1])for(const y of [0,b.points.length-1])if(Math.hypot(a.points[x][0]-b.points[y][0],a.points[x][1]-b.points[y][1])<.002){ai=x;bi=y;}
  assert.notEqual(ai,undefined,`${a.id} joins ${b.id}`);
  const section=(r,i)=>{const g=roadDeckGeometry(city,r);return[Array.from(g.vertices.slice(i*6,i*6+3)),Array.from(g.vertices.slice(i*6+3,i*6+6))].sort((a,b)=>a[0]-b[0]);};
  assert.deepEqual(section(a,ai),section(b,bi),`${a.id} and ${b.id} cannot leave a width or tangent step`);
 }
 assert.equal(roads[0].deckWidths[0],16);assert.equal(roads[0].deckWidths.at(-1),10,'Boston ramp must meet the existing 10 m Massachusetts Avenue street');
 assert.ok(roads[0].deckWidths.every((w,i,a)=>!i||Math.abs(w-a[i-1])<.6),'the shore taper must be gradual');
});

test('Smoot labels cover the eastern sidewalk with real unit spacing and the commemorative total',()=>{
 const markers=smootMarkers(spine.length);assert.equal(markers.length,39);assert.equal(markers[0].smoot,0);assert.equal(markers.at(-1).smoot,364.4);
 assert.equal(SMOOT_METRES,1.7018);assert.equal(SMOOT_TOTAL,364.4);
 for(const m of markers){assert.ok(m.distance>8&&m.distance<spine.length-8);assert.ok(Math.abs(m.distance-markers[0].distance-m.smoot*SMOOT_METRES)<1e-8);}
 assert.ok(markers.find(m=>m.smoot===182.2).label.includes('HALFWAY TO HELL'));
 assert.ok(markers.at(-1).label.includes('± 1 EAR'));
 const details=addHarvardBridgeDetails(new THREE.Scene(),city,{labelTexture:null});
 assert.equal(details.group.userData.markers.length,39);assert.equal(details.group.userData.ticks,366);assert.equal(details.collisions.length,4);
 details.group.traverse(o=>o.geometry?.dispose());
});

for(const reverse of [false,true])test(`full Harvard Bridge ${reverse?'Cambridge to Boston':'Boston to Cambridge'} drive clears each widened seam and sidewalk`,async()=>{
 const physics=await DrivingPhysics.create(city),scene=new THREE.Scene(),details=addHarvardBridgeDetails(scene,city,{labelTexture:null}),held={throttle:0,brake:0,steer:0,handbrake:false};
 const points=spine.road.points.map((_,i)=>{const p=deckEdge(spine.road,i,reverse?-1:1,(spine.road.deckWidths[i]??16)*.18);return{x:p[0],z:p[1]};});if(reverse)points.reverse();
 try{
  for(const mesh of details.collisions)physics.addStaticMesh(mesh.vertices,mesh.indices);
  const [a,b]=points;physics.reset(a.x,a.z,Math.atan2(b.x-a.x,b.z-a.z),reverse?HARVARD_BRIDGE_ROADS.at(-1):HARVARD_BRIDGE_ROADS[0]);
  for(let i=0;i<60;i++)physics.step({...held,brake:1},1/60);
  let cursor=1,lastProgress=0;
  for(let frame=0;frame<150*60;frame++){
   const s=physics.getState(),before=cursor;while(cursor<points.length-1&&Math.hypot(s.x-points[cursor].x,s.z-points[cursor].z)<4)cursor++;
   if(cursor>before)lastProgress=frame;assert.ok(frame-lastProgress<420,`blocked near ${s.x},${s.z}`);
   if(cursor===points.length-1&&Math.hypot(s.x-points[cursor].x,s.z-points[cursor].z)<1.5)return;
   let target=cursor,look=0;while(target<points.length-1&&look<7){look+=Math.hypot(points[target+1].x-points[target].x,points[target+1].z-points[target].z);target++;}
   const p=points[target],angle=Math.atan2(Math.sin(Math.atan2(p.x-s.x,p.z-s.z)-s.yaw),Math.cos(Math.atan2(p.x-s.x,p.z-s.z)-s.yaw)),steer=Math.atan2(2*2.66*Math.sin(angle),Math.max(4,Math.hypot(p.x-s.x,p.z-s.z))),limit=carSteeringLimit(s.speed);
   physics.step({...held,throttle:s.speed<8?.65:0,brake:s.speed>9?.1:0,steer:steer/limit},1/60);
  }
  assert.fail('did not finish the full bridge');
 }finally{physics.dispose();scene.traverse(o=>o.geometry?.dispose());}
});
