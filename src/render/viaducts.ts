import * as THREE from 'three';
import type {CityData} from '../types';
import type {TileBuildingGeometry} from '../simulation/tile-format.ts';
import {surveyViaductSupports} from '../simulation/viaduct-supports.ts';
import {mergeSpatialGeometries} from './spatial-batches.ts';

/** Land-side approach supports only; the survey bridge and tunnel end stay intact. */
export function addSurveyViaductSupports(target:THREE.Object3D,city:CityData,data:TileBuildingGeometry){
  const supports=surveyViaductSupports(city,data),parts:THREE.BufferGeometry[]=[];
  for(const p of supports){
    parts.push(new THREE.BoxGeometry(2.2,p.top-p.bottom,2.6).rotateY(p.yaw).translate(p.x,(p.top+p.bottom)/2,p.z));
    parts.push(new THREE.BoxGeometry(p.width,.85,3.2).rotateY(p.yaw).translate(p.capX,p.top-.425,p.capZ));
    parts.push(new THREE.BoxGeometry(4.2,.8,4.6).rotateY(p.yaw).translate(p.x,p.bottom+.4,p.z));
  }
  const group=new THREE.Group();group.name='Land-side survey viaduct piers';group.userData={supports:supports.length,excludes:'Zakim water span and Big Dig tunnel mouth'};
  const material=new THREE.MeshStandardMaterial({color:'#a5a398',roughness:.95});
  const collisions:{vertices:Float32Array;indices:Uint32Array}[]=[];
  for(const mesh of mergeSpatialGeometries(parts,material)){
    mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);const g=mesh.geometry,p=g.getAttribute('position');
    collisions.push({vertices:new Float32Array(p.array),indices:g.index?new Uint32Array(g.index.array):Uint32Array.from({length:p.count},(_,i)=>i)});
  }
  target.add(group);return{group,collisions};
}
