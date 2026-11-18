import * as THREE from 'three';
import type {CityArea,CityData,Point2} from '../types.ts';
import type {ParkOptions} from './city-parks.ts';
import {FROG_POND,FROG_POND_LEVEL,frogPondApron} from '../simulation/boston-common.ts';
import {sampleElevation} from '../simulation/terrain.ts';
import {TriangleWriter} from './geometry-writer.ts';
import {parkSurfaceSteps,WATER_SURFACE_OFFSET} from './area-surfaces.ts';
import {applyWaterMotion,waterMotion} from './water-motion.ts';

function distanceToSegment(p:Point2,a:Point2,b:Point2){
  const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);
}

const frogPondConcrete=new THREE.MeshStandardMaterial({color:'#b7afa3',roughness:.93});

/** This wading pool has a concrete rim and a level surface. The apron ties
 * the rim back into the sloped paths without changing their terrain heights. */
export function* frogPondSteps(city:CityData,water:CityArea,waterMaterial:THREE.Material,{onShore,pace}:ParkOptions){
  const level=FROG_POND_LEVEL,rimHeight=level+.23,ring=water.rings[0];
  const apron=yield* parkSurfaceSteps(city,[frogPondApron,ring],{pace,cellSize:.5,smooth:true,heightAt:p=>{
    const distance=Math.min(...ring.map((a,i)=>distanceToSegment(p,a,ring[(i+1)%ring.length])));
    const outer=Math.min(...frogPondApron.map((a,i)=>distanceToSegment(p,a,frogPondApron[(i+1)%frogPondApron.length])));
    const t=distance/(distance+outer||1);
    return rimHeight+(sampleElevation(city,...p)+.035-rimHeight)*t;
  }});
  const rim=new TriangleWriter();
  rim.append(apron);
  apron.dispose();
  for(const [i,[ax,az]] of ring.entries()){
    const [bx,bz]=ring[(i+1)%ring.length],base=level-.04;
    rim.triangle(ax,base,az,ax,rimHeight,az,bx,base,bz);
    rim.triangle(bx,base,bz,ax,rimHeight,az,bx,rimHeight,bz);
  }
  const concrete=new THREE.Mesh(rim.geometry(),frogPondConcrete);
  concrete.name='Frog Pond concrete rim';
  concrete.receiveShadow=true;

  const surface=yield* parkSurfaceSteps(city,water.rings,{offset:WATER_SURFACE_OFFSET,flatHeight:level,water:true,basin:true,pace});
  const sheet=new THREE.Mesh(applyWaterMotion(surface,waterMotion(water)),waterMaterial);
  sheet.name='Frog Pond water';
  sheet.receiveShadow=true;
  sheet.userData.noAO=true;
  const pond=new THREE.Group();
  pond.name=FROG_POND;
  pond.add(concrete,sheet);
  const vertices=concrete.geometry.getAttribute('position').array as Float32Array;
  onShore?.(vertices,Uint32Array.from({length:vertices.length/3},(_,i)=>i));
  return pond;
}
