import './helpers/npc-fleet.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {CONFLICT,footprintsOverlap,firstContact,clearance,crossing,rightOfWay,yieldSpeed,blockingCycle} from '../src/simulation/traffic-conflicts.ts';
import {createTraffic,join} from '../src/simulation/traffic.ts';
import {DrivingPhysics} from '../src/physics/vehicle.ts';

const car={halfLength:2.4,halfWidth:.93};
/** A straight run from (x, z) heading `yaw`, sampled as traffic.ts samples a route. */
function straight(x,z,yaw,length=20){
  const pose=t=>({x:x+Math.sin(yaw)*t,z:z+Math.cos(yaw)*t,yaw}),poses=[];
  for(let t=0;t<=length;t+=CONFLICT.step)poses.push(pose(t));
  return{...car,poses,pose};
}
const claim=(index,extra={})=>({index,travel:5,speed:5,stopsShort:false,forced:false,otherAhead:true,...extra});

test('footprints overlap across a junction but not between neighbouring lanes',()=>{
  const east={x:0,z:0,yaw:Math.PI/2};
  assert.ok(footprintsOverlap(east,car,{x:0,z:2,yaw:0},car),'a car crossing just ahead overlaps');
  assert.ok(!footprintsOverlap(east,car,{x:0,z:3.4,yaw:Math.PI/2},car),'parallel lanes 3.4 m apart stay clear');
  assert.ok(!footprintsOverlap(east,car,{x:0,z:3.2,yaw:-Math.PI/2},car),'opposing lanes of a narrow two-way street stay clear');
  assert.ok(!footprintsOverlap(east,car,{x:8,z:0,yaw:Math.PI/2},car),'a car eight metres ahead is not touching');
});

test('first contact measures the travel to a crossing and finds a car already in the way',()=>{
  const northbound=straight(0,-15,0),eastbound=straight(-15,0,Math.PI/2);
  const travel=firstContact(northbound,eastbound);
  // The crossing lane is 15 m ahead; contact begins half a car length plus half a width (and margins) before it.
  const expected=15-(car.halfLength+CONFLICT.lengthMargin)-(car.halfWidth+CONFLICT.widthMargin);
  assert.ok(Math.abs(travel-expected)<.15,`contact after ${travel} m, expected about ${expected}`);
  assert.equal(firstContact(straight(-2,-1,Math.PI/2),straight(0,-2,0)),0,'already overlapping');
  assert.equal(firstContact(straight(0,0,0),straight(4,0,0)),undefined,'parallel lanes never meet');
  const leader=straight(0,12,0),follower=straight(0,0,0);
  assert.equal(firstContact(leader,follower),0,'the car ahead already stands in its follower’s path');
  assert.ok(firstContact(follower,leader)>5,'the follower reaches the car ahead after the gap between them');
});

test('a car knows when it has passed clear of another path, and crossing paths from merging ones',()=>{
  const northbound=straight(0,-15,0,30),eastbound=straight(-15,0,Math.PI/2,30),entry=firstContact(northbound,eastbound);
  const exit=clearance(northbound,eastbound,entry),reach=car.halfLength+CONFLICT.lengthMargin+car.halfWidth+CONFLICT.widthMargin;
  assert.ok(exit>15+reach-CONFLICT.step&&exit<=15+reach+CONFLICT.step,`clear of the crossing lane after ${exit} m`);
  assert.equal(clearance(straight(0,0,0,30),straight(0,12,0,30),firstContact(straight(0,0,0,30),straight(0,12,0,30))),Infinity,'a car never clears the lane it follows');
  assert.ok(crossing({x:0,z:0,yaw:0},{x:0,z:0,yaw:Math.PI/2}));assert.ok(!crossing({x:0,z:0,yaw:0},{x:0,z:0,yaw:.3}));assert.ok(!crossing({x:0,z:0,yaw:0},{x:0,z:0,yaw:Math.PI}));
});

test('lanes joined at a sharp turn meet where their lines cross instead of doubling back',()=>{
  const road={};
  // Joined end to end, the right turn would run back from (10, 0) to (7, 3): the
  // incoming lane ends beyond the outgoing one's start (Beacon Street onto
  // Brookline Avenue at Kenmore), and corner rounding made that a loop.
  for(const [next,expected,label] of [
    [[[7,3],[7,13]],[[0,0],[7,0],[7,13]],'right turn'],
    [[[13,-3],[13,-13]],[[0,0],[13,0],[13,-13]],'left turn'],
    [[[4,4],[-6,14]],[[0,0],[8,0],[-6,14]],'sharp turn'],
  ]){
    const points=[[0,0],[10,0]],roads=[road,road];join(points,roads,next,road);
    assert.equal(points.length,roads.length);assert.equal(points.length,expected.length,label);
    points.forEach((p,i)=>assert.ok(Math.hypot(p[0]-expected[i][0],p[1]-expected[i][1])<1e-9,`${label}: ${p} instead of ${expected[i]}`));
  }
  const straightOn=[[0,0],[10,0]];join(straightOn,[road,road],[[10.5,.2],[20,.2]],road);
  assert.deepEqual(straightOn,[[0,0],[10,0],[10.5,.2],[20,.2]],'a straight continuation keeps both lanes as they are');
});

test('right of way always lets exactly one of two cars meeting at a corner go',()=>{
  // Two cars touching at a corner, each with the other in front: the old rule stopped both for good.
  for(const remembered of [undefined,0,1]){
    const winner=rightOfWay(claim(0,{travel:0}),claim(1,{travel:0}),remembered);
    assert.equal(winner,remembered??0);
  }
  assert.equal(rightOfWay(claim(0,{travel:0,otherAhead:true}),claim(1,{travel:0,otherAhead:false})),1,'the car with nothing in front pulls away');
  assert.equal(rightOfWay(claim(0,{travel:0,otherAhead:false}),claim(1,{travel:0,otherAhead:false})),undefined,'cars moving apart both go');
  assert.equal(rightOfWay(claim(0,{travel:6}),claim(1,{travel:0})),1,'a car already in the other’s path clears it first');
  assert.equal(rightOfWay(claim(0,{travel:4,speed:9}),claim(1,{travel:2,speed:1})),0,'a car too fast to stop keeps going');
  assert.equal(rightOfWay(claim(0,{travel:10}),claim(1,{travel:4})),1,'otherwise the earlier arrival goes first');
  assert.equal(rightOfWay(claim(0,{travel:10}),claim(1,{travel:4}),0),0,'a remembered order holds while both brake');
  assert.equal(rightOfWay(claim(0,{travel:10}),claim(1,{travel:4,stopsShort:true})),0,'a car held by a red light claims nothing');
  assert.equal(rightOfWay(claim(0,{travel:10}),claim(1,{travel:4,stopsShort:true}),1),0,'a remembered winner that turns red gives way');
  assert.equal(rightOfWay(claim(0,{travel:0,forced:true}),claim(1,{travel:0,otherAhead:false})),0,'deadlock priority beats every other rule');
  assert.equal(yieldSpeed(CONFLICT.buffer),0);assert.ok(yieldSpeed(12)>9);
});

test('a cycle of cars each stopped for the next is detected, a queue is not',()=>{
  assert.deepEqual(blockingCycle(0,[1,2,0,-1]),[0,1,2]);
  assert.deepEqual(blockingCycle(3,[1,2,1,0]),[1,2]);
  assert.equal(blockingCycle(0,[1,2,3,-1]),undefined,'a queue behind a red light ends at a car waiting for nothing else');
});

/** A closed three-by-three grid of two-way 14 m streets, 150 m blocks, with no
 * signals: four T junctions and a four-way crossing keep every route turning
 * through unsignalled junctions. */
async function grid(){
  const lines=[-150,0,150],roads=[];
  for(const a of lines)for(let i=0;i<2;i++){
    roads.push({id:`ew${a}_${i}`,name:`Street ${a}`,width:14,oneway:0,points:[[lines[i],a],[lines[i+1],a]]});
    roads.push({id:`ns${a}_${i}`,name:`Avenue ${a}`,width:14,oneway:0,points:[[a,lines[i]],[a,lines[i+1]]]});
  }
  const city={bounds:{minX:-600,maxX:600,minZ:-600,maxZ:600},buildings:[],signals:[],roads,spawn:{x:-100,z:3,yaw:Math.PI/2}};
  const physics=await DrivingPhysics.create(city),traffic=createTraffic(new THREE.Scene(),city,physics);
  return{physics,traffic,dispose(){traffic.dispose();physics.dispose();}};
}

test('busy unsignalled junctions keep flowing without stuck or stacked cars',async()=>{
  const f=await grid(),observer={x:0,y:0,z:0},player={x:500,y:.65,z:500,yaw:0,speed:0,steering:0};
  f.physics.body.setTranslation(player,true);
  try{
    const junctions=[[0,0],[-150,0],[150,0],[0,-150],[0,150]],still=new Map(),inside=new Map();let crossings=0,longest=0;
    for(let step=0;step<60*150;step++){
      f.traffic.update(1/60,player,observer);f.physics.world.step();
      if(step%15)continue;
      const cars=f.traffic.snapshot();
      cars.forEach((car,k)=>{
        const at=junctions.findIndex(([x,z])=>Math.abs(car.x-x)<9&&Math.abs(car.z-z)<9);if(at>=0&&inside.get(k)!==at)crossings++;inside.set(k,at);
        const wait=car.speed<.2?(still.get(k)??0)+.25:0;still.set(k,wait);longest=Math.max(longest,wait);
      });
      if(step<60*5)continue;
      for(let a=0;a<cars.length;a++)for(let b=a+1;b<cars.length;b++){
        const gap=Math.hypot(cars[a].x-cars[b].x,cars[a].z-cars[b].z);
        assert.ok(gap>2.2,`cars ${a} and ${b} stacked ${gap.toFixed(2)} m apart at (${cars[a].x.toFixed(1)}, ${cars[a].z.toFixed(1)}) after ${(step/60).toFixed(1)} s`);
      }
    }
    assert.ok(longest<20,`a car waited ${longest} s`);
    assert.ok(crossings>60,`only ${crossings} junction crossings in two and a half minutes`);
  }finally{f.dispose();}
});

test('routes near the player extend before they run out, across a gap between source datasets',async()=>{
  // A one-way loop whose first side is split by a 6 m seam with no shared node.
  const side=(id,points)=>({id,name:`Loop ${id}`,width:10,oneway:1,points});
  const city={bounds:{minX:-300,maxX:300,minZ:-300,maxZ:300},buildings:[],signals:[],spawn:{x:30,z:-40,yaw:0},roads:[
    side('a1',[[0,0],[37,0]]),side('a2',[[43,0],[80,0]]),side('b',[[80,0],[80,80]]),side('c',[[80,80],[0,80]]),side('d',[[0,80],[0,0]]),
  ]};
  const physics=await DrivingPhysics.create(city),traffic=createTraffic(new THREE.Scene(),city,physics),observer={x:40,y:0,z:40},player={x:250,y:.65,z:250,yaw:0,speed:0,steering:0};
  physics.body.setTranslation(player,true);
  try{
    assert.ok(traffic.count>=3,'the loop carries several cars');
    const still=new Map();let longest=0,travelled=0;
    // A new route stops at the seam, at most one lap (314 m) from where it starts.
    for(let step=0;step<60*260;step++){
      traffic.update(1/60,player,observer);physics.world.step();
      const cars=traffic.snapshot();travelled+=cars[0].speed/60;
      if(step%15)continue;
      cars.forEach((car,k)=>{const wait=car.speed<.2?(still.get(k)??0)+.25:0;still.set(k,wait);longest=Math.max(longest,wait);});
    }
    assert.ok(longest<20,`a car waited ${longest} s`);
    assert.ok(travelled>1000,`the first car covered only ${travelled.toFixed(0)} m`);
  }finally{traffic.dispose();physics.dispose();}
});
