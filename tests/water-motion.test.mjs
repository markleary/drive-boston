import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {applyWaterMotion,waterMotion} from '../src/render/water-motion.ts';
import {parkSurface} from '../src/render/area-surfaces.ts';
import {splitStaticGeometry} from '../src/render/static-batches.ts';
import {readJson} from './helpers/metro-city.mjs';

const rectangle=(width,length,x=0)=>[[[x,0],[x+width,0],[x+width,length],[x,length]]];
const water=(rings,name='')=>({id:name,name,rings});

test('wind motion increases with exposed body size while long narrow water stays sheltered',()=>{
  const pond=waterMotion(water(rectangle(40,60))),lake=waterMotion(water(rectangle(350,500))),channel=waterMotion(water(rectangle(15,3000)));
  assert.ok(pond.strength<.06&&pond.speed<.15);
  assert.ok(lake.strength>.95&&lake.speed>.95);
  assert.ok(channel.strength<.07&&channel.speed<.25,'river length alone must not make a narrow channel choppy');
});

test('the Fens is calm while all source reaches of the Charles share broad-river motion',()=>{
  const city=readJson('city.json'),fens=city.water.find(w=>w.id==='water-merged-181'),estuary=city.water.find(w=>w.id==='water-merged-55');
  const calm=waterMotion(fens),charles=estuary.surfaces.filter(s=>s.name==='Charles River').map(s=>waterMotion(estuary,s));
  assert.ok(calm.strength<.06&&calm.speed<.2);
  assert.ok(charles.length>1);assert.ok(charles.every(p=>p.strength>.95&&p.speed>.95));
  assert.ok(charles.every(p=>p===charles[0]),'source boundaries must not produce motion seams');
  const tributary=estuary.surfaces.find(s=>s.name==='Alewife Brook');
  assert.ok(waterMotion(estuary,tributary).strength<charles[0].strength*.2,'small tributary must not inherit harbour motion');
});

test('tile clipping, merging and spatial batching retain each complete water body profile',()=>{
  const city={roads:[]},body=water(rectangle(500,500)),profile=waterMotion(body);
  const bounds=[{minX:0,maxX:250,minZ:0,maxZ:500},{minX:250,maxX:500,minZ:0,maxZ:500}];
  const sheets=bounds.map(b=>applyWaterMotion(parkSurface(city,body.rings,.035,0,b,true),waterMotion(body)));
  const sheltered=waterMotion(water(rectangle(20,20))),pond=applyWaterMotion(parkSurface(city,rectangle(20,20,690),.035,0,undefined,true),sheltered);
  const merged=mergeGeometries([...sheets,pond]),parts=splitStaticGeometry(merged);
  assert.ok(parts.length>1);
  let riverVertices=0,pondVertices=0;
  for(const part of parts){const position=part.attributes.position,motion=part.attributes.waterMotion;assert.equal(motion.count,position.count);
    for(let i=0;i<position.count;i++){const expected=position.getX(i)<600?profile:sheltered;assert.ok(Math.abs(motion.getX(i)-expected.strength)<1e-6);assert.ok(Math.abs(motion.getY(i)-expected.speed)<1e-6);if(position.getX(i)<600)riverVertices++;else pondVertices++;}
    part.dispose();
  }
  assert.ok(riverVertices&&pondVertices);for(const g of [...sheets,pond,merged])g.dispose();
});
