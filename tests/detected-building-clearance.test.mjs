import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {Cuboid,Ray} from '@dimforge/rapier3d-compat';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {meshBuildingIds,usesExactBuildingCollision} from '../src/simulation/building-collisions.ts';
import {pointInside} from '../src/simulation/roads.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {tileCollisionIndices} from '../src/render/tile-geometry.ts';
import {loadMetroCity,windowCity,installExactMeshes} from './helpers/metro-city.mjs';

const sites=[
 {id:'BOS-W4QSH-IA7KI-LI2Y3',road:'13658-0-0',name:'Longwood Avenue',bounds:{minX:-2600,maxX:-2300,minZ:1250,maxZ:1550}},
 {id:'BOS-H2DUR-PMYVD-X1MZ6',road:'12474-0-0',name:'East Newton Street',bounds:{minX:150,maxX:500,minZ:1300,maxZ:1650}},
];

function route(road,lateral){
 const out=[];
 for(let i=1;i<road.points.length;i++){
  const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),steps=Math.ceil(length/2),yaw=Math.atan2(dx,dz);
  for(let j=0;j<steps;j++)out.push({x:a[0]+dx*j/steps+dz/length*lateral,z:a[1]+dz*j/steps-dx/length*lateral,yaw});
  if(i===road.points.length-1)out.push({x:b[0]+dz/length*lateral,z:b[1]-dx/length*lateral,yaw});
 }
 return out;
}

for(const site of sites)test(`automatic detection keeps ${site.name} open beneath its surveyed building`,async()=>{
 const metro=await loadMetroCity({bounds:site.bounds}),city=windowCity(metro,site.bounds);
 const building=city.buildings.find(b=>b.id===site.id),road=city.roads.find(r=>r.id===site.road),data=metro.geometry.get(site.id);
 assert.ok(building&&road&&data,'the real surveyed fixture and its road are packaged');
 assert.equal(meshBuildingIds.has(site.id),false,'this regression must exercise automatic detection, not a legacy exception');
 assert.equal(building.collision,'mesh');assert.ok(building.roadOverlaps.includes(site.road));assert.ok(usesExactBuildingCollision(building));
 const far=metro.index.near(...building.center,0).find(b=>!b.fragment&&Math.abs(b.height-building.height)<.011&&Math.abs(b.base-building.baseElevation)<.011&&b.footprint.length===building.footprint.length&&b.footprint.every((p,i)=>Math.hypot(p[0]-building.footprint[i][0],p[1]-building.footprint[i][1])<.08));
 assert.ok(far?.exactMesh,'flight clearance must also ignore the false convex footprint');
 const centerline=route(road,0);assert.ok(centerline.some(p=>pointInside([p.x,p.z],building.footprint)),'the old convex collider would block this roadway');
 // Isolate this imported building: the regression covers automatic collision,
 // its source shell and generated footing, rather than unrelated streetscape.
 city.buildings=[building];city.roads=[road];city.geometry=metro.geometry;
 city.spawn={x:centerline[0].x,z:centerline[0].z,yaw:centerline[0].yaw};
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));geometry.setIndex(new THREE.BufferAttribute(tileCollisionIndices(data),1));
 const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),scene=new THREE.Group();scene.add(new THREE.Mesh(geometry,material));
 const physics=await DrivingPhysics.create(city);
 try{
  assert.ok(physics.meshBuildingIds.has(site.id),'metadata must bypass the footprint during initial physics construction');
  assert.ok(installExactMeshes(physics,city,scene).has(site.id));scene.updateMatrixWorld(true);physics.world.step();
  const ray=new THREE.Raycaster(),busSection=new Cuboid(1.25,2.1,.1),isBuilding=c=>physics.detailedColliders.has(c.handle);
  let swept=0,overheadHits=0;
  for(const lateral of [-road.width/4,0,road.width/4]){
   const points=route(road,lateral);
   for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],ha=sampleElevation(city,a.x,a.z),hb=sampleElevation(city,b.x,b.z);
    for(const height of [.75,2,4]){
     const start=new THREE.Vector3(a.x,ha+height,a.z),delta=new THREE.Vector3(b.x,hb+height,b.z).sub(start);ray.far=delta.length();ray.set(start,delta.normalize());
     assert.equal(ray.intersectObjects(scene.children,false).length,0,`${site.name} visible shell/footing closes lateral ${lateral} at ${a.x.toFixed(1)},${a.z.toFixed(1)}`);
    }
    const hit=physics.world.castShape({x:a.x,y:ha+2.3,z:a.z},{x:0,y:Math.sin(a.yaw/2),z:0,w:Math.cos(a.yaw/2)},
     {x:b.x-a.x,y:hb-ha,z:b.z-a.z},busSection,0,1,true,undefined,undefined,physics.chassisCollider,physics.body,isBuilding);
    assert.equal(hit,null,`${site.name} bus-height swept clearance is blocked at ${a.x.toFixed(1)},${a.z.toFixed(1)}, lateral ${lateral}`);swept++;
    if(lateral===0){
     const overhead=physics.world.castRay(new Ray({x:a.x,y:ha+4.5,z:a.z},{x:0,y:1,z:0}),100,true,undefined,undefined,physics.chassisCollider,physics.body,isBuilding);
     if(overhead)overheadHits++;
    }
   }
  }
  assert.ok(swept>100,'continuous sweeps must cover the complete approach and passage');
  assert.ok(overheadHits>0,'the real overhead link must remain present and collidable');
 }finally{physics.dispose();scene.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});material.dispose();}
});
