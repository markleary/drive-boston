import assert from 'node:assert/strict';
import test from 'node:test';
import {FACADE_STYLES} from '../src/render/materials.ts';
import {applyWindowInteriors,insideWindow,interiorLighting,setInteriorLighting,windowGrid,windowRowFits,windowInteriorShader} from '../src/render/window-interiors.ts';
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
    // A profile's raised ground floor leaves the wall below row zero as
    // foundation: the previous tile's upper row never shows there, even though
    // its head would reach 0.09 m above the base on the periodic texture.
    const cx0=grid.spacing/2;
    assert.ok(!insideWindow(grid,cx0,grid.rows[1]-6),`${style.id}: no window centred below the base`);
    assert.ok(!insideWindow(grid,cx0,-.02),`${style.id}: no glazing just below the base`);
    assert.ok(insideWindow(grid,cx0-grid.width*.25,grid.rows[1]-grid.height*.3),`${style.id}: the upper row itself is glazed`);
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
  assert.equal(material.customProgramCacheKey(),'boston-window-interiors-3');
  assert.ok(shader.fragmentShader.includes('float basement=1.0-smoothstep(-py,py,tile.y);')&&shader.fragmentShader.includes('cover*=1.0-basement;'),'the wall below row zero is foundation, not a room');
  assert.deepEqual(material.userData.windowInteriors.bays,[2,3],'two-metre bays make two- or three-bay rooms');
  for(const chunk of ['dFdx(vInteriorWorld)','transformDirectionByInverseViewMatrix(nonPerturbedNormal,viewMatrix)','interiorHash(roomId'])assert.ok(windowInteriorShader.fragment.includes(chunk),chunk);
  assert.ok(!/\bvUv\b/.test(windowInteriorShader.fragment),'three no longer declares vUv for map-only materials');
});

test('a row is either wholly below the eaves or has no glazing, near or far',()=>{
  for(const style of FACADE_STYLES){
    const grid=windowGrid(style),head=7.56+grid.height/2+.22;
    assert.ok(windowRowFits(grid,7.56,head+.001));
    assert.ok(!windowRowFits(grid,7.56,head-.001));
    // A roof at 7.2 used to slice the third row into a short strip. Even the
    // portion of that opening below the roof must now be wall, not glass.
    assert.ok(!insideWindow(grid,grid.spacing/2+.1,7.56-grid.height*.3,7.2));
    assert.ok(insideWindow(grid,grid.spacing/2+.1,4.56-grid.height*.3,7.2));
    assert.ok(!insideWindow(grid,grid.spacing/2+.1,10.56-grid.height*.3,8.85),'no attic row through the gable');
  }
  assert.ok(windowInteriorShader.fragment.includes('diffuseColor.rgb=texture2D(interiorWallMap,vMapUv).rgb;'));
  assert.ok(windowInteriorShader.fragment.includes('totalEmissiveRadiance=vec3(0.0);\n    cover=0.0;'));
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
