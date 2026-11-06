import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {loadMetroCity} from './helpers/metro-city.mjs';
import {tileShellGeometry} from '../src/render/tile-geometry.ts';

test('BU Data Sciences Center cantilevers render solid from below with front-face culling',async()=>{
  const city=await loadMetroCity({tiles:['-3_0']});
  const building=city.buildings.find(b=>b.id==='BOS-6NQ8D-T9UI7-21PWA');
  const data=city.geometry.get(building.id),geometry=tileShellGeometry(data,building,true);
  const material=new THREE.MeshBasicMaterial({side:THREE.FrontSide}),shell=new THREE.Mesh(geometry,material);
  shell.updateMatrixWorld();
  const p=geometry.attributes.position,n=geometry.attributes.normal,heights=new Set(),ray=new THREE.Raycaster();let faces=0;
  for(let i=0;i<p.count;i+=3){
    if(n.getY(i)>-.99)continue;
    const center=new THREE.Vector3();
    for(let j=0;j<3;j++)center.add(new THREE.Vector3().fromBufferAttribute(p,i+j));
    center.divideScalar(3);heights.add(center.y.toFixed(2));faces++;
    ray.set(center.clone().add(new THREE.Vector3(0,-.1,0)),new THREE.Vector3(0,1,0));
    assert.ok(Math.abs(ray.intersectObject(shell)[0]?.distance-.1)<.001,`underside at ${center.toArray()} must be visible from below`);
    ray.set(center.clone().add(new THREE.Vector3(0,150,0)),new THREE.Vector3(0,-1,0));
    assert.ok(ray.intersectObject(shell).some(hit=>hit.point.y>center.y+.1),'the original roof above each overhang remains visible from above');
  }
  assert.equal(faces,44);assert.equal(heights.size,9);
  geometry.computeBoundingBox();assert.ok(Math.abs(geometry.boundingBox.max.y-93.205)<.01);
  geometry.dispose();material.dispose();
});
