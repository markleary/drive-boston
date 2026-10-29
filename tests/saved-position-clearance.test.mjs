import assert from 'node:assert/strict';
import test from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import {DrivingPhysics,VEHICLE} from '../src/physics/vehicle.ts';
import {ULTRA_BEE} from '../src/physics/bike.ts';
import {sampleDriveSurface} from '../src/simulation/road-surfaces.ts';

const released={throttle:0,brake:0,steer:0,handbrake:false};
const flatCity=()=>({bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100},roads:[],buildings:[],spawn:{x:-20,z:-20,yaw:0}});

test('saved arrival checks newly installed source triangles before a physics step and leaves the recovery position untouched',async()=>{
  const physics=await DrivingPhysics.create(flatCity());
  try{
    physics.reset(-20,-20,.3);
    const before=physics.getState(),translation={...physics.body.translation()},velocity={...physics.body.linvel()};
    physics.addStaticMesh(new Float32Array([-4,0,10,4,0,10,4,4,10,-4,4,10]),new Uint32Array([0,1,2,0,2,3]));
    assert.equal(physics.canResetAt(0,10,0),false,'new streamed wall must be visible without broad-phase refresh');
    assert.equal(physics.canResetAt(0,0,0),true);
    assert.deepEqual({...physics.body.translation()},translation);assert.deepEqual({...physics.body.linvel()},velocity);
    assert.deepEqual(physics.getState().rotation,before.rotation,'preflight cannot rotate the real chassis');
    physics.body.setTranslation({x:30,y:-20,z:30},true);physics.step(released,1/60);
    const recovered=physics.getState();
    assert.ok(Math.hypot(recovered.x+20,recovered.z+20)<.001,'failed or successful preflight cannot replace the crash recovery target');
  }finally{physics.dispose();}
});

test('saved arrival uses the requested yaw and retains clearance beneath an overhead deck',async()=>{
  const physics=await DrivingPhysics.create(flatCity());
  try{
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(.02,2,4).setTranslation(1.5,2,0));
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(5,1,5).setTranslation(0,6,0));
    assert.equal(physics.canResetAt(0,0,0),true,'narrow side of the car fits beside the wall and below the deck');
    assert.equal(physics.canResetAt(0,0,Math.PI/2),false,'the same saved center with its nose through the wall must be rejected');
  }finally{physics.dispose();}
});

for(const vehicle of ['car','ultrabee'])test(`saved ${vehicle} pose includes the chassis local offset on a slope`,async()=>{
  const city=flatCity();city.elevation={width:5,height:5,cellSize:4,originX:-8,originZ:-8,heights:Float32Array.from({length:25},(_,i)=>(i%5-2)*2)};
  const physics=await DrivingPhysics.create(city,{streaming:true});
  try{
    physics.setVehicleType(vehicle);
    assert.equal(physics.canResetAt(0,0,.4),true);
    const surface=sampleDriveSurface(city,0,0),n=surface.normal,halfHeight=vehicle==='car'?.23:.24;
    const bodyY=surface.height+(vehicle==='car'?VEHICLE.spawnHeight:ULTRA_BEE.spawnHeight)/Math.max(.5,n.y);
    // This tiny obstruction is inside the correctly positioned lower chassis
    // face, but below a shape placed at the body's center without its -.06 offset.
    const d=-.06-halfHeight+.005;
    physics.world.createCollider(RAPIER.ColliderDesc.ball(.003).setTranslation(n.x*d,bodyY+n.y*d,n.z*d));
    assert.equal(physics.canResetAt(0,0,.4),false,'the probe must use the same sloped collider transform as reset()');
  }finally{physics.dispose();}
});

test('saved bridge roadId selects the upper support instead of an obstruction on the street below',async()=>{
  const city=flatCity();city.roads=[{id:'upper',name:'Overpass',points:[[0,-20],[0,20]],width:8,oneway:0,elevations:[6,6],bridge:{id:'upper',thickness:.5,clearanceEstimated:true}}];
  const physics=await DrivingPhysics.create(city);
  try{
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(2,1,2).setTranslation(0,1,0));
    assert.equal(physics.canResetAt(0,0,0),false);
    assert.equal(physics.canResetAt(0,0,0,'upper'),true,'a saved bridge position must stay on its explicit deck');
  }finally{physics.dispose();}
});

test('saved-position preflight ignores self, sensors and moving traffic but includes ordinary fixed colliders',async()=>{
  const physics=await DrivingPhysics.create(flatCity());
  try{
    physics.reset(0,0,0);
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(3,3,3).setTranslation(0,1,0).setSensor(true));
    for(const desc of [RAPIER.RigidBodyDesc.kinematicPositionBased(),RAPIER.RigidBodyDesc.dynamic()]){
      const body=physics.world.createRigidBody(desc.setTranslation(0,1,0));
      physics.world.createCollider(RAPIER.ColliderDesc.cuboid(3,3,3),body);
    }
    assert.equal(physics.canResetAt(0,0,0),true,'transient actors must not invalidate stored positions');
    const fixed=physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0,1,0));
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(3,3,3),fixed);
    assert.equal(physics.canResetAt(0,0,0),false,'ordinary fixed geometry must be tested alongside detailed meshes');
  }finally{physics.dispose();}
});

test('saved bike clearance uses the current narrow chassis rather than car dimensions',async()=>{
  const physics=await DrivingPhysics.create(flatCity());
  try{
    for(const x of [-.5,.5])physics.world.createCollider(RAPIER.ColliderDesc.cuboid(.1,2,4).setTranslation(x,2,0));
    assert.equal(physics.canResetAt(0,0,0),false);
    physics.setVehicleType('ultrabee');
    assert.equal(physics.canResetAt(0,0,0),true);
  }finally{physics.dispose();}
});
