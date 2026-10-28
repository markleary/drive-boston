import assert from 'node:assert/strict';
import test from 'node:test';
import {expandTriangles,tileShellGeometry} from '../src/render/tile-geometry.ts';
import {loadMetroCity} from './helpers/metro-city.mjs';

test('survey expansion drops collapsed faces while preserving even very small real surfaces',()=>{
  const positions=new Float32Array([
    339.56,-.193,-815.981, 339.56,13.897,-815.981, 339.56,15.857,-815.981,
    0,0,0, 1,0,0, 0,1,0,
    0,0,1, .00001,0,1, 0,.00001,1,
  ]);
  const indices=new Uint32Array([0,1,2, 3,4,5, 3,3,3, 6,7,8]);
  assert.deepEqual(expandTriangles(positions,indices),positions.slice(9));
  assert.equal(expandTriangles(positions,indices.subarray(0,3)).length,0);
  assert.equal(tileShellGeometry({positions,facade:indices.subarray(0,3),roof:[]},{},false),undefined);
});

test('Back Bay survey shells have finite unit normals, including the helicopter flash locations',async t=>{
  const city=await loadMetroCity({tiles:['0_-1']});let removed=0,surfaces=0;
  for(const building of city.buildings){
    const data=city.geometry.get(building.id);
    for(const roof of [false,true]){
      const source=roof?data.roof:data.facade,g=tileShellGeometry(data,building,roof);
      removed+=source.length/3-(g?.attributes.position.count??0)/3;
      if(!g)continue;
      const normals=g.attributes.normal;
      for(let i=0;i<normals.count;i++)assert.ok(Math.abs(Math.hypot(normals.getX(i),normals.getY(i),normals.getZ(i))-1)<1e-6,`${building.id}: invalid surface normal`);
      assert.ok(g.attributes.uv.array.every(Number.isFinite));surfaces++;g.dispose();
    }
  }
  assert.ok(removed>=5,'fixture must include the collapsed gray-granite and brick-loft faces');
  assert.ok(surfaces>100,'inspect the actual surveyed tile');t.diagnostic(`${removed} zero-area faces removed; ${surfaces} real surfaces retained.`);
});
