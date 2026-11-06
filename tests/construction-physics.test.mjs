import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {createConstruction,constructionCones} from '../src/simulation/construction.ts';
import {constructionPoint} from '../src/simulation/construction-zones.ts';

const released={throttle:0,brake:0,steer:0,handbrake:false};
const fixture=(vehicleKind='dump-truck',pavedWidth=7)=>{
  const road={id:'construction-road',name:'Work Avenue',width:14,pavedWidth,oneway:1,points:[[0,-400],[0,400]]};
  const zone={id:'construction-test',roadId:road.id,road,x:0,z:0,yaw:0,direction:1,laneOffset:pavedWidth/2-1.7,openOffset:pavedWidth/2-5.1,length:60,workLength:24,taperLength:18,pavedWidth,seed:1,vehicleKind};
  const city={bounds:{minX:-500,maxX:500,minZ:-500,maxZ:500},spawn:{x:-zone.openOffset,z:-90,yaw:0},roads:[road],buildings:[],signals:[],landmarks:[]};
  return{city,zone};
};
const coneBodies=(physics,construction)=>[...new Set([...construction.colliders].map(handle=>physics.world.getCollider(handle).parent()))].filter(body=>body.isDynamic());

test('both equipment models stop a player with actual Rapier collision contacts',async()=>{
  for(const kind of ['dump-truck','excavator']){
    const {city,zone}=fixture(kind),physics=await DrivingPhysics.create(city),scene=new THREE.Scene(),construction=createConstruction(scene,city,physics,[zone]);
    try{
      construction.update(city.spawn);
      const [x,z]=constructionPoint(zone,25,zone.laneOffset);physics.reset(x,z,Math.PI);
      const contacts=[];let nearest=Infinity;
      for(let step=0;step<360;step++){
        physics.step({...released,throttle:contacts.length?0:1},1/60);
        contacts.push(...physics.takeImpacts().filter(impact=>impact.colliders.some(handle=>construction.equipmentColliders.has(handle))));
        nearest=Math.min(nearest,Math.abs(physics.getState().z));
      }
      assert.ok(contacts.length,`${kind} reports an equipment contact`);
      assert.ok(contacts.some(impact=>impact.severity>3),`${kind} resists the car instead of allowing it through`);
      assert.ok(nearest>2,`${kind} keeps the player outside its chassis (${nearest.toFixed(2)}m)`);
      for(const handle of construction.equipmentColliders)assert.ok(!physics.world.getCollider(handle).parent().isDynamic());
    }finally{construction.dispose();physics.dispose();}
  }
});

test('the narrowest eligible open lane passes every player car and the motorcycle without impacts',async()=>{
  for(const kind of ['dump-truck','excavator'])for(const vehicle of ['harbor-s4','mclaren-gt','mclaren-720s','supra-mk4','ultrabee']){
    const {city,zone}=fixture(kind),physics=await DrivingPhysics.create(city),construction=createConstruction(new THREE.Scene(),city,physics,[zone]);
    try{
      if(vehicle==='ultrabee')physics.setVehicleType(vehicle);else physics.setCar(vehicle);
      construction.update(physics.getState());
      const impacts=[];
      for(let step=0;step<600&&physics.getState().z<50;step++){
        physics.step({...released,throttle:1},1/60);
        impacts.push(...physics.takeImpacts().filter(impact=>impact.colliders.some(handle=>construction.colliders.has(handle))));
      }
      const state=physics.getState();assert.ok(state.z>45,`${vehicle} passes ${kind} in the 7m carriageway (${state.z.toFixed(2)}m)`);
      assert.equal(impacts.length,0,`${vehicle} clears every cone and equipment proxy`);
      assert.ok(Math.abs(state.x-city.spawn.x)<.12,'the passing lane remains straight');
    }finally{construction.dispose();physics.dispose();}
  }
});

test('a player strike knocks a lightweight cone out of position',async()=>{
  const {city,zone}=fixture(),physics=await DrivingPhysics.create(city),construction=createConstruction(new THREE.Scene(),city,physics,[zone]);
  try{
    construction.update(city.spawn);
    const cones=coneBodies(physics,construction),leading=cones.reduce((a,b)=>a.translation().z<b.translation().z?a:b),before={...leading.translation()};
    assert.equal(cones.length,constructionCones(zone).length);assert.ok(Math.abs(leading.mass()-4)<.01,'a weighted cone weighs 4kg');
    physics.reset(before.x,before.z-15,0);
    let moved=0;
    for(let step=0;step<240&&moved<.6;step++){
      physics.step({...released,throttle:1},1/60);construction.update(physics.getState());
      const p=leading.translation();moved=Math.hypot(p.x-before.x,p.z-before.z);
    }
    assert.ok(moved>.5,`the cone moves after contact (${moved.toFixed(2)}m)`);
    assert.ok(leading.isDynamic(),'the cone remains a simulated body');
  }finally{construction.dispose();physics.dispose();}
});

test('streaming and support loss release every site body and instance buffer while shared models are reused',async()=>{
  const {city,zone}=fixture(),physics=await DrivingPhysics.create(city),scene=new THREE.Scene();let supported=true,coneTileMissing=false;
  const baseline={bodies:physics.world.bodies.len(),colliders:physics.world.colliders.len(),detailed:physics.detailedColliders.size};
  const construction=createConstruction(scene,city,physics,[zone],{hasGround:x=>supported&&(!coneTileMissing||x<50)});
  const geometryDisposals=new Map(),materialDisposals=new Map();let instanceDisposals=0;
  try{
    construction.update(city.spawn);
    const geometries=new Set(),materials=new Set();construction.group.traverse(object=>{
      if(object instanceof THREE.Mesh){geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);}
      if(object instanceof THREE.InstancedMesh)object.addEventListener('dispose',()=>instanceDisposals++);
    });
    for(const geometry of geometries)geometry.addEventListener('dispose',()=>geometryDisposals.set(geometry,(geometryDisposals.get(geometry)??0)+1));
    for(const material of materials)material.addEventListener('dispose',()=>materialDisposals.set(material,(materialDisposals.get(material)??0)+1));
    const initial=construction.colliders.size;assert.ok(initial>40);assert.equal(construction.snapshot().active,1);
    assert.equal(construction.group.children[0].children.filter(object=>object instanceof THREE.InstancedMesh).length,4,'cones share four surface batches rather than one draw per cone');
    construction.update({x:2000,z:2000});
    assert.equal(construction.snapshot().active,0);assert.equal(construction.group.children.length,0);assert.equal(construction.colliders.size,0);assert.equal(construction.equipmentColliders.size,0);
    assert.deepEqual({bodies:physics.world.bodies.len(),colliders:physics.world.colliders.len(),detailed:physics.detailedColliders.size},baseline);
    assert.equal(instanceDisposals,4);assert.equal(geometryDisposals.size,0,'unloading preserves the shared immutable model buffers');
    construction.update(city.spawn);assert.equal(construction.colliders.size,initial);
    const cone=coneBodies(physics,construction)[0];cone.setTranslation({x:100,y:.025,z:0},true);
    // Keep the site's road supported while the kicked cone's new tile is absent.
    coneTileMissing=true;construction.update(city.spawn);assert.equal(cone.isEnabled(),false);assert.equal(construction.snapshot().active,1);
    coneTileMissing=false;construction.update(city.spawn);assert.equal(cone.isEnabled(),true,'a supported kicked cone may resume simulation');
    supported=false;construction.update(city.spawn);
    assert.equal(construction.snapshot().active,0,'missing site ground removes the site before dynamic cones can fall');
    assert.deepEqual({bodies:physics.world.bodies.len(),colliders:physics.world.colliders.len(),detailed:physics.detailedColliders.size},baseline);
    supported=true;construction.update(city.spawn);assert.equal(construction.colliders.size,initial);
    construction.dispose();assert.equal(scene.getObjectByName('RoadConstruction'),undefined);
    assert.ok([...geometryDisposals.values()].every(count=>count===1));assert.equal(geometryDisposals.size,geometries.size);
    assert.ok([...materialDisposals.values()].every(count=>count===1));assert.equal(materialDisposals.size,materials.size);
  }finally{if(scene.getObjectByName('RoadConstruction'))construction.dispose();physics.dispose();}
});

test('a saved arrival in a planned closed lane defers activation until the player clears it',async()=>{
  const {city,zone}=fixture(),physics=await DrivingPhysics.create(city),construction=createConstruction(new THREE.Scene(),city,physics,[zone]);
  try{
    const [x,z]=constructionPoint(zone,0);construction.update({x,z});assert.equal(construction.snapshot().active,0,'equipment does not appear inside the player');
    const [openX,openZ]=constructionPoint(zone,0,zone.openOffset);construction.update({x:openX,z:openZ});assert.equal(construction.snapshot().active,1,'an arrival in the open lane activates the site');
  }finally{construction.dispose();physics.dispose();}
});
