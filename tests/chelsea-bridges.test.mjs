import assert from 'node:assert/strict';
import test from 'node:test';
import {DrivingPhysics,carSteeringLimit} from '../src/physics/vehicle.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {loadMetroCity,windowCity,installExactMeshes} from './helpers/metro-city.mjs';
import {meshBuildingIds} from '../src/simulation/building-collisions.ts';
const metro=await loadMetroCity({bounds:{minX:2600,maxX:4500,minZ:-4350,maxZ:-3500}});
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

// Follow an actual adjoining street for 30m so each physical test crosses both
// ground/deck seams; starting and stopping on the bridge would miss them.
function streetTail(city,point,direction){
 const choices=[];
 for(const road of city.roads){
  if(road.elevations)continue;
  for(let i=0;i<road.points.length;i++)if(distance(point,road.points[i])<.01)for(const step of [-1,1]){
   const q=road.points[i+step];if(!q)continue;
   const score=((q[0]-point[0])*direction[0]+(q[1]-point[1])*direction[1])/distance(point,q);
   const path=[point];let remaining=30;
   for(let j=i+step;j>=0&&j<road.points.length;j+=step){const p=path.at(-1),q=road.points[j],length=distance(p,q),t=Math.min(1,remaining/length);path.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);remaining-=length;if(remaining<=0)break;}
   if(path.length>1)choices.push({score,path});
  }
 }
 assert.ok(choices.length,'bridge must have a real street continuation');return choices.sort((a,b)=>b.score-a.score)[0].path;
}
function resample(points){return points.flatMap((a,i)=>{const b=points[i+1];if(!b)return[a];const n=Math.ceil(distance(a,b)/3);return Array.from({length:n},(_,j)=>[a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n]);});}

for(const id of ['chelsea-mcardle','chelsea-street-bridge'])for(const reverse of [false,true])test(`${id} ${reverse?'Chelsea to East Boston':'East Boston to Chelsea'} crosses both street seams without hitting barriers`,async()=>{
 const bridge=metro.roads.find(r=>r.id===id);assert.ok(bridge);
 const bounds={minX:Math.min(...bridge.points.map(p=>p[0]))-100,maxX:Math.max(...bridge.points.map(p=>p[0]))+100,minZ:Math.min(...bridge.points.map(p=>p[1]))-100,maxZ:Math.max(...bridge.points.map(p=>p[1]))+100};
 const city=windowCity(metro,bounds);city.geometry=metro.geometry;
 const a=bridge.points[0],b=bridge.points[1],y=bridge.points.at(-2),z=bridge.points.at(-1);
 const before=streetTail(city,a,[a[0]-b[0],a[1]-b[1]]).reverse(),after=streetTail(city,z,[z[0]-y[0],z[1]-y[1]]);
 let points=resample([...before.slice(0,-1),...bridge.points,...after.slice(1)]);if(reverse)points.reverse();
 points=points.map((p,i,list)=>{const a=list[Math.max(0,i-1)],b=list[Math.min(list.length-1,i+1)],length=distance(a,b)||1;return[p[0]-(b[1]-a[1])/length*2.2,p[1]+(b[0]-a[0])/length*2.2];});
 for(const i of [0,bridge.points.length-1])assert.ok(Math.abs(bridge.elevations[i]-sampleElevation(city,...bridge.points[i]))<.001,'deck meets graded terrain');
 const physics=await DrivingPhysics.create(city,{meshBuildingIds});installExactMeshes(physics,city);const held={throttle:0,brake:0,steer:0,handbrake:false};
 try{
  physics.reset(...points[0],Math.atan2(points[1][0]-points[0][0],points[1][1]-points[0][1]));for(let i=0;i<60;i++)physics.step({...held,brake:1},1/60);
  let cursor=1,lastProgress=0;
  for(let frame=0;frame<150*60;frame++){
   const s=physics.getState(),previous=cursor;while(cursor<points.length-1&&Math.hypot(s.x-points[cursor][0],s.z-points[cursor][1])<3.5)cursor++;
   if(cursor>previous)lastProgress=frame;assert.ok(frame-lastProgress<480,`blocked at ${s.x.toFixed(2)},${s.z.toFixed(2)} y=${s.y.toFixed(2)} near point ${cursor}`);
   if(cursor===points.length-1&&Math.hypot(s.x-points[cursor][0],s.z-points[cursor][1])<3.5){assert.ok(Math.abs(s.y-sampleElevation(city,s.x,s.z)-.67)<.3,'vehicle reaches actual ground beyond the far landing');return;}
   let target=cursor,look=0;while(target<points.length-1&&look<8){look+=distance(points[target],points[target+1]);target++;}
   const p=points[target],angle=Math.atan2(Math.sin(Math.atan2(p[0]-s.x,p[1]-s.z)-s.yaw),Math.cos(Math.atan2(p[0]-s.x,p[1]-s.z)-s.yaw)),steer=Math.atan2(2*2.66*Math.sin(angle),Math.max(4,Math.hypot(p[0]-s.x,p[1]-s.z))),speed=Math.abs(angle)>.35?5:8;
   physics.step({...held,throttle:s.speed<speed?.7:0,brake:s.speed>speed+1?.2:0,steer:Math.max(-1,Math.min(1,steer/carSteeringLimit(s.speed)))},1/60);
  }
  assert.fail('crossing did not finish');
 }finally{physics.dispose();}
});
