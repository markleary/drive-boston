import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createFarCity} from '../src/render/far-city.ts';
import {drawsFarMassing} from '../src/simulation/far-format.ts';

// A tile shaped like far.bin's 0_0: an ordinary hull, a hidden complex whose 400 m hull spans the
// street between its wings, its two massing fragments (which repeat the hidden flag), and a hidden
// structure without fragments (the Zakim).
const square=(x0,z0,x1,z1)=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
const entry=(footprint,height,flags={})=>({tx:0,tz:0,height,base:2,landmark:false,exactMesh:false,hidden:false,fragment:false,style:0,footprint,center:[0,0],...flags});
function city(){
  const buildings=[
    entry(square(600,600,620,630),12),
    entry(square(0,0,400,300),150,{hidden:true,exactMesh:true}),
    entry(square(10,10,150,290),30,{hidden:true,exactMesh:true,fragment:true}),
    entry(square(250,40,330,120),150,{hidden:true,exactMesh:true,fragment:true}),
    entry(square(700,0,706,6),90,{hidden:true}),
  ];
  return {elevation:{width:2,height:2,cellSize:1000,originX:0,originZ:0,heights:new Float32Array(4)},tiles:{keys:['0_0'],size:1000},far:{tiles:new Map([['0_0',{key:'0_0',tx:0,tz:0,buildings}]])},bounds:{minX:0,maxX:1000,minZ:0,maxZ:1000},roads:[]};
}

test('a hidden complex draws by its fragments, never by its hull',()=>{
  assert.equal(drawsFarMassing({hidden:false,fragment:false}),true);
  assert.equal(drawsFarMassing({hidden:true,fragment:false}),false);
  assert.equal(drawsFarMassing({hidden:true,fragment:true}),true);
  const view=createFarCity(new THREE.Scene(),city()),mesh=view.group.getObjectByName('Distant blocks 0_0');
  assert.equal(view.buildingCount,3,'the ordinary hull and both fragments');
  assert.equal(mesh.geometry.getAttribute('position').count,3*30);
  // The street between the wings (x 150..250) stays open from the ground up, and the tall fragment, not the hull, sets the top.
  const p=mesh.geometry.getAttribute('position');let blocked=false,top=-Infinity;
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);top=Math.max(top,p.getY(i));if(x>151&&x<249&&z<300)blocked=true;}
  assert.equal(blocked,false);assert.equal(top,152);
});

test('fragments hide and return with their detailed tile',()=>{
  const view=createFarCity(new THREE.Scene(),city()),mesh=view.group.getObjectByName('Distant blocks 0_0');
  view.update(new THREE.Vector3(500,0,500),0);assert.equal(mesh.visible,true);
  view.setChunkDetailed('0_0',true);assert.equal(mesh.visible,false);
  view.update(new THREE.Vector3(500,0,500),0);assert.equal(mesh.visible,false);
  view.setChunkDetailed('0_0',false);view.update(new THREE.Vector3(500,0,500),0);assert.equal(mesh.visible,true);
});
