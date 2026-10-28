import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {facadeStyleFor,stabilizeFacadeUVs} from '../src/render/materials.ts';
import {expandTriangles} from '../src/render/tile-geometry.ts';
import {loadCentralCity,loadMetroCity} from './helpers/metro-city.mjs';
import {tileShellGeometry} from '../src/render/tile-geometry.ts';
import {prepareNeighborhoodArchitecture,architectureFor} from '../src/render/neighborhood-profiles.ts';
import {windowGrid,insideWindow} from '../src/render/window-interiors.ts';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

test('named church spires keep masonry instead of inheriting office-tower materials',async()=>{
  const city=await loadCentralCity();
  for(const name of ['Old South Church','Arlington Street Church']){
    const building=city.buildings.find(b=>b.name===name);assert.ok(building,`missing source church: ${name}`);
    const style=facadeStyleFor(building);assert.equal(style.kind,'stone');assert.equal(style.detail,'gothic');
  }
});

test('Lowell and Summer Street facades use wall eaves rather than the roof peak as their window limit',async()=>{
  const city=await loadMetroCity({tiles:['-3_-5','-4_-5']});
  prepareNeighborhoodArchitecture(city);
  for(const id of ['osm-way-29516178','osm-way-29516172','osm-way-29532161','osm-way-29532168']){
    const b=city.buildings.find(b=>b.id===id);assert.ok(b);
    const data=city.geometry.get(id),g=tileShellGeometry(data,b,false),profile=architectureFor(b);
    if(profile){
      const floors=b.eaveHeight<8.3?2:3;
      assert.ok(Math.abs(profile.raisedBase+profile.floorHeight*floors-b.eaveHeight)<1e-6,'occupied floors end at the eaves, not the ridge');
      if(floors===2)assert.equal(profile.kind,'wood-frame','no third porch floor on a two-storey wall');
    }
    const expected=(b.eaveHeight-(profile?.raisedBase??0))/(profile?profile.floorHeight*2:6)*6;
    assert.ok(g.attributes.facadeTop.array.every(v=>Math.abs(v-expected)<1e-5));
    const grid=windowGrid(facadeStyleFor(b)),headRow=Math.floor(expected/3)*3+1.56;
    assert.ok(!insideWindow(grid,grid.spacing/2+.1,headRow,expected),'roof/attic row must not have glazing');
    assert.ok(b.eaveHeight<=b.height);
    const roof=tileShellGeometry(data,b,true),merged=mergeGeometries([g,roof]);
    assert.ok(merged,'park/landmark finishes must still batch roof and facade geometry together');
    roof.dispose();merged.dispose();
    g.dispose();
  }
});

function sharedEdgeJumps(geometry){
  const p=geometry.attributes.position,n=geometry.attributes.normal,uv=geometry.attributes.uv,edges=new Map();
  let checked=0,jumps=0;
  for(let i=0;i<p.count;i+=3){
    if(Math.abs(n.getY(i))>.25)continue;
    for(let j=0;j<3;j++){
      const a=i+j,b=i+(j+1)%3;
      const pa=[p.getX(a),p.getY(a),p.getZ(a)].map(v=>v.toFixed(3)).join(','),pb=[p.getX(b),p.getY(b),p.getZ(b)].map(v=>v.toFixed(3)).join(',');
      if(pa===pb)continue;
      const first=pa<pb?a:b,last=pa<pb?b:a,key=pa<pb?`${pa}|${pb}`:`${pb}|${pa}`;
      const item={u:[uv.getX(first)*6,uv.getX(last)*6],normal:[n.getX(i),n.getY(i),n.getZ(i)]},previous=edges.get(key);
      if(!previous){edges.set(key,item);continue;}
      if(previous.normal.reduce((sum,v,k)=>sum+v*item.normal[k],0)<Math.cos(Math.PI/120))continue;
      checked++;
      const delta=Math.max(...item.u.map((u,k)=>{const d=Math.abs(u-previous.u[k])%6;return Math.min(d,6-d);}));
      if(delta>.02)jumps++;
    }
  }
  return {checked,jumps};
}

/** Each survey facet projected along its own normal: the per-face mapping the
 * original GLB carried, whose phase breaks the stabilization removes. */
function naiveFacadeGeometry(data){
  const flat=expandTriangles(data.positions,data.facade),geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(flat,3));geometry.computeVertexNormals();
  const n=geometry.attributes.normal,uv=new Float32Array(flat.length/3*2);
  for(let i=0;i<flat.length/3;i++){const nx=n.getX(i),nz=n.getZ(i),h=Math.hypot(nx,nz)||1;uv[i*2]=(flat[i*3]*nz/h-flat[i*3+2]*nx/h)/6;uv[i*2+1]=flat[i*3+1]/6;}
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  return geometry;
}

test('survey-wall UV stabilization removes texture phase breaks without changing geometry',async t=>{
  const city=await loadCentralCity();
  let before=0,after=0,checked=0,buildings=0;
  for(const building of city.buildings){
    const data=city.geometry.get(building.id);if(!data||!data.facade.length)continue;
    const geometry=naiveFacadeGeometry(data);buildings++;
    const positions=geometry.attributes.position.array.slice(),normals=geometry.attributes.normal.array.slice();
    const original=sharedEdgeJumps(geometry);before+=original.jumps;checked+=original.checked;
    stabilizeFacadeUVs(geometry,building);
    after+=sharedEdgeJumps(geometry).jumps;
    assert.deepEqual(geometry.attributes.position.array,positions,'measured building vertices changed');
    assert.deepEqual(geometry.attributes.normal.array,normals,'measured surface normals changed');
    assert.ok(geometry.attributes.uv.array.every(Number.isFinite),'UV projection produced nonfinite coordinates');
    geometry.dispose();
  }
  assert.ok(buildings>3000&&checked>10000,'test must inspect the real district asset');
  assert.ok(before>500,'source fixture no longer reproduces the phase discontinuities');
  assert.ok(after<before*.1,`expected at least 90% fewer nearly planar texture breaks; got ${before} -> ${after}`);
  t.diagnostic(`${buildings} buildings, ${checked} shared edges checked: ${before} -> ${after} texture phase breaks over 2cm; source positions/normals unchanged.`);
});
