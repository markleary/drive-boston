import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {parkSurface,shoreBankGeometry,WATER_SURFACE_OFFSET} from '../src/render/area-surfaces.ts';
import {waterShore} from '../src/render/water-shore.ts';
import {pointInside} from '../src/simulation/roads.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {resolveCity} from '../src/simulation/city-tiles.ts';
import {read,readJson} from './helpers/metro-city.mjs';

const inside=(p,rings)=>pointInside(p,rings[0])&&!rings.slice(1).some(r=>pointInside(p,r));
const metro=await resolveCity(readJson('city.json'),read);

test('water stays horizontal where a sloping bank rises through it',()=>{
 const city={bounds:{minX:0,maxX:12,minZ:0,maxZ:12},roads:[],elevation:{width:3,height:3,cellSize:6,originX:0,originZ:0,heights:[0,3,6,0,3,6,0,3,6]}};
 const rings=[[[0,0],[12,0],[12,12],[0,12]]],level=2,g=parkSurface(city,rings,WATER_SURFACE_OFFSET,level,undefined,true),p=g.attributes.position,n=g.attributes.normal;
 assert.ok(p.count>0);let shoreline=0;
 for(let i=0;i<p.count;i++){
  assert.ok(Math.abs(p.getY(i)-level-WATER_SURFACE_OFFSET)<1e-6);
  assert.ok(sampleElevation(city,p.getX(i),p.getZ(i))<=level+1e-6,'the bank should emerge instead of lifting the surface');
  assert.ok(n.getY(i)>.99999);if(Math.abs(p.getX(i)-4)<1e-6)shoreline++;
 }
 assert.ok(shoreline>0,'water must meet the bank at the height contour');g.dispose();
});

test('flat water retains island holes and paved ground-road cutouts',()=>{
 const city={bounds:{minX:0,maxX:30,minZ:0,maxZ:30},roads:[{id:'shore',width:4,points:[[0,6],[30,6]]}],elevation:{width:6,height:6,cellSize:6,originX:0,originZ:0,heights:new Array(36).fill(0)}};
 const rings=[[[0,0],[30,0],[30,30],[0,30]],[[12,14],[18,14],[18,20],[12,20]]],g=parkSurface(city,rings,WATER_SURFACE_OFFSET,0,undefined,true),p=g.attributes.position;
 assert.ok(p.count>0);
 for(let i=0;i<p.count;i+=3){
  const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;
  assert.ok(!pointInside([x,z],rings[1]));assert.ok(Math.abs(z-6)>5.04,'the road and its bank allowance must remain dry');
 }
 g.dispose();
});

test('a partial tunnel roof stops both pavement cutouts at its exact station',()=>{
 const road={id:'tunnel',width:4,points:[[0,3],[30,3]],elevations:[-8,-8],tunnel:{clearance:4,covered:[[13,30]]}};
 const city={bounds:{minX:0,maxX:30,minZ:0,maxZ:30},roads:[road]};
 const water={rings:[[[0,0],[30,0],[30,30],[0,30]]]},shore=waterShore(water);
 const bank=[],geometry=parkSurface(city,shore.rings,WATER_SURFACE_OFFSET,0,undefined,true,shore,bank);
 const bankGeometry=shoreBankGeometry(bank),material=new THREE.MeshBasicMaterial(),ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0);
 for(const [surface,z] of [[geometry,4],[bankGeometry,1.6]]){
  const mesh=new THREE.Mesh(surface,material);
  const visible=x=>{ray.set(new THREE.Vector3(x,10,z),down);return ray.intersectObject(mesh,false).length>0;};
  assert.equal(visible(12.9),false,'the open approach retains its pavement cutout');
  assert.equal(visible(13.1),true,'the surface resumes at the roof boundary within a road segment');
  surface.dispose();
 }
 material.dispose();
});

test('harbour water covers the I-90 bores in Fort Point Channel and off South Boston',()=>{
 const probes=[
  [1662.216,329.501],[1656.206,381.679],[1689.312,299.602],
  [3624.64,-65.46],[3625.35,-37.22],[3601.6,-21.63],
 ];
 const water=metro.water.find(w=>w.id==='water-merged-55'),material=new THREE.MeshBasicMaterial(),ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0);
 for(const [x,z] of probes){
  const surface=water.surfaces.find(s=>inside([x,z],s.rings));
  assert.equal(surface?.name,'Tidal harbour');
  const shore=waterShore(water,surface.rings),bounds={minX:x-6,maxX:x+6,minZ:z-6,maxZ:z+6};
  const geometry=parkSurface(metro,shore.rings,WATER_SURFACE_OFFSET,surface.level,bounds,true,shore);
  ray.set(new THREE.Vector3(x,10,z),down);
  const hit=ray.intersectObject(new THREE.Mesh(geometry,material),false)[0];
  assert.ok(hit&&Math.abs(hit.point.y-surface.level-WATER_SURFACE_OFFSET)<1e-5,`the water surface continues over the tunnel at ${x}, ${z}`);
  geometry.dispose();
 }
 material.dispose();
});

test('the Frog Pond water covers both lobes without grass breaking through',()=>{
 const pond=metro.water.find(w=>w.name==='Frog Pond'),[{level,rings}]=pond.surfaces;
 assert.ok(inside([686,-650],pond.rings)&&inside([784,-665],pond.rings));
 const ring=rings[0],g=parkSurface(metro,rings,WATER_SURFACE_OFFSET,level,undefined,true),p=g.attributes.position;
 const basinArea=Math.abs(ring.reduce((sum,[x,z],i)=>{
  const [nextX,nextZ]=ring[(i+1)%ring.length];return sum+x*nextZ-z*nextX;
 },0))/2;
 let waterArea=0;
 for(let i=0;i<p.count;i+=3){
  const x=p.getX(i),z=p.getZ(i);
  waterArea+=Math.abs((p.getX(i+1)-x)*(p.getZ(i+2)-z)-(p.getZ(i+1)-z)*(p.getX(i+2)-x))/2;
 }
 assert.ok(Math.abs(basinArea-waterArea)<.1);
 g.dispose();
});

test('Mattapan screenshot reach keeps a single 1.18 m water level across terrain and tile boundaries',()=>{
 const water=metro.water.find(w=>w.id==='water-merged-55'),surface=water.surfaces.find(s=>inside([-1200,9020],s.rings));
 assert.equal(surface.name,'Neponset River');assert.equal(surface.level,1.18);
 for(const point of [[-1200,9020],[-930,9000],[-690,9060]])assert.ok(inside(point,surface.rings),'one horizontal reach spans the scene');
 const seam=new Set();
 for(const bounds of [{minX:-1260,maxX:-1000,minZ:8900,maxZ:9120},{minX:-1000,maxX:-700,minZ:8900,maxZ:9120}]){
  const g=parkSurface(metro,surface.rings,WATER_SURFACE_OFFSET,surface.level,bounds,true),p=g.attributes.position;
  assert.ok(p.count>300,'the Neponset must remain visible, rather than disappear below the harbour level');
  for(let i=0;i<p.count;i++){
   assert.ok(Math.abs(p.getY(i)-1.215)<1e-6);assert.ok(g.attributes.normal.getY(i)>.99999);
   if(Math.abs(p.getX(i)+1000)<1e-4)seam.add(p.getY(i));
  }
  g.dispose();
 }
 assert.equal(seam.size,1,'streamed tile boundaries cannot choose different levels');
});

test('source basin partitions preserve the merged hydro area without overlapping sheets',()=>{
 const water=metro.water.find(w=>w.id==='water-merged-55');
 const area=ring=>Math.abs(ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0))/2;
 const polygonArea=rings=>area(rings[0])-rings.slice(1).reduce((sum,r)=>sum+area(r),0);
 assert.ok(Math.abs(water.surfaces.reduce((sum,s)=>sum+polygonArea(s.rings),0)-polygonArea(water.rings))<3);
 for(const p of [[-1200,9020],[-1184,-575],[-40,-1455],[4000,0]])assert.equal(water.surfaces.filter(s=>inside(p,s.rings)).length,1);
 assert.deepEqual([...new Set(water.surfaces.filter(s=>s.source==='water-23087-0-0').map(s=>s.level))],[1.18,4.424,6.56]);
});

test('inland additions to the hydro union share the adjoining river level',()=>{
 const water=metro.water.find(w=>w.id==='water-merged-55');
 for(const [x,z,height] of [[-556,-431,-3.18],[-250,8892,1.18],[-79,8899,1.18]]){
  const surface=water.surfaces.find(s=>inside([x,z],s.rings));assert.ok(surface);assert.equal(surface.level,height,'a source-outline addition must not fall to sea level');
  const g=parkSurface(metro,surface.rings,WATER_SURFACE_OFFSET,height,{minX:x-8,maxX:x+8,minZ:z-8,maxZ:z+8},true);
  assert.ok(g.attributes.position.count>0,'inland residual water stays visible above its DEM');g.dispose();
 }
});
