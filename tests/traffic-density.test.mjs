import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {createTraffic} from '../src/simulation/traffic.ts';

const city=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url),'utf8'));
const gap=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);

test('busy districts get a visible local fleet while explicit teleports preserve car spacing and the fixed pool',async()=>{
  const physics=await DrivingPhysics.create(city),scene=new THREE.Scene(),traffic=createTraffic(scene,city,physics);
  try{
    const initial=traffic.population(city.spawn);
    assert.equal(initial.total,64);
    assert.equal(initial.level,'busy');
    assert.ok(initial.local>=48,'Back Bay needs a populated surrounding street network');
    assert.ok(initial.nearby>=16,'cars must be visible on nearby blocks, not all distant reserve vehicles');
    assert.ok(initial.forward>=5,'the opening street view must contain cars ahead of the camera, not just behind nearby buildings');
    const forward=traffic.snapshot().map(car=>({along:(car.x-city.spawn.x)*Math.sin(city.spawn.yaw)+(car.z-city.spawn.z)*Math.cos(city.spawn.yaw),across:(car.x-city.spawn.x)*Math.cos(city.spawn.yaw)-(car.z-city.spawn.z)*Math.sin(city.spawn.yaw)})).filter(car=>car.along>35&&car.along<200&&Math.abs(car.across)<12);
    assert.ok(Math.max(...forward.map(car=>car.across))-Math.min(...forward.map(car=>car.across))>3,'wide one-way Boylston should use both travel lanes, rather than hide every car behind one convoy');
    for(const [id,level,target] of [['downtown-crossing','busy',48],['mission-hill','residential',18]]){
      const destination=city.landmarks.find(place=>place.id===id).driveStart;
      const before=traffic.snapshot();
      const bus={x:destination.x+Math.sin(destination.yaw)*80,z:destination.z+Math.cos(destination.yaw)*80,y:0,halfLength:6,halfWidth:1.3};
      traffic.populateAt(destination,destination,[bus]);
      const after=traffic.snapshot(),population=traffic.population(destination);
      assert.equal(population.total,64,'moving between districts must not allocate more physics bodies');
      assert.equal(population.level,level);
      assert.equal(population.target,target);
      assert.ok(population.local>=target,'teleport should arrive in an already populated neighborhood');
      if(level==='busy')assert.ok(population.nearby>=12,'the new downtown view should have nearby traffic immediately');
      if(level==='busy')assert.ok(population.forward>=5,'downtown must populate the real narrow through street visible ahead');
      if(level==='residential')assert.ok(population.local<initial.local,'residential streets retain a quieter fleet');
      for(let i=0;i<after.length;i++){
        if(gap(before[i],destination)<650*1.35)assert.ok(gap(before[i],after[i])<1e-6,'cars already in the new neighborhood must keep their position');
        if(gap(before[i],after[i])>1){
          assert.ok(gap(after[i],destination)>=35,'new cars must clear the arriving player');
          assert.ok(gap(after[i],bus)>=11,'new cars must clear a bus already at the destination');
        }
        for(let j=0;j<i;j++)assert.ok(gap(after[i],after[j])>=18-1e-6,'all respawns retain a safe traffic gap');
      }
    }
  }finally{traffic.dispose();physics.dispose();}
});
