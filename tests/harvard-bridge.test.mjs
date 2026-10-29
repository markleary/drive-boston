import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import * as THREE from 'three';
import {resolveCity} from '../src/simulation/city-tiles.ts';
import {roadDeckGeometry,deckEdge} from '../src/simulation/road-surfaces.ts';
import {harvardBridgeSpine,HARVARD_BRIDGE_ROADS,smootMarkers,SMOOT_METRES,SMOOT_TOTAL} from '../src/simulation/harvard-bridge.ts';
import {addHarvardBridgeDetails} from '../src/render/harvard-bridge.ts';
import {DrivingPhysics,carSteeringLimit} from '../src/physics/vehicle.ts';
import {read,readJson,windowCity} from './helpers/metro-city.mjs';
const metro=await resolveCity(readJson('city.json'),read),city=windowCity(metro,{minX:-1650,maxX:-1100,minZ:-900,maxZ:0}),spine=harvardBridgeSpine(city);

function assertBostonApproach(roads){
 const bridge=harvardBridgeSpine({roads}),shore=roads.find(r=>r.id==='14557-0-1').points[0],end=bridge.road.points.findIndex(p=>Math.hypot(p[0]-shore[0],p[1]-shore[1])<.001);
 const ys=bridge.road.elevations,distances=bridge.distances,rise=ys[end]-ys[0],grade=rise/distances[end];
 assert.ok(end>20&&distances[end]>100,'the ramp must span all three Boston source pieces');
 assert.ok(grade>0&&grade<.04,'one gentle climb reaches the existing basin deck');
 for(let i=0;i<=end;i++){
  assert.ok(Math.abs(ys[i]-(ys[0]+grade*distances[i]))<=.000051,`Boston ramp station ${i} must lie on one straight grade`);
  if(i)assert.ok(ys[i]>ys[i-1],'the Boston approach must never dip or form a crest');
 }
 assert.equal(ys[end],ys[end+1],'the ramp joins the flat basin deck without an overshoot');
}

test('Boston Harvard approach has one straight grade from Massachusetts Avenue to the basin deck',()=>assertBostonApproach(city.roads));

test('Harvard generation removes independent source crests and is idempotent',()=>{
 const roads=structuredClone(city.roads.filter(r=>HARVARD_BRIDGE_ROADS.includes(r.id))),byId=new Map(roads.map(r=>[r.id,r]));
 // Recorded source endpoint estimates before the fix: a 5.6966 m shore crest
 // followed by 3.2516 m and 3.225 m basin sections. The intermediate samples
 // deliberately need not match the old interpolation for the repair to work.
 for(const [id,a,b]of [['15082-0-0',5.6966,-.2658],['11255-0-0',3.2516,5.6966],['14557-0-1',3.225,3.2516]]){
  const r=byId.get(id);r.elevations=r.points.map((_,i)=>a+(b-a)*i/(r.points.length-1));
 }
 const result=spawnSync('python3',['-c',`import sys,json
sys.path.insert(0,'scripts')
from harvard_bridge import harmonize_harvard,validate_harvard_profile
roads=json.load(sys.stdin)
try:validate_harvard_profile(roads)
except AssertionError:pass
else:raise AssertionError('validator accepted the source crest')
harmonize_harvard(roads)
validate_harvard_profile(roads)
first=json.dumps(roads,sort_keys=True)
harmonize_harvard(roads)
assert json.dumps(roads,sort_keys=True)==first,'Harvard postprocessing must be idempotent'
print(json.dumps(roads))`],{cwd:new URL('..',import.meta.url),input:JSON.stringify(roads),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.error?.message);
 const generated=JSON.parse(result.stdout);assertBostonApproach(generated);
 assert.equal(generated.find(r=>r.id==='15082-0-0').elevations.at(-1),-.2658,'the graded Boston street landing stays pinned');
 assert.deepEqual(generated.find(r=>r.id==='water-link-14557-0-0').elevations,byId.get('water-link-14557-0-0').elevations,'the established basin deck remains unchanged');
});

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
