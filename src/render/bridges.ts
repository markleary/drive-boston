import * as THREE from 'three';
import type {CityData} from '../types';
import {roadDeckGeometry,roadSlabGeometry,sampleRoadElevation,bridgeSupports,bridgeBarriers,bridgeEdgeSections} from '../simulation/road-surfaces.ts';
import {drapedRibbon} from './terrain-ground.ts';
import {mergeSpatialGeometries} from './spatial-batches.ts';

/** The source-defined upper road is independent from the streets beneath it. */
export function addRoadStructures(scene:THREE.Object3D,city:CityData,asphalt?:THREE.Material,structures=city.roads.filter(r=>r.elevations)){
  const group=new THREE.Group();group.name='Elevated roads and water crossings';
  const concrete=new THREE.MeshStandardMaterial({color:'#9b9a8e',roughness:.92});
  const steel=new THREE.MeshStandardMaterial({color:'#525f58',roughness:.7,metalness:.45});
  const paint=new THREE.MeshStandardMaterial({color:'#dbd9bc',roughness:.87});
  asphalt??=new THREE.MeshStandardMaterial({color:'#50565a',roughness:.94});
  const decks:THREE.BufferGeometry[]=[],slabs:THREE.BufferGeometry[]=[],markings:THREE.BufferGeometry[]=[],rails:THREE.BufferGeometry[]=[],piers:THREE.BufferGeometry[]=[];
  for(const road of structures){
    if(!road.elevations||road.tunnel)continue;
    const deck=roadDeckGeometry(city,road,road.width,.025),top=new THREE.BufferGeometry();
    top.setAttribute('position',new THREE.BufferAttribute(deck.vertices,3));top.setAttribute('uv',new THREE.BufferAttribute(deck.uv,2));top.setIndex(new THREE.BufferAttribute(deck.indices,1));top.computeVertexNormals();decks.push(top);
    const slab=roadSlabGeometry(city,road),base=new THREE.BufferGeometry();base.setAttribute('position',new THREE.BufferAttribute(slab.vertices,3));base.setIndex(new THREE.BufferAttribute(slab.indices,1));base.computeVertexNormals();slabs.push(base);
    const surface=(x:number,z:number)=>sampleRoadElevation(city,road,x,z);
    for(const edge of bridgeEdgeSections(city,road,.55)){
      const dx=edge.b[0]-edge.a[0],dz=edge.b[1]-edge.a[1],lengthSquared=dx*dx+dz*dz;
      const edgeHeight=(x:number,z:number)=>edge.ya+(edge.yb-edge.ya)*Math.max(0,Math.min(1,((x-edge.a[0])*dx+(z-edge.a[1])*dz)/(lengthSquared||1)));
      markings.push(drapedRibbon(city,[edge.a,edge.b],.13,.04,edgeHeight));
    }
    let distance=0;
    if(road.width>8&&road.id!==city.tobinBridge?.lowerRoadId&&road.id!==city.tobinBridge?.upperRoadId)for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
      if(Math.floor(distance/5)%2===0)markings.push(drapedRibbon(city,[a,b],.12,.04,surface));distance+=length;
    }
    for(const p of bridgeBarriers(city,road)){
      const g=new THREE.BoxGeometry(.27,.76,p.length).rotateX(-p.slope).rotateY(p.yaw).translate(p.x,p.y,p.z);rails.push(g);
    }
    for(const p of bridgeSupports(city,road)){
      piers.push(new THREE.BoxGeometry(1.8,p.top-p.bottom,2.4).rotateY(p.yaw).translate(p.x,(p.top+p.bottom)/2,p.z));
      piers.push(new THREE.BoxGeometry(p.width-.5,.55,2.8).rotateY(p.yaw).translate(p.x,p.top-.28,p.z));
    }
  }
  for(const [geometries,material]of [[decks,asphalt],[slabs,steel],[markings,paint],[rails,concrete],[piers,concrete]]as const){
    for(const mesh of mergeSpatialGeometries(geometries,material)){mesh.castShadow=geometries!==markings;mesh.receiveShadow=true;group.add(mesh);}
  }
  group.userData={roads:structures.length,deckHeight:'Estimated profile on official source alignments',collision:'Independent closed decks; clear mapped underpasses'};
  scene.add(group);return group;
}
