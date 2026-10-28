import assert from 'node:assert/strict';
import test from 'node:test';
import {fenwayDiamond,createFenwayRoofSampler} from '../src/render/fenway-layout.ts';
import {prepareNeighborhoodArchitecture,architectureFor} from '../src/render/neighborhood-profiles.ts';

import {loadCentralCity} from './helpers/metro-city.mjs';
test('Fenway diamond is a regulation square aligned to both mapped foul poles',()=>{
  const f=fenwayDiamond(),length=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  for(const[a,b]of[[f.home,f.first],[f.first,f.second],[f.second,f.third],[f.third,f.home]])assert.ok(Math.abs(length(a,b)-27.432)<1e-6);
  assert.ok(Math.abs(length(f.home,f.mound)-18.4404)<1e-6);
  assert.ok(Math.abs(length(f.home,f.left)-94.488)<1e-6);
  assert.ok(Math.abs(length(f.home,f.right)-92.0496)<1e-6);
  assert.ok(f.home[0]<-1850&&f.home[1]>400,'home plate stays in the southwest of the mapped stadium');
  assert.ok(f.second[0]>f.home[0]&&f.second[1]<f.home[1],'fair territory faces northeast');
});

test('Mission Hill typology selects detached houses without replacing every low building',async()=>{
  const city=await loadCentralCity();
  const before=JSON.stringify(city.buildings),result=prepareNeighborhoodArchitecture(city);
  assert.ok(result.tripleDeckers>60&&result.tripleDeckers<350);
  assert.equal(JSON.stringify(city.buildings),before,'classification must preserve all source geometry/data');
  for(const building of city.buildings){
    const style=architectureFor(building);
    if(style){assert.equal(building.district,'Mission Hill');assert.ok(style.floorHeight>=2.65&&style.floorHeight<=3.35);assert.ok(style.front.setback>1.4);}
    if(building.landmark||/church|chapel|hospital/i.test(building.name))assert.equal(style,undefined);
  }
  assert.equal(architectureFor(city.buildings.find(b=>b.id==='BOS-73AP7-T4BL0-O4QDM')),undefined);
  assert.ok(architectureFor(city.buildings.find(b=>b.id==='BOS-VE1SK-58PCI-OUILE')),'the source Hillside Street house receives a three-story wood profile');
});

test('Fenway seat supports include the separate lower-bowl slab without covering the field',()=>{
  const roofAt=createFenwayRoofSampler();
  // The main shell is only Y5.576 here. Its separate lower-bowl component is
  // Y6.478, and must win or decorative chairs disappear inside the real model.
  assert.ok(Math.abs(roofAt(-1840,460)-6.478)<.003);
  assert.ok(Math.abs(roofAt(-1910,435)-6.478)<.003);
  assert.ok(roofAt(-1840,470)>7.4,'the rising main-shell stand must still take precedence farther uphill');
  assert.equal(roofAt(-1850,390),-Infinity,'the open playing field must not acquire a fabricated roof');
  assert.ok(Math.abs(createFenwayRoofSampler(2)(-1840,460)-roofAt(-1840,460)-2)<1e-6,'the source datum offset is applied once');
});
