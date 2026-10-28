import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createTransitBus} from '../src/render/transit-vehicles.ts';

function withBus(check){
  const bus=createTransitBus('39 FOREST HILLS');bus.updateMatrixWorld(true);
  try{check(bus);}finally{bus.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();o.material.map?.dispose();o.material.dispose();}});}
}

test('polished bus fits the transit body envelope and grounds its tires',()=>withBus(bus=>{
  const bounds=new THREE.Box3().setFromObject(bus);
  assert.ok(bounds.min.y>=-.002&&bounds.min.y<.01,'tires must meet the road');
  assert.ok(bounds.max.y<3.55&&bounds.min.z>=-6&&bounds.max.z<6.1,'body and folded rack stay within the existing vehicle envelope');
  assert.ok(bounds.min.x>-1.65&&bounds.max.x<1.65,'only mirrors extend outside the body width');
  assert.ok(bus.children.length<=12,'small details must share material batches');
  for(const mesh of bus.children){
    for(const value of mesh.geometry.getAttribute('position').array)assert.ok(Number.isFinite(value));
  }
}));

test('both wheel arches leave the upper tire visible rather than embedding it in the body',()=>withBus(bus=>{
  for(const side of [-1,1])for(const z of [-3.64,3.64]){
    const ray=new THREE.Raycaster(new THREE.Vector3(side*3,.88,z),new THREE.Vector3(-side,0,0));
    const hits=ray.intersectObject(bus,true);
    assert.equal(hits[0]?.object.name,'rubber',`wheel at side ${side}, z ${z} must be outside the skirt`);
  }
}));

test('bowed windshield remains in front of the painted shell across the full viewing area',()=>withBus(bus=>{
  for(const x of [-.98,-.8,-.22,.22,.8,.98])for(const y of [1.62,1.86,2.12,2.50]){
    const hits=new THREE.Raycaster(new THREE.Vector3(x,y,8),new THREE.Vector3(0,0,-1)).intersectObject(bus,true);
    assert.ok(['windscreen','dark','rubber'].includes(hits[0]?.object.name),`front shell must not poke through the windshield at ${x}, ${y}`);
  }
}));
