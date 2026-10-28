import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {meshBuildingIds} from '../src/simulation/building-collisions.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {sourceFootingGeometry,addSourceFooting} from '../src/render/source-footings.ts';
import {tileSourceGeometry} from '../src/render/tile-geometry.ts';
import {loadCentralCity} from './helpers/metro-city.mjs';

test('real concave source wall bottoms ground to terrain without filling streets or Fenway field',async()=>{
  const city=await loadCentralCity();
  const generated=new Map(),scene=new THREE.Scene(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();
  for(const id of meshBuildingIds){
    const building=city.buildings.find(x=>x.id===id),data=city.geometry.get(id);
    if(!building){assert.ok(city.metro.landmarkBuildings.some(b=>b.id===id),`${id} must at least be a landmark building`);continue;}
    assert.ok(data,`${id} must be in the central tiles`);
    const source=tileSourceGeometry(data),before=source.attributes.position.array.slice();
    const edges=[],p=source.attributes.position,index=source.index,base=building.baseElevation??0;
    for(let i=0;i<index.count;i+=3){
      const ids=[0,1,2].map(j=>index.getX(i+j));
      a.fromBufferAttribute(p,ids[0]);b.fromBufferAttribute(p,ids[1]);c.fromBufferAttribute(p,ids[2]);normal.crossVectors(b.sub(a),c.sub(a)).normalize();
      if(Math.abs(normal.y)>.28)continue;
      for(let j=0;j<3;j++){
        const u=ids[j],v=ids[(j+1)%3];if(Math.abs(p.getY(u)-base)>.03||Math.abs(p.getY(v)-base)>.03)continue;
        edges.push([[p.getX(u),p.getZ(u)],[p.getX(v),p.getZ(v)]]);
      }
    }
    const footing=sourceFootingGeometry(city,building,source),f=footing.attributes.position;
    assert.ok(f.count>0,`${id} must receive real wall contact`);
    for(let i=0;i<f.count;i++){
      const x=f.getX(i),y=f.getY(i),z=f.getZ(i);
      assert.ok(edges.some(([a,b])=>{
        const dx=b[0]-a[0],dz=b[1]-a[1],length2=dx*dx+dz*dz;if(length2<.001)return false;
        const t=((x-a[0])*dx+(z-a[1])*dz)/length2;
        return t>=-.0001&&t<=1.0001&&Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)<.002;
      }),'every footing vertex must project onto an actual source bottom edge');
      assert.ok(Math.abs(y-base)<.031||Math.abs(y-sampleElevation(city,x,z)+.08)<.003,'vertical extensions must end on the terrain, with no floating bottom');
    }
    const collider=addSourceFooting(scene,city,building,source),visible=scene.children.at(-1);
    assert.deepEqual(collider.vertices,visible.geometry.attributes.position.array,'rendering and collision must use identical triangles');
    assert.deepEqual(source.attributes.position.array,before,'measured source walls must never be moved');
    generated.set(id,visible);footing.dispose();source.dispose();
  }
  assert.deepEqual(new Set(generated.keys()),new Set([...meshBuildingIds].filter(id=>city.buildings.some(b=>b.id===id))),'every exact-mesh building in the central tiles gets a footing');
  scene.updateMatrixWorld(true);
  const ray=new THREE.Raycaster();
  for(const[x,z]of[[-400,340],[67.477,283.182],[-1850,390]]){
    ray.set(new THREE.Vector3(x,sampleElevation(city,x,z)+25,z),new THREE.Vector3(0,-1,0));ray.far=40;
    assert.equal(ray.intersectObjects(scene.children,false).length,0,'street corridors and the open field must not receive a foundation cap');
  }
  // An actual Van Ness facade edge used to hang 3.6 m above terrain here.
  const x=-1825.8838623046875,z=488.3779556274414,nx=.34191557765,nz=.9397306442;
  ray.set(new THREE.Vector3(x+nx,1.2,z+nz),new THREE.Vector3(-nx,0,-nz));ray.far=2;
  assert.ok(ray.intersectObject(generated.get('BOS-73AP7-T4BL0-O4QDM'),false).length>0,'the street-visible gap below Fenway must be closed along the real wall');
  for(const mesh of scene.children)mesh.geometry.dispose();
});
