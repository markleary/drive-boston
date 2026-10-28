import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {facadeStyleIndex} from '../src/render/materials.ts';
import {buildingIdentities,isMissionChurch,isReligiousBuilding} from '../src/simulation/building-identities.ts';
import {prepareNeighborhoodArchitecture} from '../src/render/neighborhood-profiles.ts';
import {loadMetroCity} from './helpers/metro-city.mjs';

const fixture=(fields={})=>({id:'ordinary-building',name:'Unnamed building',center:[0,0],height:72,footprint:[[0,0],[40,0],[40,60],[0,60]],...fields});
const religiousCases=[
  ...Object.keys(buildingIdentities).map(id=>fixture({id,name:'1545 TREMONT ST'})),
  ...['Church','Chapel','Cathedral','Basilica','Synagogue','Mosque','Temple'].map(name=>fixture({name:`Example ${name}`})),
  fixture({kind:'church'}),fixture({kind:'chapel',height:10}),fixture({amenity:'place_of_worship',kind:'yes'}),
  fixture({name:'59 Temple Place',kind:'church'}),fixture({name:'7 Church Ct.',amenity:'place_of_worship'}),
];
const nonReligiousCases=[
  fixture(),fixture({name:'Basilica Leasehold Condominium (Housing)'}),fixture({name:'12 CHURCH ST'}),fixture({name:'24 Temple Street'}),
  ...['Pl','Place','CT','Court','Sq','Square','Ter','Terrace','Dr','Drive','Way','Pkwy','Parkway','Blvd','Boulevard','Cir','Circle','Hwy','Highway','Aly','Alley','Path','Walk','Wharf','Row','Park'].flatMap(suffix=>[fixture({name:`59 Temple ${suffix}`}),fixture({name:`1 Church ${suffix}.`})]),
];
const cases=[...religiousCases,...nonReligiousCases];

test('religious identity, type tags and names take precedence over height; addresses and housing do not',()=>{
  for(const b of religiousCases){assert.equal(isReligiousBuilding(b),true,b.name);assert.equal(facadeStyleIndex(b),10,b.name);}
  for(const b of nonReligiousCases){assert.equal(isReligiousBuilding(b),false,b.name);assert.notEqual(facadeStyleIndex(b),10,b.name);}
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

test('shipped Temple Place and Church Court addresses keep ordinary facades at both distances',async()=>{
  const city=await loadMetroCity({tiles:['1_-1','0_-3']});
  // The shipped far family follows the runtime typology (a detached Charlestown house is clapboard at both distances), so prepare it as the tile builder does.
  prepareNeighborhoodArchitecture(city);
  for(const [id,name]of [['BOS-BQBJ2-G5TIJ-7TP9U','59 Temple Place'],['BOS-HVX3J-QQVH7-HOV5Y','1 CHURCH CT'],['BOS-EVGTT-7V88U-0W43M','7 CHURCH CT']]){
    const b=city.buildings.find(b=>b.id===id);assert.ok(b,id);assert.equal(b.name,name);assert.equal(isReligiousBuilding(b),false,name);
    const style=facadeStyleIndex(b);assert.notEqual(style,10,name);
    const key=`${Math.floor(b.center[0]/city.tiles.size)}_${Math.floor(b.center[1]/city.tiles.size)}`;
    const far=city.far.tiles.get(key).buildings.find(f=>Math.abs(f.height-b.height)<.02&&f.footprint.length===b.footprint.length&&Math.hypot(f.footprint[0][0]-b.footprint[0][0],f.footprint[0][1]-b.footprint[0][1])<.1);
    assert.ok(far,`far hull for ${name}`);assert.equal(far.style,style,`${name}: detailed and shipped distant families disagree`);
  }
});
