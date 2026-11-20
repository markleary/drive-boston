import './helpers/npc-fleet.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {createTraffic} from '../src/simulation/traffic.ts';
import {TRAFFIC_DENSITY} from '../src/simulation/npc-density.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {hasMetroData,loadMetroCity,windowCity} from './helpers/metro-city.mjs';

const metro=hasMetroData()?await loadMetroCity({tiles:[]}):undefined,skip=!metro&&'needs the metro package in public/data';

// A helicopter at 60 m from Logan's terminal roads out over the airfield, 54 m/s, with city traffic on High. Few lanes
// lead toward an observer there (four to twelve, on the terminal roads) for a neighborhood target of 152 cars, and
// they are full: before the refill counted its failures it asked for a placement for every car beyond the view, four
// times a second (3,241 in these twelve seconds, 32 of them given), each one six routes of a kilometre or more, and
// the frame fell to 5 fps. Wall time is no test, so the fleet counts what its refill asks for.
test('a refill that cannot place cars stops asking: High traffic over Logan',{skip},async()=>{
  const path=[[4200,-1860],[4800,-1900],[5600,-1600],[6400,-900]],start=path[0];
  const physics=await DrivingPhysics.create(windowCity(metro,{minX:3900,maxX:4500,minZ:-2160,maxZ:-1560})),scene=new THREE.Scene();
  const player={x:start[0],z:start[1],y:sampleElevation(metro,start[0],start[1])+.7,yaw:0,speed:0,steering:0};physics.body.setTranslation(player,true);
  const traffic=createTraffic(scene,metro,physics,[],{density:1});
  try{
    traffic.setDensity(TRAFFIC_DENSITY.high);const observer={x:start[0],z:start[1],y:player.y+60,yaw:0};traffic.populateAt(observer,player);
    assert.ok(traffic.count>=280,`${traffic.count} cars on High`);const before=traffic.refills;assert.deepEqual(before,{asked:0,placed:0},'a teleport is no refill');
    let seg=0,along=0,target=0,least=Infinity;const seconds=12;
    for(let frame=0;frame<seconds*60;frame++){
      let step=54/60;
      while(step>0&&seg<path.length-1){const a=path[seg],b=path[seg+1],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(along+step<len){along+=step;step=0;}else{step-=len-along;along=0;seg++;}}
      const a=path[Math.min(seg,path.length-2)],b=path[Math.min(seg+1,path.length-1)],len=Math.hypot(b[0]-a[0],b[1]-a[1]),t=seg<path.length-1?along/len:1;
      observer.x=a[0]+(b[0]-a[0])*t;observer.z=a[1]+(b[1]-a[1])*t;observer.y=sampleElevation(metro,observer.x,observer.z)+60;
      traffic.update(1/60,player,observer,[]);physics.world.step();
      if(frame%60===59){const p=traffic.population(observer);target=Math.max(target,p.target);least=Math.min(least,p.local);}
    }
    const {asked,placed}=traffic.refills,refills=seconds*4;
    assert.ok(target>=100,`the neighborhood asks for ${target} cars, more than its lanes hold`);
    assert.ok(placed>=10,`${placed} cars were moved toward the observer: the refill still works`);
    // Each refill may fail twice on the streets and eight times on the highway, cars and trucks apart, beside what it places.
    assert.ok(asked-placed<=refills*20,`${asked} placements asked for ${placed} given in ${refills} refills`);
    assert.ok(asked<600,`${asked} placements asked in ${seconds} s (77 with the limit, 3,241 without it)`);
    assert.ok(least>=25,`${least} cars near the observer at the least`);
  }finally{traffic.dispose?.();physics.world.free?.();}
});
