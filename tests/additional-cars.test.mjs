import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {createCar} from '../src/render/car.ts';
import {PLAYER_CARS,carGear,carRpm,isPlayerCarId} from '../src/simulation/player-cars.ts';
const city={bounds:{minX:-20000,maxX:20000,minZ:-20000,maxZ:20000},buildings:[],spawn:{x:0,z:0,yaw:0}};
const idle={throttle:0,brake:0,steer:0,handbrake:false};
const advance=(p,n,input=idle,dt=1/60)=>{for(let i=0;i<Math.round(n/dt);i++)p.step(input,dt);return p.getState();};
for(const id of ['mclaren-720s','supra-mk4'])for(const dt of [1/60,1/120])test(`${id} calibrated performance and transmission at ${1/dt} Hz`,async t=>{
  const p=await DrivingPhysics.create(city),spec=PLAYER_CARS[id];p.setCar(id);
  try{
    advance(p,2,idle,dt);assert.equal(p.body.mass(),spec.mass);
    const times={},gears=new Set();
    for(let i=0;i<120/dt;i++){
      p.step({...idle,throttle:1},dt);const s=p.getState();gears.add(s.gear);
      for(const [key,speed]of [['sixty',60*.44704],['hundred',100/3.6],['twoHundred',200/3.6]])if(s.speed>=speed&&times[key]===undefined)times[key]=(i+1)*dt;
      assert.ok(Number.isFinite(s.speed+s.y+s.rpm));
    }
    assert.ok(Math.abs(times.sixty-(id==='mclaren-720s'?2.8:4.6))<.15,JSON.stringify(times));
    if(id==='mclaren-720s'){assert.ok(Math.abs(times.hundred-2.9)<.15);assert.ok(Math.abs(times.twoHundred-7.8)<.2);}
    assert.equal(gears.size,id==='mclaren-720s'?7:6);assert.ok(Math.abs(p.getState().speed-spec.maxForwardSpeed)<.15);
    p.reset(0,0,0);advance(p,2,idle,dt);p.body.setLinvel({x:0,y:0,z:100/3.6},true);
    const start=p.getState();let elapsed=0;
    while(p.getState().speed>.1&&elapsed<6){p.step({...idle,brake:1},dt);elapsed+=dt;}
    const braking=p.getState().z-start.z;assert.ok(Math.abs(braking-(id==='mclaren-720s'?30:36))<1);
    t.diagnostic(JSON.stringify({...times,braking}));
    const reverse=advance(p,2,{...idle,throttle:-1},dt);assert.ok(reverse.speed<-2);assert.equal(reverse.gear,-1);
    // Hysteresis holds a selected gear through small speed oscillations.
    assert.equal(carGear(id,22.6,2),2);assert.ok(Number.isFinite(carRpm(id,reverse.speed,-1,-1)));
  }finally{p.dispose();}
});

test('all four cars swap safely and retain the selected mass and footprint after riding',async()=>{
  const p=await DrivingPhysics.create(city);
  try{
    const colliders=p.world.colliders.len();
    for(let repeat=0;repeat<3;repeat++)for(const id of Object.keys(PLAYER_CARS)){
      assert.ok(isPlayerCarId(id));p.setCar(id);advance(p,1,{...idle,throttle:1});
      p.setVehicleType('ultrabee');p.setVehicleType('car');
      const state=p.getState();assert.equal(state.carId,id);assert.equal(p.body.mass(),PLAYER_CARS[id].mass);
      assert.equal(state.halfLength,PLAYER_CARS[id].halfLength);assert.equal(state.halfWidth,PLAYER_CARS[id].halfWidth);
      assert.equal(p.controller.numWheels(),4);assert.equal(p.world.colliders.len(),colliders);
    }
  }finally{p.dispose();}
});

for(const id of ['mclaren-720s','supra-mk4'])test(`${id} complete bounded model, outward MA plates, wheel dimensions and unique paint`,()=>{
  const car=createCar(id),spec=PLAYER_CARS[id];
  try{
    const paint=car.group.children.find(o=>o.isMesh&&o.material.isMeshPhysicalMaterial);
    assert.notEqual(paint.material.color.getHex(),0xc87935);
    paint.geometry.computeBoundingBox();const size=paint.geometry.boundingBox.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.z-spec.halfLength*2)<.08,`length ${size.z}`);assert.ok(size.x>1.8&&size.x<2.2);
    const plates=car.group.getObjectByName('PlayerMassachusettsPlates');assert.ok(plates);
    const pos=plates.geometry.attributes.position,norm=plates.geometry.attributes.normal;
    assert.equal(pos.count,8);for(let i=0;i<pos.count;i++)assert.equal(Math.sign(norm.getZ(i)),Math.sign(pos.getZ(i)));
    let triangles=0;car.group.traverse(o=>{if(o.isMesh){const p=o.geometry.attributes.position,n=o.geometry.attributes.normal;triangles+=(o.geometry.index?.count??p.count)/3;for(let i=0;i<p.count;i++)assert.ok(Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)+n.getX(i)+n.getY(i)+n.getZ(i)));}});
    assert.ok(triangles<40000,`${triangles} triangles`);
    if(id==='supra-mk4')assert.ok(paint.geometry.boundingBox.max.y<.76,'lowered wing remains below .76 m above chassis origin');
  }finally{car.dispose();}
});

for(const id of ['mclaren-720s','supra-mk4'])test(`${id} CCD stops the car at top speed`,async()=>{
  const wall={id:'wall',name:'Wall',center:[0,81.5],height:20,footprint:[[-50,80],[50,80],[50,83],[-50,83]]};
  const p=await DrivingPhysics.create({...city,buildings:[wall]});p.setCar(id);
  try{
    advance(p,2);p.body.setLinvel({x:0,y:0,z:PLAYER_CARS[id].maxForwardSpeed},true);let furthest=0,impacts=0;
    for(let i=0;i<90;i++){p.step(idle,1/60);const s=p.getState();furthest=Math.max(furthest,s.z);impacts+=p.takeImpacts().length;assert.ok(Number.isFinite(s.x+s.y+s.z));}
    assert.ok(impacts>0);assert.ok(furthest<79,`chassis reached ${furthest}`);
  }finally{p.dispose();}
});

for(const id of ['mclaren-720s','supra-mk4'])test(`${id} steering produces stable mirrored turns`,async()=>{
  const p=await DrivingPhysics.create(city);p.setCar(id);const turns=[];
  try{
    for(const steer of [-1,1]){
      p.reset(0,0,0);advance(p,2);p.body.setLinvel({x:0,y:0,z:12},true);
      const state=advance(p,1,{...idle,throttle:.3,steer});turns.push(state.yaw);
      const q=p.body.rotation(),up=1-2*(q.x*q.x+q.z*q.z);
      assert.ok(up>.85,'car stays upright');assert.ok(Math.abs(state.yaw)>.15,'physical car actually turns');
    }
    assert.ok(turns[0]*turns[1]<0);assert.ok(Math.abs(Math.abs(turns[0])-Math.abs(turns[1]))<.08);
  }finally{p.dispose();}
});

test('Supra spoiler joins both supports continuously at the front and rear of its chord',()=>{
  const car=createCar('supra-mk4');
  try{
    const paint=car.group.children.find(o=>o.isMesh&&o.material.isMeshPhysicalMaterial);
    paint.updateMatrixWorld(true);
    for(const side of [-1,1])for(const z of [-1.92,-2.09])for(let y=.66;y<=.685;y+=.0025){
      const ray=new THREE.Raycaster(new THREE.Vector3(side*1.2,y,z),new THREE.Vector3(-side,0,0),0,.55);
      assert.ok(ray.intersectObject(paint,false).length>0,`gap at side ${side}, height ${y}, chord ${z}`);
    }
  }finally{car.dispose();}
});
