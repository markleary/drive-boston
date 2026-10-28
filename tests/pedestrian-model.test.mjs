import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createPedestrianModel} from '../src/render/pedestrian-model.ts';

function fixture(height=1){
  const group=new THREE.Group(),materials=new Set();
  const person={id:0,position:new THREE.Vector3(),yaw:0,height,width:1,speed:1,bag:true,scarf:true,outfit:0};
  const model=createPedestrianModel(group,[person],materials);
  return {group,person,model,dispose(){model.dispose();group.traverse(o=>o.geometry?.dispose());materials.forEach(m=>m.dispose());}};
}

test('a walking foot stays planted as the body advances, including different heights',()=>{
  for(const height of [.94,1.05]){
    const f=fixture(height),matrix=new THREE.Matrix4(),point=new THREE.Vector3();
    try{
      const shoes=f.group.getObjectByName('Shoes'),samples=[];
      for(let frame=0;frame<180;frame++){
        const distance=frame/60;f.person.position.z=distance;
        f.model.pose(0,f.person,distance,1,1/60);f.model.flush();shoes.getMatrixAt(0,matrix);point.setFromMatrixPosition(matrix);
        samples.push(point.clone());
        // Check every sole vertex: heel/toe roll may not push the shoe through
        // the sidewalk, and the swing must have room to clear the pavement.
        const sole=f.group.getObjectByName('Shoe soles');sole.getMatrixAt(0,matrix);
        const vertices=sole.geometry.attributes.position;
        for(let i=0;i<vertices.count;i++)assert.ok(point.fromBufferAttribute(vertices,i).applyMatrix4(matrix).y>=-.001,'outsole may not penetrate the sidewalk');
      }
      let planted=0,longest=0;
      for(let i=1;i<samples.length;i++){
        if(Math.abs(samples[i].z-samples[i-1].z)<1e-5)planted++;else planted=0;
        longest=Math.max(longest,planted);
      }
      assert.ok(longest>=25,'a stance foot should stay in the same world position for a substantial part of the stride');
      assert.ok(Math.max(...samples.map(p=>p.y))>.09,'swing foot must lift clear of the sidewalk');
    }finally{f.dispose();}
  }
});

test('a vehicle pause eases the limbs into rest and resuming does not snap them',()=>{
  const f=fixture(),matrix=new THREE.Matrix4(),point=new THREE.Vector3();
  const shoe=()=>{f.group.getObjectByName('Shoes').getMatrixAt(0,matrix);return point.setFromMatrixPosition(matrix).clone();};
  try{
    f.model.pose(0,f.person,.29,1,1/60);const walking=shoe();
    f.model.pose(0,f.person,.29,0,1/60);const first=shoe();
    assert.ok(first.distanceTo(walking)<.04,'braking must blend rather than snap to the idle pose');
    for(let i=0;i<90;i++)f.model.pose(0,f.person,.29,0,1/60);
    const idle=shoe();assert.ok(Math.abs(idle.z-.043)<1e-5,'paused feet should settle underneath the hips');
    f.model.pose(0,f.person,.29,1,1/60);assert.ok(shoe().distanceTo(idle)<.04,'resuming should blend back into the stride');
  }finally{f.dispose();}
});

test('changing facial detail preserves each walker position and complexion',()=>{
  const group=new THREE.Group(),materials=new Set(),people=Array.from({length:4},(_,id)=>({
    id,position:new THREE.Vector3(id*4,0,0),yaw:0,height:1,width:1,speed:1,bag:false,scarf:false,
  }));
  const model=createPedestrianModel(group,people,materials),matrix=new THREE.Matrix4(),color=new THREE.Color(),original=new Map();
  try{
    people.forEach((p,i)=>model.pose(i,p,.3,1,0,true));model.flush();
    const detailed=group.getObjectByName('Faces'),distant=group.getObjectByName('Distant faces');
    for(let i=0;i<detailed.count;i++){
      detailed.getMatrixAt(i,matrix);detailed.getColorAt(i,color);original.set(Math.round(matrix.elements[12]),{matrix:matrix.clone(),color:color.clone()});
    }
    for(const nearby of [new Set([1,3]),new Set([0]),new Set([0,1,2,3])]){
      people.forEach((p,i)=>model.pose(i,p,.3,1,0,nearby.has(i)));model.flush();
      assert.equal(detailed.count+distant.count,people.length,'detail changes must not drop or duplicate a face');
      for(const mesh of [detailed,distant])for(let i=0;i<mesh.count;i++){
        mesh.getMatrixAt(i,matrix);mesh.getColorAt(i,color);const before=original.get(Math.round(matrix.elements[12]));
        assert.ok(before&&matrix.equals(before.matrix),'a detail change must preserve the head pose');
        assert.ok(color.equals(before.color),'compacting the detail batches must preserve each complexion');
      }
    }
  }finally{model.dispose();group.traverse(o=>o.geometry?.dispose());materials.forEach(m=>m.dispose());}
});
