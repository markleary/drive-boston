import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGraphics} from '../src/render/graphics.ts';
import {createFarCity} from '../src/render/far-city.ts';

// Exercise the real mobile graphics path without a DOM or WebGL context: any
// accidental composer/GTAO/bloom construction would require the missing context.
test('touch rendering stays direct when quality and viewport change',()=>{
  const saved=Object.fromEntries(['innerWidth','innerHeight'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  Object.assign(globalThis,{innerWidth:393,innerHeight:852});
  try{
    const calls=[],scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
    const leafMaterial=new THREE.MeshBasicMaterial({alphaToCoverage:true});scene.add(new THREE.Mesh(new THREE.BoxGeometry(),leafMaterial));
    const renderer={setPixelRatio:r=>calls.push(['ratio',r]),setSize:(w,h)=>calls.push(['size',w,h]),render:(s,c)=>calls.push(['render',s===scene,c===camera])};
    const graphics=createGraphics(renderer,scene,camera,'balanced',true);
    assert.equal(leafMaterial.alphaToCoverage,false);
    graphics.render(0);graphics.setQuality('high');
    Object.assign(globalThis,{innerWidth:852,innerHeight:393});graphics.resize();graphics.render(.016);graphics.dispose();
    assert.equal(graphics.quality,'high');
    assert.ok(calls.filter(c=>c[0]==='ratio').every(c=>c[1]===1));
    assert.deepEqual(calls.at(-2),['size',852,393]);
    assert.deepEqual(calls.at(-1),['render',true,true]);
  }finally{for(const [k,descriptor] of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,k,descriptor);else delete globalThis[k];}}
});

function city(){
  const keys=['0_0','1_0','8_0'],tiles=new Map(keys.map(key=>{
    const [tx,tz]=key.split('_').map(Number),x=tx*1000;
    return [key,{key,tx,tz,buildings:[{height:10,base:0,hidden:false,style:0,footprint:[[x,0],[x+10,0],[x+10,10],[x,10]]}]}];
  }));
  return {elevation:{width:10,height:2,cellSize:1000,originX:0,originZ:0,heights:new Float32Array(20)},tiles:{keys,size:1000},far:{tiles},bounds:{minX:0,maxX:9000,minZ:0,maxZ:1000}};
}

test('mobile skyline releases old geometry and rebuilds after travel or detailed-tile eviction',()=>{
  const view=createFarCity(new THREE.Scene(),city(),true);
  assert.equal(view.stats().geometryBytes,0);
  view.update(new THREE.Vector3(500,0,500),0);
  view.update(new THREE.Vector3(500,0,500),0);
  assert.equal(view.buildingCount,2);
  let disposed=0;for(const mesh of view.group.children)mesh.geometry.addEventListener('dispose',()=>disposed++);
  view.update(new THREE.Vector3(8500,0,500),0);
  assert.equal(disposed,4);assert.equal(view.buildingCount,1);assert.equal(view.stats().residentChunks,1);
  view.setChunkDetailed('8_0',true);assert.equal(view.stats().geometryBytes,0);
  view.update(new THREE.Vector3(8500,0,500),0);assert.equal(view.stats().geometryBytes,0);
  view.setChunkDetailed('8_0',false);view.update(new THREE.Vector3(8500,0,500),0);
  assert.equal(view.buildingCount,1);assert.ok(view.stats().geometryBytes>0);
});

test('desktop skyline retains every chunk and hides detailed tiles without freeing their geometry',()=>{
  const view=createFarCity(new THREE.Scene(),city());
  assert.equal(view.buildingCount,3);const bytes=view.stats().geometryBytes;
  view.update(new THREE.Vector3(500,0,500),0);view.setChunkDetailed('0_0',true);
  assert.equal(view.stats().geometryBytes,bytes);
  assert.equal(view.group.getObjectByName('Distant blocks 0_0').visible,false);
  view.setChunkDetailed('0_0',false);assert.equal(view.group.getObjectByName('Distant blocks 0_0').visible,true);
});
