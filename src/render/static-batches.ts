import * as THREE from 'three';
import { drain, due, type Pace } from './pacing.ts';

/** Submit static tile details sharing a material in one multi-draw, retaining
 * each source mesh's frustum bounds. No geometry, texture or shadow LOD changes.
 * Survey shells remain separate: the world owns their visibility and samplers.
 */
export function batchStaticDetails(root:THREE.Group){return drain(staticDetailBatchSteps(root));}
export function* staticDetailBatchSteps(root:THREE.Group,pace?:Pace):Generator<void,{sources:number;batches:number}>{
  const buckets=new Map<string,THREE.Mesh<THREE.BufferGeometry,THREE.Material>[]>();
  root.updateWorldMatrix(true,true);
  root.traverseVisible(object=>{
    if(!(object instanceof THREE.Mesh)||object instanceof THREE.InstancedMesh||object instanceof THREE.BatchedMesh||
      object.name==='Boston surveyed buildings'||!object.visible||!object.frustumCulled||Array.isArray(object.material)||
      object.material.transparent||object.geometry.groups.length||object.customDepthMaterial||object.customDistanceMaterial||
      Object.keys(object.geometry.morphAttributes).length)return;
    const g:THREE.BufferGeometry=object.geometry;if(!g.attributes.position?.count)return;
    const attributes=Object.entries(g.attributes).sort(([a],[b])=>a.localeCompare(b)).map(([name,a])=>`${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).join(',');
    const key=[object.material.uuid,!!g.index,attributes,object.castShadow,object.receiveShadow,object.renderOrder,object.layers.mask,!!object.userData.noAO].join('|');
    const list=buckets.get(key)??[];list.push(object);buckets.set(key,list);
  });
  const inverse=new THREE.Matrix4().copy(root.matrixWorld).invert(),matrix=new THREE.Matrix4();
  let sources=0,batches=0;
  for(const list of buckets.values()){
    if(list.length<3)continue;
    const first=list[0],vertices=list.reduce((n,m)=>n+m.geometry.attributes.position.count,0),indices=list.reduce((n,m)=>n+(m.geometry.index?.count??0),0);
    // Count spatial parts before allocating the instance matrix texture.
    const parts:{mesh:THREE.Mesh<THREE.BufferGeometry,THREE.Material>;geometries:THREE.BufferGeometry[]}[]=[];
    for(const mesh of list){if(due(pace))yield;parts.push({mesh,geometries:splitStaticGeometry(mesh.geometry)});}
    const count=parts.reduce((n,p)=>n+p.geometries.length,0);
    const batch=new THREE.BatchedMesh(count,vertices,indices,first.material);
    batch.name=`Static details: ${first.parent?.name??first.name}`;batch.castShadow=first.castShadow;batch.receiveShadow=first.receiveShadow;batch.renderOrder=first.renderOrder;batch.layers.mask=first.layers.mask;batch.userData.noAO=!!first.userData.noAO;
    // Join the live scene before removing any source, so a paced build never
    // shows a hole between an old mesh and its replacement.
    root.add(batch);
    for(const {mesh,geometries} of parts){
      if(due(pace))yield;
      for(const geometry of geometries){
        const id=batch.addInstance(batch.addGeometry(geometry));
        batch.setMatrixAt(id,matrix.multiplyMatrices(inverse,mesh.matrixWorld));
        if(geometry!==mesh.geometry)geometry.dispose();
      }
      batch.boundingBox=null;batch.boundingSphere=null;
      mesh.removeFromParent();mesh.geometry.dispose();
    }
    batch.computeBoundingBox();batch.computeBoundingSphere();sources+=list.length;batches++;
  }
  // These roots contain static tile details. Material uniforms (signals, lamps)
  // still animate; recomposing thousands of unchanged local matrices does not.
  root.traverse(object=>{object.updateMatrix();object.matrixAutoUpdate=false;});
  return {sources,batches};
}

/** Keep every triangle intact, but give long, merged road/trim meshes local
 * bounds. A single distant vertex must not keep an entire district in view. */
export function splitStaticGeometry(geometry:THREE.BufferGeometry,cellSize=128):THREE.BufferGeometry[]{
  const p=geometry.attributes.position;
  if(geometry.index||!p||p.count<300||Object.values(geometry.attributes).some(a=>a instanceof THREE.InterleavedBufferAttribute))return [geometry];
  geometry.computeBoundingBox();const size=geometry.boundingBox!.getSize(new THREE.Vector3());
  if(Math.max(size.x,size.z)<=cellSize)return [geometry];
  const cells=new Map<string,number[]>();
  for(let i=0;i<p.count;i+=3){
    const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;
    const key=`${Math.floor(x/cellSize)},${Math.floor(z/cellSize)}`,list=cells.get(key)??[];list.push(i,i+1,i+2);cells.set(key,list);
  }
  if(cells.size<2)return [geometry];
  return [...cells.values()].map(ids=>{
    const part=new THREE.BufferGeometry();
    for(const [name,source] of Object.entries(geometry.attributes)){
      const a=source as THREE.BufferAttribute;
      const array=new (a.array.constructor as typeof Float32Array)(ids.length*a.itemSize);
      for(let i=0;i<ids.length;i++)for(let j=0;j<a.itemSize;j++)array[i*a.itemSize+j]=a.array[ids[i]*a.itemSize+j];
      const attribute=new THREE.BufferAttribute(array,a.itemSize,a.normalized);attribute.gpuType=a.gpuType;part.setAttribute(name,attribute);
    }
    part.computeBoundingBox();part.computeBoundingSphere();return part;
  });
}
