import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {createCar} from '../src/render/car.ts';
const city={bounds:{minX:-20000,maxX:20000,minZ:-20000,maxZ:20000},buildings:[],spawn:{x:0,z:0,yaw:0}};
const idle={throttle:0,brake:0,steer:0,handbrake:false};
const advance=(p,n,input=idle,dt=1/60)=>{for(let i=0;i<Math.round(n/dt);i++)p.step(input,dt);return p.getState();};

test('Harbor S4 remains default and actually reaches 60 mph on level ground',async()=>{
  const p=await DrivingPhysics.create(city);
  try{assert.equal(p.carId,'harbor-s4');advance(p,2);const s=advance(p,35,{...idle,throttle:1});assert.ok(Math.abs(s.speed/.44704-60)<.15);assert.equal(p.body.mass(),1240);}
  finally{p.dispose();}
});

for(const dt of [1/60,1/120])test(`GT measured launch, seven gears, top speed and braking at ${1/dt} Hz`,async t=>{
  const p=await DrivingPhysics.create(city);p.setCar('mclaren-gt');
  try{
    advance(p,2,idle,dt);assert.equal(p.body.mass(),1530);
    const times={},gears=new Set();
    for(let i=0;i<120/dt;i++){
      p.step({...idle,throttle:1},dt);const s=p.getState();gears.add(s.gear);
      for(const [key,speed]of [['sixty',60*.44704],['hundred',100/3.6],['twoHundred',200/3.6]])if(s.speed>=speed&&times[key]===undefined)times[key]=(i+1)*dt;
      assert.ok(Number.isFinite(s.speed+s.y+s.rpm));
    }
    assert.ok(Math.abs(times.sixty-3.1)<.18,`0–60: ${times.sixty}`);
    assert.ok(Math.abs(times.hundred-3.2)<.18,`0–100: ${times.hundred}`);
    assert.ok(Math.abs(times.twoHundred-9)<.3,`0–200: ${times.twoHundred}`);
    assert.equal(gears.size,7);assert.ok(Math.abs(p.getState().speed-326/3.6)<.25);
    p.reset(0,0,0);advance(p,2,idle,dt);p.body.setLinvel({x:0,y:0,z:100/3.6},true);
    const start=p.getState();let elapsed=0;
    while(p.getState().speed>.1&&elapsed<6){p.step({...idle,brake:1},dt);elapsed+=dt;}
    const distance=p.getState().z-start.z;assert.ok(Math.abs(distance-32)<1.2,`100–0: ${distance}m`);
    t.diagnostic(JSON.stringify({...times,brakingMetres:distance}));
    const reverse=advance(p,2,{...idle,throttle:-1},dt);assert.ok(reverse.speed<-2);assert.equal(reverse.gear,-1);
  }finally{p.dispose();}
});

test('car changes clear momentum, retain selection through bike switches, and release controllers',async()=>{
  const p=await DrivingPhysics.create(city);
  try{
    const initialColliders=p.world.colliders.len();
    for(let i=0;i<8;i++){
      advance(p,.5,{...idle,throttle:1});const before=p.getState();
      p.setCar('mclaren-gt');let s=p.getState();assert.equal(s.carId,'mclaren-gt');assert.equal(s.speed,0);assert.ok(Math.hypot(s.x-before.x,s.z-before.z)<.01);
      p.setVehicleType('ultrabee');p.setCar('harbor-s4');assert.equal(p.vehicleType,'ultrabee');
      p.setCar('mclaren-gt');p.setVehicleType('car');assert.equal(p.body.mass(),1530);assert.equal(p.controller.numWheels(),4);
      p.setCar('harbor-s4');assert.equal(p.body.mass(),1240);assert.equal(p.world.colliders.len(),initialColliders);
    }
  }finally{p.dispose();}
});

test('GT body has outward normals, realistic dimensions, wheel openings and bounded geometry',()=>{
  const car=createCar('mclaren-gt');
  try{
    const body=car.group.children.find(o=>o.isMesh&&o.material.color.getHex()===0xc87935);
    body.geometry.computeBoundingBox();const size=body.geometry.boundingBox.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.z-4.683)<.01);assert.ok(size.x>1.85&&size.x<2.12);
    const pos=body.geometry.attributes.position,norm=body.geometry.attributes.normal;
    let upward=0,arch=0;
    for(let i=0;i<pos.count;i++){
      assert.ok(Number.isFinite(pos.getX(i)+pos.getY(i)+pos.getZ(i)));
      if(Math.abs(pos.getX(i))<.1&&pos.getY(i)>.1&&norm.getY(i)>.8)upward++;
      if(Math.abs(pos.getZ(i)-1.3375)<.04&&Math.abs(pos.getX(i))>.90&&pos.getY(i)>.1)arch++;
    }
    assert.ok(upward>50,'painted upper shell must face the light');assert.ok(arch>0);
    let triangles=0;car.group.traverse(o=>{if(o.isMesh)triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;});
    assert.ok(triangles<40000,`player car has ${triangles} triangles`);
  }finally{car.dispose();}
});

test('GT CCD stops a 203 mph chassis at a solid wall',async()=>{
  const wall={id:'wall',name:'Wall',center:[0,81.5],height:20,footprint:[[-50,80],[50,80],[50,83],[-50,83]]};
  const p=await DrivingPhysics.create({...city,buildings:[wall]});p.setCar('mclaren-gt');
  try{
    advance(p,2);p.body.setLinvel({x:0,y:0,z:326/3.6},true);let furthest=0,impacts=0;
    for(let i=0;i<90;i++){p.step(idle,1/60);const s=p.getState();furthest=Math.max(furthest,s.z);impacts+=p.takeImpacts().length;assert.ok(Number.isFinite(s.x+s.y+s.z));}
    assert.ok(impacts>0);assert.ok(furthest<79,`chassis reached ${furthest}, wall starts at 80`);
  }finally{p.dispose();}
});
