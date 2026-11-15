import assert from 'node:assert/strict';
import test from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import {DrivingPhysics,carSteeringLimit} from '../src/physics/vehicle.ts';
import {PLAYER_CARS} from '../src/simulation/player-cars.ts';
import {resolveCity} from '../src/simulation/city-tiles.ts';
import {roadProjection,roadWidthAt} from '../src/simulation/road-surfaces.ts';
import {tunnelPointAt,tunnelStations} from '../src/simulation/tunnels.ts';
import {read,readJson,windowCity} from './helpers/metro-city.mjs';

const metro=await resolveCity(readJson('city.json'),read);
const idle={throttle:0,brake:0,steer:0,handbrake:false},spec=PLAYER_CARS['moving-truck'];

for(const blockedExit of [false,true])test(`actual Leverett westbound tunnel repairs ${blockedExit?'back on its approach when the exit cannot fit the truck':'beyond its curved roof when the exit is clear'}`,async()=>{
  const city=windowCity(metro,{minX:330,maxX:790,minZ:-1960,maxZ:-1570});
  const road=city.roads.find(r=>r.id==='storrow-leverett-west-2'),stations=tunnelStations(road);
  const stationAt=(x,z)=>{const q=roadProjection(road,x,z);return stations[q.index]+(stations[q.index+1]-stations[q.index])*q.t;};
  const p=await DrivingPhysics.create(city,{buildingColliders:false});
  try{
    p.setCar('moving-truck');const start=tunnelPointAt(road,20);p.reset(start.x,start.z,start.yaw,road.id);
    for(let i=0;i<90;i++)p.step(idle,1/60);
    for(let i=0;i<1200&&!p.getState().storrowed;i++){
      const s=p.getState(),target=tunnelPointAt(road,Math.min(stations.at(-1),stationAt(s.x,s.z)+10));
      const angle=Math.atan2(Math.sin(Math.atan2(target.x-s.x,target.z-s.z)-s.yaw),Math.cos(Math.atan2(target.x-s.x,target.z-s.z)-s.yaw));
      p.step({...idle,throttle:.7,steer:Math.atan2(2*spec.wheelbase*Math.sin(angle),10)/carSteeringLimit(s.speed,spec)},1/60);
    }
    assert.equal(p.getState().storrowed,true,'the mapped 3.2 m ceiling catches the box');assert.equal(p.takeStorrowStrikes().length,1);
    for(let i=0;i<30;i++)p.step(idle,1/60);
    if(blockedExit)p.world.createCollider(RAPIER.ColliderDesc.cuboid(40,20,40).setTranslation(500,0,-1780));
    assert.equal(p.resetToRoad(),blockedExit?'retreated':undefined);const after=p.getState();
    assert.equal(after.storrowed,false);assert.equal(after.storrowDamage,0);assert.equal(Math.abs(after.speed),0);
    const station=stationAt(after.x,after.z),[entrance,exit]=road.tunnel.covered[0];
    assert.ok(blockedExit?station+spec.halfLength<entrance:station-spec.halfLength>exit,'complete truck is on the selected side of the tunnel');
    assert.ok(Math.cos(after.yaw-tunnelPointAt(road,station).yaw)>.99,'original westbound facing is preserved');
    for(const along of [-1,-.5,0,.5,1])for(const across of [-1,0,1]){
      const x=after.x+Math.sin(after.yaw)*along*spec.halfLength+Math.cos(after.yaw)*across*spec.halfWidth;
      const z=after.z+Math.cos(after.yaw)*along*spec.halfLength-Math.sin(after.yaw)*across*spec.halfWidth;
      assert.ok(roadProjection(road,x,z).distance<roadWidthAt(road,x,z)/2-.1,'whole truck remains on the same mapped road');
    }
    assert.ok(p.canResetAt(after.x,after.z,after.yaw,road.id,true),'all colliders clear the physical tunnel and road geometry');
    for(let i=0;i<120;i++)p.step(idle,1/60);
    assert.equal(p.takeStorrowStrikes().length,0);assert.equal(p.getState().storrowed,false);
  }finally{p.dispose();}
});
