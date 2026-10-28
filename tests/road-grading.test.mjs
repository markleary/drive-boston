import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {Ray} from '@dimforge/rapier3d-compat';
import {prepareRoadTerrain} from '../src/simulation/road-grading.ts';
import {sampleElevation,buildTerrainGeometryData} from '../src/simulation/terrain.ts';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {drapedRibbon} from '../src/render/terrain-ground.ts';

const load=()=>JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url),'utf8'));
const city=load(),rawGrid=city.elevation,rawHeights=rawGrid.heights.slice();
const report=prepareRoadTerrain(city);
const crossfall=(data,x,z,yaw,width)=>Math.abs(sampleElevation(data,x+Math.cos(yaw)*width/2,z-Math.sin(yaw)*width/2)-sampleElevation(data,x-Math.cos(yaw)*width/2,z+Math.sin(yaw)*width/2))/width;
const examples=[
  {id:'13085-0-0',x:1917.3601466,z:-700.6414604,yaw:3.1224848193},
  {id:'7479-0-0',x:1581.5311143,z:-368.7361688,yaw:-.9343073515},
];

test('road grading levels both badly banked Purchase Street locations without changing source data',()=>{
  assert.notEqual(city.elevation,rawGrid);assert.deepEqual(rawGrid.heights,rawHeights,'bundled DEM remains available as unmodified source evidence');
  assert.ok(report.roads>2000);assert.equal(prepareRoadTerrain(city),report,'preparation cannot compound grading on repeat');
  for(const p of examples){
    const road=city.roads.find(r=>r.id===p.id);
    assert.ok(crossfall({...city,elevation:rawGrid},p.x,p.z,p.yaw,road.width)>.2,'exercise the reported severe crossfall');
    assert.ok(crossfall(city,p.x,p.z,p.yaw,road.width)<.01,'road is level across its width to within 1%');
  }
  assert.ok(!city.roads.find(r=>r.id===examples[0].id).elevations,'ordinary roads must not become bridge decks');
});

test('grading retains the broad Mission Hill ascent and ties into existing ground-level bridge ends',()=>{
  const road=city.roads.find(r=>r.id==='16540-0-0'),a=road.points[0],b=road.points.at(-1);
  const before=sampleElevation({...city,elevation:rawGrid},...b)-sampleElevation({...city,elevation:rawGrid},...a);
  const after=sampleElevation(city,...b)-sampleElevation(city,...a);
  assert.ok(Math.abs(before)>5,'fixture must span a real hill');
  assert.ok(Math.sign(before)===Math.sign(after)&&Math.abs(after)>Math.abs(before)*.7,'cross-street leveling must not erase the hill');
  for(const bridge of city.roads.filter(r=>r.elevations)){
    for(const [i,level]of[[0,bridge.startLevel],[bridge.points.length-1,bridge.endLevel]])if(level===0)
      assert.ok(Math.abs(sampleElevation(city,...bridge.points[i])-bridge.elevations[i])<.015,`${bridge.id} has a new approach step`);
    if(bridge.startLevel===1&&bridge.endLevel===1)assert.ok(bridge.elevations.every(h=>h===6.4),'upper deck remains separate from ground grading');
  }
});

test('graded asphalt triangles and Rapier wheel support agree, and the car no longer leans sideways',async()=>{
  const physics=await DrivingPhysics.create(city);
  try{
    const hillExamples=[
      {id:'13512-0-0',x:-2690.332234,z:2465.164838,yaw:2.537020},
      {id:'17845-0-0',x:-2736.107112,z:2091.509323,yaw:-1.903783},
      {id:'3336-0-0',x:-2705.625972,z:2060.079919,yaw:1.232763},
    ];
    for(const point of [...examples,...hillExamples]){
      const road=city.roads.find(r=>r.id===point.id),geometry=drapedRibbon(city,road.points,road.width,.045),p=geometry.attributes.position;
      let error=0;
      for(let i=0;i<p.count;i+=3){
        const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;
        error=Math.max(error,Math.abs((p.getY(i)+p.getY(i+1)+p.getY(i+2))/3-sampleElevation(city,x,z)-.045));
      }
      geometry.dispose();assert.ok(error<.03,'visible asphalt must follow the same corrected physical triangles');
      physics.reset(point.x,point.z,point.yaw);
      for(let i=0;i<120;i++)physics.step({throttle:0,brake:1,steer:0,handbrake:true},1/60);
      const state=physics.getState(),q=state.rotation;
      assert.ok(Math.abs(2*(q.x*q.y+q.w*q.z))<.025,`the physical car remains laterally level on ${road.name} (${road.id})`);
      const x=point.x+1.5*Math.cos(point.yaw),z=point.z-1.5*Math.sin(point.yaw);
      const rayY=sampleElevation(city,x,z)+30;
      const hit=physics.world.castRay(new Ray({x,y:rayY,z},{x:0,y:-1,z:0}),60,true,undefined,undefined,physics.chassisCollider,physics.body);
      assert.ok(hit&&Math.abs(rayY-hit.timeOfImpact-sampleElevation(city,x,z))<.002,'collision support equals the shared height query');
      assert.ok([0,1,2,3].every(i=>physics.controller.wheelIsInContact(i)));
    }
    const p=examples[0];physics.reset(p.x,p.z,p.yaw);
    for(let i=0;i<60;i++)physics.step({throttle:0,brake:1,steer:0,handbrake:false},1/60);
    const start=physics.getState();
    for(let i=0;i<240;i++)physics.step({throttle:1,brake:0,steer:0,handbrake:false},1/60);
    const end=physics.getState();assert.ok(Math.hypot(end.x-start.x,end.z-start.z)>35&&end.speed>12,'the corrected section remains drivable with sustained acceleration');
  }finally{physics.dispose();}
});

test('terrain mesh uses the corrected samples without increasing the collision triangle budget',()=>{
  const mesh=buildTerrainGeometryData(city),grid=city.elevation;
  assert.equal(mesh.indices.length,(grid.width-1)*(grid.height-1)*6);
  for(let i=0;i<grid.heights.length;i+=211)assert.ok(Math.abs(mesh.vertices[i*3+1]-grid.heights[i])<.00001);
});

test('street grading does not raise hillside ground into the existing house models',()=>{
  for(const id of ['BOS-DXQC2-Q872C-RB7KR','BOS-2NYVA-KCMKF-2EGOT']){
    const house=city.buildings.find(b=>b.id===id),oldHeight=sampleElevation({...city,elevation:rawGrid},...house.center);
    const height=sampleElevation(city,...house.center);
    assert.ok(height<=Math.max(house.baseElevation+.2,oldHeight+.2),`${house.name}: road fill buries the source house by ${(height-house.baseElevation).toFixed(2)}m`);
  }
  const newlyBuried=city.buildings.filter(b=>sampleElevation(city,...b.center)>b.baseElevation+1&&sampleElevation({...city,elevation:rawGrid},...b.center)<=b.baseElevation+1);
  assert.equal(newlyBuried.length,0,`road grading must not bury more than a metre of a previously exposed building: ${newlyBuried.map(b=>b.name).slice(0,8).join(', ')}`);
});

test('road grading preserves exposed facade edges as well as building centers',()=>{
  const source={...city,elevation:rawGrid};
  for(const fixture of [
    {id:'BOS-NUMNC-Q27D2-G0EKT',x:468.634,z:-960.372},
    {id:'BOS-AMV2R-0JKY4-FAM1S',x:-2207.700166666667,z:2525.563916666667},
    {id:'BOS-70LFX-RLHYN-XJ34P',x:-1637.8595714285714,z:2586.031285714286},
  ]){
    const building=city.buildings.find(b=>b.id===fixture.id);
    assert.ok(building,`missing source building ${fixture.id}`);
    const before=sampleElevation(source,fixture.x,fixture.z),after=sampleElevation(city,fixture.x,fixture.z);
    assert.ok(before<building.baseElevation+.2,'fixture starts with an exposed source facade');
    assert.ok(after<=Math.max(before,building.baseElevation)+.3,`${building.name||building.id} facade at ${fixture.x},${fixture.z} buried by ${(after-building.baseElevation).toFixed(2)}m`);
  }
});
