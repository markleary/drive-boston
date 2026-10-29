import assert from 'node:assert/strict';
import test from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import {waterShore,SHORE_WIDTH} from '../src/render/water-shore.ts';
import {parkSurface,shoreBankGeometry,WATER_SURFACE_OFFSET} from '../src/render/area-surfaces.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {pointInside} from '../src/simulation/roads.ts';
import {waterHeight} from '../src/simulation/water-level.ts';
import {resolveCity} from '../src/simulation/city-tiles.ts';
import {read,readJson,loadMetroCity} from './helpers/metro-city.mjs';
import {footbridgeRoad} from '../src/simulation/footbridges.ts';
import {roadSlabGeometry,sampleRoadElevation} from '../src/simulation/road-surfaces.ts';

const flat={bounds:{minX:0,maxX:30,minZ:0,maxZ:30},roads:[],elevation:{width:6,height:6,originX:0,originZ:0,cellSize:6,heights:new Array(36).fill(0)}};
const pond={id:'pond',name:'Pond',rings:[[[0,0],[30,0],[30,30],[0,30]]]};
const build=(city,water,level,bounds,rings=water.rings)=>{
 const shore=waterShore(water,rings),banks=[],waterGeometry=parkSurface(city,shore.rings,WATER_SURFACE_OFFSET,level,bounds,true,shore,banks);
 return {shore,water:waterGeometry,bank:shoreBankGeometry(banks)};
};
const covers=(geometry,point)=>{const p=geometry.attributes.position;for(let i=0;i<p.count;i+=3)if(pointInside(point,[0,1,2].map(j=>[p.getX(i+j),p.getZ(i+j)])))return true;return false;};

test('rounded shoreline cuts projecting corners inward and keeps island holes',()=>{
 const water={...pond,rings:[pond.rings[0],[[10,10],[20,10],[20,20],[10,20]]]},shore=waterShore(water);
 assert.ok(shore.rings[0].length>4);assert.ok(!shore.rings[0].some(p=>p[0]===0&&p[1]===0));
 for(const ring of shore.rings)for(const [x,z] of ring)assert.ok(x>=0&&x<=30&&z>=0&&z<=30);
 const {water:g,bank}=build(flat,water,.8),p=g.attributes.position;
 for(let i=0;i<p.count;i+=3){const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;assert.ok(!pointInside([x,z],water.rings[1]));}
 g.dispose();bank.dispose();
});

test('low terrain meets a horizontal pond through a grounded, collidable bank',async()=>{
 const {shore,water,bank}=build(flat,pond,.8),p=water.attributes.position,b=bank.attributes.position;
 assert.ok(p.count>0&&b.count>0);let ground=0,crest=0;
 for(let i=0;i<p.count;i++){
  assert.ok(Math.abs(p.getY(i)-.835)<1e-6);
  assert.ok(shore.distance(p.getX(i),p.getZ(i))>=SHORE_WIDTH-.06,'the floating outer edge is replaced by land');
 }
 for(let i=0;i<b.count;i++){
  const d=shore.distance(b.getX(i),b.getZ(i)),y=b.getY(i);
  assert.ok(y>=.0259&&y<=.8261);if(d<1e-5){assert.ok(Math.abs(y-.026)<1e-5);ground++;}
  if(Math.abs(d-SHORE_WIDTH)<1e-4){assert.ok(Math.abs(y-.826)<1e-5);crest++;}
 }
 assert.ok(ground>0&&crest>0);
 await RAPIER.init();const world=new RAPIER.World({x:0,y:-9.81,z:0});
 world.createCollider(RAPIER.ColliderDesc.trimesh(b.array,Uint32Array.from({length:b.count},(_,i)=>i)));world.step();
 for(const [x,z,y] of [[1.5,15.1,.426],[2.25,15.1,.701]]){
  const hit=world.castRay(new RAPIER.Ray({x,y:3,z},{x:0,y:-1,z:0}),5,true);
  assert.ok(hit);assert.ok(Math.abs(3-hit.timeOfImpact-y)<.002,'wheel collision follows the visible slope');
 }
 world.free();water.dispose();bank.dispose();
});

test('source partitions and streamed tile seams do not acquire artificial banks',()=>{
 const left=[[[0,0],[15,0],[15,30],[0,30]]],right=[[[15,0],[30,0],[30,30],[15,30]]];
 for(const rings of [left,right]){
  const {shore,water,bank}=build(flat,pond,.8,undefined,rings);
  assert.ok(shore.distance(15,15)>SHORE_WIDTH,'a basin seam is not a shoreline');
  const p=water.attributes.position;assert.ok(Array.from({length:p.count},(_,i)=>i).some(i=>p.getX(i)===15&&p.getZ(i)>10&&p.getZ(i)<20));water.dispose();bank.dispose();
 }
 const values=[];
 for(const bounds of [{minX:0,maxX:15,minZ:0,maxZ:30},{minX:15,maxX:30,minZ:0,maxZ:30}]){
  const {water,bank}=build(flat,pond,.8,bounds),p=bank.attributes.position;
  values.push(new Set(Array.from({length:p.count},(_,i)=>i).filter(i=>p.getX(i)===15).map(i=>`${p.getZ(i)},${p.getY(i)}`)));water.dispose();bank.dispose();
 }
 assert.deepEqual(values[0],values[1]);
});

test('narrow ponds retain an open center and blend over a matching bank shelf',()=>{
 const pond={id:'canal',name:'Narrow pond',rings:[[[0,0],[4,0],[4,30],[0,30]]]},result=build(flat,pond,.8),p=result.water.attributes.position,edge=result.water.attributes.waterEdge,b=result.bank.attributes.position;
 assert.ok(result.shore.width<1);assert.ok(p.count>0,'the bank must not fill a narrow body');
 const alphas=Array.from(edge.array);assert.ok(alphas.some(a=>a<.01)&&alphas.some(a=>a>.99));assert.ok(alphas.some(a=>a>.1&&a<.9));
 let covered=0;
 for(let i=0;i<b.count;i++)if(result.shore.distance(b.getX(i),b.getZ(i))>result.shore.width+.1){assert.ok(Math.abs(b.getY(i)-.826)<1e-5);covered++;}
 assert.ok(covered>0,'the transparent rim blends against land immediately below it');result.water.dispose();result.bank.dispose();
});

test('Fens screenshot shoreline has ground-level outer edges and inset flat water',async()=>{
 const city=await resolveCity(readJson('city.json'),read),water=city.water.find(w=>w.id==='water-merged-181'),level=waterHeight(city,water);
 const result=build(city,water,level,{minX:-1900,maxX:-1700,minZ:1000,maxZ:1200}),p=result.water.attributes.position,b=result.bank.attributes.position;
 assert.ok(p.count>5000&&b.count>5000);let grounded=0;
 for(let i=0;i<p.count;i++)assert.ok(Math.abs(p.getY(i)-level-WATER_SURFACE_OFFSET)<1e-6);
 for(let i=0;i<b.count;i++){
  const x=b.getX(i),z=b.getZ(i);if(result.shore.distance(x,z)<.0002){assert.ok(Math.abs(b.getY(i)-sampleElevation(city,x,z)-.026)<.0002);grounded++;}
 }
 assert.ok(grounded>100);result.water.dispose();result.bank.dispose();
});

test('raised bank leaves ground paths and the actual low Riverway footbridges clear',async()=>{
 await RAPIER.init();
 const pathCity={...flat,parkPaths:[{id:'path',width:2,points:[[-2,15],[8,15]]}]},pathResult=build(pathCity,pond,.8),positions=pathResult.bank.attributes.position;
 for(let i=0;i<positions.count;i+=3){const x=(positions.getX(i)+positions.getX(i+1)+positions.getX(i+2))/3,z=(positions.getZ(i)+positions.getZ(i+1)+positions.getZ(i+2))/3;assert.ok(!(x>=0&&x<=8&&Math.abs(z-15)<1),'bank must not bury the ground path');}
 pathResult.water.dispose();pathResult.bank.dispose();
 const city=await loadMetroCity({bounds:{minX:-3000,maxX:-2700,minZ:900,maxZ:1100}}),water=city.water.find(w=>w.id==='water-merged-185'),level=waterHeight(city,water);
 for(const [id,x,z] of [['osm-way-48920379-0--3_0_0',-2763.6973333333335,926.7795],['osm-way-1374297290-0--3_1_0',-2939.1675,1086.728]]){
  const bridge=footbridgeRoad(city,city.parkPaths.find(p=>p.id===id)),result=build(city,water,level,{minX:x-5,maxX:x+5,minZ:z-5,maxZ:z+5}),bank=result.bank.attributes.position,world=new RAPIER.World({x:0,y:-9.81,z:0});
  try{
   world.createCollider(RAPIER.ColliderDesc.trimesh(bank.array,Uint32Array.from({length:bank.count},(_,i)=>i)));world.step();
   const ray=new RAPIER.Ray({x,y:5,z},{x:0,y:-1,z:0});
   assert.equal(world.castRay(ray,20,true),null,'the new bank must not protrude through the mapped bridge');
   const slab=roadSlabGeometry(city,bridge);world.createCollider(RAPIER.ColliderDesc.trimesh(slab.vertices,slab.indices));world.step();
   const hit=world.castRay(ray,20,true);assert.ok(hit);
   assert.ok(Math.abs(5-hit.timeOfImpact-sampleRoadElevation(city,bridge,x,z))<.001,'the bridge slab remains the visible and physical support');
  }finally{world.free();result.water.dispose();result.bank.dispose();}
 }
 const endpoint=[-2764.659133,925.84845],bounds={minX:-2770,maxX:-2745,minZ:920,maxZ:944},corrected=build(city,water,level,bounds),uncut=build({...city,parkPaths:[]},water,level,bounds);
 assert.ok(covers(uncut.water,endpoint),'the source water plane otherwise crosses this submerged approach');
 assert.ok(!covers(corrected.water,endpoint),'only the low bridge approach is removed from water');
 for(const result of [corrected,uncut]){result.water.dispose();result.bank.dispose();}
});

test('water clears low footbridge approaches but remains underneath the elevated center',()=>{
 const city={...flat,parkPaths:[{id:'arched',width:2.6,bridge:true,points:[[0,15],[30,15]]}]},result=build(city,pond,.8);
 assert.ok(!covers(result.water,[4,15]),'a low landing cannot pass through the water plane');
 assert.ok(covers(result.water,[15,15]),'the high central span still crosses open water');
 result.water.dispose();result.bank.dispose();
});
