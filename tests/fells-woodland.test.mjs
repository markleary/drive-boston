import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { fellsWoodlandSteps, fellsViewHeight } from '../src/render/fells-woodland.ts';
import { sampleElevation } from '../src/simulation/terrain.ts';
import { PARK_CANOPY } from '../src/simulation/deck-canopy.ts';
import { disposeTileResources } from '../src/render/tile-resources.ts';

function withCanvas(run) {
  const saved=Object.getOwnPropertyDescriptor(globalThis,'document');
  const context=Object.fromEntries(['save','restore','translate','rotate','beginPath','lineTo','moveTo','ellipse','fill','stroke'].map(name=>[name,()=>{}]));
  globalThis.document={createElement:()=>({getContext:()=>context})};
  try{return run();}finally{if(saved)Object.defineProperty(globalThis,'document',saved);else delete globalThis.document;}
}
const bounds={minX:-150,maxX:150,minZ:-150,maxZ:150};
const city={bounds,roads:[],buildings:[],elevation:{width:2,height:2,cellSize:300,originX:-150,originZ:-150,heights:[0,90,0,90]}};
function make(overrides={}) {
  const group=new THREE.Group(),trees=[],colliders=[];
  const options={bounds,contains:([x,z])=>x>=bounds.minX&&x<bounds.maxX&&z>=bounds.minZ&&z<bounds.maxZ,
    clear:()=>true,viewHeight:()=>Infinity,onTrees:t=>trees.push(...t),onRock:(vertices,indices)=>colliders.push({vertices,indices}),...overrides};
  const steps=fellsWoodlandSteps(city,group,options);let result;do{result=steps.next();}while(!result.done);
  return{group,woodland:group.children[0],trees,colliders,count:result.value};
}

test('Fells combines mature cutout-canopy plantings, saplings and a dense separate shrub layer',()=>withCanvas(()=>{
  const {group,woodland,trees,count}=make();
  assert.equal(count,trees.length); assert.ok(trees.length>500,'a nine-hectare stand should read as continuous woodland');
  assert.ok(trees.some(t=>t.scale<.5)&&trees.some(t=>t.scale>1),'undergrowth and mature trunks have distinct heights');
  assert.deepEqual([...new Set(trees.map(t=>t.species))].sort(),['elm','maple','red oak','white pine']);
  assert.ok(woodland.userData.shrubs>trees.length*2,'shrubs fill the space below the canopy');
  const shrubs=woodland.children.filter(m=>m.name==='Fells shrubs and saplings');
  assert.equal(shrubs.reduce((n,m)=>n+m.count,0),woodland.userData.shrubs);
  assert.ok(shrubs.every(m=>m.material.alphaTest>0&&m.material.transparent===false),'cutouts write depth without sorting overlapping transparent shrubs');
  woodland.userData.updateFoliage(new THREE.Vector3(0,40,0),0,true);
  assert.ok(shrubs.some(m=>m.visible),'near undergrowth remains visible');
  woodland.userData.updateFoliage(new THREE.Vector3(2000,40,0),1,true);
  assert.ok(shrubs.every(m=>!m.visible),'distant undergrowth leaves the draw and shadow passes');
  disposeTileResources(group);
}));

test('the woodland respects travel clearances and height caps for both trees and low brush',()=>withCanvas(()=>{
  // The empty strip represents a path, with a modest canopy ceiling over its eastern side.
  const ceiling=(p)=>sampleElevation(city,...p)+(p[0]>60?8:40);
  const {group,woodland,trees}=make({clear:([x],reach)=>Math.abs(x)>=7+reach,viewHeight:ceiling});
  for(const tree of trees){
    const p=[tree.position.x,tree.position.z],reach=PARK_CANOPY.reach/1.12*tree.scale,top=PARK_CANOPY.top/1.12*tree.scale;
    assert.ok(Math.abs(p[0])>=7+reach,'branches clear the path when its clearance function requires it');
    assert.ok(sampleElevation(city,...p)+top<=ceiling(p),'full tree bounds remain below the requested sightline');
  }
  const matrix=new THREE.Matrix4(),point=new THREE.Vector3();
  for(const mesh of woodland.children.filter(m=>m.name==='Fells shrubs and saplings'))for(let i=0;i<mesh.count;i++){
    mesh.getMatrixAt(i,matrix);
    const positions=mesh.geometry.getAttribute('position');
    for(let j=0;j<positions.count;j++){
      point.fromBufferAttribute(positions,j).applyMatrix4(matrix);
      assert.ok(Math.abs(point.x)>7,'all shrub corners clear the path, not just their stems');
    }
  }
  disposeTileResources(group);
}));

test('large fractured outcrops share exactly their rendered geometry with wheel collision',()=>withCanvas(()=>{
  const {group,woodland,colliders}=make();
  const rock=woodland.children.find(m=>m.name==='Granite ledges and boulders');
  assert.ok(rock); assert.ok(woodland.userData.outcrops>8);
  assert.equal(colliders.length,1); assert.equal(colliders[0].vertices,rock.geometry.attributes.position.array);
  assert.equal(colliders[0].indices.length,rock.geometry.attributes.position.count);
  let largestRise=0;
  const p=rock.geometry.attributes.position,n=rock.geometry.attributes.normal;
  for(let i=0;i<p.count;i++){
    largestRise=Math.max(largestRise,p.getY(i)-sampleElevation(city,p.getX(i),p.getZ(i)));
    assert.ok(Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)+n.getX(i)+n.getY(i)+n.getZ(i)));
  }
  assert.ok(largestRise>4,'outcrops include substantial exposed faces, not just pebbles');
  disposeTileResources(group);
}));

test('Wright’s Tower keeps its existing open approach despite denser planting',()=>{
  const view=fellsViewHeight(city);
  assert.equal(view([-2520.863,-9163.378],2),-Infinity);
  assert.equal(view([0,0],2),Infinity);
});
