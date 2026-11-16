import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { loadMetroCity, windowCity } from './helpers/metro-city.mjs';
import { buildCastleIsland } from '../src/render/castle-island.ts';
import { FORT_ID, FORT_FLOOR, fortOutline, fortCourt, fortTerrainCuts, gatePoint } from '../src/simulation/castle-island.ts';
import { pointInside } from '../src/simulation/roads.ts';
import { parkSurface } from '../src/render/area-surfaces.ts';
import { waterShore } from '../src/render/water-shore.ts';
import { inWaterfrontTerrainCut, clipWaterfrontTerrainSteps } from '../src/render/waterfront-terrain.ts';
import { terrainGeometry } from '../src/render/terrain-ground.ts';
import { drain } from '../src/render/pacing.ts';
import { sampleElevation } from '../src/simulation/terrain.ts';
import { ownFarHulls } from '../src/simulation/city-tiles.ts';

const city=await loadMetroCity({tiles:['5_1']}),model=buildCastleIsland(city);
const meshOf=(geometry)=>{const m=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));m.updateMatrixWorld();return m;};
const collision=meshOf(new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(model.collision.vertices,3)).setIndex(new THREE.BufferAttribute(model.collision.indices,1)));
const down=(mesh,x,z)=>new THREE.Raycaster(new THREE.Vector3(x,35,z),new THREE.Vector3(0,-1,0),0,50).intersectObject(mesh);

test('Fort Independence follows its surveyed bastions and replaces exactly the source fort',()=>{
 const fort=city.buildings.find(b=>b.id===FORT_ID);assert.equal(fort.landmark,'fort-independence');
 assert.equal(ownFarHulls(city,fort).length,1);
 for(const p of fort.footprint)assert.ok(fortOutline.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<.02));
 assert.ok(pointInside([5257,1291],fortCourt));
 assert.ok(model.group.children.length<=14);assert.ok(model.group.userData.triangles<8000);
 for(const mesh of model.group.children)for(const attribute of Object.values(mesh.geometry.attributes))assert.ok(attribute.array.every(Number.isFinite));
});

test('the parade ground is open to the sky and a person can pass through the actual gateway',()=>{
 for(const p of [[5257,1291],[5235,1300],[5280,1290]]){
  const hits=down(collision,...p);assert.ok(hits.length);assert.ok(Math.abs(hits[0].point.y-FORT_FLOOR)<.05);
 }
 for(const side of [-1,0,1]){
  const a=gatePoint(side,-2),b=gatePoint(side,24),direction=new THREE.Vector3(b[0]-a[0],0,b[1]-a[1]).normalize();
  assert.equal(new THREE.Raycaster(new THREE.Vector3(a[0],FORT_FLOOR+1.6,a[1]),direction,0,26).intersectObject(collision).length,0);
 }
 for(const side of [-8,8]){
  const a=gatePoint(side,-3),b=gatePoint(side,10),direction=new THREE.Vector3(b[0]-a[0],0,b[1]-a[1]).normalize();
  assert.ok(new THREE.Raycaster(new THREE.Vector3(a[0],FORT_FLOOR+1.6,a[1]),direction,0,13).intersectObject(collision).length>0);
 }
 for(const depth of [0,4,8,12,18])assert.ok(down(collision,...gatePoint(0,depth)).some(hit=>Math.abs(hit.point.y-FORT_FLOOR)<.06));
});

test('Pleasure Bay has a level water sheet where its former harbor level was buried by terrain',()=>{
 const water=city.water.find(w=>w.id==='water-merged-55'),bay=water.surfaces.filter(s=>s.name==='Pleasure Bay');assert.equal(bay.length,1);
 assert.equal(bay[0].level,-3.14);assert.ok(water.surfaces.some(s=>s.name==='Tidal harbour'&&s.level===-4.95));
 const bounds={minX:4700,maxX:4820,minZ:1560,maxZ:1680},surface=bay[0],geometry=parkSurface(city,surface.rings,.035,surface.level,bounds,true,waterShore(water,surface.rings)),mesh=meshOf(geometry);
 for(const p of [[4710,1580],[4750,1620],[4800,1660]]){
  const hits=down(mesh,...p);assert.ok(hits.length,`water visible at ${p}`);assert.ok(Math.abs(hits[0].point.y-(-3.105))<.001);
  assert.ok(inWaterfrontTerrainCut(...p));
 }
 // Real beach, causeway, Head Island and fort remain solid dry land.
 for(const p of [[4240,1590],[4888,2135],[5165,1620],[5257,1291]])assert.equal(inWaterfrontTerrainCut(...p),false,`preserve land at ${p}`);
});

test('terrain replacement removes buried bay grass and the old courtyard mound without cutting adjoining park',()=>{
 for(const [bounds,cuts,absent,present] of [
  [{minX:4700,maxX:4820,minZ:1560,maxZ:1680},undefined,[4750,1620],null],
  [{minX:5140,maxX:5370,minZ:1180,maxZ:1390},fortTerrainCuts,[5257,1291],[5170,1370]],
 ]){
  const local=windowCity(city,bounds),g=terrainGeometry(local);drain(clipWaterfrontTerrainSteps(city,g,undefined,cuts));const mesh=meshOf(g);
  assert.equal(down(mesh,...absent).length,0);if(present)assert.ok(down(mesh,...present).length);
 }
});


test('the entrance approach stays above the convex terrain across its full walking width',()=>{
 for(let depth=-23;depth<-1;depth+=.5)for(const side of [-1.8,0,1.8]){
  const p=gatePoint(side,depth),hits=down(collision,...p);assert.ok(hits.length);
  assert.ok(hits[0].point.y>=sampleElevation(city,...p)+.04,`approach buried at ${side}, ${depth}`);
 }
});
