import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createCar} from '../src/render/car.ts';

const state={x:120,y:3,z:-400,yaw:1.2,speed:0,steering:0,braking:false};
const visibleMeshes=car=>{const list=[];car.group.traverseVisible(o=>{if(o instanceof THREE.Mesh)list.push(o);});return list;};
test('a shortened chase boom cannot fill the view with coupe bodywork; headlights stay active',()=>{
  const car=createCar();car.update(state,true);
  const boom=new THREE.Vector3(0,2.3,-7.8).normalize().multiplyScalar(.6).add(new THREE.Vector3(0,.5,0));
  car.group.updateWorldMatrix(true,true);const position=car.group.localToWorld(boom);
  const lights=car.group.children.filter(o=>o instanceof THREE.SpotLight);assert.equal(lights.length,2);
  car.setCameraPosition(position);assert.equal(car.bodyVisible,false);assert.equal(visibleMeshes(car).length,0);assert.ok(lights.every(l=>l.visible&&l.intensity===38));
  car.setCameraPosition(car.group.localToWorld(new THREE.Vector3(0,2.8,-8)));
  assert.equal(car.bodyVisible,true);assert.ok(visibleMeshes(car).length>10);assert.ok(lights.every(l=>l.visible));car.dispose();
});
test('camera clearance follows a rotated or rolled car, including near-plane margin',()=>{
  const car=createCar();const rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(.4,-.8,.5));car.update({...state,rotation},false);car.group.updateWorldMatrix(true,true);
  car.setCameraPosition(car.group.localToWorld(new THREE.Vector3(.9,.2,0)));assert.equal(car.bodyVisible,false);
  car.setCameraPosition(car.group.localToWorld(new THREE.Vector3(4,.2,0)));assert.equal(car.bodyVisible,true);car.dispose();
});
