import * as THREE from 'three';
import type {Building,CityData} from '../types';
import {sampleElevation} from '../simulation/terrain.ts';
import {clipBuildingTunnelPassage} from '../simulation/tunnel-passages.ts';

/** Extend only real wall-bottom edges to the terrain. Convex footprints would
 * close the public streets and courtyards inside these concave source models. */
export function sourceFootingGeometry(city:CityData,building:Building,source:THREE.BufferGeometry){
  const base=building.baseElevation??0,p=source.attributes.position,index=source.index;
  const edges=new Map<string,{a:THREE.Vector3;b:THREE.Vector3;normal:THREE.Vector3}>();
  const vertices=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()],ab=new THREE.Vector3(),ac=new THREE.Vector3(),normal=new THREE.Vector3();
  for(let i=0;i<(index?.count??p.count);i+=3){
    for(let j=0;j<3;j++)vertices[j].fromBufferAttribute(p,index?index.getX(i+j):i+j);
    normal.crossVectors(ab.subVectors(vertices[1],vertices[0]),ac.subVectors(vertices[2],vertices[0])).normalize();
    if(Math.abs(normal.y)>.28||normal.lengthSq()<.5)continue;
    for(let j=0;j<3;j++){
      const a=vertices[j],b=vertices[(j+1)%3];
      if(Math.abs(a.y-base)>.03||Math.abs(b.y-base)>.03||Math.hypot(a.x-b.x,a.z-b.z)<.05)continue;
      const keyA=[a.x,a.y,a.z].map(v=>v.toFixed(3)).join(','),keyB=[b.x,b.y,b.z].map(v=>v.toFixed(3)).join(',');
      const key=keyA<keyB?`${keyA}|${keyB}`:`${keyB}|${keyA}`;
      if(!edges.has(key))edges.set(key,{a:a.clone(),b:b.clone(),normal:normal.clone()});
    }
  }
  const positions:number[]=[];let groundedEdges=0;
  for(const{a,b,normal}of edges.values()){
    const length=Math.hypot(b.x-a.x,b.z-a.z),steps=Math.max(1,Math.ceil(length/2));let grounded=false;
    for(let i=0;i<steps;i++){
      const x=a.clone().lerp(b,i/steps),y=a.clone().lerp(b,(i+1)/steps);
      const lowX=Math.min(x.y,sampleElevation(city,x.x,x.z)-.08),lowY=Math.min(y.y,sampleElevation(city,y.x,y.z)-.08);
      if(Math.max(x.y-lowX,y.y-lowY)<.12)continue;
      const topX=[x.x,x.y,x.z],topY=[y.x,y.y,y.z],bottomX=[x.x,lowX,x.z],bottomY=[y.x,lowY,y.z];
      const forward=(y.z-x.z)*normal.x-(y.x-x.x)*normal.z>0;
      const triangle=forward?[bottomX,topY,bottomY,bottomX,topX,topY]:[bottomX,bottomY,topY,bottomX,topY,topX];
      for(const vertex of triangle)positions.push(...vertex);grounded=true;
    }
    if(grounded)groundedEdges++;
  }
  const raw=new Float32Array(positions),clipped=clipBuildingTunnelPassage(city,building,{vertices:raw,indices:Uint32Array.from({length:raw.length/3},(_,i)=>i)});
  const visible=clipped.vertices===raw?raw:new Float32Array(clipped.indices.length*3);
  if(visible!==raw)for(let i=0;i<clipped.indices.length;i++)visible.set(clipped.vertices.subarray(clipped.indices[i]*3,clipped.indices[i]*3+3),i*3);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(visible,3));geometry.computeVertexNormals();
  geometry.userData={sourceBottomEdges:edges.size,groundedEdges};return geometry;
}

let material:THREE.MeshStandardMaterial|undefined;
/** One generated buffer supplies both the visible footing and static collision. */
export function addSourceFooting(scene:THREE.Object3D,city:CityData,building:Building,source:THREE.BufferGeometry){
  const geometry=sourceFootingGeometry(city,building,source),position=geometry.attributes.position;
  if(!position.count){geometry.dispose();return undefined;}
  material??=new THREE.MeshStandardMaterial({color:'#827c6d',roughness:.95,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(geometry,material);mesh.name='Source wall footings';mesh.userData.buildingId=building.id;
  mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);
  return{id:building.id,vertices:new Float32Array(position.array),indices:Uint32Array.from({length:position.count},(_,i)=>i)};
}
