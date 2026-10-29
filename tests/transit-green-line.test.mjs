import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createGreenLine} from '../src/render/transit-vehicles.ts';

const meshes=group=>{const result=[];group.traverse(o=>{if(o instanceof THREE.Mesh)result.push(o);});return result;};

test('one Green Line car has three sections, two articulations and a grounded transit envelope',()=>{
  const tram=createGreenLine('B BOSTON COLLEGE');tram.group.updateMatrixWorld(true);
  assert.equal(tram.sections.length,3);assert.equal(tram.bellows.length,2);
  assert.equal(tram.length,22.5);assert.deepEqual(tram.sections.map(s=>s.position.z),tram.offsets);
  const bounds=new THREE.Box3().setFromObject(tram.group);
  assert.ok(Math.abs(bounds.min.y)<.001,'steel wheels touch the rails');
  assert.ok(bounds.min.x>-1.56&&bounds.max.x<1.56,'only mirror trim extends outside the car width');
  assert.ok(bounds.min.z>-11.6&&bounds.max.z<11.6,'coupler trim stays inside the existing train clearance envelope');
  assert.ok(Math.abs(bounds.max.y+.11-5.73)<.001,'pantograph plus rail datum meets the overhead wire height');
  const pieces=meshes(tram.group);
  assert.ok(pieces.length<=30,'small fittings must be merged into material batches');
  assert.ok(pieces.reduce((sum,m)=>sum+m.geometry.getAttribute('position').count/3,0)<35000,'trim tessellation stays bounded');
  for(const m of pieces)for(const value of m.geometry.getAttribute('position').array)assert.ok(Number.isFinite(value));
});

test('cab glazing and passenger windows stay outside the painted skin at both ends',()=>{
  const tram=createGreenLine('C CLEVELAND CIRCLE');tram.group.updateMatrixWorld(true);
  for(const end of [-1,1]){
    for(const x of [-.98,-.80,-.22,.22,.80,.98])for(const y of [1.50,1.70,2.0,2.3,2.5]){
      const hits=new THREE.Raycaster(new THREE.Vector3(x,y,end*15),new THREE.Vector3(0,0,-end)).intersectObject(tram.group,true);
      assert.ok(['windscreen','rubber','dark','metal'].includes(hits[0]?.object.name),`cab skin must not cover the windshield at ${end}, ${x}, ${y}`);
    }
    for(const side of [-1,1])for(const z of [-2.85,.15,1.40,2.58])for(const y of [1.70,2.10,2.40]){
      const hits=new THREE.Raycaster(new THREE.Vector3(side*3,y,end*(7.35+z)),new THREE.Vector3(-side,0,0)).intersectObject(tram.group,true);
      assert.equal(hits[0]?.object.name,'glass',`passenger glazing must remain visible at ${end}, ${side}, ${z}, ${y}`);
    }
  }
});

test('opposite cab lights show white forward and red behind',()=>{
  const tram=createGreenLine('D RIVERSIDE');tram.group.updateMatrixWorld(true);
  for(const end of [-1,1]){
    const hit=new THREE.Raycaster(new THREE.Vector3(.96,.79,end*15),new THREE.Vector3(0,0,-end)).intersectObject(tram.group,true)[0];
    assert.equal(hit?.object.name,'head');
    const color=hit.object.material.color;
    assert.ok(end===1?color.g>.5:color.r>color.g*4,'front and rear must remain distinguishable');
  }
});

test('all branches share car geometry and materials while articulating independently',()=>{
  const first=createGreenLine('E HEATH STREET'),second=createGreenLine('D RIVERSIDE');
  const a=meshes(first.group),b=meshes(second.group);assert.equal(a.length,b.length);
  for(let i=0;i<a.length;i++){
    assert.notEqual(a[i],b[i]);assert.equal(a[i].geometry,b[i].geometry,'fleet geometry is shared');assert.equal(a[i].material,b[i].material,'fleet materials are shared');
  }
  // Both cab ends are copies of the same mesh resources, with their own transforms.
  const front=meshes(first.sections[0]),rear=meshes(first.sections[2]);
  for(let i=0;i<front.length;i++)assert.equal(front[i].geometry,rear[i].geometry);
  first.sections[0].position.x=8;first.bellows[0].rotation.y=.12;
  assert.equal(second.sections[0].position.x,0);assert.equal(second.bellows[0].rotation.y,0);
  assert.equal(first.sections[2].position.x,0);
});
