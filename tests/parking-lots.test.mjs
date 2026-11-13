import test from 'node:test';
import assert from 'node:assert/strict';
import {tileStalls,parkedCar,nearestParked,poolSlots,slotType,stallDraw,stallLines,OCCUPANCY,STALL_HALF,STALL_LINE} from '../src/simulation/parking-lots.ts';
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
  const near=nearestParked(cars,30,0,220,20);assert.ok(near.length>=5&&near.length===cars.filter(car=>Math.hypot(car.x-30,car.z)<=20).length,'every car within reach while the pool has room');
  const d=near.map(car=>Math.hypot(car.x-30,car.z));assert.deepEqual(d,[...d].sort((a,b)=>a-b));assert.ok(d.at(-1)<=20);
  assert.equal(nearestParked(cars,30,500,220,20).length,0);
});

// A lot of 2,400 stalls, and the slots a pool of `capacity` has of each model.
const lot=Array.from({length:2400},(_,i)=>parkedCar({x:(i%60)*2.6+.37,z:Math.floor(i/60)*11.6-.91,yaw:0})).filter(Boolean);
const quota=capacity=>{const out={};for(let i=0;i<capacity;i++)out[slotType(i)]=(out[slotType(i)]??0)+1;return out;};
const count=cars=>{const out={};for(const car of cars)out[car.spec.type]=(out[car.spec.type]??0)+1;return out;};

test('the pool is shared out by model: of each the nearest it has slots for, never one more',()=>{
  for(const capacity of [220,30]){
    const slots=quota(capacity);assert.equal(Object.values(slots).reduce((a,b)=>a+b),capacity);assert.ok(!('box' in slots),'no slot for a box truck');
    let short=0;
    for(const [x,z] of [[78,230],[10,5],[150,450],[40,120]]){
      const wanted=nearestParked(lot,x,z,capacity,520),drawn=count(wanted),d=car=>Math.hypot(car.x-x,car.z-z);
      assert.ok(wanted.length<=capacity);assert.deepEqual(wanted.map(d),wanted.map(d).sort((a,b)=>a-b),'nearest first');
      for(const type of Object.keys(slots)){
        assert.ok((drawn[type]??0)<=slots[type],`${drawn[type]} ${type}s for ${slots[type]} slots`);
        // every car of the model that is left out stands further off than each one drawn
        const far=Math.max(...wanted.filter(car=>car.spec.type===type).map(d)),out=lot.filter(car=>car.spec.type===type&&!wanted.includes(car));
        assert.ok(out.every(car=>d(car)>=far),`a nearer ${type} is left out`);
      }
      // (the nearest cars whatever their model: more of some model than the pool has slots for, which is what drew a pickup as a compact)
      const nearest=count([...lot].sort((a,b)=>d(a)-d(b)).slice(0,capacity));if(Object.keys(slots).some(type=>(nearest[type]??0)>slots[type]))short++;
    }
    assert.ok(short>=2,`the nearest ${capacity} cars overrun a model's slots at ${short} of 4 places`);
  }
  // a lot of pickups alone: as many as the pool has pickup slots, none in another model's
  const pickups=lot.filter(car=>car.spec.type==='pickup');assert.ok(pickups.length>quota(220).pickup);
  assert.equal(nearestParked(pickups,78,230,220,5000).length,quota(220).pickup);
});

test('a car is drawn in a slot of its own model as the pool moves on, and keeps its slot while it is wanted',()=>{
  for(const capacity of [220,30]){
    const slots=Array(capacity).fill(undefined);let before=new Map(),moves=0,kept=0;
    for(let step=0;step<40;step++){
      const x=10+step*7,z=40+step*11,wanted=nearestParked(lot,x,z,capacity,capacity===30?150:520),was=[...slots],{freed,held}=poolSlots(slots,wanted);
      assert.equal(held.size,wanted.length,'every wanted car has a slot');
      for(const car of wanted){const slot=held.get(car.key);assert.equal(slots[slot],car);assert.equal(slotType(slot),car.spec.type,`a ${car.spec.type} in a ${slotType(slot)} slot`);}
      assert.equal(slots.filter(Boolean).length,wanted.length,'and no slot holds a car that is not wanted');
      // a car that stays keeps its slot; a slot whose car left is reported, so that its body goes before the slot is drawn again
      for(const [key,slot] of before)if(held.has(key)){assert.equal(held.get(key),slot);kept++;}
      const left=was.flatMap((car,slot)=>car&&!held.has(car.key)?[slot]:[]);assert.deepEqual([...freed].sort((a,b)=>a-b),left);moves+=freed.length;
      before=held;
    }
    assert.ok(moves>capacity&&kept>capacity,`the pool turned over (${moves} slots freed, ${kept} kept)`);
  }
  // nothing wanted: every slot is freed
  const slots=Array(30).fill(undefined);poolSlots(slots,nearestParked(lot,78,230,30,150));const held=slots.filter(Boolean).length,{freed}=poolSlots(slots,[]);
  assert.ok(held>0&&freed.length===held&&slots.every(car=>!car));
  // a car with no slot of its model free is not drawn as another
  const full=Array(6).fill(undefined),pickups=lot.filter(car=>car.spec.type==='pickup').slice(0,3),placed=poolSlots(full,pickups);
  assert.equal(placed.held.size,1);assert.deepEqual(full.map(car=>car?.spec.type),[undefined,undefined,undefined,undefined,undefined,'pickup']);
});

test('stalls in a row are painted with one line between neighbours, along the cars',()=>{
  // three stalls a stall's width apart, cars facing +z, and one across the aisle facing them
  const row=[0,1,2].map(i=>({x:10+i*2*STALL_HALF,z:5,yaw:0})),lines=stallLines([...row,{x:10,z:16.6,yaw:Math.PI}]);
  assert.equal(lines.length,4+2,'four lines bound three stalls in a row, two the one opposite');
  for(const [x0,z0,x1,z1] of lines){assert.ok(Math.abs(Math.hypot(x1-x0,z1-z0)-STALL_LINE)<1e-9);assert.ok(Math.abs(x1-x0)<1e-9,'along the car');}
  assert.deepEqual([...new Set(lines.slice(0,4).map(l=>Math.round(l[0]*10)/10))].sort((a,b)=>a-b),[8.7,11.3,13.9,16.5]);
  assert.deepEqual(stallLines([]),[]);
});
