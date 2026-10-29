import * as THREE from 'three';
import type {CityData,Point2} from '../types';
import type {TransitRoute} from '../simulation/transit.ts';
import {sampleElevation} from '../simulation/terrain.ts';
import {box,PartBatches} from './geometry-writer.ts';

/** Huntington changes to street running at Brigham Circle. The other branches
 * have their own right of way, including west of Huntington's old x cutoff. */
export function reservedTrack(route:Pick<TransitRoute,'line'>,point:Point2){return route.line!=='Green-E'||point[0]>-2460;}

/** Spatial batches keep a distant branch out of the draw list, and write small
 * rail pieces directly into buffers instead of allocating thousands of meshes. */
export function createTransitTracks<R extends TransitRoute>(city:CityData,routes:R[],pointAt:(route:R,distance:number)=>Point2,heightAt:(route:R,distance:number,point:Point2)=>number,hiddenAt:(route:R,distance:number)=>boolean=()=>false){
 const group=new THREE.Group();group.name='Green Line surface infrastructure';
 const iron=new THREE.MeshStandardMaterial({color:0x555c5d,metalness:.7,roughness:.36});
 const concrete=new THREE.MeshStandardMaterial({color:0x777d70,roughness:.95});
 const ballast=new THREE.MeshStandardMaterial({color:0x68665e,roughness:1});
 const beds=new PartBatches(),rails=new PartBatches(),wires=new PartBatches(),supports=new PartBatches();
 const cylinder=new THREE.CylinderGeometry(1,1,1,6),wireCylinder=new THREE.CylinderGeometry(1,1,1,4,1,true),matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0),one=new THREE.Vector3(1,1,1);
 const beam=(batches:PartBatches,a:THREE.Vector3,b:THREE.Vector3,r:number)=>{
  const delta=b.clone().sub(a),length=delta.length();if(length<.001)return;
  q.setFromUnitVectors(up,delta.multiplyScalar(1/length));matrix.compose(a.clone().add(b).multiplyScalar(.5),q,new THREE.Vector3(r,length,r));batches.part(batches===wires?wireCylinder:cylinder,iron,matrix);
 };
 const lines=new Set<string>();
 for(const route of routes.filter(r=>r.kind==='tram')){
  const poles=!lines.has(route.line);lines.add(route.line);let lastPole=-100;
  for(let s=0;s<route.length-1;s+=3){
   if(hiddenAt(route,s+1.5))continue;
   const end=Math.min(route.length,s+3),a=pointAt(route,s),b=pointAt(route,end),dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.001)continue;
   const ya=heightAt(route,s,a),yb=heightAt(route,end,b),cy=(ya+yb)/2,x=(a[0]+b[0])/2,z=(a[1]+b[1])/2,yaw=Math.atan2(dx,dz),tilt=-Math.atan2(yb-ya,length),nx=-dz/length,nz=dx/length;
   q.setFromEuler(new THREE.Euler(tilt,yaw,0,'YXZ'));const span=Math.hypot(length,yb-ya)+.025;
   if(reservedTrack(route,a)){
    const bridge=route.bridges?.some(b=>s>=b.start&&s<=b.end),ground=Math.min(sampleElevation(city,x,z),sampleElevation(city,x+nx*1.25,z+nz*1.25),sampleElevation(city,x-nx*1.25,z-nz*1.25)),depth=bridge?.22:Math.max(.035,cy-ground+.035);
    matrix.compose(new THREE.Vector3(x,cy+.08-depth/2,z),q,one);beds.part(box(2.5,depth,span),route.line==='Green-D'?ballast:concrete,matrix);
   }
   for(const side of [-1,1]){matrix.compose(new THREE.Vector3(x+nx*.7175*side,cy+.095,z+nz*.7175*side),q,one);rails.part(box(.065,.04,span),iron,matrix);}
   beam(wires,new THREE.Vector3(a[0],ya+5.73,a[1]),new THREE.Vector3(b[0],yb+5.73,b[1]),.012);
   if(poles&&s-lastPole>34&&reservedTrack(route,a)){
    lastPole=s;const px=a[0]+nx*1.9,pz=a[1]+nz*1.9,y=sampleElevation(city,px,pz);
    beam(supports,new THREE.Vector3(px,y,pz),new THREE.Vector3(px,ya+6.3,pz),.08);
    beam(supports,new THREE.Vector3(px,ya+6.1,pz),new THREE.Vector3(a[0]-nx*4,ya+6.1,a[1]-nz*4),.035);
   }
  }
 }
 cylinder.dispose();wireCylinder.dispose();
 for(const [batches,name]of [[beds,'Reserved Green Line rail bed'],[rails,'Standard gauge Green Line rails'],[wires,'Green Line overhead wire'],[supports,'Catenary poles']]as const){
  for(const mesh of batches.meshes()){mesh.name=name;mesh.receiveShadow=true;mesh.castShadow=batches===supports;mesh.updateMatrix();mesh.matrixAutoUpdate=false;group.add(mesh);}
 }
 // Empty fixtures do not put these materials into the scene disposal walk.
 for(const material of [iron,concrete,ballast])if(!group.children.some(o=>(o as THREE.Mesh).material===material))material.dispose();
 let lastX=Infinity,lastZ=Infinity;
 return{group,updateVisibility(x:number,z:number){
  if(Math.hypot(x-lastX,z-lastZ)<60)return;lastX=x;lastZ=z;
  for(const object of group.children){const sphere=(object as THREE.Mesh).geometry.boundingSphere!;object.visible=Math.hypot(sphere.center.x-x,sphere.center.z-z)<1400+sphere.radius;}
 }};
}
