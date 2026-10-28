import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {TriangleWriter,PartBatches,box} from '../src/render/geometry-writer.ts';

const expanded=(g,m)=>{const n=g.index?g.toNonIndexed():g;if(m)n.applyMatrix4(m);return n;};
const close=(a,b,eps=1e-5)=>{assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<eps,`index ${i}: ${a[i]} vs ${b[i]}`);};
const placed=()=>new THREE.Matrix4().compose(new THREE.Vector3(12.5,-3,7),new THREE.Quaternion().setFromEuler(new THREE.Euler(.2,1.1,-.3,'YXZ')),new THREE.Vector3(1,1,1));

test('a written box matches BoxGeometry vertex for vertex, placed or not',()=>{
  for(const m of [undefined,placed()]){
    const writer=new TriangleWriter(4);writer.box(box(1.3,.4,2.2),m);
    const reference=expanded(new THREE.BoxGeometry(1.3,.4,2.2),m),g=writer.geometry();
    assert.equal(g.attributes.position.count,36);
    close(g.attributes.position.array,reference.attributes.position.array);
    close(g.attributes.normal.array,reference.attributes.normal.array);
    close(g.attributes.uv.array,reference.attributes.uv.array);
  }
});

test('appended geometries expand their index and transform normals like applyMatrix4',()=>{
  const m=placed(),source=new THREE.CylinderGeometry(.3,.5,2,7),writer=new TriangleWriter(1);
  writer.append(source,m);const reference=expanded(source,m),g=writer.geometry();
  close(g.attributes.position.array,reference.attributes.position.array);
  close(g.attributes.normal.array,reference.attributes.normal.array);
  close(g.attributes.uv.array,reference.attributes.uv.array);
});

test('flat triangles carry the normal computeVertexNormals gives a non-indexed mesh',()=>{
  const writer=new TriangleWriter(1);writer.triangle(0,0,0,2,0,0,0,0,3,0,0,1,0,0,1);
  const reference=new THREE.BufferGeometry();reference.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,2,0,0,0,0,3],3));reference.computeVertexNormals();
  close(writer.geometry().attributes.normal.array,reference.attributes.normal.array);
  assert.ok(writer.geometry().boundingSphere.radius>0);
});

test('batches merge by material and cell, growing past their initial capacity',()=>{
  const batches=new PartBatches(100),a=new THREE.MeshBasicMaterial(),b=new THREE.MeshBasicMaterial();
  for(let i=0;i<300;i++)batches.part(box(1,1,1),i%2?a:b,new THREE.Matrix4().makeTranslation(i*2,0,0));
  const meshes=batches.meshes();
  assert.equal(meshes.length,12);
  assert.equal(meshes.reduce((n,m)=>n+m.geometry.attributes.position.count,0),300*36);
  assert.ok(meshes.every(m=>m.geometry.boundingSphere.radius<80));
});
