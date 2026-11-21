import assert from 'node:assert/strict';
import test from 'node:test';
import {SITE_MODELS,buildSite,replacesSiteShell,siteAdditions,siteFor} from '../src/render/site-landmarks.ts';
import {siteKit} from '../src/render/site-kit.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {drawnStreets} from '../src/simulation/drawn-streets.ts';
import {pointInside} from '../src/simulation/roads.ts';
import {loadMetroCity,loadTileHeaders} from './helpers/metro-city.mjs';

// Every hand-built site landmark, built on the packaged building it replaces (or at its own place) with the kit's
// plain materials: node has no canvas, and the geometry does not depend on the textures.
const metro=await loadMetroCity({tiles:[...new Set(SITE_MODELS.map(s=>s.tile))]});
const buildings=new Map([...metro.loadedTiles.values()].flatMap(t=>t.buildings).map(b=>[b.id,b])),kit=siteKit();
const built=new Map(SITE_MODELS.map(site=>[site.id,buildSite(metro,site,site.building?buildings.get(site.building):undefined,false,kit)]));
const bounds=model=>{const b=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];for(const mesh of model.group.children){const p=mesh.geometry.getAttribute('position').array;for(let i=0;i<p.length;i++){const k=i%3;if(p[i]<b[k])b[k]=p[i];if(p[i]>b[k+3])b[k+3]=p[i];}}return b;};

test('every site names its place, its tile and, where it replaces a shell, a building of that tile',()=>{
 const places=new Set(metro.landmarks.map(l=>l.id)),ids=new Set();
 for(const site of SITE_MODELS){
  assert.ok(!ids.has(site.id),`${site.id} is listed twice`);ids.add(site.id);
  assert.ok(places.has(site.place),`${site.id}: ${site.place} is no place of the list`);
  assert.ok(metro.loadedTiles.has(site.tile),`${site.id}: no tile ${site.tile}`);
  assert.ok(site.note.length>30,`${site.id} says what it is modelled from`);
  if(site.building){const b=buildings.get(site.building);assert.ok(b,`${site.id}: ${site.building} is not in the package`);assert.ok(metro.loadedTiles.get(site.tile).buildings.includes(b),`${site.id}: ${site.building} is not in tile ${site.tile}`);assert.equal(siteFor(b),site);}
  else{assert.ok(site.at,`${site.id} is an addition and says where it stands`);const [tx,tz]=site.tile.split('_').map(Number);assert.ok(Math.floor(site.at[0]/1000)===tx&&Math.floor(site.at[1]/1000)===tz,`${site.id} stands in its own tile`);assert.ok(siteAdditions(site.tile).includes(site));}
  for(const id of [site.building,...site.replaces??[]].filter(Boolean)){assert.ok(buildings.has(id)||metro.far,`${site.id}: ${id}`);assert.ok(replacesSiteShell({id}));}
 }
});

test('every model is finite, of a sane size, stands on its ground and is solid',()=>{
 for(const site of SITE_MODELS){
  const model=built.get(site.id),b=bounds(model),record=site.building?buildings.get(site.building):undefined,[cx,cz]=record?.center??site.at;
  assert.ok(b.every(Number.isFinite),`${site.id} has a vertex that is no number`);
  for(const mesh of model.group.children){const p=mesh.geometry.getAttribute('position').array,n=mesh.geometry.getAttribute('normal').array;assert.ok(p.every(Number.isFinite)&&n.every(Number.isFinite),`${site.id}: ${mesh.material.name}`);assert.equal(p.length%9,0);}
  assert.ok(model.triangles>150,`${site.id} is more than a box (${model.triangles} triangles)`);
  assert.ok(model.triangles<90000,`${site.id} is ${model.triangles} triangles: too heavy for a tile's building stage`);
  // In plan it stays about its footprint (or its own place): no part flung across the block.
  const reach=record?Math.max(...record.footprint.map(p=>Math.hypot(p[0]-cx,p[1]-cz)))+30:140;
  assert.ok(b[0]>cx-reach&&b[3]<cx+reach&&b[2]>cz-reach&&b[5]<cz+reach,`${site.id} reaches ${[cx-b[0],b[3]-cx,cz-b[2],b[5]-cz].map(v=>v.toFixed(0))} m from its centre (limit ${reach.toFixed(0)})`);
  // It meets its ground: its lowest point at or under the terrain (or the water) there, and not buried by a storey.
  const ground=Math.min(sampleElevation(metro,cx,cz),record?.baseElevation??Infinity);
  assert.ok(b[1]<=ground+.6,`${site.id} floats: lowest point ${b[1].toFixed(2)}, ground ${ground.toFixed(2)}`);
  assert.ok(b[1]>ground-9,`${site.id} is sunk: lowest point ${b[1].toFixed(2)}, ground ${ground.toFixed(2)}`);
  assert.ok(b[4]-ground>2&&b[4]-ground<120,`${site.id} is ${(b[4]-ground).toFixed(1)} m high`);
  const solid=model.collisions.reduce((n,c)=>n+c.indices.length/3,0);
  assert.ok(solid>=8,`${site.id} has a collider (${solid} triangles)`);assert.ok(solid<20000,`${site.id}: ${solid} collider triangles`);
  for(const c of model.collisions)assert.ok(c.vertices.every(Number.isFinite));
 }
});

test('a model that replaces a shell is about as tall as the building it stands for, or says why not',()=>{
 for(const site of SITE_MODELS){
  if(!site.building)continue;
  const record=buildings.get(site.building),b=bounds(built.get(site.id)),height=b[4]-(record.baseElevation??sampleElevation(metro,...record.center));
  assert.ok(height>=Math.min(record.height,6)*.6,`${site.id} is ${height.toFixed(1)} m where its shell is ${record.height.toFixed(1)} m`);
 }
});

test('no model puts a collider on the roadway its tile draws',()=>{
 // A shell's own footprint can touch the drawn pavement by centimetres (so did its hull); beyond 0.6 m of the
 // footprints a model stands for, nothing solid within a storey of the ground may lie on a street.
 const headers=loadTileHeaders(metro,[...metro.loadedTiles.keys()]);
 const off=(p,fp)=>{if(pointInside(p,fp))return 0;let d=Infinity;for(let i=0;i<fp.length;i++){const a=fp[i],b=fp[(i+1)%fp.length],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));d=Math.min(d,Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz));}return d;};
 for(const site of SITE_MODELS){
  const footprints=[site.building,...site.replaces??[],...Object.keys(site.finish??{})].filter(Boolean).map(id=>buildings.get(id)?.footprint).filter(Boolean);
  for(const c of built.get(site.id).collisions){
   const v=c.vertices;
   for(let i=0;i<v.length;i+=9){
    const low=Math.min(v[i+1],v[i+4],v[i+7]);
    for(const [x,z] of [[v[i],v[i+2]],[v[i+3],v[i+5]],[v[i+6],v[i+8]],[(v[i]+v[i+3]+v[i+6])/3,(v[i+2]+v[i+5]+v[i+8])/3]]){
     if(low>sampleElevation(metro,x,z)+4.5)continue;
     const tile=headers.get(`${Math.floor(x/1000)}_${Math.floor(z/1000)}`);if(!tile||!drawnStreets(tile).paved(x,z))continue;
     assert.ok(footprints.some(fp=>off([x,z],fp)<.6),`${site.id} is solid on a street at ${x.toFixed(1)}, ${z.toFixed(1)}`);
    }
   }
  }
 }
});
