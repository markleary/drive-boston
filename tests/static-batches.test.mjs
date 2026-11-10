import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import {batchStaticDetails,splitStaticGeometry,staticDetailBatchSteps} from '../src/render/static-batches.ts';
import {drain,UNPACED,until} from '../src/render/pacing.ts';

const triangles=g=>{
  const p=g.attributes.position,attributes=Object.keys(g.attributes).sort();
  return Array.from({length:p.count/3},(_,t)=>JSON.stringify(attributes.map(name=>{
    const a=g.attributes[name];return Array.from(a.array.slice(t*3*a.itemSize,(t+1)*3*a.itemSize));
  })));
};
test('spatial splitting retains every triangle and all material attributes exactly',()=>{
  const geometry=new THREE.BoxGeometry(2,3,4).toNonIndexed(),parts=[];
  for(let i=0;i<12;i++)parts.push(geometry.clone().translate(i*128,0,i%2*256));
  // Concatenate triangles with explicit attributes, including normalized bytes.
  const combined=new THREE.BufferGeometry();
  for(const name of Object.keys(geometry.attributes))combined.setAttribute(name,new THREE.BufferAttribute(Float32Array.from(parts.flatMap(g=>[...g.attributes[name].array])),geometry.attributes[name].itemSize));
  combined.setAttribute('color',new THREE.BufferAttribute(Uint8Array.from({length:combined.attributes.position.count*3},(_,i)=>i%256),3,true));
  const chunks=splitStaticGeometry(combined);
  assert.ok(chunks.length>4);assert.deepEqual(chunks.flatMap(triangles).sort(),triangles(combined).sort());
  for(const chunk of chunks){assert.equal(chunk.attributes.color.normalized,true);assert.ok(chunk.attributes.color.array instanceof Uint8Array);assert.ok(chunk.boundingSphere.radius<5);}
});

test('indexed meshes split by cell keep every triangle, share vertices within a part and index them compactly',()=>{
  // A 9 x 3 lattice of shared vertices, 100 m apart: sixteen quads over several 128 m cells.
  const columns=9,rows=3,position=[],uv=[],index=[];
  for(let j=0;j<rows;j++)for(let i=0;i<columns;i++){position.push(i*100,Math.sin(i+j),j*100);uv.push(i/7,j/7);}
  for(let j=0;j<rows-1;j++)for(let i=0;i<columns-1;i++){const a=j*columns+i,b=a+1,c=a+columns,d=c+1;index.push(a,c,b,b,c,d);}
  // Enough corners to be worth splitting.
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(position,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  const repeated=[];for(let k=0;k<4;k++)repeated.push(...index);geometry.setIndex(repeated);
  const parts=splitStaticGeometry(geometry);assert.ok(parts.length>4);
  assert.deepEqual(parts.flatMap(part=>triangles(part.toNonIndexed())).sort(),triangles(geometry.toNonIndexed()).sort());
  for(const part of parts){
    assert.ok(part.index.array instanceof Uint16Array,'a part of a few vertices needs no 32-bit index');
    assert.ok(part.attributes.position.count<part.index.count,'triangles still share their vertices');assert.equal(new Set(part.index.array).size,part.attributes.position.count);
    assert.ok(part.boundingSphere.radius<160);
  }
});

test('a vertex that is not a number does not stop the split: its triangles go in a part of their own',t=>{
  t.mock.method(console,'error',()=>{}); // three reports the stray part's bounding sphere
  for(const indexed of [false,true]){
    const box=new THREE.BoxGeometry(2,3,4),parts=[];
    for(let i=0;i<12;i++)parts.push((indexed?box:box.toNonIndexed()).clone().translate(i*128,0,i%2*256));
    const geometry=new THREE.BufferGeometry(),size=parts[0].attributes.position.count;
    for(const name of ['position','normal','uv'])geometry.setAttribute(name,new THREE.BufferAttribute(Float32Array.from(parts.flatMap(g=>[...g.attributes[name].array])),box.attributes[name].itemSize));
    if(indexed)geometry.setIndex(parts.flatMap((g,i)=>Array.from(g.index.array,v=>v+i*size)));
    // One corner at infinity (a division by zero upstream) and one undefined, in two different boxes.
    const p=geometry.attributes.position;p.setXYZ(size*3+1,Infinity,1,-Infinity);p.setX(size*7+2,NaN);
    const flat=indexed?geometry.toNonIndexed():geometry,chunks=splitStaticGeometry(geometry);
    assert.ok(chunks.length>4);assert.deepEqual(chunks.flatMap(c=>triangles(indexed?c.toNonIndexed():c)).sort(),triangles(flat).sort(),'no triangle is lost or repeated');
    const stray=chunks.filter(c=>!c.attributes.position.array.every(Number.isFinite));assert.equal(stray.length,1,'the stray triangles share one part');
    for(const chunk of chunks)if(chunk!==stray[0]){assert.ok(chunk.boundingSphere.radius<5);assert.ok(Number.isFinite(chunk.boundingSphere.center.x));}
    // Only stray vertices: nothing to place the cells by, so the geometry stays whole.
    const lost=geometry.clone();lost.attributes.position.array.fill(NaN);assert.deepEqual(splitStaticGeometry(lost),[lost]);
  }
});

/** The parts a batch would draw for a camera: draw starts, as the renderer's multi-draw receives them. */
const drawn=(batch,camera)=>{camera.updateMatrixWorld();batch.onBeforeRender(null,null,camera,batch.geometry,batch.material);return Array.from(batch._multiDrawStarts.slice(0,batch._multiDrawCount)).sort((a,b)=>a-b);};
test('static batching places every part in the tile\'s frame, keeps materials and shadow flags, and culls parts from fixed bounds',()=>{
  const root=new THREE.Group();root.position.set(200,3,-100);
  const parent=new THREE.Group();parent.position.set(9,2,7);parent.rotation.y=.3;root.add(parent);
  const material=new THREE.MeshStandardMaterial({color:'red'}),sources=[];
  for(let i=0;i<3;i++){const geometry=new THREE.BoxGeometry(1,2,3);geometry.clearGroups();const mesh=new THREE.Mesh(geometry,material);mesh.position.set(i*20,0,0);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);sources.push(mesh);}
  root.updateWorldMatrix(true,true);const inverse=root.matrixWorld.clone().invert();
  // What each source's vertices and normals are in the root's frame.
  const expected=sources.map(m=>m.geometry.clone().applyMatrix4(inverse.clone().multiply(m.matrixWorld)));
  const stats=batchStaticDetails(root);assert.equal(stats.sources,3);assert.equal(stats.batches,1);
  const batch=root.children.find(m=>m instanceof THREE.BatchedMesh);assert.ok(batch);assert.equal(batch.material,material);assert.equal(batch.castShadow,true);assert.equal(batch.receiveShadow,true);
  // No part carries a matrix of its own: the geometry is already placed, so the draw-to-part lookup cannot matter.
  const identity=new THREE.Matrix4(),actual=new THREE.Matrix4();
  for(let i=0;i<3;i++){
    batch.getMatrixAt(i,actual);assert.ok(actual.equals(identity));
    const range=batch.getGeometryRangeAt(i);
    for(const name of ['position','normal']){const got=batch.geometry.attributes[name].array,want=expected[i].attributes[name].array;for(let k=0;k<want.length;k++)assert.ok(Math.abs(got[range.vertexStart*3+k]-want[k])<1e-5,name);}
  }
  assert.equal(batch.perObjectFrustumCulled,false,'three\'s own per-part pass has nothing left to do');assert.equal(batch.sortObjects,false);
  assert.equal(root.matrixAutoUpdate,false);assert.equal(parent.children.length,0);
  // A camera on the first box looking away from the others draws that part alone; one that sees the row draws all three.
  root.updateMatrixWorld(true); // the frame's scene update, which places the new batch under its tile
  const first=new THREE.Vector3(0,0,0).applyMatrix4(sources[0].matrixWorld),last=new THREE.Vector3(0,0,0).applyMatrix4(sources[2].matrixWorld),along=last.clone().sub(first).normalize();
  const near=new THREE.PerspectiveCamera(50,1,.1,500);near.position.copy(first).addScaledVector(along,5);near.lookAt(first);
  const wide=new THREE.PerspectiveCamera(50,1,.1,500);wide.position.copy(first).addScaledVector(along,-60);wide.lookAt(last);
  const starts=[0,1,2].map(i=>batch.getGeometryRangeAt(i).start*batch.geometry.index.array.BYTES_PER_ELEMENT);
  assert.deepEqual(drawn(batch,near),[starts[0]]);assert.deepEqual(drawn(batch,wide),starts);
  assert.deepEqual(drawn(batch,near),[starts[0]],'a view of the whole batch leaves no stale draw list behind');
  // A shadow camera is orthographic: the same test serves it.
  const light=new THREE.OrthographicCamera(-4,4,4,-4,.1,200);light.position.copy(last).add(new THREE.Vector3(0,50,0));light.lookAt(last);
  assert.deepEqual(drawn(batch,light),[starts[2]]);
});

test('the fixed-bounds cull draws exactly the parts three\'s own per-part cull would',()=>{
  // Two builds of the same forty placed parts: the static batch, and a plain BatchedMesh culled by three.
  const material=new THREE.MeshStandardMaterial(),root=new THREE.Group(),reference=new THREE.BatchedMesh(40,40*24,40*36,material),matrix=new THREE.Matrix4();
  let seed=7;const random=()=>(seed=(seed*16807)%2147483647)/2147483647;
  for(let i=0;i<40;i++){
    const geometry=new THREE.BoxGeometry(1+random()*6,1+random()*9,1+random()*6);geometry.clearGroups();
    const mesh=new THREE.Mesh(geometry,material);mesh.position.set(random()*300-150,random()*20,random()*300-150);mesh.rotation.set(random(),random()*6,random());root.add(mesh);
    mesh.updateMatrix();reference.setMatrixAt(reference.addInstance(reference.addGeometry(geometry)),matrix.copy(mesh.matrix));
  }
  reference.computeBoundingSphere();batchStaticDetails(root);const batch=root.children[0];assert.ok(batch instanceof THREE.BatchedMesh);assert.equal(batch.instanceCount,40);
  const starts=Array.from({length:40},(_,i)=>batch.getGeometryRangeAt(i).start*batch.geometry.index.array.BYTES_PER_ELEMENT);
  let partial=0;
  for(let n=0;n<200;n++){
    const camera=n%4===3?new THREE.OrthographicCamera(-30-random()*60,30+random()*60,40,-40,1,300):new THREE.PerspectiveCamera(30+random()*50,.5+random()*2,.2,40+random()*400);
    camera.position.set(random()*360-180,random()*60,random()*360-180);camera.lookAt(random()*200-100,random()*10,random()*200-100);camera.updateMatrixWorld();
    THREE.BatchedMesh.prototype.onBeforeRender.call(reference,null,null,camera,reference.geometry,material);
    const expected=Array.from(reference._indirectTexture.image.data.slice(0,reference._multiDrawCount),id=>starts[id]).sort((a,b)=>a-b),actual=drawn(batch,camera);
    assert.deepEqual(actual,expected,`camera ${n}`);if(actual.length&&actual.length<40)partial++;
  }
  assert.ok(partial>60,'most views cut through the batch');
});

test('survey shells and transparent, hidden or independently controlled meshes stay separate',()=>{
  const root=new THREE.Group(),material=new THREE.MeshStandardMaterial(),transparent=new THREE.MeshStandardMaterial({transparent:true});
  const shells=[];for(let i=0;i<3;i++){
    const shell=new THREE.Mesh(new THREE.BoxGeometry(),material);shell.name='Boston surveyed buildings';root.add(shell);shells.push(shell);
    const glass=new THREE.Mesh(new THREE.BoxGeometry(),transparent);root.add(glass);
    const hidden=new THREE.Mesh(new THREE.BoxGeometry(),material);hidden.visible=false;root.add(hidden);
  }
  assert.deepEqual(batchStaticDetails(root),{sources:0,batches:0});assert.equal(root.children.length,9);
  shells[0].visible=false;assert.equal(shells[0].visible,false);
});

test('paced batching draws every source exactly once at each yield',()=>{
  const root=new THREE.Group(),material=new THREE.MeshStandardMaterial(),pace={deadline:-Infinity};
  for(let i=0;i<9;i++){const geometry=new THREE.BoxGeometry();geometry.clearGroups();const mesh=new THREE.Mesh(geometry,material);mesh.position.x=i*5;root.add(mesh);}
  const steps=staticDetailBatchSteps(root,pace);let result=steps.next(),yields=0;
  while(!result.done){
    let instances=0;root.traverseVisible(o=>{if(o instanceof THREE.BatchedMesh)instances+=o.instanceCount;else if(o instanceof THREE.Mesh)instances++;});
    assert.equal(instances,9);yields++;result=steps.next();
  }
  assert.ok(yields>9);assert.equal(result.value.sources,9);
});

const sourceRoot=(count)=>{
  const root=new THREE.Group(),material=new THREE.MeshStandardMaterial();
  for(let i=0;i<count;i++){const geometry=new THREE.BoxGeometry();geometry.clearGroups();const mesh=new THREE.Mesh(geometry,material);mesh.position.x=i*5;root.add(mesh);}
  return root;
};
test('a paced batch stays hidden until its programs are ready, then replaces its sources at once',()=>{
  const root=sourceRoot(4),pace={deadline:Infinity};let polls=0,warmed;
  const steps=staticDetailBatchSteps(root,pace,mesh=>{warmed=mesh;assert.equal(mesh.instanceCount,4);assert.equal(mesh.visible,false);return ()=>++polls>3;});
  let result;
  do{
    // The streamer gives each frame a fresh deadline.
    pace.deadline=performance.now()+1e4;result=steps.next();
    if(!result.done){assert.equal(warmed?.visible??false,false);assert.equal(root.children.filter(o=>!(o instanceof THREE.BatchedMesh)).length,4);}
  }while(!result.done);
  assert.equal(polls,4);assert.equal(warmed.visible,true);assert.deepEqual(root.children,[warmed]);assert.deepEqual(result.value,{sources:4,batches:1});
});
test('an unpaced or synchronous build shows its batches without waiting for programs',()=>{
  const root=sourceRoot(3);let polls=0;
  assert.deepEqual(drain(staticDetailBatchSteps(root,UNPACED,()=>()=>{polls++;return false;})),{sources:3,batches:1});
  assert.equal(polls,0);assert.equal(root.children.length,1);assert.equal(root.children[0].visible,true);
});
test('waiting for programs gives up after its time limit',async()=>{
  const pace={deadline:0},began=performance.now(),steps=until(()=>false,pace,30);let yields=0;
  while(!steps.next().done){assert.equal(pace.deadline,-Infinity);yields++;pace.deadline=0;await new Promise(resolve=>setTimeout(resolve,5));}
  assert.ok(yields>0);assert.ok(performance.now()-began>=30);
});
