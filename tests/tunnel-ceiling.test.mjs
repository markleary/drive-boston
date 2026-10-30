import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createTunnelCeilingMaterial,tiledTunnelCeiling} from '../src/render/tunnel-ceiling.ts';

test('ceiling panels include visible recessed joints and reusable repeating color/relief maps',()=>{
  const material=createTunnelCeilingMaterial(),map=material.map,bump=material.bumpMap;
  try{
    assert.ok(map?.isDataTexture&&bump?.isDataTexture);assert.equal(material.emissiveMap,map,'underground fill preserves the panel pattern');
    assert.equal(map.colorSpace,THREE.SRGBColorSpace);assert.equal(bump.colorSpace,THREE.NoColorSpace);
    assert.equal(map.wrapS,THREE.RepeatWrapping);assert.equal(map.wrapT,THREE.RepeatWrapping);
    const value=(x,y)=>map.image.data[(y*map.image.width+x)*4],height=(x,y)=>bump.image.data[y*bump.image.width+x];
    assert.ok(value(32,64)>value(0,64)+40,'panel interiors remain visibly lighter than the grout');
    assert.ok(value(32,64)>value(64,64)+40,'regular tile joints repeat across the ceiling');
    assert.ok(value(32,64)>value(32,128)+40,'rectangular panels have transverse joints too');
    assert.ok(height(32,64)>height(0,64)+100,'joint relief is recessed rather than merely painted');
    assert.ok(material.bumpScale>0&&material.bumpScale<.03,'relief stays subtle at vehicle scale');
  }finally{map.dispose();bump.dispose();material.dispose();}
});

test('ceiling UVs retain the collision mesh and physical tile scale on banked sloping roads',()=>{
  const road={id:'banked',name:'Banked tunnel',width:8,points:[[0,0],[0,20]],elevations:[-12,-10],deckEdgeElevations:[[-11.6,-12.4],[-9.6,-10.4]],oneway:1};
  const mesh={vertices:new Float32Array([4,-6.4,0,-4,-7.2,0,4,-4.4,20,-4,-5.2,20]),indices:new Uint32Array([0,2,1,1,2,3])};
  const geometry=tiledTunnelCeiling(mesh,road);
  try{
    assert.equal(geometry.attributes.position.array,mesh.vertices);assert.equal(geometry.index.array,mesh.indices,'roof holes and collision winding are untouched');
    const uv=geometry.attributes.uv;assert.ok([...uv.array].every(Number.isFinite));
    assert.ok(Math.abs((uv.getX(0)-uv.getX(1))*4.8-Math.hypot(8,.8))<1e-5,'tile scale follows banked transverse distance');
    assert.ok(Math.abs((uv.getY(2)-uv.getY(0))*4.8-Math.hypot(20,2))<1e-5,'tile scale follows the sloping road distance');
  }finally{geometry.dispose();}
});
