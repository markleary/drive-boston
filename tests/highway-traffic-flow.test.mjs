import './helpers/npc-fleet.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {createTraffic} from '../src/simulation/traffic.ts';
import {sampleRoadElevation} from '../src/simulation/road-surfaces.ts';
import {loadMetroCity,windowCity} from './helpers/metro-city.mjs';

const city=await loadMetroCity({tiles:[]}),roads=[...city.roads,...city.surveyRoads??[]],byId=new Map(roads.map(r=>[r.id,r]));
const leverettBounds={minX:-600,maxX:1300,minZ:-4300,maxZ:-1300};

async function fleet(observer,bounds){
 const physics=await DrivingPhysics.create(windowCity(city,bounds)),traffic=createTraffic(new THREE.Scene(),city,physics);
 const player={x:5000,z:5000,y:2,yaw:0,speed:0,steering:0};physics.body.setTranslation(player,true);traffic.populateAt(observer,player);
 return {traffic,step(){traffic.update(1/60,player,observer);physics.world.step();},dispose(){traffic.dispose();physics.dispose();}};
}
function at(road,i){return{x:road.points[i][0],z:road.points[i][1],y:road.elevations[i]+.7};}

test('a real ambient car takes the complete southbound exit and crosses onto Leverett without a height jump',async()=>{
 const road=byId.get('i93-sb-exit-18'),observer=at(road,0),f=await fleet(observer,leverettBounds);
 let selected=-1,previous,joined=false;
 try{
  for(let frame=0;frame<150*60;frame++){
   f.step();if(frame%15)continue;const cars=f.traffic.snapshot();
   if(selected<0)selected=cars.findIndex(c=>!c.parked&&!c.hidden&&c.road===road.name&&c.speed>3);
   if(selected<0)continue;
   const car=cars[selected];Object.assign(observer,{x:car.x,z:car.z,y:car.y+1});
   assert.ok(!car.hidden&&!car.parked&&!car.knocked,'the followed car remains on its route');
   if(previous)assert.ok(Math.abs(car.y-previous.y)<.75,'no step between the mainline, exit pieces and connector');
   previous=car;
   if(car.road==='Leverett Connector'){
    assert.ok(Math.abs(car.y-sampleRoadElevation(city,byId.get('leverett-connector-south'),car.x,car.z)-.65)<.2);
    joined=true;break;
   }
  }
  assert.ok(joined,'a car must traverse the 1.3 km exit and enter the connected Leverett roadway');
 }finally{f.dispose();}
});

test('ambient cars merge from the retained Leverett survey onto I-93 northbound',async()=>{
 const road=byId.get('i93-zakim-leverett-nb-02'),observer=at(road,road.points.length-1),f=await fleet(observer,leverettBounds);
 let previous=f.traffic.snapshot(),merged=0;
 try{
  // The connector carries about one car in eight seconds past this observer and a merge about every five minutes
  // (two in ten minutes, on the package before and after Charles River Dam Road became a street: at 52 and 291 s,
  // then at 146 and 389 s, the seeded sequence having shifted with that road's vertices). So wait for the first
  // merge instead of for a fixed 100 s, which only one of those two sequences passes.
  for(let frame=0;frame<420*60&&!merged;frame++){
   f.step();if(frame%15)continue;const cars=f.traffic.snapshot();
   cars.forEach((car,i)=>{
    const before=previous[i];
    if(before.road!=='Leverett Connector'||!car.road.startsWith('I-93 North')||car.parked||car.hidden)return;
    assert.ok(Math.hypot(car.x-before.x,car.z-before.z)<12,'a real moving car crosses the merge');
    assert.ok(Math.abs(car.y-before.y)<.75,'the car stays on the upper northbound deck');merged++;
   });
   previous=cars;
  }
  assert.ok(merged>0,'Leverett must feed northbound traffic');
 }finally{f.dispose();}
});

for(const direction of ['northbound','southbound'])test(`the shipped I-93 ${direction} tunnel visibly carries moving ambient traffic`,async()=>{
 const road=byId.get(`central-artery-${direction}`),observer=at(road,Math.floor(road.points.length/2));
 const f=await fleet(observer,{minX:observer.x-800,maxX:observer.x+800,minZ:observer.z-800,maxZ:observer.z+800});
 const moving=new Set();let samples=0;
 try{
  assert.equal(f.traffic.population(observer).highway,2,'the underground observer selects the tunnel highway population');
  for(let frame=0;frame<15*60;frame++){
   f.step();if(frame%15)continue;
   for(const car of f.traffic.snapshot()){
    if(car.parked||car.hidden||car.road!==road.name||Math.hypot(car.x-observer.x,car.z-observer.z)>450)continue;
    assert.ok(Math.abs(car.y-sampleRoadElevation(city,road,car.x,car.z)-.65)<.2,'traffic follows its bore rather than the surface road');
    samples++;if(car.speed>3)moving.add(car.registration);
   }
  }
  assert.ok(samples>100&&moving.size>=5,`visible tunnel traffic: ${samples} samples, ${moving.size} moving cars`);
 }finally{f.dispose();}
});
