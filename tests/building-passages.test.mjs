import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {Cuboid} from '@dimforge/rapier3d-compat';
import {DrivingPhysics,carSteeringLimit} from '../src/physics/vehicle.ts';
import {meshBuildingIds} from '../src/simulation/building-collisions.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {tileCollisionIndices} from '../src/render/tile-geometry.ts';
import {loadMetroCity,windowCity,installExactMeshes} from './helpers/metro-city.mjs';

const BMC='BOS-HO11N-VJBYE-3RDXF',bounds={minX:-150,maxX:300,minZ:1600,maxZ:1950};
const metro=await loadMetroCity({bounds}),city=windowCity(metro,bounds);city.geometry=metro.geometry;
const roads=['15696-0-0','15699-0-0'].map(id=>{const road=city.roads.find(r=>r.id===id);assert.ok(road);return road;});
const released={throttle:0,brake:0,steer:0,handbrake:false};

function route(road,lateral=0,step=2){
  const out=[];
  for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),n=Math.ceil(length/step),yaw=Math.atan2(dx,dz);
    for(let j=0;j<n;j++)out.push({x:a[0]+dx*j/n+dz/length*lateral,z:a[1]+dz*j/n-dx/length*lateral,yaw});
    if(i===road.points.length-1)out.push({x:b[0]+dz/length*lateral,z:b[1]-dx/length*lateral,yaw});
  }
  return out;
}

test('BMC source walls and footings leave both Mass Ave carriageways open up to bus height',async()=>{
  const data=city.geometry.get(BMC);assert.ok(data);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));geometry.setIndex(new THREE.BufferAttribute(tileCollisionIndices(data),1));
  const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),shell=new THREE.Mesh(geometry,material),scene=new THREE.Group();scene.add(shell);
  const physics=await DrivingPhysics.create(city,{meshBuildingIds});
  try{
    assert.ok(installExactMeshes(physics,city,scene).has(BMC));scene.updateMatrixWorld(true);physics.world.step();
    const ray=new THREE.Raycaster(),bus=new Cuboid(1.25,1.95,5.5);
    for(const road of roads)for(const lateral of [-3,0,3]){
      const points=route(road,lateral,1);
      for(let i=1;i<points.length;i++){
        const a=points[i-1],b=points[i];
        for(const height of [.75,2,4]){
          const start=new THREE.Vector3(a.x,sampleElevation(city,a.x,a.z)+height,a.z),end=new THREE.Vector3(b.x,sampleElevation(city,b.x,b.z)+height,b.z),direction=end.sub(start),distance=direction.length();
          ray.set(start,direction.normalize());ray.far=distance;
          assert.equal(ray.intersectObjects(scene.children,false).length,0,`${road.id} visible wall crosses lane ${lateral} at ${a.x.toFixed(2)},${a.z.toFixed(2)}, height ${height}`);
        }
        const hits=[];
        physics.world.intersectionsWithShape({x:a.x,y:sampleElevation(city,a.x,a.z)+2.1,z:a.z},{x:0,y:Math.sin(a.yaw/2),z:0,w:Math.cos(a.yaw/2)},bus,c=>{if(physics.detailedColliders.has(c.handle))hits.push(c.handle);return true;});
        assert.equal(hits.length,0,`${road.id} bus clearance blocked in lane ${lateral} at ${a.x.toFixed(2)},${a.z.toFixed(2)}`);
      }
    }
    // The correction opens the ground floor, while retaining the overhead floors.
    ray.set(new THREE.Vector3(50,1,1755),new THREE.Vector3(0,1,0));ray.far=40;
    assert.ok(ray.intersectObject(shell,false).length>0,'the building remains above the street');
  }finally{physics.dispose();scene.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});material.dispose();}
});

for(const road of roads)test(`drive the entire BMC passage on ${road.id} without resetting past either facade`,async()=>{
  const points=route(road),start=points[0],end=points.at(-1),physics=await DrivingPhysics.create(city,{meshBuildingIds});
  try{
    installExactMeshes(physics,city);physics.reset(start.x,start.z,start.yaw);
    for(let i=0;i<60;i++)physics.step({...released,brake:1},1/60);
    let cursor=1,lastProgress=0;
    for(let frame=0;frame<45*60;frame++){
      const state=physics.getState(),previous=cursor;
      while(cursor<points.length-1&&Math.hypot(points[cursor].x-state.x,points[cursor].z-state.z)<4)cursor++;
      if(cursor>previous)lastProgress=frame;
      assert.ok(frame-lastProgress<360,`${road.id} blocked at ${state.x.toFixed(2)},${state.z.toFixed(2)}`);
      assert.ok(Math.abs(state.y-sampleElevation(city,state.x,state.z)-.67)<.6,'the car stays at street level');
      if(cursor===points.length-1&&Math.hypot(end.x-state.x,end.z-state.z)<4){assert.ok(state.speed>5);return;}
      const target=points[Math.min(points.length-1,cursor+3)],dx=target.x-state.x,dz=target.z-state.z;
      const angle=Math.atan2(Math.sin(Math.atan2(dx,dz)-state.yaw),Math.cos(Math.atan2(dx,dz)-state.yaw));
      const steer=Math.atan2(2*2.66*Math.sin(angle),Math.hypot(dx,dz))/carSteeringLimit(state.speed);
      physics.step({...released,throttle:state.speed<8?.4:0,brake:state.speed>9?.15:0,steer},1/60);
    }
    assert.fail(`${road.id} did not clear both facades`);
  }finally{physics.dispose();}
});
