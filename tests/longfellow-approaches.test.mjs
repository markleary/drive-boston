import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {resolveCity} from '../src/simulation/city-tiles.ts';
import {DrivingPhysics,carSteeringLimit} from '../src/physics/vehicle.ts';
import {addCharlesBridgeDetails} from '../src/render/charles-bridges.ts';
import {parkSurface,WATER_SURFACE_OFFSET} from '../src/render/area-surfaces.ts';
import {drapedRibbon} from '../src/render/terrain-ground.ts';
import {roadDeckGeometry} from '../src/simulation/road-surfaces.ts';
import {inLongfellowCorridor,longfellowPoint,LONGFELLOW_LENGTH} from '../src/simulation/longfellow.ts';
import {read,readJson,windowCity} from './helpers/metro-city.mjs';
const metro=await resolveCity(readJson('city.json'),read),city=windowCity(metro,{minX:-750,maxX:300,minZ:-1550,maxZ:-1050});
const released={throttle:0,brake:0,steer:0,handbrake:false};

async function drive(ids){
 const roads=ids.map(id=>{const r=city.roads.find(r=>r.id===id);assert.ok(r,id);return r;});
 const route=roads.flatMap(r=>r.points.flatMap((p,i)=>{
  const q=r.points[i+1];if(!q)return[{x:p[0],z:p[1],road:r}];const count=Math.max(1,Math.ceil(Math.hypot(q[0]-p[0],q[1]-p[1])/3));
  return Array.from({length:count},(_,j)=>({x:p[0]+(q[0]-p[0])*j/count,z:p[1]+(q[1]-p[1])*j/count,road:r}));
 })).filter((p,i,a)=>!i||Math.hypot(p.x-a[i-1].x,p.z-a[i-1].z)>.02);
 const physics=await DrivingPhysics.create(city),scene=new THREE.Scene(),details=addCharlesBridgeDetails(scene,city);
 try{
  for(const mesh of details.collisions)physics.addStaticMesh(mesh.vertices,mesh.indices);
  const [start,next]=route;physics.reset(start.x,start.z,Math.atan2(next.x-start.x,next.z-start.z),start.road.id);
  for(let i=0;i<60;i++)physics.step({...released,brake:1},1/60);
  let cursor=1,lastProgress=0;
  for(let frame=0;frame<130*60;frame++){
   const s=physics.getState(),previous=cursor;
   while(cursor<route.length-1&&Math.hypot(s.x-route[cursor].x,s.z-route[cursor].z)<4)cursor++;
   if(cursor>previous)lastProgress=frame;
   assert.ok(frame-lastProgress<360,`blocked on ${route[cursor].road.id} near ${s.x.toFixed(2)},${s.z.toFixed(2)}`);
   if(cursor===route.length-1&&Math.hypot(s.x-route[cursor].x,s.z-route[cursor].z)<1.5)return;
   let target=cursor,look=0;
   while(target<route.length-1&&look<7){look+=Math.hypot(route[target+1].x-route[target].x,route[target+1].z-route[target].z);target++;}
   const p=route[target],angle=Math.atan2(Math.sin(Math.atan2(p.x-s.x,p.z-s.z)-s.yaw),Math.cos(Math.atan2(p.x-s.x,p.z-s.z)-s.yaw));
   const steer=Math.atan2(2*2.66*Math.sin(angle),Math.max(4,Math.hypot(p.x-s.x,p.z-s.z))),limit=carSteeringLimit(s.speed);
   physics.step({...released,throttle:s.speed<7?.35:0,brake:s.speed>8?.1:0,steer:steer/limit},1/60);
  }
  assert.fail('route did not reach its far approach');
 }finally{physics.dispose();scene.traverse(o=>o.geometry?.dispose());}
}

test('Cambridge-to-Boston Longfellow drive clears all decorative piers from the start of the ramp',()=>drive(['osm-1228698551-0','14614-0-0','water-link-14614-0-0','14614-0-1']));
test('Boston-to-Cambridge Longfellow drive clears the full ramp and returns to Main Street',()=>drive(['14615-0-0','water-link-14615-0-0','14615-0-1','osm-1501638153-0','osm-1305820996-0']));
test('Memorial Drive passes under the Longfellow decoration and across both deck-to-ground joins',()=>drive(['osm-8615862-0','osm-827504928-0','osm-822621173-0','osm-8614583-0']));


test('the rail reservation and both bridge approaches exclude tree trunks and nearby canopy',()=>{
 for(let d=-20;d<=LONGFELLOW_LENGTH+20;d+=8)for(const side of [-20,-7,0,7,20])assert.ok(inLongfellowCorridor(...longfellowPoint(d,side)));
 for(const p of [[-384.91,-1286.58],longfellowPoint(20,0),longfellowPoint(60,0)])assert.ok(inLongfellowCorridor(...p));
 assert.equal(inLongfellowCorridor(...longfellowPoint(60,35)),false,'riverside planting beyond the bridge remains eligible');
 assert.equal(inLongfellowCorridor(...longfellowPoint(-50,0)),false,'unrelated Main Street blocks remain eligible');
});

test('water stays below Memorial Drive pavement at the two underpass joins',()=>{
 const water=metro.water.find(w=>w.id==='water-merged-55'),surface=water.surfaces.find(s=>s.source==='water-14492-0-0');
 assert.equal(surface.name,'Charles River');
 const bounds={minX:-560,maxX:-275,minZ:-1435,maxZ:-1160},g=parkSurface(city,surface.rings,WATER_SURFACE_OFFSET,surface.level,bounds,true);
 assert.ok(g.attributes.position.count>100,'river water must remain visible beside the approaches');
 // Count the source hydro footprint even where the bank now emerges through
 // the horizontal plane. Either terrain or pavement may keep that overlap dry.
 const reference=parkSurface(city,surface.rings,WATER_SURFACE_OFFSET,surface.level,bounds);
 const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),sheet=new THREE.Mesh(g,material),original=new THREE.Mesh(reference,material),ray=new THREE.Raycaster();sheet.updateMatrixWorld();original.updateMatrixWorld();
 const height=(mesh,x,z)=>{ray.set(new THREE.Vector3(x,30,z),new THREE.Vector3(0,-1,0));return ray.intersectObject(mesh,false)[0]?.point.y;};let checked=0;
 for(const id of ['osm-8615862-0','osm-827504928-0','osm-822621173-0']){
  const r=city.roads.find(r=>r.id===id);let geometry;
  if(r.elevations){const d=roadDeckGeometry(city,r,r.width,.025);geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(d.vertices,3));geometry.setIndex(new THREE.BufferAttribute(d.indices,1));}
  else geometry=drapedRibbon(city,r.points,r.width,.045);
  const mesh=new THREE.Mesh(geometry,material);mesh.updateMatrixWorld();
  for(let i=1;i<r.points.length;i++){
   const a=r.points[i-1],b=r.points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]),count=Math.max(1,Math.ceil(length/2));
   for(let j=0;j<=count;j++)for(const side of [-3,0,3]){
    const x=a[0]+(b[0]-a[0])*j/count-(b[1]-a[1])/length*side,z=a[1]+(b[1]-a[1])*j/count+(b[0]-a[0])/length*side,w=height(sheet,x,z),p=height(mesh,x,z);
    if(height(original,x,z)!==undefined&&p!==undefined){assert.ok(w===undefined||p>w+.001,`${id} water covers roadway at ${x},${z}: road=${p}, water=${w}`);checked++;}
   }
  }
  geometry.dispose();
 }
 assert.ok(checked>100,'the real hydro overlap must be exercised');g.dispose();reference.dispose();material.dispose();
});


test('pavement water cutouts keep adjacent river water and the water beneath elevated bridges',()=>{
 const water=[[[-30,-30],[30,-30],[30,30],[-30,30]]],ground={roads:[{id:'bank',name:'Riverbank road',points:[[0,-30],[0,30]],width:8,oneway:0}]};
 const elevated={roads:[{...ground.roads[0],id:'upper',elevations:[6,6],startLevel:1,endLevel:1}]};
 const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),ray=new THREE.Raycaster();
 for(const [city,expected]of [[ground,false],[elevated,true],[{roads:[{...elevated.roads[0],startLevel:0,endLevel:0}]},true]]){
  const g=parkSurface(city,water,WATER_SURFACE_OFFSET,0,undefined,true),mesh=new THREE.Mesh(g,material);mesh.updateMatrixWorld();
  const visible=x=>{ray.set(new THREE.Vector3(x,10,0),new THREE.Vector3(0,-1,0));return !!ray.intersectObject(mesh,false).length;};
  assert.equal(visible(0),expected);assert.equal(visible(-15),true);assert.equal(visible(15),true);g.dispose();
 }
 material.dispose();
});
