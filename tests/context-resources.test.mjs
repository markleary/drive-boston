import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {releaseSceneContext,registerContextTexture} from '../src/render/context-resources.ts';

test('context release preserves scene geometry, batch instances and all texture sources for re-upload',()=>{
  const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(),map=new THREE.Texture(),interior=new THREE.Texture();
  const material=new THREE.MeshStandardMaterial({map});registerContextTexture(material,interior);
  const batch=new THREE.BatchedMesh(2,geometry.attributes.position.count,geometry.index.count,material);
  batch.addInstance(batch.addGeometry(geometry));scene.add(batch);
  const instances=new THREE.InstancedMesh(geometry,material,2);scene.add(instances);
  const data=batch._matricesTexture,matrix=instances.instanceMatrix.array,vertices=geometry.attributes.position.array;
  let events=0,textureEvents=0;
  for(const o of [batch,instances,geometry,material])o.addEventListener('dispose',()=>events++);
  for(const texture of [map,interior,data])texture.addEventListener('dispose',()=>textureEvents++);
  releaseSceneContext(scene);
  assert.equal(events,4);assert.equal(textureEvents,3);
  assert.equal(scene.children.length,2);assert.equal(batch.instanceCount,1);
  assert.equal(batch._matricesTexture,data,'BatchedMesh.dispose would destroy this source');
  assert.equal(instances.instanceMatrix.array,matrix);assert.equal(geometry.attributes.position.array,vertices);
  const transform=new THREE.Matrix4();batch.getMatrixAt(0,transform);assert.ok(transform.equals(new THREE.Matrix4()));
  releaseSceneContext(scene);assert.equal(batch._matricesTexture,data,'repeated context loss must retain the source');
});
