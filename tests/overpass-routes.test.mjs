import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {prepareRoadTerrain} from '../src/simulation/road-grading.ts';
import {bridgeBarriers} from '../src/simulation/road-surfaces.ts';

const city=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url),'utf8'));
prepareRoadTerrain(city);
const released={throttle:0,brake:0,steer:0,handbrake:false};

// Follow surveyed centerlines using steering and pedals only. A point-height
// query or a reset past the merge would miss the original physical obstruction.
async function driveRoute(ids){
  const route=ids.flatMap(id=>{
    const road=city.roads.find(r=>r.id===`${id}-0-bridge`);assert.ok(road);
    return road.points.map((p,i)=>({x:p[0],z:p[1],y:road.elevations[i],id:road.id}));
  });
  const physics=await DrivingPhysics.create(city);
  try{
    let cursor=1,lastProgress=0,maxHeight=-Infinity;
    const start=route[cursor],next=route[cursor+1];
    physics.reset(start.x,start.z,Math.atan2(next.x-start.x,next.z-start.z),start.id);
    for(let i=0;i<60;i++)physics.step({...released,brake:1},1/60);
    for(let frame=0;frame<110*60;frame++){
      const state=physics.getState(),previous=cursor;
      while(cursor<route.length-1&&Math.hypot(route[cursor].x-state.x,route[cursor].z-state.z)<4)cursor++;
      if(cursor>previous)lastProgress=frame;
      assert.ok(frame-lastProgress<360,`blocked on ${route[cursor].id} at ${state.x.toFixed(2)}, ${state.z.toFixed(2)}`);
      assert.ok(Math.abs(state.rotation.x)<.35&&Math.abs(state.rotation.z)<.35,'car remains upright through the joins');
      maxHeight=Math.max(maxHeight,state.y);
      if(cursor===route.length-1&&Math.hypot(state.x-route[cursor].x,state.z-route[cursor].z)<1.5){
        assert.ok(maxHeight>6.9,'route actually climbed onto the upper deck');
        assert.ok(state.speed>5,'car reaches the far exit under its own power');
        assert.ok(Math.abs(state.y-route[cursor].y-.67)<.5,`car returns to the exit elevation: y=${state.y}, exit=${route[cursor].y}`);
        return;
      }
      let target=cursor,look=0;
      while(target<route.length-1&&look<7){look+=Math.hypot(route[target+1].x-route[target].x,route[target+1].z-route[target].z);target++;}
      const point=route[target],dx=point.x-state.x,dz=point.z-state.z;
      const angle=Math.atan2(Math.sin(Math.atan2(dx,dz)-state.yaw),Math.cos(Math.atan2(dx,dz)-state.yaw));
      const steeringAngle=Math.atan2(2*2.66*Math.sin(angle),Math.hypot(dx,dz));
      const limit=Math.min(.48,Math.atan(7.8*2.66/(state.speed*state.speed+16)));
      physics.step({...released,throttle:state.speed<8?.4:0,brake:state.speed>9?.15:0,steer:steeringAngle/limit},1/60);
    }
    assert.fail('did not complete the entire overpass route');
  }finally{physics.dispose();}
}

test('Bowker destination ramp clears the acute merge and descending-ramp barrier',()=>
  driveRoute([21327,23520,24120,20011,21017,19411]));
test('Bowker southbound route crosses Commonwealth and exits onto Boylston',()=>
  driveRoute([21862,21969,23628,22007,24120,20011,21017,19411]));
test('Bowker northbound route clears the exit split and returns to street level',()=>
  driveRoute([19934,19480,21363,24125,19492,20142,22849]));

test('merge clipping retains exposed guardrails and does not open rails over a lower street',()=>{
  const main={id:'upper',points:[[0,0],[0,40]],width:8,elevations:[6,6]};
  const ramp={id:'ramp',points:[[0,20],[12,40]],width:7,elevations:[6,5.5]};
  const under={id:'lower',points:[[-15,10],[15,10]],width:8,elevations:[0,0]};
  const rails=bridgeBarriers({roads:[main,ramp,under]},main);
  const distance=(x,z)=>Math.min(...rails.map(p=>{
    const dx=Math.sin(p.yaw),dz=Math.cos(p.yaw),t=Math.max(-p.length/2,Math.min(p.length/2,(x-p.x)*dx+(z-p.z)*dz));
    return Math.hypot(x-p.x-dx*t,z-p.z-dz*t);
  }));
  assert.ok(distance(3.82,26.37)>2,'joining ramp lane is free of mainline rail');
  assert.ok(distance(-3.82,26.37)<.01,'exposed opposite edge stays protected');
  assert.ok(distance(3.82,10)<.01&&distance(-3.82,10)<.01,'lower crossing cannot punch holes in the upper rails');
});
