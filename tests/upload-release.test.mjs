import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createUploadRelease} from '../src/render/upload-release.ts';
import {sceneAttributeBytes} from '../src/render/scene-memory.ts';

const upload=geometry=>{for(const a of [...Object.values(geometry.attributes),geometry.index])a?.onUploadCallback();};

test('a watched tile keeps its arrays until release, then frees what was uploaded and the rest on upload',()=>{
  const uploads=createUploadRelease(),group=new THREE.Group(),material=new THREE.MeshBasicMaterial();
  const drawn=new THREE.BoxGeometry(),later=new THREE.BoxGeometry();group.add(new THREE.Mesh(drawn,material));
  const bytes=g=>Object.values(g.attributes).reduce((n,a)=>n+a.array.byteLength,g.index.array.byteLength);
  const drawnBytes=bytes(drawn),laterBytes=bytes(later);
  uploads.watch(group);upload(drawn);
  // Later build stages sample the shells: nothing is freed while the tile builds.
  assert.ok(drawn.attributes.position.array);assert.equal(uploads.releasedBytes,0);
  group.add(new THREE.Mesh(later,material));uploads.release(group);
  assert.equal(drawn.attributes.position.array,null);assert.equal(drawn.index.array,null);assert.equal(uploads.releasedBytes,drawnBytes);
  assert.ok(later.attributes.position.array);assert.ok(later.boundingSphere,'culling bounds exist before the positions go');
  upload(later);assert.equal(later.attributes.normal.array,null);assert.equal(uploads.releasedBytes,drawnBytes+laterBytes);
  // Counts survive for draw ranges; the scene memory diagnostic skips released arrays.
  assert.equal(drawn.attributes.position.count,24);assert.equal(sceneAttributeBytes(group),0);
});

test('instanced meshes and dynamic attributes keep their arrays',()=>{
  const uploads=createUploadRelease(),group=new THREE.Group(),material=new THREE.MeshBasicMaterial();
  const instanced=new THREE.InstancedMesh(new THREE.BoxGeometry(),material,4),dynamic=new THREE.BoxGeometry();
  dynamic.attributes.position.setUsage(THREE.DynamicDrawUsage);group.add(instanced,new THREE.Mesh(dynamic,material));
  uploads.release(group);upload(instanced.geometry);upload(dynamic);instanced.instanceMatrix.onUploadCallback();
  assert.ok(instanced.geometry.attributes.position.array);assert.ok(instanced.instanceMatrix.array);
  assert.ok(dynamic.attributes.position.array);assert.equal(dynamic.attributes.normal.array,null);
});
