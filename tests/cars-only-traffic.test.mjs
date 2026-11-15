import './helpers/npc-fleet.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {isCarsOnlyRoad,npcRoadAllowed} from '../src/simulation/cars-only-roads.ts';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {createTraffic} from '../src/simulation/traffic.ts';

const names=['Storrow Drive East · Back Bay','Storrow Dr.','Soldiers Field Road','Soldiers Field Rd','Memorial Drive','Memorial Dr.','Embankment Road'];
test('commercial restrictions recognize parkways and access aliases without banning nearby streets',()=>{
  for(const name of names){assert.equal(isCarsOnlyRoad({name}),true,name);assert.equal(npcRoadAllowed('box',{name}),false,name);assert.equal(npcRoadAllowed('sedan',{name}),true,name);}
  for(const name of ['Charlesbank Road','Soldiers Field Place','Memorial Road','Memorial Circle','West Harrington Memorial Way','Main Street'])assert.equal(isCarsOnlyRoad({name}),false,name);
  for(const road of [{name:'Unnamed ramp',highway:'storrow'},{name:'Unnamed ramp',bridge:{id:'storrow'}},{name:'Unnamed ramp',id:'storrow-wb-entry'},...['8890-0-0','13519-0-0','13128-0-0','13129-0-0','13133-0-0','13134-0-0','13136-0-0','8541-0-0'].map(id=>({name:'Charlesbank Road',id}))])assert.equal(npcRoadAllowed('box',road),false);
});

test('audited source aliases block box trucks while genuine nearby local roads remain legal',()=>{
  const aliases={
    'David G Mugar Way':['1797-0-0','1798-0-0','7601-0-0','13337-0-0','14322-0-0','14323-0-0','14324-0-0'],
    'Charles Street':['8457-0-0','13137-0-0','13138-0-0'],
    'Nashua Street':['9170-0-0','9171-0-0','13140-0-0'],
    'North Beacon Street':['14372-0-0'],
  };
  for(const [name,ids]of Object.entries(aliases))for(const id of ids){assert.equal(npcRoadAllowed('box',{id,name}),false,id);assert.equal(npcRoadAllowed('sedan',{id,name}),true,id);}
  for(const id of ['9281-0-0','9282-0-0','7604-0-0','13240-0-0'])assert.equal(npcRoadAllowed('box',{id,name:'David G Mugar Way'}),true,id);
  for(const [id,name]of [['10287-0-0','Cambridge Street'],['10309-0-0','Western Avenue'],['9444-0-0','North Harvard Street'],['8696-0-0','Everett Street'],['1245-0-0','Charles Street'],['real-charlesbank','Charlesbank Road']])assert.equal(npcRoadAllowed('box',{id,name}),true,id);
});

function fixture(){
  const roads=[],n=19,step=100;
  for(let x=0;x<n;x++)for(let z=0;z<n;z++){
    if(x<n-1)roads.push({id:`h-${x}-${z}`,name:z===2?'Storrow Drive':z===4?'Soldiers Field Road':z===6?'Memorial Drive':'Market Street',width:16,oneway:0,points:[[x*step,z*step],[(x+1)*step,z*step]]});
    if(z<n-1)roads.push({id:`v-${x}-${z}`,name:'Commercial Avenue',width:16,oneway:0,points:[[x*step,z*step],[x*step,(z+1)*step]]});
  }
  return{bounds:{minX:-100,maxX:2000,minZ:-100,maxZ:2000},roads,signals:[],buildings:[],spawn:{x:400,z:200,yaw:Math.PI/2}};
}

test('box fleet avoids parkways at startup, teleport refills and continued driving through their junctions',async()=>{
  const city=fixture(),physics=await DrivingPhysics.create(city),traffic=createTraffic(new THREE.Scene(),city,physics);
  const far={x:-200,y:.8,z:-200,yaw:0,speed:0,steering:0};physics.body.setTranslation(far,true);
  const assertLegal=()=>{
    const cars=traffic.snapshot();assert.equal(cars.length,77);
    assert.equal(cars.filter(car=>car.type==='box').length,7,'commercial fleet remains available on legal roads');
    for(const car of cars)if(car.type==='box')assert.equal(isCarsOnlyRoad({name:car.road}),false,`box truck entered ${car.road}`);
    return cars;
  };
  try{
    assertLegal();let passengerParkway=false,truckTravel=0;
    const previous=new Map();
    for(let tick=0;tick<7200;tick++){
      const observer={x:400,y:.8,z:200+Math.floor(tick/2400)*200,yaw:Math.PI/2};
      if(tick%2400===0)traffic.populateAt(observer,far);
      traffic.update(1/30,far,observer);physics.world.step();
      if(tick%30===0)for(const car of assertLegal()){
        if(car.type!=='box'&&isCarsOnlyRoad({name:car.road}))passengerParkway=true;
        if(car.type==='box'){const prior=previous.get(car.registration);if(prior)truckTravel+=Math.min(20,Math.hypot(car.x-prior.x,car.z-prior.z));previous.set(car.registration,car);}
      }
    }
    assert.ok(passengerParkway,'passenger cars continue using the parkways');
    assert.ok(truckTravel>200,'trucks must drive and cross parkway intersections on legal streets rather than all remain frozen');
  }finally{traffic.dispose();physics.dispose();}
});
