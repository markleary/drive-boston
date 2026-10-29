import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {sceneAttributeBytes} from '../src/render/scene-memory.ts';
test('scene memory counts shared backing arrays once and includes instance capacity',()=>{
  const scene=new THREE.Scene(),material=new THREE.MeshBasicMaterial(),geometry=new THREE.BoxGeometry();
  const bytes=Object.values(geometry.attributes).reduce((n,a)=>n+a.array.byteLength,geometry.index.array.byteLength);
  scene.add(new THREE.Mesh(geometry,material),new THREE.Mesh(geometry,material));
  assert.equal(sceneAttributeBytes(scene),bytes);
  const instances=new THREE.InstancedMesh(geometry,material,100);instances.count=1;instances.setColorAt(0,new THREE.Color('red'));scene.add(instances);
  assert.equal(sceneAttributeBytes(scene),bytes+100*(16+3)*4);
  scene.remove(instances);assert.equal(sceneAttributeBytes(scene),bytes);assert.equal(scene.children.length,2);
});
test('interleaved geometry reports retained backing storage without double counting views',()=>{
  const scene=new THREE.Scene(),geometry=new THREE.BufferGeometry();
  const data=new THREE.InterleavedBuffer(new Float32Array(60),6);
  geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(data,3,0));geometry.setAttribute('normal',new THREE.InterleavedBufferAttribute(data,3,3));
  scene.add(new THREE.Mesh(geometry));assert.equal(sceneAttributeBytes(scene),240);
});
