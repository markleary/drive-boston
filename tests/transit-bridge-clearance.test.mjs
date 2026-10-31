import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {Ray} from '@dimforge/rapier3d-compat';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {addRoadStructures} from '../src/render/bridges.ts';
import {bridgeBarriers} from '../src/simulation/road-surfaces.ts';
import {reserveTransitCorridors,shareTransitCorridors} from '../src/simulation/transit-corridors.ts';
import {loadMetroCity} from './helpers/metro-city.mjs';

const route={kind:'tram',line:'Green-B',points:[[0,-30],[0,30]]};
/** A 6 m deck across a railway at `rail` height: the ground is a ridge under the
 * rail line only (a 5 m tent on the 5 m grid), so the deck edges beside it stand
 * off the ground and keep their parapets wherever the rail does not open them. */
function fixture(rail=6){
  const road={id:'crossing',name:'Crossing',width:10,points:[[-20,0],[20,0]],elevations:[6,6]};
  const heights=Array.from({length:21*21},(_,k)=>k%21===10?rail:0);
  return{bounds:{minX:-50,maxX:50,minZ:-50,maxZ:50},roads:[road],buildings:[],spawn:{x:20,z:20,yaw:0},
    elevation:{width:21,height:21,cellSize:5,originX:-50,originZ:-50,heights}};
}

test('a same-level railway opens the same narrow bridge-barrier gap in rendering and physics',async()=>{
  const city=fixture();reserveTransitCorridors(city,[route]);
  const physics=await DrivingPhysics.create(city),scene=new THREE.Scene(),structures=addRoadStructures(scene,city);scene.updateMatrixWorld(true);
  try{
    for(const x of [-1.5,0,1.5,5]){
      const renderHit=new THREE.Raycaster(new THREE.Vector3(x,6.4,-15),new THREE.Vector3(0,0,1),0,30).intersectObject(structures,true)[0];
      const physicsHit=physics.world.castRay(new Ray({x,y:6.4,z:-15},{x:0,y:0,z:1}),30,true,undefined,undefined,physics.chassisCollider,physics.body);
      assert.equal(!!renderHit,x===5,`rendered barrier at x=${x} must respect only the rail opening`);
      assert.equal(!!physicsHit,x===5,`physical barrier at x=${x} must match the visible opening`);
      if(renderHit)assert.ok(Math.abs(renderHit.distance-physicsHit.timeOfImpact)<.01);
    }
  }finally{physics.dispose();structures.traverse(o=>{if(o.isMesh)o.geometry.dispose();});}
});

test('upper-road parapets stay intact above a lower or covered railway and tile views share clearance',()=>{
  for(const rail of [0,6]){
    const city=fixture(rail),road=city.roads[0],original=bridgeBarriers(city,road);assert.ok(original.length>=2,'the deck has parapets to keep');
    reserveTransitCorridors(city,[{...route,...(rail===6?{covered:[{start:20,end:40}]}:{})}]);
    assert.deepEqual(bridgeBarriers(city,road),original,'an underpass cannot cut the upper-road edge');
  }
  const city=fixture(),tile={...city};reserveTransitCorridors(city,[route]);shareTransitCorridors(tile,city);
  assert.deepEqual(bridgeBarriers(tile,tile.roads[0]),bridgeBarriers(city,city.roads[0]));
});

test('shipped B bridge openings change only the two Essex Street edges crossing the rail median',async()=>{
  const city=await loadMetroCity({tiles:[]}),roads=city.roads.filter(r=>r.elevations),before=new Map(roads.map(r=>[r.id,bridgeBarriers(city,r)]));
  reserveTransitCorridors(city,JSON.parse(readFileSync(new URL('../public/data/transit.json',import.meta.url),'utf8')).routes);
  const changed=[];let removed=0;
  for(const road of roads){
    const prior=before.get(road.id),current=bridgeBarriers(city,road);
    if(JSON.stringify(prior)===JSON.stringify(current))continue;
    changed.push(road.id);assert.equal(road.name,'Essex Street');
    removed+=prior.reduce((sum,p)=>sum+p.length,0)-current.reduce((sum,p)=>sum+p.length,0);
  }
  assert.deepEqual(changed.sort(),['25555-0-0','25559-0-0']);
  assert.ok(removed>13&&removed<15,'only the two-track clearance across each transverse edge is removed');
});
