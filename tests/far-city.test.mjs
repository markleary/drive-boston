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
  // Each box is an instance of the one unit box: five faces, thirty vertices, placed by its matrix.
  assert.ok(mesh instanceof THREE.InstancedMesh);assert.equal(mesh.count,3);assert.equal(mesh.geometry.getAttribute('position').count,30);
  const unit=mesh.geometry.getAttribute('position'),matrix=new THREE.Matrix4(),point=new THREE.Vector3(),corners=[];
  for(let n=0;n<mesh.count;n++){mesh.getMatrixAt(n,matrix);for(let i=0;i<unit.count;i++)corners.push(point.fromBufferAttribute(unit,i).applyMatrix4(matrix).clone());}
  // The street between the wings (x 150..250) stays open from the ground up, and the tall fragment, not the hull, sets the top.
  let blocked=false,top=-Infinity;
  for(const {x,y,z} of corners){top=Math.max(top,y);if(x>151&&x<249&&z<300)blocked=true;}
  assert.equal(blocked,false);assert.equal(top,152);
  // The first box is the 20 m by 30 m hull from a metre under its base (2) to its top (14), walls then roof, facing out.
  mesh.getMatrixAt(0,matrix);const box=new THREE.Box3().setFromPoints(corners.slice(0,30)),normal=mesh.geometry.getAttribute('normal'),roof=mesh.geometry.getAttribute('roof');
  for(const [got,want] of [[box.min.x,600],[box.max.x,620],[box.min.y,1],[box.max.y,14],[box.min.z,600],[box.max.z,630]])assert.ok(Math.abs(got-want)<1e-4);
  const centre=box.getCenter(new THREE.Vector3()),rotation=new THREE.Matrix3().setFromMatrix4(matrix);
  for(let i=0;i<30;i+=3){
    const [a,b,c]=[0,1,2].map(k=>corners[i+k]),face=new THREE.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)).normalize();
    // Scale-free direction of the stored normal, as the instancing shader derives it.
    const stored=new THREE.Vector3().fromBufferAttribute(normal,i).applyMatrix3(rotation).normalize();
    if(roof.getX(i)){assert.ok(Math.abs(face.y-1)<1e-6);assert.equal(a.y,14);}else{assert.ok(Math.abs(face.y)<1e-6);assert.ok(face.dot(a.clone().sub(centre))>0,'walls face outward');}
    assert.ok(face.dot(stored)>.999,'stored normals are the face normals');
  }
  assert.ok(mesh.instanceColor.array instanceof Uint8Array&&mesh.instanceColor.normalized,'wall colours stay eight-bit');
  assert.ok(mesh.boundingSphere.containsPoint(new THREE.Vector3(300,150,60))&&mesh.boundingSphere.containsPoint(new THREE.Vector3(610,5,615)),'the chunk culls by all of its boxes');
});

test('fragments hide and return with their detailed tile',()=>{
  const view=createFarCity(new THREE.Scene(),city()),mesh=view.group.getObjectByName('Distant blocks 0_0');
  view.update(new THREE.Vector3(500,0,500),0);assert.equal(mesh.visible,true);
  view.setChunkDetailed('0_0',true);assert.equal(mesh.visible,false);
  view.update(new THREE.Vector3(500,0,500),0);assert.equal(mesh.visible,false);
  view.setChunkDetailed('0_0',false);view.update(new THREE.Vector3(500,0,500),0);assert.equal(mesh.visible,true);
});
