import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {DrivingPhysics,carSteeringLimit} from '../src/physics/vehicle.ts';
import {resolveCity} from '../src/simulation/city-tiles.ts';
import {deckEdge,roadRotation,sampleRoadElevation} from '../src/simulation/road-surfaces.ts';
import {addHarvardBridgeDetails} from '../src/render/harvard-bridge.ts';
import {read,readJson,windowCity} from './helpers/metro-city.mjs';

const metro=await resolveCity(readJson('city.json'),read);
const city=windowCity(metro,{minX:-1750,maxX:-900,minZ:-1050,maxZ:100});
const idle={throttle:0,brake:0,steer:0,handbrake:false};
const road=id=>{const r=city.roads.find(r=>r.id===id);assert.ok(r,id);return r;};
const chain=prefix=>city.roads.filter(r=>r.id===prefix||new RegExp(`^${prefix}-\\d+$`).test(r.id)).sort((a,b)=>(Number(a.id.slice(prefix.length+1))||1)-(Number(b.id.slice(prefix.length+1))||1));
const points=roads=>roads.flatMap(r=>r.points.map(p=>({x:p[0],z:p[1],road:r.id})));
const offset=(route,across)=>route.map((p,i)=>{
 const a=route[Math.max(0,i-1)],b=route[Math.min(route.length-1,i+1)],length=Math.hypot(b.x-a.x,b.z-a.z)||1;
 return {...p,x:p.x-(b.z-a.z)/length*across,z:p.z+(b.x-a.x)/length*across};
});

async function drive(route){
 const physics=await DrivingPhysics.create(city,{buildingColliders:false}),scene=new THREE.Group();
 try{
  for(const mesh of addHarvardBridgeDetails(scene,city,{labelTexture:null}).collisions)physics.addStaticMesh(mesh.vertices,mesh.indices);
  const [a,b]=route;physics.reset(a.x,a.z,Math.atan2(b.x-a.x,b.z-a.z),a.road);
  for(let i=0;i<60;i++)physics.step({...idle,brake:1},1/60);
  let cursor=1,lastProgress=0;
  for(let frame=0;frame<120*60;frame++){
   const s=physics.getState(),before=cursor;
   while(cursor<route.length-1&&(Math.hypot(s.x-route[cursor].x,s.z-route[cursor].z)<3||Math.hypot(s.x-route[cursor+1].x,s.z-route[cursor+1].z)<Math.hypot(s.x-route[cursor].x,s.z-route[cursor].z)))cursor++;
   if(cursor>before)lastProgress=frame;
   assert.ok(frame-lastProgress<420,`blocked on ${route[cursor].road} at ${s.x.toFixed(2)}, ${s.z.toFixed(2)} (speed ${s.speed.toFixed(2)})`);
   assert.ok(Math.abs(s.rotation.x)<.35&&Math.abs(s.rotation.z)<.35,'the car stays upright');
   if(cursor===route.length-1&&Math.hypot(s.x-route[cursor].x,s.z-route[cursor].z)<2){assert.ok(s.speed>2);return;}
   let target=cursor,look=0;
   while(target<route.length-1&&look<5){look+=Math.hypot(route[target+1].x-route[target].x,route[target+1].z-route[target].z);target++;}
   const p=route[target],distance=Math.hypot(p.x-s.x,p.z-s.z),angle=Math.atan2(Math.sin(Math.atan2(p.x-s.x,p.z-s.z)-s.yaw),Math.cos(Math.atan2(p.x-s.x,p.z-s.z)-s.yaw));
   const steer=Math.atan2(2*2.66*Math.sin(angle),Math.max(4,distance))/carSteeringLimit(s.speed);
   physics.step({...idle,throttle:s.speed<5?.5:0,brake:s.speed>6?.2:0,steer},1/60);
  }
  assert.fail('route did not complete');
 }finally{physics.dispose();scene.traverse(o=>o.geometry?.dispose());}
}

test('Bowker entrance crosses the Harvard approach and joins Storrow Drive East',()=>drive(points([
 ...chain('storrow-eb-entrance-bowker'),...chain('storrow-eb-entrance-massachusetts-avenue'),road('storrow-eb-12'),
])));
test('Storrow westbound exit reaches Harvard Bridge through its sidewalk opening',()=>drive([
 ...points([road('storrow-wb-exit-massachusetts-avenue')]),...points([road('11255-0-0')]).reverse(),...points([road('14557-0-1')]).reverse(),
]));
test('Back Street reaches Massachusetts Avenue through the bridge sidewalk',()=>drive(points([road('13251-0-0-deck')]).reverse()));

for(const lane of [-1.6,1.6])test(`Storrow East through lane ${lane} clears the diverging Bowker ramp`,()=>drive(offset(points([road('storrow-eb-07'),road('storrow-eb-08')]),lane)));
test('the Bowker fork remains drivable from Storrow East to the elevated ramp',()=>drive([
 ...points([road('storrow-eb-07')]).slice(0,36),...points([road('19896-0-bridge'),road('24132-0-bridge')]),
]));

test('nearby Storrow, Charlesgate, Back Street and Harvard lanes contain no fixed obstructions',async()=>{
 const physics=await DrivingPhysics.create(city,{buildingColliders:false}),scene=new THREE.Group(),harvard=new Set();
 try{
  for(const mesh of addHarvardBridgeDetails(scene,city,{labelTexture:null}).collisions)harvard.add(physics.addStaticMesh(mesh.vertices,mesh.indices).handle);
  physics.world.step();let samples=0;const failures=[];
  // Sweep a sedan chassis at two-metre intervals through every lane in the
  // reported area: surface streets, elevated roads and walled cuts alike.
  for(const r of city.roads)for(let i=1;i<r.points.length;i++){
   const a=r.points[i-1],b=r.points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=(b[0]-a[0])/length,dz=(b[1]-a[1])/length,yaw=Math.atan2(dx,dz);
   for(let d=0;d<length;d+=2){
    const x=a[0]+dx*d,z=a[1]+dz*d;if(x< -1670||x> -1070||z< -260||z>30)continue;
    const t=d/length,width=(r.deckWidths?.[i-1]??r.width)*(1-t)+(r.deckWidths?.[i]??r.width)*t;
    const lanes=r.lanes?Array.from({length:r.lanes},(_,k)=>(k-(r.lanes-1)/2)*3.2):r.oneway?[0]:[-width/4,width/4];
    for(const lane of lanes){
     const px=x-dz*lane,pz=z+dx*lane,y=sampleRoadElevation(city,r,px,pz);samples++;
     physics.world.intersectionsWithShape({x:px,y:y+.75,z:pz},roadRotation(city,r,px,pz,yaw),new RAPIER.Cuboid(.85,.23,2.02),c=>{
      if(c!==physics.chassisCollider)failures.push(`${r.id} at ${px.toFixed(1)},${pz.toFixed(1)}`);return true;
     });
    }
   }
  }
  assert.ok(samples>5300,`${samples} lane samples`);assert.deepEqual(failures,[]);
  // A lower road crossing must not open the rail above it. Probe the Harvard
  // approach over Storrow's through lanes and both sides of the river span.
  for(const [id,i]of [['15082-0-0',8],['water-link-14557-0-0',10]])for(const side of [-1,1]){
   const r=road(id),[x,z]=deckEdge(r,i,side,-2.33),y=sampleRoadElevation(city,r,x,z),hits=[];
   physics.world.intersectionsWithShape({x,y:y+.55,z},{x:0,y:0,z:0,w:1},new RAPIER.Ball(.15),c=>{if(harvard.has(c.handle))hits.push(c.handle);return true;});
   assert.ok(hits.length,`${id} side ${side} retains its outer rail`);
  }
 }finally{physics.dispose();scene.traverse(o=>o.geometry?.dispose());}
});
