import * as THREE from 'three';
import {geometryParts} from './car.ts';
import {addTeslaBody,teslaSurfaces,teslaRearSurfaceZ,TESLA_BODY} from './tesla-body.ts';
import {addTeslaDetails} from './tesla-details.ts';
import {addTeslaCabin} from './tesla-cabin.ts';
export {TESLA_BODY,teslaRearSurfaceZ};
export {createTeslaWheelGeometry,createTeslaCaliperGeometry} from './tesla-wheels.ts';

/** 2025 Highland Performance artwork based on the user's front/rear and detail
 * reference views. All vertices use final chassis-local metres: +Z forward,
 * tire contact plane at -.605m. The body, lights and glazing share one surface
 * model so trim follows the panels instead of floating above them. */
export function createTeslaGeometry(){
  const parts=geometryParts();
  addTeslaBody(parts);addTeslaCabin(parts);addTeslaDetails(parts,teslaSurfaces);
  return parts.finish();
}
export function createTeslaWordmarkGeometry(){
  const geometry=new THREE.PlaneGeometry(.46,.086,16,4);geometry.rotateY(Math.PI);geometry.translate(0,.255,0);
  const position=geometry.attributes.position;
  for(let i=0;i<position.count;i++)position.setZ(i,teslaRearSurfaceZ(position.getX(i),position.getY(i))-.003);
  geometry.computeVertexNormals();return geometry;
}

/** Tiny repeating two-over/two-under twill; mipmaps keep the weave quiet at
 * chase-camera distance and no external texture fetch is needed. */
export function createTeslaCarbonTexture(){
  const size=64,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const vertical=(Math.floor(x/8)+Math.floor(y/8))%4<2;
    const across=(vertical?x:y)%8,along=(vertical?y:x)%8;
    const value=104+25*Math.sin(Math.PI*(across+.5)/8)+(vertical?10:0)+3*Math.cos(along*Math.PI);
    const i=(y*size+x)*4;data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
  }
  const texture=new THREE.DataTexture(data,size,size);texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(48,5);
  texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
  texture.anisotropy=4;texture.needsUpdate=true;return texture;
}
