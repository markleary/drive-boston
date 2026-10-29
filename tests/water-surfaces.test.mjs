import assert from 'node:assert/strict';
import test from 'node:test';
import {parkSurface,WATER_SURFACE_OFFSET} from '../src/render/area-surfaces.ts';
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
