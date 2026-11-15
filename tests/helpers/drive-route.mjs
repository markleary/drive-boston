import assert from 'node:assert/strict';
import {DrivingPhysics,carSteeringLimit} from '../../src/physics/vehicle.ts';
import {sampleRoadElevation} from '../../src/simulation/road-surfaces.ts';
import {installExactMeshes} from './metro-city.mjs';

/** Drive through real generated surfaces and exact survey collision, including
 * seams. Progress, uprightness and the destination height are checked. */
export async function driveRoadChain(city,roads,{reverse=false,speed=6}={}){
 const points=roads.flatMap((r,k)=>r.points.slice(k?1:0).map(p=>({x:p[0],z:p[1],y:sampleRoadElevation(city,r,...p)})));
 const route=[];
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/2));
  for(let j=0;j<n;j++)route.push({x:a.x+(b.x-a.x)*j/n,z:a.z+(b.z-a.z)*j/n,y:a.y+(b.y-a.y)*j/n});
 }
 route.push(points.at(-1));if(reverse)route.reverse();
 const physics=await DrivingPhysics.create(city);installExactMeshes(physics,city);
 const released={throttle:0,brake:0,steer:0,handbrake:false};
 const start=route[0],next=route[1],end=route.at(-1),name=roads.map(r=>r.id).join(' → ');
 try{
  physics.reset(start.x,start.z,Math.atan2(next.x-start.x,next.z-start.z),roads[0].id);
  physics.body.setTranslation({x:start.x,y:start.y+.85,z:start.z},true);
  for(let i=0;i<60;i++)physics.step({...released,brake:1},1/60);
  let cursor=1,last=0;
  const distance=route.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-route[i].x,p.z-route[i].z),0);
  for(let frame=0;frame<Math.max(180,distance/speed*1.5+30)*60;frame++){
   const state=physics.getState(),previous=cursor;
   while(cursor<route.length-1&&Math.hypot(route[cursor].x-state.x,route[cursor].z-state.z)<3)cursor++;
   if(cursor>previous)last=frame;
   assert.ok(frame-last<600,`blocked ${name} at ${state.x.toFixed(2)},${state.z.toFixed(2)} y=${state.y.toFixed(2)} toward ${route[cursor].x.toFixed(2)},${route[cursor].z.toFixed(2)}`);
   assert.ok(Math.abs(state.rotation.x)<.55&&Math.abs(state.rotation.z)<.55,`${name}: car stays upright`);
   if(cursor===route.length-1&&Math.hypot(state.x-end.x,state.z-end.z)<2){assert.ok(Math.abs(state.y-end.y-.67)<.65,`${name}: ends on destination floor`);return;}
   let target=cursor,look=0;
   while(target<route.length-1&&look<5){look+=Math.hypot(route[target+1].x-route[target].x,route[target+1].z-route[target].z);target++;}
   const p=route[target],dx=p.x-state.x,dz=p.z-state.z,angle=Math.atan2(Math.sin(Math.atan2(dx,dz)-state.yaw),Math.cos(Math.atan2(dx,dz)-state.yaw));
   const steer=Math.atan2(2*2.66*Math.sin(angle),Math.hypot(dx,dz))/carSteeringLimit(state.speed);
   physics.step({...released,throttle:state.speed<speed?.35:0,brake:state.speed>speed+1?.2:0,steer},1/60);
  }
  assert.fail(`did not finish ${name}`);
 }finally{physics.dispose();}
}
