import assert from 'node:assert/strict';
import test from 'node:test';
import {isMissionChurch,splitMissionChurchShell} from '../src/render/mission-church.ts';
import {loadMetroCity,shellGeometry} from './helpers/metro-city.mjs';

const city=await loadMetroCity({tiles:['-3_1']});
const records=geometry=>{
  const p=geometry.attributes.position,n=geometry.attributes.normal,rows=[];
  for(let i=0;i<p.count;i+=3){const row=[];for(let j=0;j<3;j++)for(const a of [p,n])for(let k=0;k<3;k++)row.push(a.getComponent(i+j,k));rows.push(JSON.stringify(row));}
  return rows;
};
test('basilica material partitions retain both surveyed shells and keep windows off the stone spires',()=>{
  const buildings=city.buildings.filter(isMissionChurch);assert.equal(buildings.length,2);
  for(const b of buildings){
    const surfaces=new Set();let stoneVertices=0;
    for(const roof of [false,true]){
      const source=shellGeometry(city,b.id,roof),parts=splitMissionChurchShell(source,b,roof);
      assert.deepEqual(parts.flatMap(p=>records(p.geometry)).sort(),records(source).sort(),`${b.id}: measured vertices or normals changed`);
      for(const {kind,geometry}of parts){
        surfaces.add(kind);assert.ok(geometry.attributes.uv.array.every(Number.isFinite));
        const p=geometry.attributes.position,uv=geometry.attributes.uv;
        for(let i=0;i<p.count;i++){
          if(p.getY(i)>(b.baseElevation??0)+58){assert.ok(['stone','roof'].includes(kind),'spires cannot inherit windowed materials');if(kind==='stone')stoneVertices++;}
          if(kind==='front')assert.ok(uv.getX(i)>-.02&&uv.getX(i)<1.02&&uv.getY(i)>-.001&&uv.getY(i)<1.02,'front atlas covers the facade');
        }
        geometry.dispose();
      }
      source.dispose();
    }
    assert.ok(surfaces.has('front')&&surfaces.has('side')&&surfaces.has('roof')&&surfaces.has('annex'));assert.ok(stoneVertices>0,'surveyed spire vertices received plain stone');
  }
});
