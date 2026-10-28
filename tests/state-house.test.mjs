import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {STATE_HOUSE_ID,isStateHouse,splitStateHouseShell} from '../src/render/state-house.ts';
import {loadCentralCity,shellGeometry} from './helpers/metro-city.mjs';

test('State House material treatment preserves every surveyed triangle and only selects the mapped complex',async()=>{
  const city=await loadCentralCity();
  assert.ok(city.geometry.has(STATE_HOUSE_ID),'the treatment must target the existing State House complex');
  assert.deepEqual(city.buildings.filter(isStateHouse).map(b=>b.id),[STATE_HOUSE_ID],'neighboring Beacon Hill buildings remain independently styled');
  const triangleRecords=geometry=>{
    const attributes=['position','normal','uv'].filter(name=>geometry.hasAttribute(name)),p=geometry.getAttribute('position'),records=[];
    for(let i=0;i<p.count;i+=3){const row=[];for(const name of attributes){const a=geometry.getAttribute(name);for(let j=0;j<3;j++)for(let k=0;k<a.itemSize;k++)row.push(a.getComponent(i+j,k));}records.push(JSON.stringify(row));}
    return records;
  };
  for(const roof of [false,true]){
    const source=shellGeometry(city,STATE_HOUSE_ID,roof);assert.ok(source,'both shell parts are present');
    const parts=splitStateHouseShell(source,roof);
    const before=triangleRecords(source).sort(),after=parts.flatMap(part=>triangleRecords(part.geometry)).sort();
    assert.deepEqual(after,before,'surface materials must not alter or drop source geometry');
    if(roof)assert.deepEqual(parts.map(p=>p.kind),['roof']);
    else for(const kind of ['brick','brickWindows','stone','drum'])assert.ok(parts.some(p=>p.kind===kind),`the source includes ${kind} architecture`);
    source.dispose();parts.forEach(p=>p.geometry.dispose());
  }
});
