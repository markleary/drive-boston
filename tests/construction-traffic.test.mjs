import './helpers/npc-fleet.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {createTraffic,lane,roadGraph,roundedPath} from '../src/simulation/traffic.ts';
import {planConstructionZones,constructionPoint} from '../src/simulation/construction-zones.ts';
import {constructionCones,createConstruction} from '../src/simulation/construction.ts';

const dt=1/60;
const local=(zone,car)=>{
  const dx=car.x-zone.x,dz=car.z-zone.z,s=Math.sin(zone.yaw),c=Math.cos(zone.yaw);
  return{along:dx*s+dz*c,across:-dx*c+dz*s};
};
const alignment=(a,b)=>Math.cos(a-b);
function fixtureCity(oneway){
  const direction=oneway===-1?-1:1;
  return {
    bounds:{minX:-700,maxX:700,minZ:-100,maxZ:400},
    spawn:{x:-500*direction,z:0,yaw:Math.PI/2*direction},buildings:[],signals:[],
    roads:[{id:'works',name:'Test Avenue',width:14,pavedWidth:oneway?7:13,oneway,
      points:Array.from({length:13},(_,i)=>[-600+i*100,0])}],
  };
}

/** Inspect the car's full oriented footprint. A centreline-only assertion would
 * miss a long pickup or box truck sweeping a cone during the merge. */
function assertClearFootprint(zone,car,conePoints){
  const p=local(zone,car),yaw=car.yaw-zone.yaw,c=Math.abs(Math.cos(yaw)),s=Math.abs(Math.sin(yaw));
  const lateral=car.halfWidth*c+car.halfLength*s,longitudinal=car.halfLength*c+car.halfWidth*s;
  assert.ok(Math.abs(p.across)+lateral<zone.pavedWidth/2-.01,`${car.registration} stays between curbs at ${p.along.toFixed(1)}m`);
  if(Math.abs(p.along)<3.4+longitudinal){
    assert.ok(p.across+lateral<zone.laneOffset-1.25-.02,`${car.registration} clears the parked equipment at ${p.along.toFixed(1)}m`);
  }
  const fx=Math.sin(car.yaw),fz=Math.cos(car.yaw);
  for(const point of conePoints){
    const dx=point[0]-car.x,dz=point[1]-car.z;
    const along=dx*fx+dz*fz,across=dx*fz-dz*fx;
    const distance=Math.hypot(Math.max(0,Math.abs(along)-car.halfLength),Math.max(0,Math.abs(across)-car.halfWidth));
    assert.ok(distance>.245+.015,`${car.registration} clears a cone by its full base radius (${distance.toFixed(3)}m)`);
  }
}

for(const [label,oneway,seed]of [['forward one-way',1,85],['reverse one-way',-1,8],['two-way',0,37]]){
  test(`live ${label} traffic merges through a physical construction site and continues beyond it`,async()=>{
    const city=fixtureCity(oneway),zones=planConstructionZones(city,{seed,maxZones:1});
    assert.equal(zones.length,1);const [zone]=zones;
    const physics=await DrivingPhysics.create(city),scene=new THREE.Scene(),construction=createConstruction(scene,city,physics,zones);
    const traffic=createTraffic(scene,city,physics,zones);
    const observer={x:zone.x,y:.65,z:120},player={x:zone.x,y:.65,z:300,yaw:0,speed:0,steering:0};
    physics.body.setTranslation(player,true);physics.body.setLinvel({x:0,y:0,z:0},true);
    construction.update(observer,player);
    const coneBodies=[...new Set([...construction.colliders].map(handle=>physics.world.getCollider(handle).parent()).filter(body=>body.isDynamic()))];
    const coneStarts=coneBodies.map(body=>body.translation());
    const conePoints=constructionCones(zone).map(cone=>constructionPoint(zone,cone.along,cone.offset));
    assert.equal(coneBodies.length,conePoints.length,'every visible cone has its own dynamic body');
    const entered=new Map(),passed=new Set(),outerPassed=new Set(),opposing=new Set();let footprintChecks=0,peakSteering=0;
    let previous=traffic.snapshot();
    try{
      assert.ok(previous.length>=5,'the road carries a live fleet for the merge');
      for(let step=0;step<60*60;step++){
        traffic.update(dt,player,observer);physics.world.step();construction.update(observer,player);
        const cars=traffic.snapshot();
        cars.forEach((car,index)=>{
          const p=local(zone,car),before=local(zone,previous[index]);
          assert.equal(car.knocked,false,'construction must not knock an NPC out of its route');
          if(alignment(car.yaw,zone.yaw)>.9){
            if(p.along<-48)entered.set(car.registration,{outer:p.across>0});
            if(p.along>48&&entered.has(car.registration)){
              passed.add(car.registration);if(entered.get(car.registration).outer)outerPassed.add(car.registration);
            }
            if(Math.abs(p.along)<45){
              assertClearFootprint(zone,car,conePoints);footprintChecks++;peakSteering=Math.max(peakSteering,Math.abs(car.steering));
              assert.ok(p.along>=before.along-1e-5,'merging continues in the legal direction');
              if(Math.abs(before.along)<48)assert.ok(Math.hypot(car.x-previous[index].x,car.z-previous[index].z)<.20,'a merge follows the route continuously, without relocation');
              if(Math.abs(p.along)<12)assert.ok(p.across<=zone.openOffset+.015,'cars occupy the remaining lane through the work area');
            }
          }else if(alignment(car.yaw,zone.yaw)<-.99){
            opposing.add(car.registration);
            assert.ok(Math.abs(p.across+2.99)<1e-5,'opposite-direction traffic retains its original lane');
          }
        });
        previous=cars;
      }
      assert.ok(passed.size>=2,`at least two cars actually cross the full closure (${passed.size})`);
      assert.ok(outerPassed.size>=1,'a car starting in the closed lane merges and reaches the far side');
      assert.ok(footprintChecks>120,'footprints are checked during real traversal');
      assert.ok(peakSteering>.015,'the detour visibly steers the front wheels');
      if(!oneway)assert.ok(opposing.size>=2,'the unaffected opposite-direction stream remains active');
      coneBodies.forEach((body,i)=>{const p=body.translation();assert.ok(Math.hypot(p.x-coneStarts[i].x,p.z-coneStarts[i].z)<.10,'traffic leaves every construction cone standing in its lane');});
    }finally{traffic.dispose();construction.dispose();physics.dispose();}
  });
}

test('rounded construction routes preserve the open lane and leave the opposing path unchanged',()=>{
  const city=fixtureCity(0),[zone]=planConstructionZones(city,{seed:37,maxZones:1}),{edges}=roadGraph(city);
  for(const edge of edges){
    const points=lane(edge,[zone]),path=roundedPath(points,points.map(()=>edge.road));
    const same=alignment(Math.atan2(edge.points[1][0]-edge.points[0][0],edge.points[1][1]-edge.points[0][1]),zone.yaw)>0;
    for(const point of path.points){
      const p=local(zone,{x:point[0],z:point[1]});
      if(same&&Math.abs(p.along)<zone.workLength/2+3)assert.ok(Math.abs(p.across-zone.openOffset)<.01,'corner rounding must not bend the route back into the work area');
      if(!same)assert.ok(Math.abs(p.across+2.99)<1e-6,'opposing traffic must not be displaced by route rounding');
    }
  }
});
