import test from 'node:test';
import assert from 'node:assert/strict';
import {tileStalls,parkedCar,nearestParked,stallDraw,stallLines,OCCUPANCY,STALL_HALF,STALL_LINE} from '../src/simulation/parking-lots.ts';
import {NPC_VEHICLES} from '../src/simulation/npc-vehicle-specs.ts';

const tile={tx:2,tz:-3,size:1000,parking:[150,99975,9000,300,99975,27000]};

test('a tile\'s stalls are read in world metres with the vehicle yaw of a car parked nose in',()=>{
  const stalls=tileStalls(tile);assert.equal(stalls.length,2);
  assert.deepEqual([stalls[0].x,stalls[0].z],[2001.5,-2000.25]);assert.ok(Math.abs(stalls[0].yaw-Math.PI/2)<1e-9);assert.ok(Math.abs(stalls[1].yaw-3*Math.PI/2)<1e-9);
  assert.deepEqual(tileStalls({tx:0,tz:0,size:1000}),[]);
});

test('a stall holds the same car on every visit, and about the set share of stalls are taken',()=>{
  const stalls=Array.from({length:4000},(_,i)=>({x:(i%80)*2.6+.37,z:Math.floor(i/80)*11.6-.91,yaw:0}));
  const first=stalls.map(parkedCar),again=stalls.map(parkedCar);assert.deepEqual(first,again);
  const taken=first.filter(Boolean);assert.ok(Math.abs(taken.length/stalls.length-OCCUPANCY)<.04,`${taken.length} of ${stalls.length}`);
  const types=new Set(taken.map(car=>car.spec.type));assert.ok(types.size>=4&&!types.has('box'),'passenger cars of several kinds, no box trucks');
  for(const car of taken){assert.ok(car.spec.colors.includes(car.color));assert.ok(NPC_VEHICLES.includes(car.spec));assert.ok(car.spec.length<=5.9,'nothing longer than a stall holds');}
  const backed=taken.filter((car,i)=>Math.abs(car.yaw-Math.PI)<1e-9).length/taken.length;assert.ok(backed>.06&&backed<.2,`one in eight backed in, got ${backed}`);
  // neighbouring stalls do not repeat one another
  const row=first.slice(0,80).map(car=>car?`${car.spec.type}${car.color}`:'-');assert.ok(new Set(row).size>=8);
});

test('the four draws of a stall are independent of one another',()=>{
  let both=0,n=20000;for(let i=0;i<n;i++){const [a,b]=stallDraw(i*.731,i*-1.277);if(a<.5&&b<.5)both++;}
  assert.ok(Math.abs(both/n-.25)<.02,`${both/n}`);
});

test('the pool takes the nearest cars within reach, nearest first',()=>{
  const cars=Array.from({length:50},(_,i)=>parkedCar({x:i*3+.11,z:.07,yaw:0})).filter(Boolean);
  const near=nearestParked(cars,30,0,5,20);assert.equal(near.length,5);
  const d=near.map(car=>Math.hypot(car.x-30,car.z));assert.deepEqual(d,[...d].sort((a,b)=>a-b));assert.ok(d[4]<=20);
  assert.equal(nearestParked(cars,30,500,5,20).length,0);
});

test('stalls in a row are painted with one line between neighbours, along the cars',()=>{
  // three stalls a stall's width apart, cars facing +z, and one across the aisle facing them
  const row=[0,1,2].map(i=>({x:10+i*2*STALL_HALF,z:5,yaw:0})),lines=stallLines([...row,{x:10,z:16.6,yaw:Math.PI}]);
  assert.equal(lines.length,4+2,'four lines bound three stalls in a row, two the one opposite');
  for(const [x0,z0,x1,z1] of lines){assert.ok(Math.abs(Math.hypot(x1-x0,z1-z0)-STALL_LINE)<1e-9);assert.ok(Math.abs(x1-x0)<1e-9,'along the car');}
  assert.deepEqual([...new Set(lines.slice(0,4).map(l=>Math.round(l[0]*10)/10))].sort((a,b)=>a-b),[8.7,11.3,13.9,16.5]);
  assert.deepEqual(stallLines([]),[]);
});
