import assert from 'node:assert/strict';
import test from 'node:test';
import {FACADE_STYLES} from '../src/render/materials.ts';
import {applyWindowInteriors,insideWindow,interiorLighting,setInteriorLighting,windowGrid,windowInteriorShader} from '../src/render/window-interiors.ts';
import {MeshStandardMaterial} from 'three';

test('every facade style yields a window grid that matches the painted openings',()=>{
  for(const style of FACADE_STYLES){
    const grid=windowGrid(style);
    assert.equal(grid.spacing*grid.columns,6,`${style.id}: columns must tile six metres`);
    assert.ok(grid.width<grid.spacing,`${style.id}: windows must leave a pier between bays`);
    assert.deepEqual(grid.rows,[1.56,4.56]);
    assert.equal(grid.head,style.detail==='gothic'?2:style.detail==='arched'?1:0);
    // Window centres are glazed, the piers between bays and the spandrels are not.
    for(let row=0;row<2;row++)for(let col=0;col<grid.columns;col++){
      const cx=grid.spacing*(col+.5),cy=grid.rows[row];
      assert.ok(insideWindow(grid,cx-grid.width*.25,cy-grid.height*.3),`${style.id}: lower-left pane of column ${col} row ${row}`);
      assert.ok(!insideWindow(grid,cx+grid.spacing/2,cy),`${style.id}: pier after column ${col}`);
      assert.ok(!insideWindow(grid,cx,cy+grid.height/2+.1),`${style.id}: above the lintel`);
      assert.ok(!insideWindow(grid,cx,cy-grid.height/2-.1),`${style.id}: below the sill`);
    }
    // Mullions split the glazing where the painter draws frame bars.
    const [gx,gy]=grid.bars,cx=grid.spacing/2,cy=grid.rows[0];
    if(gx>1)assert.ok(!insideWindow(grid,cx-grid.width/2+grid.width/gx,cy-grid.height*.3),`${style.id}: vertical mullion`);
    if(gy>1)assert.ok(!insideWindow(grid,cx+grid.width*.2,cy-grid.height/2+grid.height/gy),`${style.id}: horizontal mullion`);
    // Arched and pointed heads leave their upper corners solid masonry.
    const corner=insideWindow(grid,cx-grid.width/2+.04,cy+grid.height/2-.04);
    assert.equal(corner,grid.head===0,`${style.id}: head corner`);
    if(grid.head)assert.ok(insideWindow(grid,cx+grid.width*.08,cy+grid.height/2-.12),`${style.id}: apex glazing`);
  }
});

test('interior mapping hooks into the standard facade program with shared lighting uniforms',()=>{
  const style=FACADE_STYLES[1],grid=windowGrid(style);
  const material=applyWindowInteriors(new MeshStandardMaterial(),grid,139+73,.8);
  const shader={uniforms:{},vertexShader:'#include <common>\nvoid main(){\n#include <project_vertex>\n}',fragmentShader:'#include <common>\nvoid main(){\n#include <emissivemap_fragment>\n}'};
  material.onBeforeCompile(shader,undefined);
  assert.ok(shader.vertexShader.includes('vInteriorWorld=(modelMatrix*vec4(transformed,1.0)).xyz'));
  assert.ok(shader.fragmentShader.includes('#include <emissivemap_fragment>'),'the painted emissive stays as the far look');
  assert.ok(shader.fragmentShader.includes('totalEmissiveRadiance*=litMask*(1.0-region);'),'painted glow follows each room switch and is cleared under near windows');
  assert.ok(shader.fragmentShader.indexOf('float lit=')<shader.fragmentShader.indexOf('if(cover>0.002)'),'far and near windows share one per-room light switch');
  assert.ok(shader.fragmentShader.includes('totalEmissiveRadiance+=glow*cover;'));
  assert.ok(shader.fragmentShader.includes('diffuseColor.rgb=mix(diffuseColor.rgb'));
  assert.equal(shader.uniforms.interiorLighting,interiorLighting,'one live lighting uniform for every style');
  assert.deepEqual([shader.uniforms.interiorGrid.value.x,shader.uniforms.interiorGrid.value.w],[grid.spacing,1]);
  assert.deepEqual(shader.uniforms.interiorBars.value.toArray(),grid.bars);
  assert.equal(material.customProgramCacheKey(),'boston-window-interiors-1');
  assert.deepEqual(material.userData.windowInteriors.bays,[2,3],'two-metre bays make two- or three-bay rooms');
  for(const chunk of ['dFdx(vInteriorWorld)','transformDirectionByInverseViewMatrix(nonPerturbedNormal,viewMatrix)','interiorHash(roomId'])assert.ok(windowInteriorShader.fragment.includes(chunk),chunk);
  assert.ok(!/\bvUv\b/.test(windowInteriorShader.fragment),'three no longer declares vUv for map-only materials');
});

test('night lighting turns rooms on and golden hour keeps a few early lamps',()=>{
  setInteriorLighting('day');const day=interiorLighting.value.clone();
  setInteriorLighting('golden');const golden=interiorLighting.value.clone();
  setInteriorLighting('night');const night=interiorLighting.value.clone();
  assert.ok(day.x<golden.x&&golden.x<night.x,'glow rises toward night');
  assert.ok(day.y<golden.y&&golden.y<night.y,'more rooms are lit toward night');
  assert.ok(night.z<golden.z&&golden.z<=day.z,'less daylight reaches rooms at night');
  assert.ok(night.y>=.4&&night.y<=.5,'40 to 50 percent of rooms are lit at night');
  setInteriorLighting('golden');
});
