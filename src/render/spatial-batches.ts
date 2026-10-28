import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Batch nearby details together, leaving distant neighborhoods frustum-cullable. */
export function mergeSpatialGeometries(geometries:THREE.BufferGeometry[],material:THREE.Material,cellSize=320){
  const buckets=new Map<string,THREE.BufferGeometry[]>();
  for(const geometry of geometries){
    if(!geometry.attributes.position?.count){geometry.dispose();continue;}
    geometry.computeBoundingBox();const center=geometry.boundingBox!.getCenter(new THREE.Vector3());
    const key=`${Math.floor(center.x/cellSize)},${Math.floor(center.z/cellSize)}`;
    const bucket=buckets.get(key)??[];bucket.push(geometry);buckets.set(key,bucket);
  }
  const meshes:THREE.Mesh[]=[];
  for(const bucket of buckets.values()){
    const geometry=mergeGeometries(bucket,false);
    if(geometry){geometry.computeBoundingSphere();meshes.push(new THREE.Mesh(geometry,material));}
    for(const part of bucket)part.dispose();
  }
  return meshes;
}

/** Keep the shared geometry/material while bounding instance groups locally. */
export function spatialInstances(source:THREE.InstancedMesh,cellSize=320){
  const buckets=new Map<string,number[]>(),matrix=new THREE.Matrix4(),color=new THREE.Color();
  for(let i=0;i<source.count;i++){
    source.getMatrixAt(i,matrix);const e=matrix.elements;
    const key=`${Math.floor(e[12]/cellSize)},${Math.floor(e[14]/cellSize)}`;
    const bucket=buckets.get(key)??[];bucket.push(i);buckets.set(key,bucket);
  }
  const meshes:THREE.InstancedMesh[]=[];
  for(const ids of buckets.values()){
    const mesh=new THREE.InstancedMesh(source.geometry,source.material,ids.length);
    mesh.name=source.name;mesh.castShadow=source.castShadow;mesh.receiveShadow=source.receiveShadow;
    mesh.userData={...source.userData};mesh.renderOrder=source.renderOrder;
    ids.forEach((id,i)=>{source.getMatrixAt(id,matrix);mesh.setMatrixAt(i,matrix);if(source.instanceColor){source.getColorAt(id,color);mesh.setColorAt(i,color);}});
    mesh.computeBoundingBox();mesh.computeBoundingSphere();meshes.push(mesh);
  }
  source.dispose();return meshes;
}
