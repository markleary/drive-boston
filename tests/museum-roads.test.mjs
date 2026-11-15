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

const connections=[
 {id:'storrow-leverett-east',street:'13128-0-0',parent:'leverett-connector-north',reverse:false},
 {id:'storrow-leverett-west',street:'13133-0-0',parent:'leverett-connector-south',reverse:true},
];
function connection(entry){
 const parts=city.roads.filter(r=>r.id===entry.id||r.id.startsWith(entry.id+'-'));
 assert.ok(parts.length,`missing ${entry.id}`);
 const start=parts.find(r=>!parts.some(other=>other!==r&&other.points.at(-1).every((x,k)=>x===r.points[0][k])));
 assert.ok(start,`one source-directed chain for ${entry.id}`);
 const chain=[start];
 while(chain.length<parts.length){
  const next=parts.find(r=>!chain.includes(r)&&r.points[0].every((x,k)=>x===chain.at(-1).points.at(-1)[k]));
  assert.ok(next,`continuous ${entry.id} across deck and tunnel records`);chain.push(next);
 }
 return chain;
}

test('Museum underpasses keep source levels and the duplicate raised survey slabs are gone',()=>{
 for(const entry of source.routes)assert.ok(!city.roads.some(r=>r.id===entry.id),'old raised survey approach retired');
 for(const entry of connections){
  const chain=connection(entry);assert.ok(chain.some(r=>r.tunnel&&r.tunnel.covered.length),'source underpass has a roof');
  for(const road of chain)for(let i=1;i<road.points.length;i++){
   const d=Math.hypot(road.points[i][0]-road.points[i-1][0],road.points[i][1]-road.points[i-1][1]);
   assert.ok(Math.abs(road.elevations[i]-road.elevations[i-1])/d<.131,`${road.id} bounded grade`);
   // The shared roadway generator limits each pavement edge to 1:8, with
   // 5 cm rounding tolerance. Check the installed geometry, including roofs.
   assert.ok(Math.abs(road.deckWidths[i]-road.deckWidths[i-1])/2<=Math.max(.5,d)/8+.05,`${road.id} gradual width transition`);
  }
  const end=entry.reverse?chain[0]:chain.at(-1),i=entry.reverse?0:end.points.length-1,parent=city.roads.find(r=>r.id===entry.parent);
  const j=parent.points.findIndex(p=>p.every((x,k)=>x===end.points[i][k]));assert.ok(j>=0,'joins an existing connector vertex');
  assert.ok(Math.abs(end.elevations[i]-parent.elevations[j])<.001,'same elevation at the join');
  assert.ok(Math.abs(end.deckWidths[i]-parent.deckWidths[j])<.01,'same width at the join');
 }
 for(const p of [[617,-1845],[800,-1790],[670,-1809]]){
  ray.set(new THREE.Vector3(p[0],40,p[1]),new THREE.Vector3(0,-1,0));
  assert.ok(!ray.intersectObject(survey).some(h=>h.point.y>12&&h.point.y<24),`no detached duplicate survey floor at ${p}`);
 }
});

for(const entry of connections)for(const reverse of [false,true])test(`drive ${entry.id} through street, tunnel and connector joins ${reverse?'reverse':'forward'}`,async()=>{
 const chain=connection(entry),deck=chain.flatMap((r,k)=>r.points.slice(k?1:0).map((p,j)=>({x:p[0],z:p[1],y:r.elevations[j+(k?1:0)]})));
 if(entry.reverse)deck.reverse();
 const street=city.roads.find(r=>r.id===entry.street),parent=city.roads.find(r=>r.id===entry.parent);
 const streetPoints=entry.reverse?street.points.slice(0,4).reverse():street.points.slice(-4);
 const last=deck.at(-1),j=parent.points.findIndex(p=>p[0]===last.x&&p[1]===last.z);
 const indices=entry.reverse?Array.from({length:5},(_,k)=>j-1-k):Array.from({length:5},(_,k)=>j+1+k);
 const continuation=indices.filter(i=>i>=0&&i<parent.points.length).map(i=>({x:parent.points[i][0],z:parent.points[i][1],y:parent.elevations[i]}));
 const route=dense([...streetPoints.map(p=>({x:p[0],z:p[1],y:sampleRoadElevation(city,street,...p)})),...deck,...continuation]);if(reverse)route.reverse();
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
