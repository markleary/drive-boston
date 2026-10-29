import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {createTransit,transitPoint,routeDecks,routeSurface} from '../src/simulation/transit.ts';
import {signalAxis,signalPhase} from '../src/simulation/signals.ts';
import {pointInside} from '../src/simulation/roads.ts';
import {meshBuildingIds} from '../src/simulation/building-collisions.ts';

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
 assert.equal(data.routes.filter(r=>r.kind==='tram').length,2);assert.equal(data.routes.filter(r=>r.kind==='bus').length,16);
 for(const line of BUS_LINES)assert.equal(data.routes.filter(r=>r.line===line).length,2,`route ${line} runs in both directions`);
 for(const route of data.routes){
  assert.ok(route.points.length>80);assert.ok(route.stops.length>=8);
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
 const mfa=data.routes.filter(r=>r.kind==='tram').map(r=>r.stops.find(s=>s.name==='Museum of Fine Arts').position);
 const separation=Math.hypot(mfa[0][0]-mfa[1][0],mfa[0][1]-mfa[1][1]);
 assert.ok(separation>2.7&&separation<8,`opposing tracks need distinct geometry (${separation}m)`);
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
