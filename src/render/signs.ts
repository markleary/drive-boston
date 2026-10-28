import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { textSign } from './materials';

/** Two independently outward-facing surfaces: lettering reads left to right
 * from either approach, including when the sign is reflected in a window. */
export function createStreetSign(name:string) {
  const front=new THREE.PlaneGeometry(2.65,.48).translate(0,0,.025);
  const back=new THREE.PlaneGeometry(2.65,.48).rotateY(Math.PI).translate(0,0,-.025);
  const geometry=mergeGeometries([front,back],false)!;
  front.dispose();back.dispose();
  const material=textSign(name);
  material.side=THREE.FrontSide;
  const sign=new THREE.Mesh(geometry,material);
  sign.name=`Street sign: ${name}`;
  return sign;
}
