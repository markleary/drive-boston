import './helpers/npc-fleet.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {loadMetroCity,windowCity,hasMetroData,CENTRAL} from './helpers/metro-city.mjs';
import {laneTolerance,mallWalkLanes,offsetLine,pathLaneOffsets,straightRuns} from '../src/simulation/park-walks.ts';
import {MALL_MONUMENTS,MALL_WALK_HALF,isCommonwealthMall,isPlannedMallLawn,mallFrames} from '../src/simulation/commonwealth-mall.ts';
import {createStreetLife} from '../src/render/street-life.ts';
import {pointInside} from '../src/simulation/roads.ts';
import {EMBRACE} from '../src/render/the-embrace.ts';

const near=(a,b,eps=1e-9)=>Math.abs(a-b)<=eps;
const inside=(p,rings)=>pointInside(p,rings[0])&&!rings.slice(1).some(h=>pointInside(p,h));

test('a path is walked on its line, a wide one in two files',()=>{
  assert.deepEqual(pathLaneOffsets(2.6),[0]);assert.deepEqual(pathLaneOffsets(4.4),[0]);
  assert.deepEqual(pathLaneOffsets(4.5),[1.125,-1.125]);assert.deepEqual(pathLaneOffsets(6.3),[1.55,-1.55]);assert.deepEqual(pathLaneOffsets(8),[1.55,-1.55]);
  // Either file keeps its walker on the paving: the file's offset, the stretch's play and a body's half width fit in half the path.
  for(const width of [1,2,2.6,3.5,4.5,5.2,6.3,8])for(const lane of pathLaneOffsets(width))assert.ok(Math.abs(lane)+laneTolerance(width,lane)<=Math.max(width/2-.3,.5)+1e-9,`${width} m path`);
  const line=[[0,0],[10,0],[10,10]];
  assert.equal(offsetLine(line,0),line);
  const left=offsetLine(line,1).map(p=>p.map(v=>Math.round(v*1000)/1000));
  assert.deepEqual(left,[[0,1],[9,1],[9,10]],'mitred at the bend, a metre to the left of travel');
  assert.deepEqual(offsetLine(line,-1).map(p=>p.map(v=>Math.round(v*1000)/1000)),[[0,-1],[11,-1],[11,10]]);
});

test('straight stretches follow a path within its tolerance and skip its tight bends',()=>{
  // A straight 30 m, a quarter circle of 6 m radius, another straight 20 m.
  const points=[[0,0],[10,0],[20,0],[30,0]];
  for(let a=1;a<=8;a++)points.push([30+6*Math.sin(a*Math.PI/16),6-6*Math.cos(a*Math.PI/16)]);
  points.push([36,16],[36,26]);
  const runs=straightRuns(points,.4);
  assert.equal(runs.length,2,'the two straights; the bend gives no ten metre chord');
  assert.deepEqual(runs[0].start,[0,0]);assert.ok(runs[0].end[0]>=30&&runs[0].end[0]<32.5,'the first chord may take in the start of the bend, within tolerance');
  assert.deepEqual(runs[1].end,[36,26]);assert.ok(runs[1].start[1]<=6.01&&runs[1].start[1]>3.5);
  for(const run of runs)for(const p of points){
    const dx=run.end[0]-run.start[0],dz=run.end[1]-run.start[1],t=((p[0]-run.start[0])*dx+(p[1]-run.start[1])*dz)/(dx*dx+dz*dz);
    if(t>0&&t<1)assert.ok(Math.abs((p[0]-run.start[0])*dz-(p[1]-run.start[1])*dx)/Math.hypot(dx,dz)<=.4+1e-9,'every vertex a chord passes stays within tolerance of it');
  }
  // A gentle curve (60 m radius) is walked in chords; nothing under ten metres is kept.
  const curve=Array.from({length:41},(_,i)=>[60*Math.sin(i*.025),60-60*Math.cos(i*.025)]);
  const chords=straightRuns(curve,.4);
  assert.ok(chords.length>=3&&chords.every(c=>Math.hypot(c.end[0]-c.start[0],c.end[1]-c.start[1])>=10));
  assert.deepEqual(straightRuns([[0,0],[4,0],[4,4],[8,4]],.4),[]);
  assert.equal(straightRuns([[0,0],[25,0]],.4,10).length,1);
});

const metro=hasMetroData()?await loadMetroCity({bounds:CENTRAL}):undefined,skip=!metro&&'needs the metro package in public/data';
const malls=metro?metro.parks.filter(isCommonwealthMall):[];
const surveyed=metro?[...metro.loadedTiles.values()].flatMap(tile=>tile.sidewalks).filter(w=>w.rings[0].some(p=>malls.some(m=>pointInside(p,m.rings[0])))):[];
const onPaving=p=>surveyed.some(w=>inside(p,w.rings));

test('the Mall\'s centre walk is walked in two files, on its surveyed paving, short of the fences and the monuments',{skip},()=>{
  const lanes=mallWalkLanes();
  assert.ok(lanes.length>=30&&lanes.length%2===0,`${lanes.length} stretches`);
  const perBlock=new Map();
  for(const lane of lanes){
    const frame=mallFrames.find(f=>{const [s,v]=f.local(lane.start);return s>=0&&s<=f.length&&Math.abs(v)<4;}),[s0,v0]=frame.local(lane.start),[s1,v1]=frame.local(lane.end);
    assert.ok(s1-s0>=10,'at least ten metres');assert.ok(s0>=frame.block.walk[0]+2.5-1e-6&&s1<=frame.block.walk[1]-2.5+1e-6,'inside the walk\'s ends');
    assert.ok(Math.abs(v0)<MALL_WALK_HALF-1&&Math.abs(v1)<MALL_WALK_HALF-1&&Math.sign(v0)===Math.sign(v1),'one file, a side of the centre');
    perBlock.set(frame.index,(perBlock.get(frame.index)??0)+1);
    // Every metre of it is paving on the surveyed blocks (the walk west of the underpass is paved from its mapped line).
    for(let s=s0;s<=s1;s+=1){
      const t=(s-s0)/(s1-s0),p=frame.at(s,v0+(v1-v0)*t);
      if(frame.index<8)assert.ok(onPaving(p),`${frame.block.name}: off the walk at ${s.toFixed(0)} m, ${(v0+(v1-v0)*t).toFixed(2)} m from the axis`);
      for(const m of MALL_MONUMENTS)assert.ok(Math.hypot(m.at[0]-p[0],m.at[1]-p[1])>4.5,`${frame.block.name}: ${m.name} stands in the file`);
    }
  }
  assert.equal(perBlock.size,9,'every block is walked');
  for(const [index,count] of perBlock)assert.ok(count>=2&&count<=6,`${mallFrames[index].block.name}: ${count} stretches`);
});

test('walkers take to the park paths and the Mall\'s walk, and leave its lawn',{skip},()=>{
  const city=windowCity(metro),life=createStreetLife(new THREE.Scene(),city);
  try{
    assert.equal(life.count,112,'the pool is the same size');
    const waters=city.water.flatMap(w=>w.surfaces?.length?w.surfaces.map(s=>s.rings):[w.rings]);
    const check=(site,name,minimum)=>{
      life.populateAt(site,site);
      const local=life.pedestrians.filter(p=>Math.hypot(p.position.x-site.x,p.position.z-site.z)<350),park=local.filter(p=>p.route.park);
      assert.ok(park.length>=minimum,`${name}: ${park.length} of ${local.length} nearby walkers on its paths`);
      for(const person of life.pedestrians){
        const p=[person.position.x,person.position.z];
        assert.ok(!waters.some(rings=>inside(p,rings)),`${name}: a walker in the water at ${p.map(v=>v.toFixed(1))}`);
        assert.ok(Math.hypot(p[0]-EMBRACE.x,p[1]-EMBRACE.z)>4.5,'nobody walks through The Embrace');
        for(const end of [person.route.start,person.route.end])assert.ok(!waters.some(rings=>inside(end,rings)));
        // Nobody on a planned lawn of the Mall but on its walk.
        const lawn=malls.find(m=>isPlannedMallLawn(m)&&inside(p,m.rings));
        if(lawn){
          assert.ok(person.route.park,'the avenue\'s walkers keep off the Mall\'s lawn');
          const frame=mallFrames.find(f=>{const [s,v]=f.local(p);return s>=0&&s<=f.length&&Math.abs(v)<16;});
          assert.ok(Math.abs(frame.local(p)[1])<MALL_WALK_HALF-.9,`a walker ${frame.local(p)[1].toFixed(2)} m from the Mall\'s axis`);
        }
      }
      return {local,park};
    };
    const common=check({x:900,z:-470},'Boston Common',14),garden=check({x:400,z:-420},'the Public Garden',14);
    assert.ok(common.park.every(p=>p.route.length>=6.5&&p.route.length<=44.5)&&garden.park.length>0);
    // Exeter Street to Fairfield Street: walkers in both files of the centre walk.
    const frame=mallFrames[4],site=frame.at(6,0),mall=check({x:site[0],z:site[1]},'the Mall',8);
    const files=mall.park.map(p=>frame.local([p.position.x,p.position.z])).filter(([s,v])=>s>0&&s<frame.length&&Math.abs(v)<3);
    assert.ok(files.length>=6,`${files.length} walkers on the block's walk`);
    assert.ok(files.some(([,v])=>v>.8)&&files.some(([,v])=>v<-.8),'in both files');
    assert.ok(files.every(([s])=>Math.abs(s-31.18)>8.5),'none on the paving round Samuel Eliot Morison');
    assert.ok(mall.park.every(p=>p.road.length>0),'a park stretch is named for the street beside it');
    assert.ok(mall.park.filter(p=>Math.abs(frame.local([p.position.x,p.position.z])[1])<3).every(p=>p.road==='Commonwealth Avenue'));
  }finally{life.dispose();}
});

test('a metro walks the park paths of its resident tiles',{skip},()=>{
  // The streamer's view: tiles by key; the metro itself lists no paths.
  const site={x:900,z:-470},paths=metro.parkPaths;metro.parkPaths=[];
  const loaded=new Map([...metro.loadedTiles].map(([key,tile])=>[key,{tile}])),scene=new THREE.Scene();
  const bare=createStreetLife(scene,metro),life=createStreetLife(scene,metro,undefined,[],{tiles:{loaded}});
  try{
    bare.populateAt(site,site);life.populateAt(site,site);
    const local=list=>list.filter(p=>Math.hypot(p.position.x-site.x,p.position.z-site.z)<350);
    assert.equal(local(bare.pedestrians).filter(p=>p.route.park&&!/Commonwealth/.test(p.road)).length,0,'no tiles, no park paths');
    const park=local(life.pedestrians).filter(p=>p.route.park);
    assert.ok(park.length>=14,`${park.length} walkers on the Common's paths`);
    // A tile that streams out and in again brings the same paths: their stretches are kept by id, one walker each.
    const before=new Set(life.pedestrians.map(p=>p.route));
    loaded.clear();for(const [key,tile] of metro.loadedTiles)loaded.set(key,{tile:{...tile,parkPaths:tile.parkPaths.map(path=>({...path}))}});
    life.populateAt({x:400,z:-420},{x:400,z:-420});life.populateAt(site,site);
    const routes=life.pedestrians.map(p=>p.route);
    assert.equal(new Set(routes).size,routes.length,'one walker a stretch');
    assert.ok(local(life.pedestrians).filter(p=>p.route.park).every(p=>before.has(p.route)||p.route.park));
  }finally{bare.dispose();life.dispose();metro.parkPaths=paths;}
});
