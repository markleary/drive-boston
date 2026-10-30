// Bake the approved artwork to GLB. No browser, GPU, or external assets required.
import {writeFile} from 'node:fs/promises';
import * as THREE from 'three';
import {mergeGeometries,mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
import {MeshoptSimplifier} from 'meshoptimizer';
import {createTrafficVehicleSource,sourceFleet} from './traffic-fleet-source.mjs';

await MeshoptSimplifier.ready;
const gltf={asset:{version:'2.0',generator:'Drive Boston traffic fleet / meshoptimizer'},scene:0,scenes:[{nodes:[]}],nodes:[],meshes:[],materials:[],accessors:[],bufferViews:[],buffers:[]};
const chunks=[];let bytes=0;
function accessor(array,type,componentType,target){
 const pad=(4-bytes%4)%4;if(pad){chunks.push(Buffer.alloc(pad));bytes+=pad;}
 const data=Buffer.from(array.buffer,array.byteOffset,array.byteLength),view=gltf.bufferViews.push({buffer:0,byteOffset:bytes,byteLength:data.length,target})-1;chunks.push(data);bytes+=data.length;
 const size={SCALAR:1,VEC2:2,VEC3:3}[type],a={bufferView:view,componentType,count:array.length/size,type};
 if(type==='VEC3'&&target===34962){a.min=[Infinity,Infinity,Infinity];a.max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<array.length;i++) {const k=i%3;a.min[k]=Math.min(a.min[k],array[i]);a.max[k]=Math.max(a.max[k],array[i]);}}
 return gltf.accessors.push(a)-1;
}
const materials=new Map();
function material(name){if(!materials.has(name)){materials.set(name,gltf.materials.length);gltf.materials.push({name,pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:1},doubleSided:true});}return materials.get(name);}
const stats={};
for(let model=0;model<sourceFleet.length;model++){
 const source=createTrafficVehicleSource(model),buckets=new Map();source.updateMatrixWorld(true);
 source.traverse(mesh=>{
  if(!mesh.isMesh)return;const name=mesh.material.name,wheel=mesh.parent.name.startsWith('wheel-')?mesh.parent:null,part=wheel?.name??'body';
  const transform=wheel?wheel.matrixWorld.clone().invert().multiply(mesh.matrixWorld):mesh.matrixWorld,g=mesh.geometry.clone().applyMatrix4(transform);
  if(name!=='registration')g.deleteAttribute('uv');const flat=g.index?g.toNonIndexed():g;if(flat!==g)g.dispose();
  const key=`${part}/${name}`,bucket=buckets.get(key)??{name,part,pivot:wheel?.position.toArray(),parts:[]};bucket.parts.push(flat);buckets.set(key,bucket);
 });
 stats[source.name]={};
 for(const lod of ['near','far']){
  const root=gltf.nodes.push({name:`${source.name}-${lod}`,children:[]})-1;gltf.scenes[0].nodes.push(root);let triangles=0;const wheelNodes=new Map();
  for(const {name,part,pivot,parts} of buckets.values()){
   const merged=mergeGeometries(parts,false),g=mergeVertices(merged,.00002);merged.dispose();
   const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv,indices=new Uint32Array(g.index.array),attributes=new Float32Array(p.count*(uv?5:3));
   for(let i=0;i<p.count;i++){attributes.set([n.getX(i),n.getY(i),n.getZ(i)],i*(uv?5:3));if(uv)attributes.set([uv.getX(i),uv.getY(i)],i*5+3);}
   const target=Math.max(6,Math.floor(indices.length*(lod==='near'?.025:.003)/3)*3);
   const [reduced,error]=name==='registration'?[indices,0]:MeshoptSimplifier.simplifyWithAttributes(indices,new Float32Array(p.array),3,attributes,uv?5:3,uv?[.15,.15,.15,1,1]:[.15,.15,.15],null,target,lod==='near'?.002:.018,lod==='near'?['ErrorAbsolute','Permissive']:['ErrorAbsolute','Permissive']);
   const [remap,count]=MeshoptSimplifier.compactMesh(reduced),position=new Float32Array(count*3),normal=new Float32Array(count*3),texcoord=uv?new Float32Array(count*2):null;
   for(let i=0;i<remap.length;i++)if(remap[i]!==0xffffffff){const j=remap[i];position.set(p.array.slice(i*3,i*3+3),j*3);normal.set(n.array.slice(i*3,i*3+3),j*3);if(uv)texcoord.set(uv.array.slice(i*2,i*2+2),j*2);}
   const attrs={POSITION:accessor(position,'VEC3',5126,34962),NORMAL:accessor(normal,'VEC3',5126,34962)};if(texcoord)attrs.TEXCOORD_0=accessor(texcoord,'VEC2',5126,34962);
   const mesh=gltf.meshes.push({name,primitives:[{attributes:attrs,indices:accessor(reduced,'SCALAR',5125,34963),material:material(name)}]})-1;
   let parent=root;if(part!=='body'){if(!wheelNodes.has(part)){wheelNodes.set(part,gltf.nodes.push({name:part,translation:pivot,extras:{npcWheel:Number(part.slice(6))},children:[]})-1);gltf.nodes[root].children.push(wheelNodes.get(part));}parent=wheelNodes.get(part);}
   gltf.nodes[parent].children.push(gltf.nodes.push({name,mesh})-1);triangles+=reduced.length/3;if(lod==='near')console.log(' ',name,indices.length/3,'->',reduced.length/3);g.dispose();
  }
  stats[source.name][lod]=triangles;
 }
 source.traverse(o=>{o.geometry?.dispose();});for(const {parts} of buckets.values())parts.forEach(g=>g.dispose());
 console.log(source.name,stats[source.name]);
}
gltf.buffers.push({byteLength:bytes});
const json=Buffer.from(JSON.stringify(gltf)),jsonPadded=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]),bin=Buffer.concat(chunks),binPadded=Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4)]),header=Buffer.alloc(12),jh=Buffer.alloc(8),bh=Buffer.alloc(8);
header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+jsonPadded.length+binPadded.length,8);jh.writeUInt32LE(jsonPadded.length,0);jh.writeUInt32LE(0x4e4f534a,4);bh.writeUInt32LE(binPadded.length,0);bh.writeUInt32LE(0x004e4942,4);
await writeFile(new URL('../public/models/traffic-fleet.glb',import.meta.url),Buffer.concat([header,jh,jsonPadded,bh,binPadded]));
await writeFile(new URL('../public/models/traffic-fleet-stats.json',import.meta.url),JSON.stringify(stats,null,2)+'\n');
console.log('GLB bytes:',header.readUInt32LE(8));
