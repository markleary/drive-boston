import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {createTireSurfaceSampler,tireSlipIntensity,TRACK_LIFETIME} from '../src/simulation/tire-tracks.ts';
import {createTireTracks} from '../src/render/tire-tracks.ts';
const input={throttle:0,brake:0,steer:0,handbrake:false};
const square=(x,z,size)=>[[x,z],[x+size,z],[x+size,z+size],[x,z+size]];
const city={bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000},roads:[],buildings:[],spawn:{x:0,z:0,yaw:0},parks:[{id:'park',name:'Test lawn',rings:[square(-100,-100,200),square(70,70,10)]}],water:[{id:'pond',name:'Pond',rings:[square(40,40,10)]}]};
const contact=(x,z=0,intensity=1)=>({wheel:0,x,y:0,z,width:.235,normal:{x:0,y:1,z:0},intensity});

test('hard braking and lateral slip mark tires; ordinary driving and low-speed parking do not',()=>{
  assert.equal(tireSlipIntensity(input,20,0,true),0);
  assert.equal(tireSlipIntensity({...input,brake:.3},20,0,true),0);
  assert.equal(tireSlipIntensity({...input,brake:1},1,0,true),0);
  assert.ok(tireSlipIntensity({...input,brake:1},20,0,false)>.99);
  assert.equal(tireSlipIntensity({...input,throttle:-1},20,0,true)>0,true);
  assert.equal(tireSlipIntensity({...input,handbrake:true},20,0,false),0);
  assert.ok(tireSlipIntensity({...input,handbrake:true},20,0,true)>.99);
  assert.ok(tireSlipIntensity({...input,handbrake:true},20,0,false,true)>.99);
  assert.equal(tireSlipIntensity(input,3,5,true),1);
  assert.equal(tireSlipIntensity(input,0,5,true),1,'sideways spins also scuff the ground');
});

test('surface sampling respects survey pavement, sidewalk, path, lawn, water, holes and decks',()=>{
  const road={id:'street',name:'Street',width:6,oneway:0,points:[[-100,0],[100,0]]};
  const tile={tx:0,tz:0,size:1000,pavements:[{road:'street',walk:[1,1],edges:[-10000,-200,-10000,200,10000,-200,10000,200]}],sidewalks:[{rings:[square(10,3,3)]}],driveways:[[square(20,20,6)]],islands:[[square(30,30,3)]],parkPaths:[{id:'path',points:[[-100,-30],[100,-30]],width:3}]};
  const sample=createTireSurfaceSampler({...city,roads:[road]},()=>[tile]);
  assert.equal(sample(0,0,1),'pavement');
  assert.equal(sample(0,0,4),'grass','measured curb wins over guessed road width');
  assert.equal(sample(11,0,4),'pavement');
  assert.equal(sample(23,0,23),'pavement');
  assert.equal(sample(31,0,31),'pavement');
  assert.equal(sample(0,0,-30),'pavement');
  assert.equal(sample(0,0,20),'grass');
  assert.equal(sample(45,0,45),null);
  assert.equal(sample(75,0,75),'grass','a park polygon hole still exposes the grassy base terrain');
  assert.equal(sample(200,0,200),'grass','unmapped open terrain has the same grass material');
  assert.equal(sample(0,8,20),null,'raised objects cannot acquire grass marks');
  const deck={...road,id:'deck',points:[[-100,45],[100,45]],elevations:[8,8]};
  assert.equal(createTireSurfaceSampler({...city,roads:[deck]})(0,8,45),'pavement');
});

test('open terrain without any mapped parks receives torn-grass tracks',()=>{
  const openCity={...city,parks:[]},sample=createTireSurfaceSampler(openCity);
  assert.equal(sample(200,0,200),'grass');
  assert.equal(sample(45,0,45),null,'water remains excluded outside parks');
  assert.equal(sample(200,8,200),null,'raised contacts remain excluded outside parks');
  const scene=new THREE.Scene(),marks=createTireTracks(scene,openCity,sample);
  try{
    marks.update([contact(200,200)],0,0);
    marks.update([contact(201,200)],1/60,0);
    assert.equal(marks.stats().grass,1);
    assert.equal(marks.stats().pavement,0);
  }finally{marks.dispose();}
});

test('trails fade, stay bounded and break across lifts, teleports, resets and surface changes',()=>{
  const scene=new THREE.Scene(),marks=createTireTracks(scene,city,(x)=>x<5?'pavement':'grass',8);
  let time=0;
  const step=(contacts,revision=0)=>marks.update(contacts,time+=1/60,revision);
  step([contact(0)]);step([contact(1)]);assert.equal(marks.stats().pavement,1);
  step([]);step([contact(2)]);assert.equal(marks.stats().pavement,1,'airborne breaks the ribbon');
  step([contact(3)],1);assert.equal(marks.stats().pavement,1,'reset does not connect old tires');
  step([contact(20)],1);assert.equal(marks.stats().grass,0,'teleport does not streak across the map');
  step([contact(21)],1);assert.equal(marks.stats().grass,1);
  for(let i=0;i<50;i++)step([contact(21+(i+1)*.2)],1);
  assert.equal(marks.mesh.geometry.drawRange.count,8*6);
  assert.equal(marks.stats().grass,8);
  marks.update([],time+TRACK_LIFETIME.grass+1,1);
  assert.equal(marks.stats().grass,0);
  marks.dispose();assert.equal(scene.children.length,0);
});

test('real car and bike contacts produce marks on hard braking and none in the air',async()=>{
  for(const bike of [false,true]){
    const physics=await DrivingPhysics.create(city);
    try{
      if(bike)physics.setVehicleType('ultrabee');
      for(let i=0;i<180;i++)physics.step({...input,throttle:1},1/60);
      assert.ok(physics.getState().speed>6);
      assert.equal(physics.getTireContacts(input).filter(c=>c.intensity>.03).length,0);
      physics.step({...input,brake:1},1/60);
      const contacts=physics.getTireContacts({...input,brake:1});
      assert.equal(contacts.length,bike?2:4);
      assert.ok(contacts.every(c=>c.intensity>0&&Math.abs(c.y)<.01));
      physics.body.setTranslation({x:0,y:20,z:0},true);
      for(let i=0;i<2;i++)physics.step({...input,brake:1},1/60);
      assert.equal(physics.getTireContacts({...input,brake:1}).length,0);
    }finally{physics.dispose();}
  }
});
