import assert from 'node:assert/strict';
import test from 'node:test';
import {HOUSE_PALETTES,HOUSE_ROOFS,houseFloors,housePalette,houseRoof,victorianEra} from '../src/render/house-styles.ts';
import {edgeDistance,houseFront,housePlan} from '../src/render/house-plan.ts';
import {pointInside} from '../src/simulation/roads.ts';

test('house paint follows the era: polychrome Victorians, quiet later houses, and the far city mirror agrees',()=>{
  // scripts/building_semantics.py house_palette() returns the same indices (scripts/test_north_houses.py pins them too).
  const cases=[{id:'osm-way-29809314',houseStyle:'victorian',yearBuilt:1890},{id:'osm-way-555',houseStyle:'two-family',yearBuilt:1900},{id:'osm-way-556',houseStyle:'old-style',yearBuilt:1830},{id:'x1',houseStyle:'ranch'},{id:'osm-way-1',houseStyle:'garage'}];
  assert.deepEqual(cases.map(housePalette),[17,13,13,17,12]);
  let victorian=0,colonial=0;
  for(let i=0;i<4000;i++){
    if(HOUSE_PALETTES[housePalette({id:`osm-way-${1000+i}`,houseStyle:'victorian'})].scales)victorian++;
    if(HOUSE_PALETTES[housePalette({id:`osm-way-${1000+i}`,houseStyle:'colonial'})].scales)colonial++;
  }
  assert.ok(Math.abs(victorian/4000-.72)<.02,'about 72% of Victorians take a polychrome scheme');
  assert.ok(colonial/4000<.08,'later colonials mostly quiet');
  assert.equal(victorianEra({id:'a',houseStyle:'old-style',yearBuilt:1890}),true);
  assert.equal(victorianEra({id:'a',houseStyle:'old-style',yearBuilt:1925}),false);
  assert.equal(victorianEra({id:'a',houseStyle:'mansard'}),true);
});

test('roofs and storeys: mansards are slate, flat roofs gravel, garages one low storey',()=>{
  for(let i=0;i<50;i++)assert.ok(['slate','patterned-slate'].includes(HOUSE_ROOFS[houseRoof({id:`m${i}`,houseStyle:'mansard',roofShape:'mansard'})].kind));
  assert.equal(houseRoof({id:'a',houseStyle:'victorian',roofShape:'flat'}),-1);
  for(let i=0;i<50;i++)assert.equal(HOUSE_ROOFS[houseRoof({id:`g${i}`,houseStyle:'garage',roofShape:'gabled'})].kind,'shingle');
  const two=houseFloors({id:'a',houseStyle:'victorian',height:11,eaveHeight:6.9});
  assert.equal(two.floors,2);assert.ok(Math.abs(two.floorHeight-3.15)<1e-9);assert.equal(two.foundation,.6);
  assert.deepEqual(houseFloors({id:'g',houseStyle:'garage',height:4,eaveHeight:2.85}),{floors:1,floorHeight:2.6,foundation:.25});
});

// A residential street on z = 0 with houses 8 m back from its 8 m roadway.
const city=()=>({roads:[{id:'r',name:'Bellevue Avenue',kind:'residential',width:8,points:[[-800,0],[800,0]]}],buildings:[],landmarks:[],curbs:[],signals:[],spawn:{x:0,z:0,yaw:0},sources:[],origin:{xFeet:0,yFeet:0,longitude:0,latitude:0},bounds:{minX:-200,maxX:200,minZ:-200,maxZ:200}});
const house=(id,x,extra={})=>({id,name:id,center:[x+6,19],height:11,eaveHeight:6.9,houseStyle:'victorian',yearBuilt:1890,roofShape:'gabled',footprint:[[x,12],[x+12,12],[x+12,26],[x,26]],...extra});

test('a house plan keeps its front, porch, tower and chimney on its own footprint',()=>{
  const c=city();let porches=0,towers=0;
  for(let i=0;i<60;i++){
    const b=house(`osm-way-${7000+i}`,i*20-600+3);
    const front=houseFront(c,b);assert.ok(front,'the street wall is found');
    assert.ok(Math.abs(front.a[1]-12)<1e-9&&Math.abs(front.b[1]-12)<1e-9,'the wall facing the street');
    assert.ok(Math.abs(front.setback-8)<1e-6);assert.equal(front.road,'Bellevue Avenue');
    const plan=housePlan(c,b);assert.equal(housePlan(c,b),plan,'cached per building');
    if(plan.porch){porches++;assert.ok(plan.porch.from>=-front.length/2&&plan.porch.to<=front.length/2&&plan.porch.to-plan.porch.from>=2.2);assert.ok(plan.porch.depth<=8-2.9-1.1,'the porch stays clear of the sidewalk band');}
    if(plan.tower){towers++;assert.ok(pointInside(plan.tower.center,b.footprint)&&edgeDistance(plan.tower.center,b.footprint)>=plan.tower.radius*.52*.8);}
    if(plan.chimney)assert.ok(pointInside(plan.chimney,b.footprint)&&edgeDistance(plan.chimney,b.footprint)>=.55);
  }
  assert.ok(porches>=36,'most Victorians keep a front porch');
  assert.ok(towers>0&&towers<40,'some, not all, larger Victorians carry a corner tower');
  const garage=housePlan(c,house('osm-way-garage',3,{houseStyle:'garage',height:4,eaveHeight:2.85}));
  assert.equal(garage.chimney,undefined);assert.equal(garage.porch,undefined);assert.equal(garage.tower,undefined);
});
