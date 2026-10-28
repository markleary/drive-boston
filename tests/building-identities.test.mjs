import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {facadeStyleIndex} from '../src/render/materials.ts';
import {buildingIdentities,isMissionChurch,isReligiousBuilding} from '../src/simulation/building-identities.ts';
import {loadMetroCity} from './helpers/metro-city.mjs';

const fixture=(fields={})=>({id:'ordinary-building',name:'Unnamed building',center:[0,0],height:72,footprint:[[0,0],[40,0],[40,60],[0,60]],...fields});
const cases=[
  ...Object.keys(buildingIdentities).map(id=>fixture({id,name:'1545 TREMONT ST'})),
  ...['Church','Chapel','Cathedral','Basilica','Synagogue','Mosque','Temple'].map(name=>fixture({name:`Example ${name}`})),
  fixture({kind:'church'}),fixture({kind:'chapel',height:10}),fixture({amenity:'place_of_worship',kind:'yes'}),
  fixture(),fixture({name:'Basilica Leasehold Condominium (Housing)'}),fixture({name:'12 CHURCH ST'}),fixture({name:'24 Temple Street'}),
];

test('religious identity, type tags and names take precedence over height; addresses and housing do not',()=>{
  for(const b of cases.slice(0,-4)){assert.equal(isReligiousBuilding(b),true,b.name);assert.equal(facadeStyleIndex(b),10,b.name);}
  for(const b of cases.slice(-4)){assert.equal(isReligiousBuilding(b),false,b.name);assert.notEqual(facadeStyleIndex(b),10,b.name);}
});

test('Python far-style compiler and detailed renderer agree on semantic priority and massing fallback',()=>{
  const result=spawnSync('python3',['-c',`import sys,json;sys.path.insert(0,'scripts');from building_semantics import facade_style;print(json.dumps([facade_style(b) for b in json.load(sys.stdin)]))`],{cwd:new URL('..',import.meta.url),input:JSON.stringify(cases),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),cases.map(facadeStyleIndex));
});

test('both shipped address-only basilica meshes have corrected identities and matching distant masonry',async()=>{
  const city=await loadMetroCity({tiles:['-3_1']});
  for(const id of Object.keys(buildingIdentities)){
    const b=city.buildings.find(b=>b.id===id);assert.ok(b,id);assert.ok(isMissionChurch(b));
    assert.equal(b.name,'Basilica of Our Lady of Perpetual Help');assert.equal(b.kind,'church');assert.equal(b.landmark,'mission-church');
    assert.match(b.sourceName,/1545.*TREMONT ST/);assert.equal(facadeStyleIndex(b),10);
    const catalog=city.landmarkBuildings.find(b=>b.id===id);assert.equal(catalog.name,b.name);assert.equal(catalog.kind,'church');
    const far=city.far.tiles.get('-3_1').buildings.find(f=>Math.abs(f.height-b.height)<.02&&f.footprint.length===b.footprint.length&&Math.hypot(f.footprint[0][0]-b.footprint[0][0],f.footprint[0][1]-b.footprint[0][1])<.1);
    assert.ok(far,`far hull for ${id}`);assert.equal(far.style,10);assert.equal(far.landmark,true);
  }
});
