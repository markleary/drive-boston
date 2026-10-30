import './helpers/npc-fleet.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createStreetLife} from '../src/render/street-life.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';

import {loadCentralCity} from './helpers/metro-city.mjs';
const city=await loadCentralCity();
const routeDistance=(person)=>{
  const {start,end}=person.route,dx=end[0]-start[0],dz=end[1]-start[1];
  const t=((person.position.x-start[0])*dx+(person.position.z-start[1])*dz)/(dx*dx+dz*dz);
  return {t,distance:Math.hypot(person.position.x-start[0]-dx*t,person.position.z-start[1]-dz*t)};
};

test('pedestrians follow a distant neighborhood without teleporting nearby actors or leaving their sidewalk grade',()=>{
  const scene=new THREE.Scene(),life=createStreetLife(scene,city);
  try{
    const landmark=city.landmarks.find(place=>place.id==='mission-hill');assert.ok(landmark);
    const observer={x:landmark.position[0],z:landmark.position[1]};
    const distance=p=>Math.hypot(p.x-observer.x,p.z-observer.z);
    const count=life.count;assert.equal(count,112,'the city-wide population must stay bounded');
    const initialLocal=life.pedestrians.filter(p=>distance(p.position)<350).length;
    let previous=life.pedestrians.map(p=>p.position.clone()),jumps=0;
    const matrix=new THREE.Matrix4(),vertex=new THREE.Vector3(),soles=scene.getObjectByName('Shoe soles');assert.ok(soles?.isInstancedMesh);
    const soleVertices=soles.geometry.attributes.position;
    for(let step=1;step<=100;step++){
      life.update(.31,step*.31,observer);
      assert.equal(life.pedestrians.length,count);
      for(const [index,person] of life.pedestrians.entries()){
        if(previous[index].distanceTo(person.position)>50){
          jumps++;assert.ok(distance(previous[index])>600,'walkers already in view must never be relocated');
          assert.ok(distance(person.position)>100,'replacement walkers must appear beyond the nearby street scene');
        }
        const route=routeDistance(person);
        assert.ok(route.distance<1e-6&&route.t>=-1e-6&&route.t<=1+1e-6,'each actor must stay on its clearance-checked sidewalk segment');
        assert.ok(Math.abs(person.position.y-sampleElevation(city,person.position.x,person.position.z)-.035)<1e-5,'relocation and animation must retain the local terrain datum');
        let lowestSole=Infinity;
        for(let side=0;side<2;side++){
          soles.getMatrixAt(index*2+side,matrix);assert.ok(matrix.elements.every(Number.isFinite));
          for(let j=0;j<soleVertices.count;j++)lowestSole=Math.min(lowestSole,vertex.fromBufferAttribute(soleVertices,j).applyMatrix4(matrix).y);
        }
        assert.ok(Math.abs(lowestSole-person.position.y)<.002,'at least one stance foot must remain at the actor ground plane through each gait phase');
      }
      previous=life.pedestrians.map(p=>p.position.clone());
    }
    assert.ok(jumps>0&&life.relocations===jumps,'a long trip should relocate the existing pool');
    assert.ok(life.pedestrians.filter(p=>distance(p.position)<350).length>=initialLocal+8,'Mission Hill should acquire a visible local population');
  }finally{life.dispose();}
});

test('busy neighborhoods receive a dense nearby crowd while residential destinations stay calmer',()=>{
  const life=createStreetLife(new THREE.Scene(),city);
  try{
    const spawn=life.population(city.spawn);
    assert.equal(spawn.level,'busy');
    assert.ok(spawn.local>=60&&spawn.nearby>=20,'Back Bay must feel populated immediately, including the visible block');
    const downtown=city.landmarks.find(place=>place.id==='downtown-crossing').driveStart;
    const before=life.pedestrians.map(person=>person.position.clone());
    life.populateAt(downtown,downtown);
    const center=life.population(downtown);
    assert.equal(center.level,'busy');assert.ok(center.local>=60&&center.nearby>=20,'a map teleport must show Downtown crowds without a long refill delay');
    for(const [index,person]of life.pedestrians.entries()){
      if(Math.hypot(before[index].x-downtown.x,before[index].z-downtown.z)<=600)assert.ok(person.position.distanceTo(before[index])<1e-6,'already-nearby walkers must remain in place');
      if(person.position.distanceTo(before[index])>50)assert.ok(Math.hypot(person.position.x-downtown.x,person.position.z-downtown.z)>=30,'teleport arrivals must leave the player breathing room');
    }
    for(let i=0;i<life.pedestrians.length;i++)for(let j=i+1;j<life.pedestrians.length;j++){
      assert.ok(life.pedestrians[i].position.distanceTo(life.pedestrians[j].position)>=2.49,'crowds must retain spawn spacing');
    }
    const mission=city.landmarks.find(place=>place.id==='mission-hill').driveStart;
    life.populateAt(mission,mission);
    const residential=life.population(mission);
    assert.equal(residential.level,'residential');assert.ok(residential.local>=20&&residential.local<=30,'residential streets should retain a smaller crowd');
    assert.ok(center.local>residential.local*2);assert.equal(life.count,spawn.total,'neighborhood changes must reuse the bounded pool');
  }finally{life.dispose();}
});

test('a nearby moving player car pauses a walker, then the same route resumes',()=>{
  const scene=new THREE.Scene(),life=createStreetLife(scene,city);
  try{
    const person=life.pedestrians[0],start=person.position.clone(),route=person.route;
    assert.ok(person,'fixture must provide a walker');
    const player={x:start.x,z:start.z,speed:2};
    for(let i=1;i<=60;i++)life.update(1/60,i/60,undefined,player);
    assert.ok(person.position.distanceTo(start)<1e-6,'the walker must stop rather than stride through the nearby moving car');
    for(let i=61;i<=120;i++)life.update(1/60,i/60);
    assert.equal(person.route,route);assert.ok(person.position.distanceTo(start)>.5,'walking must resume once the car has passed');
  }finally{life.dispose();}
});
