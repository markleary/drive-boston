import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {loadMetroCity,windowCity} from './helpers/metro-city.mjs';
import {parkSurface,shoreBankGeometry} from '../src/render/area-surfaces.ts';
import {waterShore} from '../src/render/water-shore.ts';
import {frogPondSteps} from '../src/render/frog-pond.ts';
import {FROG_POND_LEVEL} from '../src/simulation/boston-common.ts';
import {sampleElevation,buildTerrainGeometryData} from '../src/simulation/terrain.ts';
import {footbridgeRoad} from '../src/simulation/footbridges.ts';
import {roadSlabGeometry,sampleRoadElevation} from '../src/simulation/road-surfaces.ts';
import {restoreWaterPaths} from '../src/simulation/water-paths.ts';
import {LONG_WHARF_DOCK,longWharfOwnsPath,longWharfGangwayOpening} from '../src/simulation/long-wharf.ts';
import {waterfrontAt,waterfrontHeight} from '../src/simulation/waterfront.ts';
import {drain} from '../src/render/pacing.ts';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {createWalker} from '../src/simulation/walker.ts';
import {clipShoreTerrainSteps} from '../src/render/shore-terrain.ts';
import {clipWaterfrontTerrainSteps} from '../src/render/waterfront-terrain.ts';
import {waterfrontDetailSteps} from '../src/render/waterfront.ts';

const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
const height=(geometry,x,z)=>{
  const ray=new THREE.Raycaster(new THREE.Vector3(x,100,z),new THREE.Vector3(0,-1,0));
  return ray.intersectObject(new THREE.Mesh(geometry,material),false)[0]?.point.y;
};
const metro=await loadMetroCity({bounds:{minX:-1000,maxX:2400,minZ:-2000,maxZ:0}});

test('lowered shores meet the edge of ground paths without leaving a suspended ribbon',async()=>{
  const city={roads:[],parkPaths:[{id:'shore walk',points:[[2,0],[2,30]],width:2}],elevation:{width:6,height:6,cellSize:6,originX:0,originZ:0,heights:Array(36).fill(4)}};
  const water={rings:[[[0,0],[30,0],[30,30],[0,30]]]},shore=waterShore(water),bank=[];
  const sheet=parkSurface(city,shore.rings,.035,0,undefined,true,shore,bank),ground=shoreBankGeometry(bank);
  assert.ok(Math.abs(height(ground,3.06,15)-4.026)<.03,'bank starts at paving height, not the water plane');
  assert.ok(height(ground,4.5,15)>1.9&&height(ground,4.5,15)<2.3,'bank slopes away from the path');
  assert.equal(height(sheet,4.5,15),undefined,'water leaves the supporting bank exposed');
  assert.ok(Math.abs(height(sheet,7,15)-.035)<1e-6);
  await RAPIER.init();const world=new RAPIER.World({x:0,y:-9.81,z:0}),p=ground.attributes.position;
  world.createCollider(RAPIER.ColliderDesc.trimesh(p.array,Uint32Array.from({length:p.count},(_,i)=>i)));world.step();
  const hit=world.castRay(new RAPIER.Ray({x:3.06,y:10,z:15},{x:0,y:-1,z:0}),20,true);
  assert.ok(hit&&Math.abs(10-hit.timeOfImpact-height(ground,3.06,15))<.001,'the visible support is collidable');
  world.free();sheet.dispose();ground.dispose();
});

test('Frog Pond has a continuous level rim and fine, smoothly shaded apron',()=>{
  const water=metro.water.find(w=>w.name==='Frog Pond'),group=drain(frogPondSteps(metro,water,material,{}));
  const apron=group.children.find(m=>m.name==='Frog Pond concrete rim').geometry;
  const sheet=group.children.find(m=>m.name==='Frog Pond water').geometry;
  let checked=0;
  for(let i=0;i<water.rings[0].length;i+=2){
    const a=water.rings[0][i],b=water.rings[0][(i+1)%water.rings[0].length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
    if(length<.1)continue;
    const x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
    // Probe both sides of the clockwise rim: one is concrete, one is water.
    const probes=[-1,1].map(sign=>[x+sign*dz/length*.12,z-sign*dx/length*.12]);
    const concrete=probes.map(p=>height(apron,...p)).filter(y=>y!==undefined),wet=probes.map(p=>height(sheet,...p)).filter(y=>y!==undefined);
    assert.ok(concrete.length&&wet.length);
    assert.ok(concrete.every(y=>Math.abs(y-FROG_POND_LEVEL-.23)<.2),'the rim cannot follow coarse DEM peaks');
    assert.ok(wet.every(y=>Math.abs(y-FROG_POND_LEVEL-.035)<1e-5),'water reaches the engineered basin border');checked++;
  }
  assert.ok(checked>15);
  const p=apron.attributes.position,n=apron.attributes.normal;let smoothed=0;
  for(let i=0;i<p.count;i+=3)if(n.getY(i)>.1&&(Math.abs(n.getY(i)-n.getY(i+1))>1e-5||Math.abs(n.getY(i)-n.getY(i+2))>1e-5))smoothed++;
  assert.ok(smoothed>100,'apron normals blend across tessellation faces');
  apron.dispose();sheet.dispose();
});

test('ground paths beside an engineered quay cannot grow a grass bank outside its wall',()=>{
  const city={roads:[],parkPaths:[{id:'quay walk',points:[[2,0],[2,30]],width:2}],elevation:{width:6,height:6,cellSize:6,originX:0,originZ:0,heights:Array(36).fill(4)}};
  const water={rings:[[[0,0],[30,0],[30,30],[0,30]]]},shore={...waterShore(water),hard:()=>true},bank=[];
  const sheet=parkSurface(city,shore.rings,.035,0,undefined,true,shore,bank);
  assert.equal(bank.length,0);
  assert.ok(Math.abs(height(sheet,3.06,15)-.035)<1e-6,'water reaches the wall beside the path');
  sheet.dispose();
});

for(const [name,ways]of [
  ['Hatch Shell',[832417214,832417215,242536776,832417244]],
  ['lagoon east',[29328208,832417246]],
  ['lagoon west',[29380675,820802432]],
  ['lagoon middle',[165358918,828185862]],
])test(`${name}: one complete supported arch across the source-way joins`,async()=>{
  const paths=metro.parkPaths.filter(p=>ways.some(id=>p.id.startsWith(`osm-way-${id}-`)));
  assert.ok(paths.length>=ways.length);const profile=paths[0].bridgePoints;assert.ok(profile);
  assert.ok(paths.every(p=>JSON.stringify(p.bridgePoints)===JSON.stringify(profile)));
  const roads=paths.map(p=>footbridgeRoad(metro,p));
  await RAPIER.init();const world=new RAPIER.World({x:0,y:-9.81,z:0});
  for(const road of roads){const slab=roadSlabGeometry(metro,road);world.createCollider(RAPIER.ColliderDesc.trimesh(slab.vertices,slab.indices));}world.step();
  let samples=0;
  for(let i=1;i<profile.length;i++){
    const a=profile[i-1],b=profile[i],count=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])*4);
    for(let k=0;k<count;k++){
      const t=(k+.5)/count,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
      const hit=world.castRay(new RAPIER.Ray({x,y:20,z},{x:0,y:-1,z:0}),40,true);
      assert.ok(hit,`no missing deck at ${x}, ${z}`);samples++;
    }
  }
  for(const point of profile.slice(1,-1)){
    const y=sampleRoadElevation(metro,footbridgeRoad(metro,{...paths[0],points:profile}),...point);
    assert.ok(y>Math.min(sampleElevation(metro,...profile[0]),sampleElevation(metro,...profile.at(-1)))+.052,'an intermediate way endpoint cannot become a riverbed landing');
  }
  assert.ok(samples>80);world.free();
});

test('short steps survive tile loading and water crossings are emitted only in their owner tiles',()=>{
  assert.ok(metro.parkPaths.some(p=>p.id.startsWith('osm-way-165358917-')),'the one-metre stair join is no longer discarded');
  for(const tx of [-1,0,1,2])for(const tz of [-2,-1]){
    const paths=restoreWaterPaths({tx,tz,size:1000,parkPaths:[]});
    for(const path of paths)for(const [x,z]of path.points)assert.ok(x>=tx*1000-1e-8&&x<=(tx+1)*1000+1e-8&&z>=tz*1000-1e-8&&z<=(tz+1)*1000+1e-8);
  }
});

test('Long Wharf HarborWalk stays on the quay and its gangway reaches a supported landing',()=>{
  const paths=metro.parkPaths.filter(longWharfOwnsPath);
  assert.ok(paths.length>5);
  for(const path of paths.filter(p=>p.name==='Boston HarborWalk'))for(const p of path.points)assert.equal(waterfrontAt(...p)?.id,'long-wharf');
  const gangway=metro.parkPaths.find(p=>p.id.startsWith('osm-way-236582646-')),dock=metro.parkPaths.find(p=>p.id.startsWith('long-wharf-floating-landing-'));
  assert.ok(gangway&&dock);
  const slab=roadSlabGeometry(metro,footbridgeRoad(metro,dock));
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(slab.vertices,3));geometry.setIndex(new THREE.BufferAttribute(slab.indices,1));
  assert.ok(Math.abs(height(geometry,...gangway.points[0])-LONG_WHARF_DOCK.level)<.001);
  assert.ok(Math.abs(gangway.elevations.at(-1)-waterfrontHeight(metro,...gangway.points.at(-1))-.021)<1e-5);
  assert.ok(longWharfGangwayOpening(...gangway.points.at(-1)),'the retaining rail leaves an entrance');
  geometry.dispose();
});

test('a walker crosses the restored Hatch Shell bridge and Long Wharf gangway without jumping',async()=>{
  for(const wharf of [false,true]){
    const paths=metro.parkPaths.filter(p=>wharf?p.id.startsWith('osm-way-236582646-')||p.id.startsWith('long-wharf-floating-landing-'):[832417214,832417215,242536776,832417244].some(id=>p.id.startsWith(`osm-way-${id}-`)));
    const crossing=wharf?paths.find(p=>p.id.startsWith('osm-way-236582646-')).points:paths[0].bridgePoints;
    const start=crossing[0],end=crossing.at(-1),dx=end[0]-start[0],dz=end[1]-start[1],length=Math.hypot(dx,dz),ux=dx/length,uz=dz/length;
    const bounds={minX:Math.min(...crossing.map(p=>p[0]))-10,maxX:Math.max(...crossing.map(p=>p[0]))+10,minZ:Math.min(...crossing.map(p=>p[1]))-10,maxZ:Math.max(...crossing.map(p=>p[1]))+10};
    const city={...windowCity(metro,bounds,{pad:6}),roads:[],buildings:[],water:metro.water,parkPaths:metro.parkPaths,spawn:{x:bounds.minX,y:10,z:bounds.minZ,yaw:0}};
    const physics=await DrivingPhysics.create(city,{streaming:true}),geometry=new THREE.BufferGeometry(),raw=buildTerrainGeometryData(city);
    geometry.setAttribute('position',new THREE.BufferAttribute(raw.vertices,3));geometry.setIndex(new THREE.BufferAttribute(raw.indices,1));geometry.computeVertexNormals();
    drain(clipWaterfrontTerrainSteps(city,geometry));drain(clipShoreTerrainSteps(city,geometry));
    physics.addStaticMesh(geometry.attributes.position.array,geometry.index.array);
    for(const path of paths)physics.addFootbridge(city,path);
    const scene=new THREE.Group();
    if(wharf)drain(waterfrontDetailSteps(city,scene,{bounds,mobile:true,onShore:(v,i)=>physics.addStaticMesh(v,i),onSolids:s=>physics.addParapets(s)}));
    const walker=createWalker(city,physics),offset=wharf?0:-1;
    walker.place(start[0]+ux*offset,wharf?LONG_WHARF_DOCK.level:sampleElevation(city,start[0]+ux*offset,start[1]+uz*offset),start[1]+uz*offset,Math.atan2(dx,dz));
    let maxAir=0,air=0,airAt;
    try{
      for(let i=0;i<Math.ceil((length+6)/1.35*60);i++){
        walker.update(1/60,{forward:1,strafe:0,turn:0,run:false,jump:false},true);physics.step({throttle:0,brake:1,steer:0,handbrake:true},1/60);
        air=walker.state.grounded?0:air+1;if(air>maxAir){maxAir=air;airAt={...walker.state};}
        if((walker.state.x-end[0])*ux+(walker.state.z-end[1])*uz>1)break;
      }
      assert.ok((walker.state.x-end[0])*ux+(walker.state.z-end[1])*uz>.7,`${wharf?'Long Wharf':'Hatch Shell'} reaches the adjoining ground path: ${JSON.stringify(walker.state)}`);
      assert.ok(maxAir<8,`no fall across a missing span or landing (${wharf?'Long Wharf':'Hatch Shell'}: ${maxAir} frames, ${JSON.stringify(airAt)})`);
    }finally{walker.dispose();physics.dispose();geometry.dispose();for(const child of scene.children)child.geometry?.dispose();}
  }
});
