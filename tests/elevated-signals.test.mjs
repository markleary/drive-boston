import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {planTrafficSignals} from '../src/simulation/signal-placement.ts';
import {sampleRoadElevation} from '../src/simulation/road-surfaces.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {createTrafficSignals} from '../src/render/traffic-signals.ts';
import {loadCentralCity} from './helpers/metro-city.mjs';

const road=(id,points,width=8,elevations)=>({id,name:id,points,width,oneway:0,...(elevations?{elevations}:{})});
const city=(roads,signals)=>({bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100},spawn:{x:0,z:0,yaw:0},roads,signals,buildings:[]});
function bounds(group,color){
 const box=new THREE.Box3();group.traverse(o=>{if(o.isMesh&&o.material.color.getHexString()===color){o.geometry.computeBoundingBox();box.union(o.geometry.boundingBox);}});return box;
}
function dispose(group){group.traverse(o=>o.geometry?.dispose());}

test('elevated signals attach to their source road and keep the full mast clear of the lower lane',()=>{
 const c=city([road('upper',[[-40,0],[40,0]],12,[4,4]),road('lower',[[0,-40],[0,40]])],[[0,0]]),placements=planTrafficSignals(c);
 assert.equal(placements.length,1);const signal=placements[0];assert.equal(signal.road.id,'upper');
 assert.ok(Math.abs(signal.position[0])>=4.55,'the mast cannot stand in the road beneath the bridge');
 assert.ok(Math.abs(signal.position[1])>=6.55,'the mast cannot stand in the upper travel lane');
 const {group}=createTrafficSignals(new THREE.Scene(),c,placements);
 try{
  const iron=bounds(group,'33443c'),heads=bounds(group,'b5a46b');
  assert.ok(Math.abs(iron.min.y)<1e-5,'the extended mast footing stays on the ground');
  assert.ok(Math.abs(iron.max.y-9.65)<1e-5,'the mast reaches above the 4 m deck');
  assert.ok(Math.abs(heads.min.y-(4+4.94-.76))<1e-5,'heads retain driving clearance above their attached roadway');
 }finally{dispose(group);}
});

test('a narrow signal-controlled ramp remains eligible beside a nearby wider ground road',()=>{
 const c=city([road('Unnamed trunk ramp',[[-40,0],[40,0]],5,[3,3]),road('Memorial Drive',[[-40,8],[40,8]],7)],[[0,0]]);
 const placements=planTrafficSignals(c);assert.equal(placements.length,1);assert.equal(placements[0].road.id,'Unnamed trunk ramp');
});

test('neighboring deck flares reserve their full pavement across signal index cell boundaries',()=>{
 const flare={...road('flared approach',[[-40,51],[40,51]],4,[4,4]),deckWidths:[16,16]};
 const c=city([road('controlled',[[-40,40],[40,40]],8,[4,4]),flare],[[0,42]]),placements=planTrafficSignals(c);
 assert.equal(placements.length,1);assert.equal(placements[0].road.id,'controlled');
 assert.ok(placements[0].position[1]<40,'the closer curb at z=45.25 lies inside the neighboring flare, despite its narrow nominal width and centre in the next index cell');
});

test('a high overpass does not displace a ground signal and its original heights remain unchanged',()=>{
 const c=city([road('ground',[[-40,0],[40,0]]),road('high',[[-40,6],[40,6]],4,[20,20])],[[0,2]]),placements=planTrafficSignals(c);
 assert.equal(placements.length,1);assert.equal(placements[0].road.id,'ground');
 assert.ok(Math.abs(placements[0].position[1]-6)<2,'a mast below the high deck remains a valid curbside placement');
 const {group}=createTrafficSignals(new THREE.Scene(),c,placements);
 try{const iron=bounds(group,'33443c'),heads=bounds(group,'b5a46b');assert.ok(Math.abs(iron.min.y)<1e-5);assert.ok(Math.abs(iron.max.y-5.65)<1e-5);assert.ok(Math.abs(heads.min.y-(4.94-.76))<1e-5);}finally{dispose(group);}
});

test('all six Harvard/Memorial source controls follow their elevated approaches',async()=>{
 const c=await loadCentralCity();c.signals=c.signals.filter(p=>Math.hypot(p[0]+1470,p[1]+780)<70);
 const placements=planTrafficSignals(c);assert.equal(placements.length,6);
 for(const signal of placements){
  assert.ok(signal.road.elevations,`${signal.road.id} must retain the source signal on its connected upper roadway`);
  const roadY=sampleRoadElevation(c,signal.road,...signal.roadPoint),footing=sampleElevation(c,...signal.position),{group}=createTrafficSignals(new THREE.Scene(),c,[signal]);
  try{
   assert.ok(Math.abs(bounds(group,'33443c').min.y-footing)<1e-4,'mast footing is supported');
   assert.ok(bounds(group,'b5a46b').min.y>roadY+4.17,'signal heads clear the upper traffic');
  }finally{dispose(group);}
 }
});
