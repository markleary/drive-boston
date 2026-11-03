import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {DrivingPhysics,carSteeringLimit} from '../src/physics/vehicle.ts';
import {sampleRoadElevation} from '../src/simulation/road-surfaces.ts';
import {tileCollisionIndices} from '../src/render/tile-geometry.ts';
import {pavementEdges} from '../src/simulation/tile-format.ts';
import {loadMetroCity,windowCity,readJson,installExactMeshes} from './helpers/metro-city.mjs';

const source=readJson('museum-approaches-source.json'),bounds={minX:250,maxX:1050,minZ:-2700,maxZ:-1450};
const metro=await loadMetroCity({bounds}),city=windowCity(metro,bounds);city.geometry=metro.geometry;
const data=metro.geometry.get(source.surveyModel),geometry=new THREE.BufferGeometry();
geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));geometry.setIndex(new THREE.BufferAttribute(tileCollisionIndices(data),1));
const survey=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));survey.updateMatrixWorld();
const ray=new THREE.Raycaster(),released={throttle:0,brake:0,steer:0,handbrake:false};
function surveyHeight(p,expected){
 ray.set(new THREE.Vector3(p[0],60,p[1]),new THREE.Vector3(0,-1,0));
 const hits=ray.intersectObject(survey).map(h=>h.point.y).filter(y=>Math.abs(y-expected)<3).sort((a,b)=>Math.abs(a-expected)-Math.abs(b-expected));
 assert.ok(hits.length,`missing retained survey deck beneath ${p}`);return hits[0];
}
function dense(points){
 const out=[];
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],count=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/3));
  for(let j=0;j<count;j++)out.push({x:a.x+(b.x-a.x)*j/count,z:a.z+(b.z-a.z)*j/count,y:a.y+(b.y-a.y)*j/count});
 }
 return[...out,points.at(-1)];
}

test('splitting the dam traffic junction preserves continuous measured pavement and sidewalk edges',()=>{
 const north=city.roads.find(r=>r.id==='museum-dam-north-connection'),dam=city.roads.find(r=>r.id==='osm-508565737-0'),link=city.roads.find(r=>r.id==='museum-dam-south-connection');
 assert.deepEqual(north.points.at(-1),dam.points[0]);assert.deepEqual(dam.points[0],link.points[0]);
 const strip=road=>{
  const owners=[...metro.loadedTiles.values()].flatMap(tile=>tile.pavements.filter(p=>p.road===road.id).map(p=>({tile,p})));
  assert.equal(owners.length,1,`one pavement owner for ${road.id}`);
  assert.deepEqual(owners[0].p.walk,[0,0],'both existing sidewalk bands remain');
  return pavementEdges(owners[0].tile,owners[0].p);
 };
 const a=strip(north),b=strip(dam);
 for(const side of ['left','right'])assert.ok(Math.hypot(a[side].at(-1)[0]-b[side][0][0],a[side].at(-1)[1]-b[side][0][1])<.001,`${side} pavement edge meets across tile owners`);
});

test('all three Museum approaches overlap the actual survey floor and retain bounded grades',()=>{
 for(const entry of source.routes){
  const road=city.roads.find(r=>r.id===entry.id);assert.equal(road.traffic,false);
  for(let i=1;i<road.points.length;i++)assert.ok(Math.abs(road.elevations[i]-road.elevations[i-1])/Math.hypot(road.points[i][0]-road.points[i-1][0],road.points[i][1]-road.points[i-1][1])<.13,`${road.id} grade`);
  const indices=entry.reverse?Array.from({length:9},(_,i)=>i):Array.from({length:9},(_,i)=>road.points.length-9+i);
  for(const i of indices)assert.ok(Math.abs(road.elevations[i]-surveyHeight(road.points[i],road.elevations[i])-.025)<.08,`${road.id} survey floor at ${i}`);
 }
});

for(const entry of source.routes)for(const reverse of [false,true])test(`drive ${entry.id} through street and survey joins ${reverse?'reverse':'forward'}`,async()=>{
 const road=city.roads.find(r=>r.id===entry.id);
 const deck=road.points.map((p,i)=>({x:p[0],z:p[1],y:road.elevations[i]}));if(entry.reverse)deck.reverse();
 const ground=city.roads.find(r=>r.id===(entry.parent??entry.landingRoad));let groundPoints;
 if(entry.parent){
  const start=deck[0];let closest=0;
  for(let i=1;i<ground.points.length;i++)if(Math.hypot(ground.points[i][0]-start.x,ground.points[i][1]-start.z)<Math.hypot(ground.points[closest][0]-start.x,ground.points[closest][1]-start.z))closest=i;
  groundPoints=ground.points.slice(Math.max(0,closest-8),closest);
 }else groundPoints=entry.landingIndex===0?ground.points.slice(0,4).reverse():ground.points.slice(-4);
 const street=dense(groundPoints.map(p=>({x:p[0],z:p[1],y:sampleRoadElevation(city,ground,...p)})));
 const mouth=entry.mouth.at(-1),extended=[];
 for(let d=3;d<=9;d+=3){const p=[mouth.x+mouth.tx*d,mouth.z+mouth.tz*d];extended.push({x:p[0],z:p[1],y:surveyHeight(p,mouth.y)});}
 const route=dense([...street,...deck,...extended]);if(reverse)route.reverse();
 await drive(route,entry.id);
});

async function drive(route,id){
 const physics=await DrivingPhysics.create(city);assert.ok(installExactMeshes(physics,city).has(source.surveyModel));
 const start=route[0],next=route[1],end=route.at(-1);
 try{
  physics.reset(start.x,start.z,Math.atan2(next.x-start.x,next.z-start.z),id);
  physics.body.setTranslation({x:start.x,y:start.y+.85,z:start.z},true);
  for(let i=0;i<60;i++)physics.step({...released,brake:1},1/60);
  let cursor=1,lastProgress=0;
  for(let frame=0;frame<160*60;frame++){
   const state=physics.getState(),previous=cursor;
   while(cursor<route.length-1&&Math.hypot(route[cursor].x-state.x,route[cursor].z-state.z)<4)cursor++;
   if(cursor>previous)lastProgress=frame;
   assert.ok(frame-lastProgress<600,`blocked ${id} at ${state.x.toFixed(2)}, ${state.z.toFixed(2)}, y=${state.y.toFixed(2)} (target ${route[cursor].x.toFixed(2)}, ${route[cursor].z.toFixed(2)})`);
   assert.ok(Math.abs(state.rotation.x)<.45&&Math.abs(state.rotation.z)<.45,'car stays upright');
   if(cursor===route.length-1&&Math.hypot(state.x-end.x,state.z-end.z)<2){assert.ok(Math.abs(state.y-end.y-.67)<.65,`ends on destination deck ${state.y} / ${end.y}`);return;}
   let target=cursor,look=0;
   while(target<route.length-1&&look<7){look+=Math.hypot(route[target+1].x-route[target].x,route[target+1].z-route[target].z);target++;}
   const p=route[target],dx=p.x-state.x,dz=p.z-state.z,angle=Math.atan2(Math.sin(Math.atan2(dx,dz)-state.yaw),Math.cos(Math.atan2(dx,dz)-state.yaw));
   const steer=Math.atan2(2*2.66*Math.sin(angle),Math.hypot(dx,dz))/carSteeringLimit(state.speed);
   physics.step({...released,throttle:state.speed<8?.4:0,brake:state.speed>9?.15:0,steer},1/60);
  }
  assert.fail(`Museum route did not finish: ${JSON.stringify(physics.getState())}`);
 }finally{physics.dispose();}
}

for(const id of ['13134-0-0','13136-0-0','14555-0-0','museum-dam-south-connection'])for(const reverse of [false,true])test(`existing street ${id} remains passable ${reverse?'reverse':'forward'}`,async()=>{
 const road=city.roads.find(r=>r.id===id),route=dense(road.points.map(p=>({x:p[0],z:p[1],y:sampleRoadElevation(city,road,...p)})));if(reverse)route.reverse();
 await drive(route,id);
});
