import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {WebGLObjects} from 'three/src/renderers/webgl/WebGLObjects.js';
import {disposeTileResources} from '../src/render/tile-resources.ts';

test('unloading tile instances releases Three renderer attributes and bindings, including colors',()=>{
  const allocated=new Set(),bindings=new Set();
  const objects=WebGLObjects({ARRAY_BUFFER:34962},{get:(_object,g)=>g,update(){}},
    {update:a=>allocated.add(a),remove:a=>allocated.delete(a)},
    {releaseStatesOfObject:o=>bindings.delete(o)},{render:{frame:1}});
  const scene=new THREE.Scene(),tile=new THREE.Group(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial();
  scene.add(tile);let geometryDisposals=0,materialDisposals=0;
  geometry.addEventListener('dispose',()=>geometryDisposals++);material.addEventListener('dispose',()=>materialDisposals++);
  for(let i=0;i<3;i++){
    const mesh=new THREE.InstancedMesh(geometry,material,10);mesh.setColorAt(0,new THREE.Color('red'));
    tile.add(mesh);objects.update(mesh);bindings.add(mesh);
  }
  assert.equal(allocated.size,6);
  disposeTileResources(tile);
  assert.equal(allocated.size,0,'base geometry disposal alone cannot free instanceMatrix/instanceColor');
  assert.equal(bindings.size,0);assert.equal(geometryDisposals,1,'shared lamp geometry disposed once');
  assert.equal(materialDisposals,0,'shared city materials must survive neighboring tile unloads');
  assert.equal(scene.children.length,0);assert.equal(tile.children.length,0);
});

test('partial tile cleanup releases owned sign maps and batch textures without disposing shared materials',()=>{
  const group=new THREE.Group(),map=new THREE.Texture(),shared=new THREE.MeshStandardMaterial(),owned=new THREE.MeshStandardMaterial({map,emissiveMap:map});
  let maps=0,materials=0,batchMaps=0;
  map.addEventListener('dispose',()=>maps++);owned.addEventListener('dispose',()=>materials++);
  const shape=new THREE.BoxGeometry(),batch=new THREE.BatchedMesh(1,shape.attributes.position.count,shape.index.count,shared);
  batch.addInstance(batch.addGeometry(shape));group.add(batch,new THREE.Mesh(new THREE.PlaneGeometry(),owned));
  batch._matricesTexture.addEventListener('dispose',()=>batchMaps++);
  const ownership=[owned,owned];disposeTileResources(group,ownership);
  assert.equal(maps,1);assert.equal(materials,1);assert.equal(batchMaps,1);assert.equal(ownership.length,0);
  disposeTileResources(group,ownership);assert.equal(maps,1,'abandoned ownership must not retain resources');
});
