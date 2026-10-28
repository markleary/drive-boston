import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {facadeStyleFor,stabilizeFacadeUVs} from '../src/render/materials.ts';

test('named church spires keep masonry instead of inheriting office-tower materials',async()=>{
  const city=JSON.parse(await fs.readFile(new URL('../public/data/city.json',import.meta.url),'utf8'));
  for(const name of ['Old South Church','Arlington Street Church']){
    const building=city.buildings.find(b=>b.name===name);assert.ok(building,`missing source church: ${name}`);
    const style=facadeStyleFor(building);assert.equal(style.kind,'stone');assert.equal(style.detail,'gothic');
  }
});

function sharedEdgeJumps(geometry){
  const p=geometry.attributes.position,n=geometry.attributes.normal,uv=geometry.attributes.uv,edges=new Map();
  let checked=0,jumps=0;
  for(let i=0;i<p.count;i+=3){
    if(Math.abs(n.getY(i))>.25)continue;
    for(let j=0;j<3;j++){
      const a=i+j,b=i+(j+1)%3;
      const pa=[p.getX(a),p.getY(a),p.getZ(a)].map(v=>v.toFixed(3)).join(','),pb=[p.getX(b),p.getY(b),p.getZ(b)].map(v=>v.toFixed(3)).join(',');
      if(pa===pb)continue;
      const first=pa<pb?a:b,last=pa<pb?b:a,key=pa<pb?`${pa}|${pb}`:`${pb}|${pa}`;
      const item={u:[uv.getX(first)*6,uv.getX(last)*6],normal:[n.getX(i),n.getY(i),n.getZ(i)]},previous=edges.get(key);
      if(!previous){edges.set(key,item);continue;}
      if(previous.normal.reduce((sum,v,k)=>sum+v*item.normal[k],0)<Math.cos(Math.PI/120))continue;
      checked++;
      const delta=Math.max(...item.u.map((u,k)=>{const d=Math.abs(u-previous.u[k])%6;return Math.min(d,6-d);}));
      if(delta>.02)jumps++;
    }
  }
  return {checked,jumps};
}

test('survey-wall UV stabilization removes texture phase breaks without changing geometry',async t=>{
  const city=JSON.parse(await fs.readFile(new URL('../public/data/city.json',import.meta.url),'utf8'));
  const buildings=new Map(city.buildings.map(b=>[b.id,b]));
  const bytes=await fs.readFile(new URL('../public/data/city.glb',import.meta.url));
  const gltf=await new Promise((resolve,reject)=>new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'',resolve,reject));
  let before=0,after=0,checked=0;
  gltf.scene.traverse(object=>{
    if(!object.isMesh||object.material.name==='roof')return;
    let owner=object;while(owner&&!owner.userData.buildingId)owner=owner.parent;
    const geometry=object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone();
    const positions=geometry.attributes.position.array.slice(),normals=geometry.attributes.normal.array.slice();
    const original=sharedEdgeJumps(geometry);before+=original.jumps;checked+=original.checked;
    stabilizeFacadeUVs(geometry,buildings.get(owner?.userData.buildingId));
    after+=sharedEdgeJumps(geometry).jumps;
    assert.deepEqual(geometry.attributes.position.array,positions,'measured building vertices changed');
    assert.deepEqual(geometry.attributes.normal.array,normals,'measured surface normals changed');
    assert.ok(geometry.attributes.uv.array.every(Number.isFinite),'UV projection produced nonfinite coordinates');
    geometry.dispose();
  });
  assert.ok(checked>10000,'test must inspect the real district asset');
  assert.ok(before>500,'source fixture no longer reproduces the phase discontinuities');
  assert.ok(after<before*.1,`expected at least 90% fewer nearly planar texture breaks; got ${before} → ${after}`);
  t.diagnostic(`${checked} shared edges checked: ${before} → ${after} texture phase breaks over 2cm; source positions/normals unchanged.`);
});
