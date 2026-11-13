import test from 'node:test';
import assert from 'node:assert/strict';
import {tileStalls,parkedCar,nearestParked,poolSlots,slotType,stallDraw,stallLines,OCCUPANCY,PARKED_TYPES,STALL_DEPTH,STALL_HALF,STALL_LINE} from '../src/simulation/parking-lots.ts';
import {NPC_VEHICLES} from '../src/simulation/npc-vehicle-specs.ts';
import {loadMetroCity} from './helpers/metro-city.mjs';

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
  const types=new Set(taken.map(car=>car.spec.type));assert.ok(types.size>=3&&!types.has('box')&&!types.has('pickup'),'passenger cars of several kinds, none longer than a stall');
  for(const car of taken){assert.ok(car.spec.colors.includes(car.color));assert.ok(NPC_VEHICLES.includes(car.spec));assert.ok(car.spec.length<=STALL_DEPTH&&car.spec.width<=2*STALL_HALF-.5,'a car fits its stall, with room to open a door');assert.deepEqual([car.x,car.z],[stalls[first.indexOf(car)].x,stalls[first.indexOf(car)].z]);}
  // the rule, on the models themselves: rows stand nose to nose, so a model longer than a stall would stand in the car beyond it
  for(const type of PARKED_TYPES)assert.ok(NPC_VEHICLES.find(v=>v.type===type).length<=STALL_DEPTH,`a ${type} is no longer than a stall`);
  assert.ok(NPC_VEHICLES.filter(v=>v.length<=STALL_DEPTH).every(v=>PARKED_TYPES.includes(v.type)),'and every model that fits one parks');
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
  // a lot of minivans alone: as many as the pool has minivan slots, none in another model's
  const vans=lot.filter(car=>car.spec.type==='minivan');assert.ok(vans.length>quota(220).minivan);
  assert.equal(nearestParked(vans,78,230,220,5000).length,quota(220).minivan);
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
  const full=Array(PARKED_TYPES.length).fill(undefined),vans=lot.filter(car=>car.spec.type==='minivan').slice(0,3),placed=poolSlots(full,vans);
  assert.equal(placed.held.size,1);assert.deepEqual(full.map(car=>car?.spec.type),PARKED_TYPES.map(type=>type==='minivan'?'minivan':undefined));
});

test('stalls in a row are painted with one line between neighbours, along the cars',()=>{
  // three stalls a stall's width apart, cars facing +z, and one across the aisle facing them
  const row=[0,1,2].map(i=>({x:10+i*2*STALL_HALF,z:5,yaw:0})),lines=stallLines([...row,{x:10,z:16.6,yaw:Math.PI}]);
  assert.equal(lines.length,4+2,'four lines bound three stalls in a row, two the one opposite');
  for(const [x0,z0,x1,z1] of lines){assert.ok(Math.abs(Math.hypot(x1-x0,z1-z0)-STALL_LINE)<1e-9);assert.ok(Math.abs(x1-x0)<1e-9,'along the car');}
  assert.deepEqual([...new Set(lines.slice(0,4).map(l=>Math.round(l[0]*10)/10))].sort((a,b)=>a-b),[8.7,11.3,13.9,16.5]);
  assert.deepEqual(stallLines([]),[]);
});

// ---- the installed package: a stall stands on what its tile draws (scripts/parking_lots.py lays it there, validate-city.py holds every tile to it)
const city=await loadMetroCity({tiles:['0_2','-7_-3','-7_-2','-3_-2','-6_-5']});
const within=(p,rings)=>{let hit=false;for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
// the ground a stall and a kerbside bay share, a little inside it: its centre and its four corners
const parkedKey=s=>`${Math.round(s.x*100)},${Math.round(s.z*100)}`;
const ground=s=>{const f=[Math.sin(s.yaw),Math.cos(s.yaw)],r=[f[1],-f[0]];return [[0,0],[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>[s.x+f[0]*a*2.5+r[0]*b*1.1,s.z+f[1]*a*2.5+r[1]*b*1.1]);};

test('a stall stands on the asphalt of its lot, in no street and on no street sidewalk: Newmarket Square, the edge of the coverage and Cambridge',()=>{
  for(const key of ['0_2','-7_-3','-3_-2']){
    const tile=city.loadedTiles.get(key),stalls=tileStalls(tile),x0=tile.tx*tile.size,z0=tile.tz*tile.size;assert.ok(stalls.length>150,`${stalls.length} stalls in tile ${key}`);
    let checked=0;
    for(const s of stalls)for(const p of ground(s)){
      if(p[0]<x0||p[0]>=x0+tile.size||p[1]<z0||p[1]>=z0+tile.size)continue;   // (the next tile draws that ground)
      checked++;
      assert.ok(!(tile.streetPavement??[]).some(rings=>within(p,rings)),`the stall at ${s.x}, ${s.z} in tile ${key} stands in a street`);
      assert.ok(tile.driveways.some(rings=>within(p,rings)),`the stall at ${s.x}, ${s.z} in tile ${key} stands off the asphalt of its lot`);
      // (the band beside a street with no surveyed sidewalk lies under the asphalt of a lot mapped out to the curb: the walkers pace it and the street trees stand in it)
      assert.ok(!(tile.streetSidewalks??[]).some(rings=>within(p,rings)),`the stall at ${s.x}, ${s.z} in tile ${key} stands on the sidewalk of a street`);
    }
    assert.ok(checked>stalls.length*4.5,`${checked} points of ${stalls.length} stalls`);
  }
  // Newmarket Square's parking is mapped inside its curbs, so its roadway holds none of it: a row of two dozen stood in the street, the stall
  // a review named at (710.94, 2583.71) among them
  const square=tileStalls(city.loadedTiles.get('0_2')).filter(s=>s.x>690&&s.x<760&&s.z>2510&&s.z<2600);
  assert.ok(square.length<=8&&!square.some(s=>Math.hypot(s.x-710.94,s.z-2583.71)<2),`${square.length} stalls left at the square`);
  // and beyond the playable coverage no lot is drawn, so none has stalls (2,267 stood on bare ground in this tile)
  const beyond=city.loadedTiles.get('-7_-2');assert.equal(tileStalls(beyond).length,0);assert.equal((beyond.parking??[]).length,0);
});

test('no two stalls share ground: a lot that two OpenStreetMap ways trace is laid out once',()=>{
  // The 3.5 hectare lot at Fresh Pond in Cambridge is mapped twice, and so are a few others: laid out one by one their rows fell on each
  // other (263 stalls exactly on another, 997 pairs of cars through each other). A car's footprint, a little inside its stall:
  const car=(s,hl=2.3,hw=.95)=>{const f=[Math.sin(s.yaw),Math.cos(s.yaw)],r=[f[1],-f[0]];return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>[s.x+f[0]*a*hl+r[0]*b*hw,s.z+f[1]*a*hl+r[1]*b*hw]);};
  // (two rectangles are apart when the edges of one or the other separate them)
  const apart=(p,q)=>[p,q].some(poly=>poly.some((a,i)=>{const b=poly[(i+1)%4],n=[b[1]-a[1],a[0]-b[0]],on=c=>c[0]*n[0]+c[1]*n[1],P=p.map(on),Q=q.map(on);return Math.max(...P)<=Math.min(...Q)+1e-9||Math.max(...Q)<=Math.min(...P)+1e-9;}));
  for(const key of ['-6_-5','0_2','-3_-2']){
    const stalls=tileStalls(city.loadedTiles.get(key));assert.ok(stalls.length>500,`${stalls.length} stalls in tile ${key}`);
    assert.equal(new Set(stalls.map(s=>parkedKey(s))).size,stalls.length,`every stall of tile ${key} has a place of its own (the key the pool knows a car by)`);
    const cells=new Map();for(const s of stalls){const k=`${Math.floor(s.x/8)},${Math.floor(s.z/8)}`;if(!cells.has(k))cells.set(k,[]);cells.get(k).push(s);}
    let through=0,models=0;const parked=new Map(stalls.map(s=>[s,parkedCar(s)]));
    for(const s of stalls)for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const o of cells.get(`${Math.floor(s.x/8)+i},${Math.floor(s.z/8)+j}`)??[]){
      if(o===s||!(o.x>s.x||(o.x===s.x&&o.z>s.z)))continue;
      if(!apart(car(s),car(o)))through++;
      // and the cars that stand in them, by the length and width of their own models (a pickup, longer than a stall, stood in the car nose to nose with it)
      const a=parked.get(s),b=parked.get(o);if(a&&b&&!apart(car(a,a.spec.length/2,a.spec.width/2),car(b,b.spec.length/2,b.spec.width/2)))models++;
    }
    assert.equal(through,0,`${through} pairs of stalls share ground in tile ${key}`);assert.equal(models,0,`${models} pairs of parked cars stand in each other in tile ${key}`);
  }
});
