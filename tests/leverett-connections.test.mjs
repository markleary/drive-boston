import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {DrivingPhysics,carSteeringLimit} from '../src/physics/vehicle.ts';
import {bridgeSupports,sampleRoadElevation} from '../src/simulation/road-surfaces.ts';
import {roadGraph} from '../src/simulation/traffic.ts';
import {tileCollisionIndices} from '../src/render/tile-geometry.ts';
import {loadMetroCity,windowCity,readJson,installExactMeshes} from './helpers/metro-city.mjs';

const source=readJson('leverett-connections-source.json'),bounds={minX:250,maxX:1050,minZ:-2700,maxZ:-1650};
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
function along(points,distance){
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(distance<=length)return[a[0]+(b[0]-a[0])*distance/length,a[1]+(b[1]-a[1])*distance/length];distance-=length;
 }
 return points.at(-1);
}
function dense(points){
 const out=[];
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],count=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/3));
  for(let j=0;j<count;j++)out.push({x:a.x+(b.x-a.x)*j/count,z:a.z+(b.z-a.z)*j/count,y:a.y+(b.y-a.y)*j/count});
 }
 return[...out,points.at(-1)];
}

test('Leverett mouths match the retained survey deck throughout their overlap and stay out of ambient traffic',()=>{
 const edges=roadGraph(city).edges;
 for(const entry of source.routes){
  const road=city.roads.find(r=>r.id===entry.id);assert.ok(road);
  assert.equal(road.traffic,false);assert.ok(!edges.some(e=>e.road.id===road.id));
  const start=entry.direction==='north'?road.points.length-8:0,end=entry.direction==='north'?road.points.length:8;
  for(let i=start;i<end;i++){
   const y=surveyHeight(road.points[i],road.elevations[i]);
   assert.ok(Math.abs(road.elevations[i]-y-.02)<.08,`${road.id} floats above or intersects the retained survey at ${road.points[i]}: patch ${road.elevations[i]}, survey ${y}`);
  }
 }
});

test('north Leverett keeps the mapped crossing order above MA3 and below the next surveyed viaduct',()=>{
 const road=city.roads.find(r=>r.id==='leverett-connector-north');
 const portal=[];
 for(let i=0;i<data.positions.length;i+=3){
  const [x,y,z]=data.positions.subarray(i,i+3);
  if(x>965&&x<976&&z>-1960&&z<-1948&&y<25)portal.push(y);
 }
 assert.ok(portal.length>10,'the actual retained lower portal must be present');
 const portalTop=Math.max(...portal),crossing=[966,-1953];
 assert.ok(sampleRoadElevation(city,road,...crossing)-road.bridge.thickness-portalTop>3,'the restored layer2 roadway must clear the lower MA3 portal');
 const under=[763.7,-2206.2],height=sampleRoadElevation(city,road,...under);
 ray.set(new THREE.Vector3(under[0],40,under[1]),new THREE.Vector3(0,-1,0));
 const overhead=ray.intersectObject(survey).map(h=>h.point.y).filter(y=>y>height+1);
 assert.ok(overhead.length&&Math.min(...overhead)-height>3,'the approach must remain below the retained upper viaduct');
 const supports=bridgeSupports(city,road);
 assert.ok(supports.length>15,'ordinary supports remain along the connector');
 assert.ok(supports.every(p=>p.x<945||p.x>985||p.z<-2000||p.z>-1920),'no generated pier or beam may obstruct the retained lower crossing');
});

for(const entry of source.routes)for(const reverse of [false,true])test(`car crosses both ${entry.id} joins with the real survey collision ${reverse?'reverse':'forward'}`,async()=>{
 const road=city.roads.find(r=>r.id===entry.id),mouth=entry.surveyMouth,way=source.ways.find(w=>w.id===mouth.sourceWay),north=entry.direction==='north';
 const extended=[];
 for(let d=3;d<=21;d+=3){
  const p=along(way.points,mouth.stationMeters+(north?d:-d));
  extended.push({x:p[0],z:p[1],y:surveyHeight(p,mouth.height)});
 }
 const ground=city.roads.find(r=>r.id===(north?'13138-0-0':'11201-0-0'));
 const groundPoints=north?ground.points.slice(-6):ground.points.slice(0,3);
 if(!north){const a=ground.points[2],b=ground.points[3],length=Math.hypot(b[0]-a[0],b[1]-a[1]);groundPoints.push([a[0]+(b[0]-a[0])*15/length,a[1]+(b[1]-a[1])*15/length]);}
 const street=dense(groundPoints.map(p=>({x:p[0],z:p[1],y:sampleRoadElevation(city,ground,...p)})));
 const deck=road.points.map((p,i)=>({x:p[0],z:p[1],y:road.elevations[i]}));
 const route=north?[...street.slice(0,-1),...deck,...extended]:[...extended.reverse(),...deck,...street.slice(1)];if(reverse)route.reverse();
 const physics=await DrivingPhysics.create(city);assert.ok(installExactMeshes(physics,city).has(source.surveyModel),'the real viaduct triangles must participate in this drive');
 const start=route[0],next=route[1],end=route.at(-1);
 try{
  physics.reset(start.x,start.z,Math.atan2(next.x-start.x,next.z-start.z),road.id);
  // One direction starts on the existing source-only deck, outside the new
  // road manifest. Place the car on its ray-verified original mesh surface.
  physics.body.setTranslation({x:start.x,y:start.y+.85,z:start.z},true);
  for(let i=0;i<60;i++)physics.step({...released,brake:1},1/60);
  let cursor=1,lastProgress=0,maxY=-Infinity;
  for(let frame=0;frame<260*60;frame++){
   const state=physics.getState(),previous=cursor;
   while(cursor<route.length-1&&Math.hypot(route[cursor].x-state.x,route[cursor].z-state.z)<4)cursor++;
   if(cursor>previous)lastProgress=frame;
   assert.ok(frame-lastProgress<600,`blocked ${entry.id} at ${state.x.toFixed(2)}, ${state.z.toFixed(2)}, y=${state.y.toFixed(2)} (target ${route[cursor].x.toFixed(2)}, ${route[cursor].z.toFixed(2)})`);
   assert.ok(Math.abs(state.rotation.x)<.45&&Math.abs(state.rotation.z)<.45,'car stays upright across the source joins');
   maxY=Math.max(maxY,state.y);
   if(cursor===route.length-1&&Math.hypot(state.x-end.x,state.z-end.z)<2){
    assert.ok(maxY>18,'route actually reaches the surveyed elevated connector');
    assert.ok(Math.abs(state.y-end.y-.67)<.65,`car ends on the destination deck: ${state.y} / ${end.y}`);return;
   }
   let target=cursor,look=0;
   while(target<route.length-1&&look<7){look+=Math.hypot(route[target+1].x-route[target].x,route[target+1].z-route[target].z);target++;}
   const p=route[target],dx=p.x-state.x,dz=p.z-state.z,angle=Math.atan2(Math.sin(Math.atan2(dx,dz)-state.yaw),Math.cos(Math.atan2(dx,dz)-state.yaw));
   const steer=Math.atan2(2*2.66*Math.sin(angle),Math.hypot(dx,dz))/carSteeringLimit(state.speed);
   physics.step({...released,throttle:state.speed<8?.4:0,brake:state.speed>9?.15:0,steer},1/60);
  }
  assert.fail(`Leverett route did not finish: ${JSON.stringify(physics.getState())}`);
 }finally{physics.dispose();}
});
