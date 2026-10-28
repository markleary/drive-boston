import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {TriangleWriter} from '../src/render/geometry-writer.ts';
import {IndexedSurfaceWriter,SurfaceBatches} from '../src/render/indexed-surfaces.ts';
import {drapedRibbonInto} from '../src/render/terrain-ground.ts';

const bytes=g=>Object.values(g.attributes).reduce((n,a)=>n+a.array.byteLength,0)+(g.index?.array.byteLength??0);
test('indexed mobile roads preserve every triangle, normal and UV on flat and curved slopes',()=>{
  for(const points of [[[0,0],[100,0]],[[0,0],[21,4],[34,28],[65,40]]])for(const surface of [()=>0,(x,z)=>Math.sin(x/18)+Math.cos(z/11)]){
    const original=new TriangleWriter(),compact=new IndexedSurfaceWriter();
    drapedRibbonInto(original,{},points,12,.045,surface);drapedRibbonInto(compact,{},points,12,.045,surface);
    const reference=original.geometry(),indexed=compact.geometry(),expanded=indexed.toNonIndexed();
    for(const name of ['position','normal','uv'])assert.deepEqual(expanded.attributes[name].array,reference.attributes[name].array);
    assert.ok(bytes(indexed)<bytes(reference)*.6,`${bytes(indexed)} vs ${bytes(reference)}`);
  }
});
test('shared-vertex batches keep material, normal and UV seams distinct across ribbons',()=>{
  const batches=new SurfaceBatches(500),material=new THREE.MeshBasicMaterial(),other=new THREE.MeshBasicMaterial();
  const writer=batches.at(material,0,0);
  for(const offset of [0,.1]){drapedRibbonInto(writer,{},[[0,0],[12,0]],4,offset,()=>0);writer.clearLookup();}
  drapedRibbonInto(batches.at(other,0,0),{},[[0,0],[12,0]],4,0,()=>0);
  const meshes=batches.meshes();assert.equal(meshes.length,2);assert.ok(meshes.every(m=>m.geometry.index));
  assert.ok(meshes[0].geometry.attributes.position.array.some((v,i)=>i%3===1&&Math.abs(v-.1)<1e-6));
  assert.equal(batches.meshes().length,0,'writers and their lookup buffers are released after mesh assembly');
});
