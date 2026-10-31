import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {resolveCity,loadTile} from '../src/simulation/city-tiles.ts';
import {surveyDeckCarriageways,deckLanes} from '../src/simulation/survey-deck-lanes.ts';
import {addSurveyDeckSurface,dashes,uncovered} from '../src/render/survey-deck-surface.ts';
import {sampleRoadElevation,roadProjection} from '../src/simulation/road-surfaces.ts';
import {read,readJson} from './helpers/metro-city.mjs';
const metro=await resolveCity(readJson('city.json'),read);
const tile=await loadTile(metro,0,-3,read),zakim=tile.buildings.find(b=>b.landmark==='zakim-bridge'),data=tile.geometry.get(zakim.id);
const {carriageways}=surveyDeckCarriageways(data);
const nearest=(x,z)=>{let best,d=Infinity;for(const c of carriageways)for(const s of c.stations){const e=Math.hypot(s.x-x,s.z-z);if(e<d){d=e;best=s;}}return{station:best,distance:d};};

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
 for(const run of runs)for(const s of run)for(const r of decks)assert.ok(!(roadProjection(r,s.x,s.z).distance<r.width/2&&Math.abs(sampleRoadElevation(metro,r,s.x,s.z)-s.y)<1.5),`${r.id} and the survey deck both pave ${s.x.toFixed(0)}, ${s.z.toFixed(0)}`);
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
