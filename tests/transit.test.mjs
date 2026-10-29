import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {createTransit,transitPoint,routeDecks,routeSurface} from '../src/simulation/transit.ts';
import {signalAxis,signalPhase} from '../src/simulation/signals.ts';
import {pointInside} from '../src/simulation/roads.ts';
import {meshBuildingIds,usesExactBuildingCollision} from '../src/simulation/building-collisions.ts';
import {createRailProfile,railCovered} from '../src/simulation/transit-rail-surface.ts';
import {tileCollisionIndices} from '../src/render/tile-geometry.ts';

import {loadCentralCity,loadMetroCity} from './helpers/metro-city.mjs';
const BUS_LINES=['1','9','23','28','39','57','66','86'];
const withDistances=route=>{const distances=[0];for(let i=1;i<route.points.length;i++)distances.push(distances.at(-1)+Math.hypot(route.points[i][0]-route.points[i-1][0],route.points[i][1]-route.points[i-1][1]));return{...route,distances,length:distances.at(-1)};};
test('perpendicular signal approaches never receive green together and include clearance time',()=>{
 for(let time=0;time<64;time+=.05){
  const north=signalPhase(time,0),east=signalPhase(time,Math.PI/2);
  assert.ok(!(north==='green'&&east==='green'));
  assert.equal(signalPhase(time,Math.PI),north);assert.equal(signalPhase(time,-Math.PI/2),east);
 }
 assert.equal(signalPhase(12,0),'amber');assert.equal(signalPhase(15,0),'red');assert.equal(signalPhase(15,Math.PI/2),'red');assert.equal(signalPhase(17,Math.PI/2),'green');
 assert.equal(signalAxis(0),0);assert.equal(signalAxis(Math.PI/2),1);
});

test('mapped Green Line uses separate surface tracks and every bus route stays within coverage',async()=>{
 const city=await loadCentralCity();
 const data=JSON.parse(readFileSync(new URL('../public/data/transit.json',import.meta.url),'utf8'));
 // Concave source complexes whose convex footprint proxies span public streets
 // collide as exact source meshes at runtime (the Prudential and 145 Dartmouth here,
 // and the Boston Medical Center model whose overhead link straddles Massachusetts
 // Avenue); tests/street-corridors.test.mjs drives the open street corridors.
 const complexes=meshBuildingIds;
 assert.equal(data.routes.filter(r=>r.kind==='tram').length,8);assert.equal(data.routes.filter(r=>r.kind==='bus').length,16);
 for(const line of BUS_LINES)assert.equal(data.routes.filter(r=>r.line===line).length,2,`route ${line} runs in both directions`);
 for(const route of data.routes){
  assert.ok(route.points.length>80);assert.ok(route.stops.length>=(route.line==='Green-D'?6:8));
  if(route.kind==='bus')assert.ok(route.length>(route.line==='39'?7900:5000),`${route.destination} keeps its full in-coverage alignment`);
  for(const stop of route.stops)assert.ok(stop.distance>0&&stop.distance<route.length);
  const path=withDistances(route),crossed=new Map();
  for(let s=10;s<route.length-10;s+=8){
   const point=transitPoint(path,s);
   assert.ok(city.coverage.some(r=>pointInside(point,r)),'transit must remain inside existing map');
   const hit=city.buildings.find(b=>!complexes.has(b.id)&&Math.abs(b.center[0]-point[0])<350&&Math.abs(b.center[1]-point[1])<350&&pointInside(point,b.footprint));
   if(hit)crossed.set(hit,(crossed.get(hit)??0)+8);
  }
  // A bus drives through the Nubian Square canopies; nothing taller than a shelter, and nothing for long.
  for(const [building,metres] of crossed)assert.ok(metres<=16||building.height<=4,`${route.destination} crosses ${building.name} (${building.height} m tall) for ${metres} m`);
 }
 for(const [line,station]of [['Green-B','Harvard Avenue'],['Green-C','Coolidge Corner'],['Green-D','Longwood'],['Green-E','Museum of Fine Arts']]){
  const pair=data.routes.filter(r=>r.line===line);assert.equal(pair.length,2,`${line} runs in both directions`);
  assert.deepEqual(pair.map(r=>r.directionId).sort(),[0,1]);
  const platforms=pair.map(r=>r.stops.find(s=>s.name===station).position),separation=Math.hypot(platforms[0][0]-platforms[1][0],platforms[0][1]-platforms[1][1]);
  assert.ok(separation>2.7&&separation<8,`${line} opposing tracks need distinct geometry (${separation}m)`);
 }
});

test('western Green Line branches stop at their subway portals and the D at the map boundary',()=>{
 const data=JSON.parse(readFileSync(new URL('../public/data/transit.json',import.meta.url),'utf8'));
 const portals={'Green-B':[-1941,131],'Green-C':[-2529,415],'Green-D':[-2308,451],'Green-E':[-1026,1020]};
 for(const route of data.routes.filter(r=>r.kind==='tram')){
  const portal=route.directionId===0?route.points[0]:route.points.at(-1),expected=portals[route.line];
  assert.ok(Math.hypot(portal[0]-expected[0],portal[1]-expected[1])<6,`${route.destination} must end at its actual surface portal`);
  assert.ok(route.stops.every(s=>!['Kenmore','Copley','Government Center','Lechmere','Union Square','Riverside','Newton Centre','Chestnut Hill'].includes(s.name)),'subway and out-of-map stops cannot be projected onto surface routes');
  if(route.line==='Green-B'){
   assert.ok(route.length>6500&&route.length<6650);assert.equal(route.stops.length,16);
   assert.ok(route.stops.some(s=>s.name==='Boston College'));
   assert.equal(route.bridges.length,1,'the B retains its mapped Turnpike bridge');
   assert.ok(route.bridges[0].end-route.bridges[0].start>110);
  }
  if(route.line==='Green-C'){
   assert.ok(route.length>3700&&route.length<3850);assert.equal(route.stops.length,13);
   assert.ok(route.stops.some(s=>s.name==='Cleveland Circle'));
  }
  if(route.line==='Green-D'){
   assert.ok(route.length>5500&&route.length<5750);assert.equal(route.coveragePercent,38);
   assert.ok(route.stops.some(s=>s.name==='Reservoir'),'the D reaches Reservoir before the map boundary');
   assert.equal(route.covered.length,4,'retain the four mapped D underpasses without rendering tracks over their roofs');
   let previous=0;for(const span of route.covered){assert.ok(span.start>previous&&span.end>span.start&&span.end<route.length);previous=span.end;}
  }
 }
 const d=data.routes.filter(r=>r.line==='Green-D');
 for(const p of d[0].points.filter(([x])=>x>-4119&&x<-3998)){
  let separation=Infinity;
  for(let i=1;i<d[1].points.length;i++){
   const a=d[1].points[i-1],b=d[1].points[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz)));
   separation=Math.min(separation,Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t));
  }
  assert.ok(separation>2.9&&separation<4.1,'paired local building-clearance corrections keep opposing cars separated');
 }
});

test('new western rail corridors clear tall buildings across all their streamed tiles',async()=>{
 const routes=JSON.parse(readFileSync(new URL('../public/data/transit.json',import.meta.url),'utf8')).routes.filter(r=>['Green-B','Green-C','Green-D'].includes(r.line));
 const bounds={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};
 for(const route of routes)for(const[x,z]of route.points){bounds.minX=Math.min(bounds.minX,x-30);bounds.maxX=Math.max(bounds.maxX,x+30);bounds.minZ=Math.min(bounds.minZ,z-30);bounds.maxZ=Math.max(bounds.maxZ,z+30);}
 const city=await loadMetroCity({bounds}),buildings=city.buildings.filter(b=>b.height>4).map(b=>({building:b,minX:Math.min(...b.footprint.map(p=>p[0])),maxX:Math.max(...b.footprint.map(p=>p[0])),minZ:Math.min(...b.footprint.map(p=>p[1])),maxZ:Math.max(...b.footprint.map(p=>p[1]))}));
 assert.ok(city.loadedTiles.size>=28,'load the entire B/C/D corridor, including Allston and Brookline');
 const exact=new Map(),material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
 try{
  for(const route of routes){
   const path=withDistances(route),profile=createRailProfile(city,path);
   for(let s=12;s<path.length-12;s+=4){
    if(railCovered(profile,s))continue;
    const p=transitPoint(path,s),a=transitPoint(path,s-1),b=transitPoint(path,s+1),dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz)||1;
    for(const side of [-1.3,0,1.3]){
     const point=[p[0]-dz/length*side,p[1]+dx/length*side];
     for(const candidate of buildings){
      if(point[0]<candidate.minX||point[0]>candidate.maxX||point[1]<candidate.minZ||point[1]>candidate.maxZ)continue;
      const building=candidate.building;if(!pointInside(point,building.footprint))continue;
      assert.ok(usesExactBuildingCollision(building),`${route.destination} overlaps the solid footprint of ${building.name} at ${s} m`);
      // 1395 Commonwealth's convex hull reaches across the B, but its actual surveyed
      // shell does not. Check that opening instead of exempting the building by ID.
      let mesh=exact.get(building.id);
      if(!mesh){const data=city.geometry.get(building.id),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));geometry.setIndex(new THREE.BufferAttribute(tileCollisionIndices(data),1));mesh=new THREE.Mesh(geometry,material);exact.set(building.id,mesh);}
      const ray=new THREE.Raycaster(new THREE.Vector3(point[0],1000,point[1]),new THREE.Vector3(0,-1,0));
      assert.equal(ray.intersectObject(mesh).length,0,`${route.destination} overlaps the source shell of ${building.name} at ${s} m`);
     }
    }
   }
  }
 }finally{for(const mesh of exact.values())mesh.geometry.dispose();material.dispose();}
});

test('buses ride the surveyed bridge decks and stay out of the water',async()=>{
 const city=await loadMetroCity({tiles:[]});
 const data=JSON.parse(readFileSync(new URL('../public/data/transit.json',import.meta.url),'utf8'));
 const water=city.water.map(w=>({rings:w.rings,box:w.rings[0].reduce((b,p)=>({minX:Math.min(b.minX,p[0]),maxX:Math.max(b.maxX,p[0]),minZ:Math.min(b.minZ,p[1]),maxZ:Math.max(b.maxZ,p[1])}),{minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity})}));
 const inWater=([x,z])=>water.some(w=>x>=w.box.minX&&x<=w.box.maxX&&z>=w.box.minZ&&z<=w.box.maxZ&&pointInside([x,z],w.rings[0])&&!w.rings.slice(1).some(h=>pointInside([x,z],h)));
 const decksOf={};
 for(const route of data.routes.filter(r=>r.kind==='bus')){
  const path=withDistances(route);path.decks=routeDecks(city,path);
  let last,wet=0,steepest=0;const names=new Set();
  for(let s=0;s<path.length;s+=2){
   const point=transitPoint(path,s),deck=path.decks[s/2],height=routeSurface(city,path,s,...point).height;
   if(deck)names.add(deck.name);else if(inWater(point))wet++;
   if(last!==undefined)steepest=Math.max(steepest,Math.abs(height-last));last=height;
  }
  // Surveyed deck pieces meet the graded ground within about 1.5 m beside the shape and the
  // steepest deck end (Columbus Avenue at Back Bay) drops 1.9 m in 2 m; a bus on the river
  // bed or jumping a storey would mean the street matching had slipped.
  assert.ok(wet<=3,`${route.destination} rides ${wet*2} m of water without a deck`);
  assert.ok(steepest<2.5,`${route.destination} steps ${steepest.toFixed(2)} m between 2 m samples`);
  decksOf[route.destination]=names;
 }
 for(const destination of ['1 HARVARD','1 NUBIAN'])assert.ok(decksOf[destination].has('Harvard Bridge'),`${destination} crosses the Charles on the Harvard Bridge deck`);
 assert.ok(decksOf['86 RESERVOIR'].has('Western Avenue')&&decksOf['86 HARVARD'].has('North Harvard Street'),'the 86 uses the Western Avenue and Anderson Memorial crossings');
 assert.ok(decksOf['9 CITY POINT'].has('Broadway'),'the 9 crosses Fort Point Channel on the Broadway deck');
});

test('bus dwells at a stop, brakes for a parked player, and departs after clearance',async()=>{
 const city={bounds:{minX:-100,maxX:100,minZ:-100,maxZ:300},roads:[],buildings:[],landmarks:[],curbs:[],signals:[],sources:[],spawn:{x:0,z:110,yaw:0}};
 const route={id:'fixture',kind:'bus',line:'39',destination:'39 TEST',points:[[0,0],[0,200]],length:200,stops:[{id:'stop',name:'Mapped stop',distance:100,position:[0,100]}]};
 const physics=await DrivingPhysics.create(city),scene=new THREE.Scene(),transit=createTransit(scene,city,physics,{routes:[route],sources:[],notes:''});
 let dwellSeen=false,closest=Infinity;
 try{
  for(let i=0;i<25*60;i++){
   transit.update(1/60,physics.getState());physics.step({throttle:0,brake:1,steer:0,handbrake:true},1/60);
   const bus=transit.snapshot()[0];dwellSeen||=bus.dwell>0;closest=Math.min(closest,110-bus.z);
  }
  assert.ok(dwellSeen,'the bus must perform an actual station dwell');assert.ok(closest>9.5,'front bumper must leave a gap to the parked car');assert.ok(Math.abs(physics.getState().z-110)<.15,'a stopped player must not be pushed');
  const stopped=transit.snapshot()[0].z;physics.reset(60,110,0);
  for(let i=0;i<8*60;i++){transit.update(1/60,physics.getState());physics.step({throttle:0,brake:1,steer:0,handbrake:true},1/60);}
  assert.ok(transit.snapshot()[0].z>stopped+12,'the bus should move after the lane clears');
 }finally{transit.dispose();physics.dispose();}
});
