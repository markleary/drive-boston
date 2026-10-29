import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {updateSunShadow} from '../src/render/shadows.ts';
import {createTreeField,updateFoliage} from '../src/render/foliage.ts';

test('flight shadows contain ground and tall casters throughout the visible district in both sun directions',()=>{
  const sun=new THREE.DirectionalLight(),position=new THREE.Vector3(2400,350,-1700),groundY=40;
  sun.shadow.camera.near=1;
  for(const direction of [new THREE.Vector3(-270,255,330),new THREE.Vector3(-200,570,-240)]){
    updateSunShadow(sun,position,groundY,direction,true);
    sun.updateMatrixWorld();sun.target.updateMatrixWorld();sun.shadow.updateMatrices(sun);
    for(const [radius,height] of [[1000,0],[900,-40],[900,300]])for(let i=0;i<72;i++){
      const angle=i*Math.PI/36,point=new THREE.Vector3(position.x+Math.cos(angle)*radius,groundY+height,position.z+Math.sin(angle)*radius);
      assert.ok(sun.shadow.getFrustum().containsPoint(point),`shadow camera clips ${point.toArray()} with sun ${direction.toArray()}`);
      const uv=point.applyMatrix4(sun.shadow.matrix);
      assert.ok(uv.x>0&&uv.x<1&&uv.y>0&&uv.y<1&&uv.z>0&&uv.z<1,'receiver and caster must both fit the shadow texture and depth interval');
    }
    assert.ok(sun.position.clone().sub(sun.target.position).normalize().distanceTo(direction.clone().normalize())<1e-12,'coverage must preserve the lighting direction');
  }
});

test('leaving detailed flight restores the compact shadow camera and its depth range',()=>{
  const sun=new THREE.DirectionalLight(),direction=new THREE.Vector3(-270,255,330),position=new THREE.Vector3(100,180,200);
  updateSunShadow(sun,position,10,direction,true);
  updateSunShadow(sun,position,10,direction,false);
  assert.equal(sun.shadow.camera.right,105+170*.72);
  assert.equal(sun.shadow.camera.far,1100);
  assert.deepEqual(sun.position.toArray(),[-170,265,530]);
  position.y=11;updateSunShadow(sun,position,10,direction,false);
  assert.equal(sun.shadow.camera.right,105.72,'ground vehicles retain the original coverage');
});

test('flight shadows retain distant tree silhouettes and switch immediately while paused',()=>{
  // Texture painting is irrelevant to this scene-graph test; keep the real
  // tree geometry, instance pools, LOD selection and custom shadow materials.
  const saved=Object.getOwnPropertyDescriptor(globalThis,'document');
  const context=Object.fromEntries(['save','restore','translate','rotate','beginPath','lineTo','moveTo','ellipse','fill','stroke'].map(name=>[name,()=>{}]));
  globalThis.document={createElement:()=>({getContext:()=>context})};
  try{
    const scene=new THREE.Scene(),field=createTreeField({grates:false}),observer=new THREE.Vector3(0,180,5000);
    scene.add(field.group);
    field.add('fixture',[80,250,...Array.from({length:36},(_,i)=>500+i*8),940].map(x=>new THREE.Vector3(x,0,5000)));
    const meshes=()=>field.group.children.filter(m=>m instanceof THREE.InstancedMesh&&m.count>0);
    updateFoliage(scene,observer,0,true,false);
    assert.equal(meshes().filter(m=>/LOD2/.test(m.name)).reduce((n,m)=>n+m.count,0),72,'distant trees remain visible; sites beyond 900 m stay excluded');
    assert.ok(meshes().filter(m=>/LOD2/.test(m.name)).every(m=>!m.castShadow));
    updateFoliage(scene,observer,0,true,true);
    assert.ok(meshes().every(m=>m.castShadow),'distant trees cast even when instance pools grow beyond their initial capacity');
    for(const mesh of meshes().filter(m=>/foliage/.test(m.name))){
      assert.equal(mesh.customDepthMaterial.map,mesh.material.map);
      assert.equal(mesh.customDepthMaterial.alphaTest,mesh.material.alphaTest,'leaf shadows retain their cutout silhouette');
    }
    updateFoliage(scene,observer,0,false,true);
    assert.ok(meshes().filter(m=>/LOD2/.test(m.name)).every(m=>!m.castShadow),'Balanced keeps its bounded tree shadow budget');
    updateFoliage(scene,observer,0,true,true);
    updateFoliage(scene,observer,0,true,false);
    assert.ok(meshes().filter(m=>/LOD2/.test(m.name)).every(m=>!m.castShadow),'leaving flight restores tree shadow limits without advancing time');
  }finally{
    if(saved)Object.defineProperty(globalThis,'document',saved);else delete globalThis.document;
  }
});
