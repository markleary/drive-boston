import assert from 'node:assert/strict';
import test from 'node:test';
import {waterHeight} from '../src/simulation/water-level.ts';
import {resolveCity} from '../src/simulation/city-tiles.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {pointInside} from '../src/simulation/roads.ts';
import {read,readJson} from './helpers/metro-city.mjs';

const metro=await resolveCity(readJson('city.json'),read);
test('Fens level ignores the high banks of its sparse winding outline without drying the pond',()=>{
  const area=metro.water.find(w=>w.id==='water-merged-181'),level=waterHeight(metro,area);
  // The former bounding-box lattice chose -1.98 m from only 107 samples,
  // leaving a metre-high water sheet at the southern tree-lined shore.
  assert.ok(level>-2.85&&level< -2.45,'the complete pond uses its lower interior rather than the high banks');
  assert.ok(level+.035-sampleElevation(metro,-1818.304,1151.882)<.65,'remove the metre-high level error before constructing the grounded bank');
  let wet=0,visible=0,south=0;
  for(let x=-2060;x<=-1370;x+=6)for(let z=-75;z<=1245;z+=6){
    if(!pointInside([x,z],area.rings[0]))continue;wet++;
    if(sampleElevation(metro,x,z)>level)continue;visible++;
    if(x>=-1900&&x<=-1700&&z>=1000&&z<=1200)south++;
  }
  assert.ok(visible/wet>.6,'a level correction must retain most of the mapped pond');
  assert.ok(south*36>4000,'the southern water around the reported footbridge remains visible');
});

test('Public Garden remains visible and flat DEM ponds retain their existing water plane',()=>{
  const garden=metro.water.find(w=>w.id==='water-merged-232');
  assert.ok(waterHeight(metro,garden)>-3.3&&waterHeight(metro,garden)<-3,'the Public Garden still has an inland pond level');
  for(const [id,level] of [['water-merged-54',-2.78],['water-merged-98',-2.52],['water-merged-195',14.08],['water-merged-13',9.36]]){
    assert.ok(Math.abs(waterHeight(metro,metro.water.find(w=>w.id===id))-level)<.005);
  }
});

test('DEM bank interpolation is excluded and the cache belongs to the terrain as well as the outline',()=>{
  const area={id:'pond',name:'Pond',rings:[[[0,0],[60,0],[60,60],[0,60]]]};
  const heights=Array.from({length:121},(_,i)=>i%11===0||i%11===10||i<11||i>=110?6:0);
  const city={bounds:{minX:0,maxX:60,minZ:0,maxZ:60},elevation:{width:11,height:11,cellSize:6,originX:0,originZ:0,heights}};
  assert.equal(waterHeight(city,area),0,'one-cell bank slopes cannot lift the pond');
  const raised={...city,elevation:{...city.elevation,heights:heights.map(h=>h+10)}};
  assert.equal(waterHeight(raised,area),10,'using the same source outline with a different terrain cannot reuse a stale level');
});

test('a pond smaller than a terrain cell still has a finite fallback level',()=>{
  const area={id:'tiny',name:'Pond',rings:[[[1,1],[4,1],[4,4],[1,4]]]};
  const city={bounds:{minX:0,maxX:6,minZ:0,maxZ:6},elevation:{width:2,height:2,cellSize:6,originX:0,originZ:0,heights:[2,2,2,2]}};
  assert.equal(waterHeight(city,area),2);
});
