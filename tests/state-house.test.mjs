import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import {STATE_HOUSE_ID,isStateHouse,splitStateHouseShell} from '../src/render/state-house.ts';

test('State House material treatment preserves every surveyed triangle and only selects the mapped complex',()=>{
  const bytes=readFileSync(new URL('../public/data/city.glb',import.meta.url));
  const jsonSize=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+jsonSize).toString()),binary=20+jsonSize+8;
  const node=gltf.nodes.find(n=>n.extras?.buildingId===STATE_HOUSE_ID);
  assert.ok(node,'the treatment must target the existing State House complex');
  const city=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url),'utf8'));
  assert.deepEqual(city.buildings.filter(isStateHouse).map(b=>b.id),[STATE_HOUSE_ID],'neighboring Beacon Hill buildings remain independently styled');
  function attribute(index){
    const a=gltf.accessors[index],view=gltf.bufferViews[a.bufferView],start=binary+(view.byteOffset??0)+(a.byteOffset??0),size={SCALAR:1,VEC2:2,VEC3:3}[a.type];
    const values=new Float32Array(a.count*size),componentBytes=a.componentType===5123?2:4;
    for(let i=0;i<values.length;i++)values[i]=a.componentType===5126?bytes.readFloatLE(start+i*4):a.componentType===5123?bytes.readUInt16LE(start+i*2):bytes.readUInt32LE(start+i*4);
    return {values,size,componentBytes};
  }
  const triangleRecords=geometry=>{
    const attributes=['position','normal','uv'].filter(name=>geometry.hasAttribute(name)),p=geometry.getAttribute('position'),records=[];
    for(let i=0;i<p.count;i+=3){const row=[];for(const name of attributes){const a=geometry.getAttribute(name);for(let j=0;j<3;j++)for(let k=0;k<a.itemSize;k++)row.push(a.getComponent(i+j,k));}records.push(JSON.stringify(row));}
    return records;
  };
  for(const primitive of gltf.meshes[node.mesh].primitives){
    const geometry=new THREE.BufferGeometry();
    for(const [key,name]of [['POSITION','position'],['NORMAL','normal'],['TEXCOORD_0','uv']])if(primitive.attributes[key]!==undefined){const a=attribute(primitive.attributes[key]);geometry.setAttribute(name,new THREE.BufferAttribute(a.values,a.size));}
    if(primitive.indices!==undefined)geometry.setIndex(Array.from(attribute(primitive.indices).values));
    const source=geometry.toNonIndexed(),roof=gltf.materials[primitive.material].name==='roof',parts=splitStateHouseShell(source,roof);
    const before=triangleRecords(source).sort(),after=parts.flatMap(part=>triangleRecords(part.geometry)).sort();
    assert.deepEqual(after,before,'surface materials must not alter or drop source geometry');
    if(roof)assert.deepEqual(parts.map(p=>p.kind),['roof']);
    else for(const kind of ['brick','brickWindows','stone','drum'])assert.ok(parts.some(p=>p.kind===kind),`the source includes ${kind} architecture`);
    geometry.dispose();source.dispose();parts.forEach(p=>p.geometry.dispose());
  }
});
