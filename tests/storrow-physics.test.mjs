import assert from 'node:assert/strict';
import test from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {PLAYER_CARS,MOVING_TRUCK} from '../src/simulation/player-cars.ts';
import {roadProjection,roadWidthAt} from '../src/simulation/road-surfaces.ts';
const city={bounds:{minX:-3000,maxX:3000,minZ:-3000,maxZ:3000},buildings:[],roads:[],spawn:{x:0,z:0,yaw:0}};
const idle={throttle:0,brake:0,steer:0,handbrake:false};
const step=(p,frames,input=idle)=>{for(let i=0;i<frames;i++)p.step(input,1/60);return p.getState();};
const beam=(p,clearance=3.2004)=>p.world.createCollider(RAPIER.ColliderDesc.cuboid(15,.5,4).setTranslation(0,clearance+.5,30));
for(const reverse of [false,true])for(const speed of [2,18,29])test(`moving truck box catches low bridge ${reverse?'backwards':'forwards'} at ${speed} m/s and R repairs beyond it`,async()=>{
  const p=await DrivingPhysics.create(city);
  try{
    p.setCar('moving-truck');beam(p);p.reset(0,reverse?60:0,0);step(p,90);
    p.body.setLinvel({x:0,y:0,z:reverse?-speed:speed},true);
    let events=[];
    for(let i=0;i<1500&&!p.getState().storrowed;i++){p.step({...idle,throttle:reverse?-1:1},1/60);events.push(...p.takeStorrowStrikes());}
    assert.equal(events.length,1);assert.equal(events[0].direction,reverse?-1:1);
    let s=step(p,90,{...idle,throttle:reverse?-1:1});assert.ok(s.storrowed);assert.ok(s.storrowDamage>=.35);assert.ok(Math.abs(s.speed)<.05);
    const stuck={x:s.x,z:s.z};s=step(p,120,{...idle,throttle:reverse?1:-1});assert.ok(Math.hypot(s.x-stuck.x,s.z-stuck.z)<.05,'wedged box cannot back itself out');assert.equal(p.takeStorrowStrikes().length,0);
    p.resetToRoad();s=p.getState();assert.equal(s.storrowed,false);assert.equal(s.storrowDamage,0);assert.equal(s.speed,0);
    assert.ok(reverse?s.z<26-PLAYER_CARS['moving-truck'].halfLength:s.z>34+PLAYER_CARS['moving-truck'].halfLength,`repair must clear entire truck on far side: z=${s.z}`);
    assert.ok(p.canResetAt(s.x,s.z,s.yaw));assert.ok(!p.canResetAt(0,30,0),'saved arrival checks cargo height');
    step(p,60);assert.equal(p.takeStorrowStrikes().length,0);
  }finally{p.dispose();}
});
test('cars pass the same beam; full-height walls do not report a bridge strike',async()=>{
  for(const truck of [false,true]){
    const p=await DrivingPhysics.create(city);
    try{
      if(truck){p.setCar('moving-truck');p.world.createCollider(RAPIER.ColliderDesc.cuboid(15,5,4).setTranslation(0,5,30));}else beam(p);
      step(p,90);step(p,600,{...idle,throttle:1});
      assert.equal(p.getState().storrowed,false);assert.equal(p.takeStorrowStrikes().length,0);
      if(!truck)assert.ok(p.getState().z>40);else assert.ok(p.getState().z<28);
    }finally{p.dispose();}
  }
});
test('loaded truck suspension, drivetrain, braking and collider lifecycle',async t=>{
  const p=await DrivingPhysics.create(city),base=p.world.colliders.len();
  try{
    p.setCar('moving-truck');let s=step(p,180);assert.equal(p.body.mass(),8200);assert.equal(p.world.colliders.len(),base+2);
    assert.ok(s.y+MOVING_TRUCK.cargo.center.y+MOVING_TRUCK.cargo.halfExtents.y>11*.3048);assert.ok(s.suspension.every(x=>x>.15&&x<.4));
    s=step(p,300,{...idle,throttle:1});assert.ok(s.speed>5&&s.speed<10,`loaded acceleration ${s.speed}`);
    p.body.setLinvel({x:0,y:0,z:20},true);const from=p.getState().z;for(let i=0;i<600&&p.getState().speed>.1;i++)p.step({...idle,brake:1},1/60);
    const distance=p.getState().z-from;assert.ok(distance>30&&distance<70,`loaded braking from 45 mph: ${distance}m`);t.diagnostic(`45 mph stopping distance: ${distance.toFixed(1)} m`);
    for(let i=0;i<4;i++){p.setVehicleType('ultrabee');assert.equal(p.world.colliders.len(),base);p.setVehicleType('car');assert.equal(p.world.colliders.len(),base+2);p.setCar('harbor-s4');assert.equal(p.world.colliders.len(),base);p.setCar('moving-truck');assert.equal(p.world.colliders.len(),base+2);}
  }finally{p.dispose();}
});

test('truck repair skips occupied far-side positions and switching from a bike respects cargo clearance',async()=>{
  const roads=[{id:'lower',name:'Storrow Drive',points:[[0,-100],[0,180]],width:12,oneway:1},{id:'upper',name:'Test Overpass',points:[[-20,30],[20,30]],width:8,oneway:0,elevations:[3.7,3.7],bridge:{id:'test',thickness:.5,clearanceEstimated:true}}];
  const p=await DrivingPhysics.create({...city,roads});
  try{
    p.setCar('moving-truck');step(p,90);for(let i=0;i<900&&!p.getState().storrowed;i++)p.step({...idle,throttle:1},1/60);assert.ok(p.getState().storrowed);
    const queued=p.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0,.7,49.8));p.world.createCollider(RAPIER.ColliderDesc.cuboid(1,.6,2.5),queued);p.resetToRoad();const after=p.getState();
    assert.equal(after.storrowed,false);assert.ok(after.z>56,`repair clears queued car: ${after.z}`);assert.ok(p.canResetAt(after.x,after.z,after.yaw,undefined,true));
    p.setVehicleType('ultrabee');p.reset(0,30,0,'lower');p.setVehicleType('car');assert.ok(p.canResetAt(p.getState().x,p.getState().z,p.getState().yaw),'truck cannot appear inside bridge after bike switch');
  }finally{p.dispose();}
});

for(const reverse of [false,true])test(`uncatalogued curved portal repairs on the connected road ${reverse?'in reverse':'forwards'}, past the complete solid`,async()=>{
  const points=[[0,-100],[0,36],[35,71],[100,90]].map(([x,z])=>reverse?[-x,60-z]:[x,z]);
  const road={id:'local-portal',name:'Local Road',points,width:7,oneway:0};
  const p=await DrivingPhysics.create({...city,roads:[road]});
  try{
    p.setCar('moving-truck');
    // A long portal covers the bend itself. Its far extent cannot be measured
    // by sending the entrance yaw straight ahead past the roadway.
    const roof=p.world.createCollider(RAPIER.ColliderDesc.cuboid(20,.5,18).setTranslation(0,3.7004,reverse?16:44));
    p.reset(0,reverse?60:0,0);step(p,90);
    for(let i=0;i<1500&&!p.getState().storrowed;i++)p.step({...idle,throttle:reverse?-1:1},1/60);
    assert.ok(p.getState().storrowed);step(p,30);
    if(!reverse){
      const stuck=p.getState();
      // All far-side candidates are temporarily occupied. R must keep the
      // wreck in place, rather than falling back to a nearby road or grass.
      const blocker=p.world.createCollider(RAPIER.ColliderDesc.cuboid(80,3,45).setTranslation(40,3,82));
      p.resetToRoad();const held=p.getState();assert.ok(held.storrowed);assert.equal(held.storrowDamage,stuck.storrowDamage);
      assert.ok(Math.hypot(held.x-stuck.x,held.z-stuck.z)<.001);
      p.world.removeCollider(blocker,true);
    }
    p.resetToRoad();const s=p.getState();assert.equal(s.storrowed,false);
    assert.ok(reverse?s.x<-30:s.x>30,`repair follows the bend past the solid: (${s.x}, ${s.z})`);
    const fx=Math.sin(s.yaw),fz=Math.cos(s.yaw),spec=PLAYER_CARS['moving-truck'];
    for(const along of [-spec.halfLength,0,spec.halfLength])for(const across of [-spec.halfWidth,0,spec.halfWidth]){
      const x=s.x+fx*along+fz*across,z=s.z+fz*along-fx*across;
      assert.ok(roadProjection(road,x,z).distance<roadWidthAt(road,x,z)/2-.1,'the whole box remains on the connected pavement');
    }
    assert.ok(fx>.6&&fz>0,'the nose follows the road, retaining its facing while reversing');
    const projectionShape=new RAPIER.Cuboid(spec.halfWidth,1000,spec.halfLength);
    assert.equal(roof.intersectsShape(projectionShape,{x:s.x,y:s.y,z:s.z},{x:0,y:Math.sin(s.yaw/2),z:0,w:Math.cos(s.yaw/2)}),false,'the complete footprint is beyond the struck roof');
    assert.ok(p.canResetAt(s.x,s.z,s.yaw,road.id,true));
  }finally{p.dispose();}
});

test('an uncatalogued portal with no pavement beyond it keeps the truck wedged instead of using an off-road rescue pose',async()=>{
  const road={id:'short-road',name:'Local Road',points:[[0,-100],[0,36]],width:7,oneway:0};
  const p=await DrivingPhysics.create({...city,roads:[road]});
  try{
    p.setCar('moving-truck');beam(p);step(p,90);
    for(let i=0;i<900&&!p.getState().storrowed;i++)p.step({...idle,throttle:1},1/60);
    assert.ok(p.getState().storrowed);const stuck=step(p,30);
    p.resetToRoad();const after=p.getState();assert.ok(after.storrowed);
    assert.equal(after.storrowDamage,stuck.storrowDamage);assert.ok(Math.hypot(after.x-stuck.x,after.z-stuck.z)<.001);
  }finally{p.dispose();}
});
