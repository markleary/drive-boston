import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import {batchStaticDetails,splitStaticGeometry,staticDetailBatchSteps} from '../src/render/static-batches.ts';

const triangles=g=>{
  const p=g.attributes.position,attributes=Object.keys(g.attributes).sort();
  return Array.from({length:p.count/3},(_,t)=>JSON.stringify(attributes.map(name=>{
    const a=g.attributes[name];return Array.from(a.array.slice(t*3*a.itemSize,(t+1)*3*a.itemSize));
  })));
};
test('spatial splitting retains every triangle and all material attributes exactly',()=>{
  const geometry=new THREE.BoxGeometry(2,3,4).toNonIndexed(),parts=[];
  for(let i=0;i<12;i++)parts.push(geometry.clone().translate(i*128,0,i%2*256));
  // Concatenate triangles with explicit attributes, including normalized bytes.
  const combined=new THREE.BufferGeometry();
  for(const name of Object.keys(geometry.attributes))combined.setAttribute(name,new THREE.BufferAttribute(Float32Array.from(parts.flatMap(g=>[...g.attributes[name].array])),geometry.attributes[name].itemSize));
  combined.setAttribute('color',new THREE.BufferAttribute(Uint8Array.from({length:combined.attributes.position.count*3},(_,i)=>i%256),3,true));
  const chunks=splitStaticGeometry(combined);
  assert.ok(chunks.length>4);assert.deepEqual(chunks.flatMap(triangles).sort(),triangles(combined).sort());
  for(const chunk of chunks){assert.equal(chunk.attributes.color.normalized,true);assert.ok(chunk.attributes.color.array instanceof Uint8Array);assert.ok(chunk.boundingSphere.radius<5);}
});

test('static batching preserves relative transforms, materials, shadow flags and per-object culling',()=>{
  const root=new THREE.Group();root.position.set(200,3,-100);
  const parent=new THREE.Group();parent.position.set(9,2,7);parent.rotation.y=.3;root.add(parent);
  const material=new THREE.MeshStandardMaterial({color:'red'}),sources=[];
  for(let i=0;i<3;i++){const geometry=new THREE.BoxGeometry(1,2,3);geometry.clearGroups();const mesh=new THREE.Mesh(geometry,material);mesh.position.set(i*20,0,0);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);sources.push(mesh);}
  root.updateWorldMatrix(true,true);const inverse=root.matrixWorld.clone().invert();const expected=sources.map(m=>inverse.clone().multiply(m.matrixWorld));
  const stats=batchStaticDetails(root);assert.equal(stats.sources,3);assert.equal(stats.batches,1);
  const batch=root.children.find(m=>m instanceof THREE.BatchedMesh);assert.ok(batch);assert.equal(batch.material,material);assert.equal(batch.castShadow,true);assert.equal(batch.receiveShadow,true);assert.equal(batch.perObjectFrustumCulled,true);
  for(let i=0;i<3;i++){const actual=new THREE.Matrix4();batch.getMatrixAt(i,actual);actual.elements.forEach((v,j)=>assert.ok(Math.abs(v-expected[i].elements[j])<1e-5));}
  assert.equal(root.matrixAutoUpdate,false);assert.equal(parent.children.length,0);
});

test('survey shells and transparent, hidden or independently controlled meshes stay separate',()=>{
  const root=new THREE.Group(),material=new THREE.MeshStandardMaterial(),transparent=new THREE.MeshStandardMaterial({transparent:true});
  const shells=[];for(let i=0;i<3;i++){
    const shell=new THREE.Mesh(new THREE.BoxGeometry(),material);shell.name='Boston surveyed buildings';root.add(shell);shells.push(shell);
    const glass=new THREE.Mesh(new THREE.BoxGeometry(),transparent);root.add(glass);
    const hidden=new THREE.Mesh(new THREE.BoxGeometry(),material);hidden.visible=false;root.add(hidden);
  }
  assert.deepEqual(batchStaticDetails(root),{sources:0,batches:0});assert.equal(root.children.length,9);
  shells[0].visible=false;assert.equal(shells[0].visible,false);
});

test('paced batching keeps a visible replacement for every source at each yield',()=>{
  const root=new THREE.Group(),material=new THREE.MeshStandardMaterial(),pace={deadline:-Infinity};
  for(let i=0;i<9;i++){const geometry=new THREE.BoxGeometry();geometry.clearGroups();const mesh=new THREE.Mesh(geometry,material);mesh.position.x=i*5;root.add(mesh);}
  const steps=staticDetailBatchSteps(root,pace);let result=steps.next(),yields=0;
  while(!result.done){
    let instances=0;root.traverse(o=>{if(o instanceof THREE.BatchedMesh)instances+=o.instanceCount;else if(o instanceof THREE.Mesh)instances++;});
    assert.equal(instances,9);yields++;result=steps.next();
  }
  assert.ok(yields>9);assert.equal(result.value.sources,9);
});
