import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {resolveCity,loadTile} from '../src/simulation/city-tiles.ts';
import {bridgeSupports,sampleRoadElevation,roadProjection} from '../src/simulation/road-surfaces.ts';
import {surveyViaductSupports} from '../src/simulation/viaduct-supports.ts';
import {coverageTester} from '../src/simulation/coverage.ts';
import {DrivingPhysics,carSteeringLimit} from '../src/physics/vehicle.ts';
import {addCharlesBridgeDetails} from '../src/render/charles-bridges.ts';
import {parkSurface,WATER_SURFACE_OFFSET} from '../src/render/area-surfaces.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {read,readJson,windowCity} from './helpers/metro-city.mjs';
const metro=await resolveCity(readJson('city.json'),read);

test('Charles River level is horizontal and still covers the two reported grass locations',()=>{
 const water=metro.water.find(w=>w.id==='water-merged-55');
 for(const [x,z]of [[-1184,-575],[-40,-1455]]){
  const surface=water.surfaces.find(s=>s.name==='Charles River'&&s.rings[0].some(p=>p[0]<x)&&s.rings[0].some(p=>p[0]>x)&&s.rings[0].some(p=>p[1]<z)&&s.rings[0].some(p=>p[1]>z));
  assert.ok(surface,'Charles must retain its own level above the merged tidal harbour');
  const bounds={minX:x-18,maxX:x+18,minZ:z-18,maxZ:z+18},g=parkSurface(metro,surface.rings,WATER_SURFACE_OFFSET,surface.level,bounds,true),p=g.getAttribute('position');
  assert.ok(p.count>30);
  for(let i=0;i<p.count;i+=3){
   const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3,y=(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3;
   assert.ok(y>sampleElevation(metro,x,z)+.03,'grass must stay below the water inside each detailed DEM triangle');
   for(let j=0;j<3;j++)assert.ok(Math.abs(p.getY(i+j)-surface.level-WATER_SURFACE_OFFSET)<1e-5,'all water vertices stay on one plane');
  }
  g.dispose();
 }
});

test('every restored source span joins retained decks at exactly the same height and stays in traffic coverage',()=>{
 const spans=metro.roads.filter(r=>r.id.startsWith('water-link-')),covered=coverageTester(metro);
 assert.equal(spans.length,18);
 for(const span of spans){
  for(const i of [0,span.points.length-1]){
   const p=span.points[i],neighbors=metro.roads.filter(r=>r!==span&&[r.points[0],r.points.at(-1)].some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<.002));
   assert.ok(neighbors.length,`${span.id} has a dangling end`);
   assert.ok(neighbors.some(r=>Math.abs(sampleRoadElevation(metro,r,...p)-span.elevations[i])<.0002),`${span.id} has a height step at its join`);
  }
  for(const p of span.points)assert.ok(covered(...p),`${span.id} is excluded from traffic coverage`);
 }
 for(const id of ['water-link-14557-0-0','water-link-14614-0-0','water-link-14615-0-0','water-link-14902-0-0','water-link-16428-0-0'])assert.ok(spans.find(r=>r.id===id));
});

// Reported at Dorchester Avenue: each per-segment profile had lifted the bank
// nodes 6.4 m above the quay, so both bridges humped 4.4 m inside a 10 m stub.
test('the Summer Street and Congress Street bridges are level decks between their Dorchester Avenue junctions',()=>{
 for(const ids of [['16427-0-0','16424-0-0','water-link-16424-0-0','16424-0-1','18106-0-0'],['16432-0-0','16428-0-0','water-link-16428-0-0','16428-0-1','17615-0-0']]){
  const roads=ids.map(id=>metro.roads.find(r=>r.id===id));assert.ok(roads.every(Boolean));
  const heights=roads.flatMap(r=>r.elevations);assert.ok(Math.max(...heights)-Math.min(...heights)<1.5,`${ids[0]}: no hump between the junctions and the channel span`);
  for(const r of roads)for(let i=1;i<r.points.length;i++){const d=Math.hypot(r.points[i][0]-r.points[i-1][0],r.points[i][1]-r.points[i-1][1]);assert.ok(Math.abs(r.elevations[i]-r.elevations[i-1])<=.05*d+1e-6,`${r.id} ramps steeper than 5% at point ${i}`);}
  for(const [r,i]of [[roads[0],0],[roads.at(-1),roads.at(-1).points.length-1]])assert.ok(Math.abs(r.elevations[i]-sampleElevation(metro,...r.points[i]))<.02,`${r.id} meets the graded street at its junction`);
  const span=roads[2];assert.ok(span.elevations.every(y=>y===span.elevations[0]),'the channel span is flat');
 }
});

test('long unsplit source segments receive repeated supports and keep lower streets clear',()=>{
 const road={id:'upper',name:'Upper',points:[[0,0],[0,220]],width:10,elevations:[10,10],bridge:{thickness:.75}},lower={id:'lower',name:'Lower',points:[[-20,86],[20,86]],width:9};
 const supports=bridgeSupports({roads:[road,lower]},road);
 assert.ok(supports.length>=5,'the old single if could place only one support on a long source segment');
 assert.ok(supports.every(p=>roadProjection(lower,p.x,p.z).distance>lower.width/2+2.1));
 assert.ok(supports.some(p=>p.z>180));
});

test('the surveyed Nashua viaducts have ground-reaching piers while the Zakim water span and tunnel end stay untouched',async()=>{
 const tile=await loadTile(metro,0,-3,read),b=tile.buildings.find(b=>b.landmark==='zakim-bridge'),data=tile.geometry.get(b.id),before=new Float32Array(data.positions);
 const supports=surveyViaductSupports(metro,data);
 assert.ok(supports.length>100);assert.ok(supports.filter(p=>p.x>600&&p.x<1200&&p.z>-2100).length>20,'supports must reach the floating ramps in the screenshots');
 assert.ok(supports.every(p=>p.z<=-1580&&p.top-p.bottom>=4));assert.deepEqual(data.positions,before,'the original cable bridge mesh must remain unchanged');
});

test('Zakim viaduct pier caps stay beneath every deck they span',async()=>{
 // Reported at x 1160, z -1852: full-width caps rose through the sloping deck
 // and hung over the lower carriageway beside it.
 const tile=await loadTile(metro,0,-3,read),data=tile.geometry.get(tile.buildings.find(b=>b.landmark==='zakim-bridge').id),v=data.positions,decks=[];
 for(let i=0;i<data.roof.length;i+=3){
  const p=[0,1,2].map(j=>[v[data.roof[i+j]*3],v[data.roof[i+j]*3+1],v[data.roof[i+j]*3+2]]),a=p[1].map((n,k)=>n-p[0][k]),b=p[2].map((n,k)=>n-p[0][k]);
  const ny=a[2]*b[0]-a[0]*b[2],nx=a[1]*b[2]-a[2]*b[1],nz=a[0]*b[1]-a[1]*b[0];if(ny>0&&Math.hypot(nx,nz)/ny<=.3)decks.push(p);
 }
 const heights=(x,z)=>decks.flatMap(([a,b,c])=>{const dx1=b[0]-a[0],dz1=b[2]-a[2],dx2=c[0]-a[0],dz2=c[2]-a[2],det=dx1*dz2-dz1*dx2;if(!det)return[];const u=((x-a[0])*dz2-(z-a[2])*dx2)/det,w=(dx1*(z-a[2])-dz1*(x-a[0]))/det;return u>=-1e-3&&w>=-1e-3&&u+w<=1.001?[a[1]+u*(b[1]-a[1])+w*(c[1]-a[1])]:[];});
 const supports=surveyViaductSupports(metro,data);
 assert.ok(supports.some(p=>Math.hypot(p.x-1157.8,p.z+1854)<30),'the reported stretch keeps its piers');
 for(const p of supports){
  const c=Math.cos(p.yaw),s=Math.sin(p.yaw);
  for(let u=-p.width/2;u<=p.width/2+1e-6;u+=.5)for(const w of [-1.6,0,1.6]){
   const x=p.capX+u*c+w*s,z=p.capZ-u*s+w*c;
   for(const h of heights(x,z))assert.ok(h>=p.top+.5||h<p.top-6,`cap at ${p.x.toFixed(0)}, ${p.z.toFixed(0)} meets a deck at ${h.toFixed(2)} (cap top ${p.top.toFixed(2)})`);
  }
 }
});

test('Longfellow has four collidable towers, dedicated carriageways, and eleven arch spans',()=>{
 const scene=new THREE.Scene(),{group,collisions}=addCharlesBridgeDetails(scene,metro);
 assert.equal(group.userData.towers,4);assert.equal(group.userData.archSpans,11);assert.ok(collisions.length>25);
 for(const r of metro.roads.filter(r=>r.name==='Longfellow Bridge'))assert.equal(r.width,7,'whole-bridge width cannot be applied to a single carriageway');
 for(const mesh of group.children){assert.ok(mesh.geometry.boundingSphere===null||Number.isFinite(mesh.geometry.boundingSphere.radius));mesh.geometry.dispose();}
});

for(const [id,bounds]of [
 ['water-link-14557-0-0',{minX:-1550,maxX:-1100,minZ:-820,maxZ:0}],
 ['water-link-14614-0-0',{minX:-450,maxX:260,minZ:-1400,maxZ:-1100}],
 ['water-link-14615-0-0',{minX:-450,maxX:260,minZ:-1400,maxZ:-1100}],
 ['water-link-16428-0-0',{minX:1700,maxX:2150,minZ:-400,maxZ:0}],
])test(`car drives across the restored ${id} and both physical joins`,async()=>{
 const city=windowCity(metro,bounds),road=city.roads.find(r=>r.id===id),a=road.points[0],b=road.points[1],end=road.points.at(-1),physics=await DrivingPhysics.create(city);
 const released={throttle:0,brake:0,steer:0,handbrake:false};
 try{
  physics.reset(a[0],a[1],Math.atan2(b[0]-a[0],b[1]-a[1]),road.id);
  for(let i=0;i<60;i++)physics.step({...released,brake:1},1/60);
  let cursor=1,finished=false;
  for(let frame=0;frame<50*60;frame++){
   const s=physics.getState();while(cursor<road.points.length-1&&Math.hypot(s.x-road.points[cursor][0],s.z-road.points[cursor][1])<8)cursor++;
   const p=road.points[cursor],angle=Math.atan2(Math.sin(Math.atan2(p[0]-s.x,p[1]-s.z)-s.yaw),Math.cos(Math.atan2(p[0]-s.x,p[1]-s.z)-s.yaw));
   const steer=Math.atan2(2*2.66*Math.sin(angle),Math.max(4,Math.hypot(p[0]-s.x,p[1]-s.z))),limit=carSteeringLimit(s.speed);
   physics.step({...released,throttle:s.speed<7?.35:0,brake:s.speed>8?.1:0,steer:steer/limit},1/60);
   assert.ok(s.y>Math.min(...road.elevations)-.3,'car fell through the former missing span');
   if(cursor===road.points.length-1&&Math.hypot(s.x-end[0],s.z-end[1])<1.5){
    // Cross the far seam under power as well.
    for(let i=0;i<45;i++)physics.step({...released,throttle:.3},1/60);
    assert.ok(physics.getState().y>road.elevations.at(-1)-.3);finished=true;break;
   }
  }
  assert.ok(finished,`car stopped before far bank: ${JSON.stringify(physics.getState())}`);
 }finally{physics.dispose();}
});
