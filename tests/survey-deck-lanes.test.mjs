import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {resolveCity,loadTile} from '../src/simulation/city-tiles.ts';
import {Ray} from '@dimforge/rapier3d-compat';
import {surveyDeckCarriageways,surveyDeckCarriagewaySteps,surveyDeckIndex,deckLanes} from '../src/simulation/survey-deck-lanes.ts';
import {surveyDeckParapets,surveyDeckParapetSteps} from '../src/simulation/survey-deck-parapets.ts';
import {surveyViaductSupportSteps} from '../src/simulation/viaduct-supports.ts';
import {addSurveyDeckSurface,addSurveyDeckSurfaceSteps,addSurveyDeckParapets,addSurveyDeckParapetSteps,surveyDeckPavement,dashes,uncovered} from '../src/render/survey-deck-surface.ts';
import {sampleRoadElevation,roadProjection,roadWidthAt,bridgeBarriers} from '../src/simulation/road-surfaces.ts';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {read,readJson} from './helpers/metro-city.mjs';
const metro=await resolveCity(readJson('city.json'),read);
const tile=await loadTile(metro,0,-3,read),zakim=tile.buildings.find(b=>b.landmark==='zakim-bridge'),data=tile.geometry.get(zakim.id);
const {carriageways}=surveyDeckCarriageways(data);
const nearest=(x,z)=>{let best,d=Infinity;for(const c of carriageways)for(const s of c.stations){const e=Math.hypot(s.x-x,s.z-z);if(e<d){d=e;best=s;}}return{station:best,distance:d};};
const {parapets,classify}=surveyDeckParapets(metro,data,carriageways.map(c=>c.stations));
/** A parapet box's plan centre line, and how far (x, z) lies from it. */
const ends=p=>{const hx=Math.sin(p.yaw)*p.length/2,hz=Math.cos(p.yaw)*p.length/2;return[[p.x-hx,p.z-hz],[p.x+hx,p.z+hz]];};
const offLine=(p,x,z)=>{const [[ax,az],[bx,bz]]=ends(p),dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)));return Math.hypot(x-ax-dx*t,z-az-dz*t);};
/** The traced edge on the given side of a station: its point, deck height and side sign. */
const edge=(s,side)=>({x:s.x-s.tz*side*s.half,z:s.z+s.tx*side*s.half,y:side>0?s.yLeft:s.yRight,side});
/** Whether (x, z) lies in a convex pavement piece. */
const inside=(poly,x,z)=>{let sign=0;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],c=(b[0]-a[0])*(z-a[2])-(b[2]-a[2])*(x-a[0]);if(Math.abs(c)<1e-9)continue;if(sign&&Math.sign(c)!==sign)return false;sign=Math.sign(c);}return true;};
/** Whether a road deck at `over` metres over the survey deck paves it in the survey's place. */
const paves=over=>over>=-.015&&over<1.5;

test('lane counts follow the measured width, keeping interstate shoulders',()=>{
 assert.equal(deckLanes(19.5),4,'a Zakim mainline deck');assert.equal(deckLanes(7.1),2,'a two-lane cantilever ramp');
 assert.equal(deckLanes(3.6),1);assert.equal(deckLanes(11),3);
});

test('dashes are 3 m on 9 m and follow the deck height',()=>{
 const parts=dashes([[0,10,0],[0,10,20],[0,14,40]]);
 assert.deepEqual(parts.map(p=>[p[0][2],p.at(-1)[2]]),[[0,3],[12,15],[24,27],[36,39]]);
 assert.ok(Math.abs(parts[2][0][1]-10.8)<1e-9,'a dash starting 24 m along climbs with the polyline');
 assert.deepEqual(parts[1].map(p=>p[2]),[12,15]);
});

test('the Zakim and the Charlestown viaduct are traced carriageway by carriageway',()=>{
 let length=0;for(const {stations} of carriageways)for(let i=1;i<stations.length;i++)length+=Math.hypot(stations[i].x-stations[i-1].x,stations[i].z-stations[i-1].z);
 assert.ok(carriageways.length>=30&&length>12000,`${carriageways.length} carriageways, ${length.toFixed(0)} m`);
 // The reported spot on the cable-stayed mainline: a four-lane deck between the median and the outer barrier.
 const {station,distance}=nearest(1160.28,-1851.65);
 assert.ok(distance<12);assert.equal(station.lanes,4);assert.ok(station.half*2>17&&station.half*2<22,`${(station.half*2).toFixed(1)} m`);
 assert.ok(Math.abs(station.y-15.1)<1.5,'on the upper deck, not the street below');
 // North of the river the viaduct keeps its own marked carriageways.
 assert.ok(nearest(57.8,-2889.1).distance<8);assert.ok(nearest(-177.4,-3868.5).distance<8);
});

test('no two traced carriageways claim the same deck',()=>{
 const cells=new Map();
 for(const [index,{stations}] of carriageways.entries())for(const s of stations){
  const k=`${Math.round(s.x)},${Math.round(s.z)},${Math.round(s.y/3)}`,other=cells.get(k);
  assert.ok(other===undefined||other===index,`carriageways ${other} and ${index} both pass ${k}`);cells.set(k,index);
 }
});

test('stretches the Central Artery and Leverett ramps already pave keep only their own markings',()=>{
 const runs=uncovered(metro,carriageways.map(c=>c.stations)),decks=metro.roads.filter(r=>r.elevations&&/^(central-artery|leverett)/.test(r.id));
 assert.ok(decks.length>0);
 for(const run of runs)for(const s of run)for(const r of decks)assert.ok(!(roadProjection(r,s.x,s.z).distance<r.width/2&&paves(sampleRoadElevation(metro,r,s.x,s.z)-s.y)),`${r.id} and the survey deck both pave ${s.x.toFixed(0)}, ${s.z.toFixed(0)}`);
 const kept=runs.reduce((n,r)=>n+r.length,0),all=carriageways.reduce((n,c)=>n+c.stations.length,0);
 assert.ok(kept<all&&kept>all*.97);
});

test('the deck pavement lies just above the survey deck and faces up',()=>{
 const group=addSurveyDeckSurface(new THREE.Group(),metro,data,{asphalt:new THREE.MeshStandardMaterial(),paint:new THREE.MeshStandardMaterial()});
 assert.equal(group.userData.carriageways,carriageways.length);assert.ok(group.userData.lines>1000);
 let triangles=0,steep=0;
 for(const mesh of group.children){
  const p=mesh.geometry.getAttribute('position'),n=mesh.geometry.getAttribute('normal');triangles+=p.count/3;
  for(let i=0;i<n.count;i++){assert.ok(n.getY(i)>=0,'pavement and paint face up');if(n.getY(i)<.9)steep++;}
  for(let i=0;i<p.count;i+=3)assert.ok(Number.isFinite(p.getY(i)));
 }
 assert.ok(triangles<150000,`${triangles} triangles`);
 // Only where a profile sample meets a raised curb at a barrier foot.
 assert.ok(steep<triangles*3*.005,`${steep} steep vertices`);
 group.traverse(o=>o.geometry?.dispose());
});

test('the tower struts beneath the Zakim deck are structure, not carriageway',()=>{
 // Both cross struts are flat 7.6 m slabs at 16.4 m, 11-12 m under the deck they carry.
 for(const [x,z] of [[868.5,-2156],[1016.1,-1989.1]])for(const {stations} of carriageways)for(const s of stations)assert.ok(Math.hypot(s.x-x,s.z-z)>16||Math.abs(s.y-16.37)>1,`a carriageway traced on the strut at ${x}, ${z}`);
 const index=surveyDeckIndex(data);
 for(const {stations} of carriageways)assert.ok(stations.filter(s=>index.covered(s.x,s.z,s.y)).length<stations.length*.8);
});

test('the pavement runs on across the joints between traced carriageways',()=>{
 // Each traced stretch ends square to itself, so the old strip pavement left a
 // bare wedge where two met at an angle; the reported one is north of the Charlestown split.
 const pieces=surveyDeckPavement(metro,data,carriageways.map(c=>c.stations)),index=surveyDeckIndex(data);
 for(const [x,z] of [[-160.4,-3614.0],[-180.7,-3618.6],[-137.7,-3226.0],[348.0,-2631.3]]){
  const piece=pieces.find(p=>inside(p,x,z));assert.ok(piece,`the deck at ${x}, ${z} is paved`);
  const y=piece.reduce((t,v)=>t+v[1],0)/piece.length;assert.ok(Math.abs(y-.03-index.surface(x,z,y))<.05,'just above the survey deck');
 }
 for(const piece of pieces)for(const v of piece)assert.ok(v.every(Number.isFinite));
});

test('the pavement gives way only to road decks that reach the survey deck',()=>{
 // The Central Artery bores dive beneath the survey at its south end. Where one
 // runs from 2 cm to 1.3 m under the deck, the deck hides its asphalt, so the
 // survey stays paved (these were bare); where a road deck lies on the survey
 // it paves the place itself.
 const pieces=surveyDeckPavement(metro,data,carriageways.map(c=>c.stations)),index=surveyDeckIndex(data);
 // The road deck's height over the survey face nearest `up` metres over the road.
 const over=(id,x,z,up=0)=>{const r=metro.roads.find(r=>r.id===id),y=sampleRoadElevation(metro,r,x,z);return y-index.surface(x,z,y+up);};
 for(const [x,z,id] of [[1197,-1783.8,'central-artery-northbound'],[1189.7,-1799.8,'central-artery-northbound']]){
  const d=over(id,x,z,1);assert.ok(d<-.02,`${id} runs under the survey at ${x}, ${z} (${d.toFixed(3)} m)`);
  assert.ok(pieces.some(p=>inside(p,x,z)),`the survey over ${id} at ${x}, ${z} is paved`);
 }
 for(const [x,z,id] of [[1165,-1802.5,'central-artery-southbound'],[347.36,-2590.29,'leverett-connector-north'],[-276.06,-4073.18,'i93-nb-01'],[637.61,-2374.88,'i93-sb-42']]){
  const d=over(id,x,z);assert.ok(paves(d),`${id} lies on the survey at ${x}, ${z} (${d.toFixed(3)} m)`);
  assert.ok(!pieces.some(p=>inside(p,x,z)),`${id} paves the survey at ${x}, ${z} itself`);
 }
});

test('the southbound tunnel approach has no detached survey deck or stray parapet in its lanes',()=>{
 const index=surveyDeckIndex(data),road=metro.roads.find(r=>r.id==='central-artery-southbound');
 assert.ok(Number.isNaN(index.deck(1177.5,-1766.2,10.3,.4)),'the orphan survey spur is gone');
 for(const [x,z] of [[1170,-1785.5],[1176,-1778.7],[1180,-1769.5]]){
  const y=sampleRoadElevation(metro,road,x,z);
  assert.ok(Number.isNaN(index.deck(x,z,y+.65,.5)),`no survey surface stands above the bore at ${x}, ${z}`);
 }
});

test('the two open survey ends at Cambridge Street have transverse concrete rails',()=>{
 const index=surveyDeckIndex(data),through=[...metro.roads,...metro.surveyRoads].filter(r=>r.id.startsWith('i93-')&&r.traffic!==false);
 for(const [x,z,y] of [[-189.5,-3619.09,32.224],[-153.225,-3491.30,16.974]]){
  const rail=parapets.find(p=>Math.hypot(p.x-x,p.z-z)<.2&&p.length>10);
  assert.ok(rail,`an end rail spans the deck at ${x}, ${z}`);
  for(const t of [-.4,0,.4]){
   const a=x+Math.sin(rail.yaw)*rail.length*t,b=z+Math.cos(rail.yaw)*rail.length*t;
   assert.ok(Number.isFinite(index.deck(a,b,y,.25)),`the rail is backed by deck at ${a}, ${b}`);
  }
  for(let t=-.5;t<=.501;t+=.05){
   const a=x+Math.sin(rail.yaw)*rail.length*t,b=z+Math.cos(rail.yaw)*rail.length*t;
   for(const road of through){
    if(roadProjection(road,a,b).distance>roadWidthAt(road,a,b)/2+rail.width/2)continue;
    assert.ok(Math.abs(y-sampleRoadElevation(metro,road,a,b))>4,`the end rail leaves ${road.id} clear`);
   }
  }
 }
});

test('parapets close the east edge of the Charlestown viaduct the survey leaves open',()=>{
 // The reported spot: northbound toward Somerville, half a kilometre of the
 // east edge had no parapet and a 14 to 29 m drop beside it.
 const {station,distance}=nearest(-149.2,-3686.4);assert.ok(distance<6);
 const side=Math.sign(-station.tz),line=carriageways.find(c=>c.stations.includes(station)).stations;
 assert.equal(classify(station,side).kind,'drop');
 let checked=0;
 for(const s of line){
  if(s.z>-3625||s.z<-4055)continue;const e=edge(s,side);checked++;
  const box=parapets.find(p=>offLine(p,e.x,e.z)<p.width/2+.05);assert.ok(box,`a parapet along the east edge at ${e.x.toFixed(1)}, ${e.z.toFixed(1)}`);
  assert.ok(Math.abs(box.y+box.height/2-(e.y+.9))<.15,'as high as the survey\'s own parapets');
 }
 assert.ok(checked>180,`${checked} stations checked`);
 // The other side keeps the survey's own barrier.
 assert.equal(classify(station,-side).kind,'barrier');
});

test('parapets fill the survey\'s other gaps and hand over to road deck rails',()=>{
 // City Square: the southbound survey barrier stops for 9 m beside the lower deck climbing 2.2 m below.
 assert.ok(parapets.some(p=>offLine(p,587.5,-2434.4)<1),'the gap beside the City Square climb is closed');
 // At the north end the I-93 deck takes over the edge with its own rail; the parapet runs on to meet it.
 const nb=metro.roads.find(r=>r.id==='i93-nb-01'),rails=bridgeBarriers(metro,nb).map(ends).flat();
 const start=rails.reduce((a,b)=>Math.hypot(b[0]+266.4,b[1]+4075.2)<Math.hypot(a[0]+266.4,a[1]+4075.2)?b:a);
 assert.ok(Math.hypot(start[0]+266.4,start[1]+4075.2)<.5,'the road rail starts at the deck\'s first section');
 assert.ok(parapets.some(p=>offLine(p,...start)<p.width/2+.2),'and the parapet reaches it');
 const {station}=nearest(-283,-4090);assert.equal(classify(station,Math.sign(-station.tz)).kind,'road');
 // Open stretches are the exception on a surveyed structure.
 const total=parapets.reduce((t,p)=>t+p.length,0);assert.ok(total>1000&&total<2500,`${total.toFixed(0)} m of parapet`);
 for(const p of parapets){assert.equal(p.height,1.2);assert.ok(p.width>=.45-1e-9&&p.width<=1.2+1e-9);for(const v of [p.x,p.y,p.z,p.yaw,p.slope,p.length])assert.ok(Number.isFinite(v));}
 const group=addSurveyDeckParapets(new THREE.Group(),parapets,new THREE.MeshStandardMaterial());
 assert.equal(group.userData.parapets,parapets.length);group.traverse(o=>o.geometry?.dispose());
});

test('dressing the Zakim pauses between small units of work, for a paced tile build',()=>{
 // Each step once ran as one block of about a tenth of a second, many times the streamer's 4 ms frame budget.
 const pauses=steps=>{let n=0,r=steps.next();while(!r.done){n++;r=steps.next();}return{n,value:r.value};};
 const stations=carriageways.reduce((n,c)=>n+c.stations.length,0);
 const piers=pauses(surveyViaductSupportSteps(metro,data));
 assert.ok(piers.n>=360&&piers.value.length>100,`${piers.n} pauses planning ${piers.value.length} piers (at least one per section)`);
 const trace=pauses(surveyDeckCarriagewaySteps(data));assert.equal(trace.value.carriageways.length,carriageways.length);
 assert.ok(trace.n>=stations,`${trace.n} pauses tracing ${stations} stations`);
 const scan=pauses(surveyDeckParapetSteps(metro,data,trace.value.carriageways.map(c=>c.stations)));
 assert.equal(scan.value.parapets.length,parapets.length);assert.ok(scan.n>=2*stations,`${scan.n} pauses classifying both edges of ${stations} stations`);
 const surface=pauses(addSurveyDeckSurfaceSteps(new THREE.Group(),metro,data,{asphalt:new THREE.MeshBasicMaterial(),paint:new THREE.MeshBasicMaterial()},trace.value));
 assert.ok(surface.n>=stations/8&&surface.value.userData.faces>1000,`${surface.n} pauses paving ${surface.value.userData.faces} pieces`);
 // The parapet boxes go 32 at a time, then become meshes, drawn as the one-shot call draws them.
 const triangles=g=>{let n=0;g.traverse(o=>{if(o.geometry)n+=o.geometry.getAttribute('position').count/3;});return n;};
 const boxes=pauses(addSurveyDeckParapetSteps(new THREE.Group(),parapets,new THREE.MeshBasicMaterial())),once=addSurveyDeckParapets(new THREE.Group(),parapets,new THREE.MeshBasicMaterial());
 assert.equal(boxes.n,Math.floor(parapets.length/32)+1,`${boxes.n} pauses drawing ${parapets.length} parapets`);
 assert.equal(triangles(boxes.value),triangles(once));assert.equal(triangles(once),parapets.length*12);
 for(const g of [surface.value,boxes.value,once])g.traverse(o=>o.geometry?.dispose());
});

test('a car cannot drive through a deck parapet',async()=>{
 const flat={bounds:{minX:-500,maxX:500,minZ:-500,maxZ:500},buildings:[],roads:[],spawn:{x:0,z:0,yaw:0}},physics=await DrivingPhysics.create(flat);
 try{
  const across={x:0,y:.45,z:30,yaw:Math.PI/2,slope:0,length:12,width:.45,height:1.2};
  physics.addParapets([across,{x:20,y:5,z:0,yaw:.6,slope:.1,length:8,width:.5,height:1.2}]);
  physics.step({throttle:0,brake:0,steer:0,handbrake:false},1/60); // New colliders join the ray queries on the next step.
  // The collider is set like the drawn box: its top lies along the pitched, turned centre line.
  const top=(x,z)=>physics.world.castRay(new Ray({x,y:20,z},{x:0,y:-1,z:0}),30,true,undefined,undefined,physics.chassisCollider,physics.body);
  for(const t of [-3,3]){const x=20+Math.sin(.6)*t*Math.cos(.1),z=Math.cos(.6)*t*Math.cos(.1),hit=top(x,z);assert.ok(hit,'the pitched parapet is solid');assert.ok(Math.abs(20-hit.timeOfImpact-(5+.6/Math.cos(.1)+Math.sin(.1)*t))<.01,`its top at ${t} m along: ${(20-hit.timeOfImpact).toFixed(3)}`);}
  physics.reset(0,0,0);for(let i=0;i<6*60;i++)physics.step({throttle:1,brake:0,steer:0,handbrake:false},1/60);
  // Unobstructed, six seconds at full throttle carry the car 86 m.
  const state=physics.getState();assert.ok(state.z>24&&state.z<30-.225-1,`the car stops at the parapet (z ${state.z.toFixed(2)})`);
 }finally{physics.dispose();}
});
