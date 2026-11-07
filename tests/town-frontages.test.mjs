import assert from 'node:assert/strict';
import test from 'node:test';
import {inTownCentre,townFrontages} from '../src/render/town-frontages.ts';

// Main Street through downtown Melrose, straightened onto x = 700 (7.6 m, so its sidewalk band ends 6.7 m out).
const road={id:'main',name:'Main Street',kind:'primary',width:7.6,points:[[700,-11500],[700,-11800]]};
const city=()=>({roads:[road],buildings:[],landmarks:[],curbs:[],signals:[],spawn:{x:700,z:-11650,yaw:0},sources:[],origin:{xFeet:0,yFeet:0,longitude:0,latitude:0},bounds:{minX:0,maxX:1000,minZ:-12000,maxZ:-11000}});
const block=(id,west,extra={})=>({id,name:id,center:[west+7,-11650],height:9,footprint:[[west,-11660],[west+14,-11660],[west+14,-11640],[west,-11640]],...extra});

test('a shop set back from the sidewalk band gets a forecourt from its wall to just inside the band',()=>{
  const shop=block('shop',710.7),[polygon,...rest]=townFrontages(city(),[shop]);
  assert.equal(rest.length,0,'only the street-facing wall');
  const ring=polygon[0];assert.equal(ring.length,4);
  const xs=ring.map(p=>p[0]).sort((a,b)=>a-b);
  assert.ok(Math.abs(xs[0]-706.4)<1e-6&&Math.abs(xs[1]-706.4)<1e-6,'outer edge 0.3 m inside the 2.9 m band');
  assert.ok(Math.abs(xs[2]-710.7)<1e-6&&Math.abs(xs[3]-710.7)<1e-6,'inner edge on the wall');
  assert.deepEqual(ring.map(p=>p[1]).sort((a,b)=>a-b),[-11660,-11660,-11640,-11640],'the forecourt spans the wall only');
  const reversed={...shop,footprint:[...shop.footprint].reverse()};
  assert.equal(townFrontages(city(),[reversed]).length,1,'either footprint winding');
});

test('houses, churches, garages, deep forecourts, buildings on the band and buildings outside the centres keep their ground',()=>{
  const c=city();
  assert.equal(townFrontages(c,[block('house',710.7,{houseStyle:'victorian'})]).length,0);
  assert.equal(townFrontages(c,[block('church',710.7,{kind:'church'})]).length,0);
  assert.equal(townFrontages(c,[block('garage',710.7,{kind:'garage'})]).length,0);
  assert.equal(townFrontages(c,[block('deep',715.7)]).length,0,'9 m beyond the band is a lawn or a lot');
  assert.equal(townFrontages(c,[block('flush',706.8)]).length,0,'a wall already at the band needs nothing');
  assert.equal(inTownCentre([700,-11650]),true);
  assert.equal(inTownCentre([2000,-11650]),false);
  const far={...road,points:[[2000,-11500],[2000,-11800]]},away={...c,roads:[far],spawn:{x:2000,z:-11650,yaw:0}};
  assert.equal(townFrontages(away,[block('suburb',2010.7)]).length,0,'Main Street outside downtown keeps its lawns');
});

test('a wall that does not face and run along the street gets no forecourt',()=>{
  // A block turned 45 degrees to the street: its nearest walls are within reach but face it at 45 degrees.
  const turned={id:'turned',name:'turned',center:[715,-11650],height:9,footprint:[[707.93,-11650],[715,-11657.07],[722.07,-11650],[715,-11642.93]]};
  assert.equal(townFrontages(city(),[turned]).length,0);
  const square=block('square',710.7);
  assert.equal(townFrontages(city(),[square]).length,1,'the same block square to the street');
});
