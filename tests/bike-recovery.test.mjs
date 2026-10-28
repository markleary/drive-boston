import assert from 'node:assert/strict';
import test from 'node:test';
import {Quaternion,Vector3} from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {closestRoad} from '../src/simulation/roads.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {loadCentralCity} from './helpers/metro-city.mjs';
const released={throttle:0,brake:0,steer:0,handbrake:false};
const road=(id,z,oneway=0)=>({id,name:id,width:10,oneway,points:[[-400,z],[400,z]]});
const flat={bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000},buildings:[],roads:[road('Start',-200),road('Crash road',200,-1)],spawn:{x:-200,z:-200,yaw:Math.PI/2}};
function advance(p,seconds,input={}){for(let i=0;i<Math.round(seconds*60);i++)p.step({...released,...input},1/60);return p.getState();}
const upY=s=>1-2*(s.rotation.x*s.rotation.x+s.rotation.z*s.rotation.z);
function layOnSide(p,{x,y,z},yaw=0,roll=Math.PI/2){
  const q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),yaw).multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),roll));
  p.body.setTranslation({x,y,z},true);p.body.setRotation(q,true);p.body.setLinvel({x:0,y:0,z:0},true);p.body.setAngvel({x:0,y:0,z:0},true);
}
async function create(city=flat,kind='ultrabee'){const p=await DrivingPhysics.create(city);p.setVehicleType(kind);advance(p,1);return p;}

test('a bike lying on its side recovers on the nearest road to the crash, faces one-way traffic and can drive away',async()=>{
  const p=await create();try{
    layOnSide(p,{x:110,y:.25,z:208});const down=advance(p,2);
    assert.ok(upY(down)<.2,'the fallen bike must stay down until the recovery delay expires');
    assert.ok(down.z>205,'it has not reset early');
    const recovered=advance(p,1.5);
    assert.ok(Math.abs(recovered.x-110)<.2&&Math.abs(recovered.z-200)<.2,'recover locally, hundreds of meters from spawn');
    assert.ok(upY(recovered)>.98&&Math.abs(recovered.speed)<.1,'reset upright and without crash momentum');
    assert.ok(Math.abs(recovered.yaw+Math.PI/2)<.02,'align with reverse one-way direction');
    assert.equal(recovered.wheelieRemaining,0);assert.ok([0,1].every(i=>p.controller.wheelIsInContact(i)));
    const moving=advance(p,1,{throttle:1});assert.ok(moving.x<recovered.x-2&&moving.speed>4,'resume the ride on the recovered road');
    p.reset(flat.spawn.x,flat.spawn.z,flat.spawn.yaw);const reset=p.getState();assert.ok(Math.abs(reset.x-flat.spawn.x)<.001&&Math.abs(reset.z-flat.spawn.z)<.001,'explicit reset still accepts the starting point');
  }finally{p.dispose();}
});

test('bike crash recovery selects the correct level at a bridge/underpass crossing',async()=>{
  const bridge={...road('Upper deck',0),elevations:[8,8]},lower=road('Underpass',0),city={...flat,roads:[bridge,lower,...flat.roads]};
  // Put the upper road first: an XY-only nearest-road query would choose it even below the deck.
  for(const height of [0,8]){const p=await create(city);try{
    layOnSide(p,{x:35,y:height+.25,z:1});const recovered=advance(p,4);
    assert.ok(Math.abs(recovered.x-35)<.2&&Math.abs(recovered.z)<.2,'recover onto the local carriageway');
    assert.ok(Math.abs(recovered.y-height-.577)<.15,`recover at the ${height===0?'underpass':'bridge'} height, not the crossing road`);
    assert.ok(upY(recovered)>.98&&[0,1].every(i=>p.controller.wheelIsInContact(i)));
  }finally{p.dispose();}}
});

test('a blocked road projection is skipped rather than recovering inside a collision body',async()=>{
  const city={...flat,roads:[road('Blocked',200),road('Clear',210),...flat.roads]},p=await create(city);
  try{
    // A parked-car proxy occupies the closest projected point.
    p.world.createCollider(RAPIER.ColliderDesc.cuboid(2,.8,2).setTranslation(110,.8,200));p.world.step();
    layOnSide(p,{x:110,y:.25,z:204});const recovered=advance(p,4);
    assert.ok(Math.abs(recovered.z-210)<.2&&Math.abs(recovered.x-110)<.2,'use the nearest clear road');
    assert.ok(upY(recovered)>.98&&Math.abs(recovered.speed)<.1);
  }finally{p.dispose();}
});

test('bike recovery falls back safely without a local road, and car recovery retains its existing saved position',async()=>{
  for(const [kind,city]of [['ultrabee',{...flat,roads:[]}],['ultrabee',{...flat,roads:[road('Remote',-500)]}],['car',flat]]){
    const p=await create(city,kind);try{
      layOnSide(p,{x:110,y:.5,z:208},0,kind==='car'?Math.PI:Math.PI/2);const recovered=advance(p,4);
      assert.ok(Math.abs(recovered.x-city.spawn.x)<.2&&Math.abs(recovered.z-city.spawn.z)<.2,`${kind} uses the last reset when local recovery does not apply`);
      assert.ok(upY(recovered)>.98);
    }finally{p.dispose();}
  }
});

test('actual Mission Hill crash recovery retains the surveyed hill elevation near the crash',async()=>{
  const city=await loadCentralCity(),start=city.landmarks.find(l=>l.id==='mission-hill').driveStart,p=await create(city);
  try{
    const near=closestRoad(city,start.x,start.z),x=near.x,z=near.z,y=sampleElevation(city,x,z);
    layOnSide(p,{x,y:y+.25,z},near.yaw);const recovered=advance(p,4);
    assert.ok(Math.hypot(recovered.x-x,recovered.z-z)<3,'stay at Mission Hill rather than returning to Boylston');
    assert.ok(Math.abs(recovered.y-sampleElevation(city,recovered.x,recovered.z)-.577)<.2,'stay grounded on the measured grade');
    assert.ok(upY(recovered)>.9);
  }finally{p.dispose();}
});

test('nearest-road constraints preserve horizontal lookups while considering height, clearance, and a bounded search',()=>{
  const upper={...road('Upper',0),elevations:[9,9]},lower=road('Lower',2),city={...flat,roads:[upper,lower]};
  assert.equal(closestRoad(city,0,0).road.id,'Upper');
  assert.equal(closestRoad(city,0,0,false,{height:.2}).road.id,'Lower');
  assert.equal(closestRoad(city,0,0,false,{height:9.2}).road.id,'Upper');
  assert.equal(closestRoad(city,0,0,false,{accept:p=>p.road.id!=='Upper'}).road.id,'Lower');
  assert.equal(closestRoad(city,0,500,false,{maxDistance:200}).distance,Infinity);
  const edge={...flat,roads:[
    {...road('Close but high',0),points:[[121,-100],[121,100]],elevations:[30,30]},
    {...road('Ground in next cell',0),points:[[129,-100],[129,100]]},
  ]};
  assert.equal(closestRoad(edge,120,0,false,{height:.2}).road.id,'Ground in next cell','height-aware lookup must search past the nearest horizontal cell');
});
