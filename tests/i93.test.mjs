import assert from 'node:assert/strict';
import test from 'node:test';
import {DrivingPhysics,carSteeringLimit} from '../src/physics/vehicle.ts';
import {sampleRoadElevation} from '../src/simulation/road-surfaces.ts';
import {meshBuildingIds} from '../src/simulation/building-collisions.ts';
import {loadMetroCity,windowCity,installExactMeshes} from './helpers/metro-city.mjs';

// Interstate 93 north of the tunnel on the shipped package: the car crosses the joins between the
// surveyed Zakim viaduct and the estimated decks, leaves by a ramp onto its street, and stops at the
// barriers that close the carriageway at the Medford/Stoneham line.
const SURVEY='BOS-2E9SM-83L3W-UVT08',released={throttle:0,brake:0,steer:0,handbrake:false};
const tilesOf=b=>{const out=[];for(let tx=Math.floor(b.minX/1000);tx<=Math.floor(b.maxX/1000);tx++)for(let tz=Math.floor(b.minZ/1000);tz<=Math.floor(b.maxZ/1000);tz++)out.push(`${tx}_${tz}`);return out;};
const index=await loadMetroCity({bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100}});
const all=[...index.roads,...(index.surveyRoads??[])],byId=new Map(all.map(r=>[r.id,r]));
const series=prefix=>all.filter(r=>new RegExp(`^${prefix}-\\d+$`).test(r.id)).sort((a,b)=>+a.id.split('-').at(-1)-+b.id.split('-').at(-1));
const nb=series('i93-nb'),sb=series('i93-sb'),same=(p,q)=>p[0]===q[0]&&p[1]===q[1];
const stations=road=>road.points.map((p,i)=>({x:p[0],z:p[1],y:road.elevations[i]}));
const length=points=>points.slice(1).reduce((s,p,i)=>s+Math.hypot(p.x-points[i].x,p.z-points[i].z),0);
function tail(points,metres){let d=0,i=points.length-1;while(i>0&&d<metres){d+=Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z);i--;}return points.slice(i);}
function head(points,metres){let d=0,i=0;while(i<points.length-1&&d<metres){d+=Math.hypot(points[i+1].x-points[i].x,points[i+1].z-points[i].z);i++;}return points.slice(0,i+1);}
function dense(points){
 const out=[];
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/3));for(let j=0;j<n;j++)out.push({x:a.x+(b.x-a.x)*j/n,z:a.z+(b.z-a.z)*j/n,y:a.y+(b.y-a.y)*j/n});}
 return [...out,points.at(-1)];
}
const join=(...parts)=>parts.flatMap((p,i)=>i&&same([p[0].x,p[0].z],[parts[i-1].at(-1).x,parts[i-1].at(-1).z])?p.slice(1):p);

/** A physics world for the area around `route` (with the survey's tile when it needs the Zakim mesh). */
async function world(route,survey){
 const xs=route.map(p=>p.x),zs=route.map(p=>p.z),bounds={minX:Math.min(...xs)-150,maxX:Math.max(...xs)+150,minZ:Math.min(...zs)-150,maxZ:Math.max(...zs)+150};
 const metro=await loadMetroCity({tiles:[...new Set([...tilesOf(bounds),...(survey?['0_-3']:[])])]}),city=windowCity(metro,bounds);city.geometry=metro.geometry;
 if(survey)city.buildings=[...city.buildings,...metro.buildings.filter(b=>b.id===SURVEY&&!city.buildings.includes(b))];
 const physics=await DrivingPhysics.create(city,{meshBuildingIds});
 const exact=installExactMeshes(physics,city);if(survey)assert.ok(exact.has(SURVEY),'the Zakim survey mesh collides');
 return physics;
}
/** Follow `route` at about 9 m/s; returns the final state, or fails where the car is blocked or tips. */
async function drive(route,id,{survey=false,stopAtEnd=true}={}){
 const physics=await world(route,survey),start=route[0],next=route[1],end=route.at(-1);
 try{
  physics.reset(start.x,start.z,Math.atan2(next.x-start.x,next.z-start.z),id);
  physics.body.setTranslation({x:start.x,y:start.y+.85,z:start.z},true);
  for(let i=0;i<60;i++)physics.step({...released,brake:1},1/60);
  let cursor=1,lastProgress=0;
  for(let frame=0;frame<120*60;frame++){
   const state=physics.getState(),previous=cursor;
   while(cursor<route.length-1&&Math.hypot(route[cursor].x-state.x,route[cursor].z-state.z)<4)cursor++;
   if(cursor>previous)lastProgress=frame;
   assert.ok(Math.abs(state.rotation.x)<.45&&Math.abs(state.rotation.z)<.45,`${id}: the car stays upright`);
   if(frame-lastProgress>=300){if(!stopAtEnd)return {state,cursor};assert.fail(`${id}: blocked at ${state.x.toFixed(1)}, ${state.z.toFixed(1)}, y=${state.y.toFixed(2)} (next ${route[cursor].x.toFixed(1)}, ${route[cursor].z.toFixed(1)}, y=${route[cursor].y.toFixed(2)})`);}
   const below=route[Math.max(0,cursor-1)];
   assert.ok(Math.abs(state.y-below.y-.67)<1.2,`${id}: the car rides the road at ${state.x.toFixed(1)}, ${state.z.toFixed(1)} (y ${state.y.toFixed(2)}, road ${below.y.toFixed(2)})`);
   if(cursor===route.length-1&&Math.hypot(state.x-end.x,state.z-end.z)<2)return {state,cursor};
   let target=cursor,look=0;
   while(target<route.length-1&&look<8){look+=Math.hypot(route[target+1].x-route[target].x,route[target+1].z-route[target].z);target++;}
   const p=route[target],dx=p.x-state.x,dz=p.z-state.z,angle=Math.atan2(Math.sin(Math.atan2(dx,dz)-state.yaw),Math.cos(Math.atan2(dx,dz)-state.yaw));
   const steer=Math.atan2(2*2.66*Math.sin(angle),Math.hypot(dx,dz))/carSteeringLimit(state.speed);
   physics.step({...released,throttle:state.speed<8?.45:0,brake:state.speed>10?.15:0,steer},1/60);
  }
  assert.fail(`${id}: the drive did not finish`);
 }finally{physics.dispose();}
}

test('northbound: off the surveyed Charlestown viaduct onto the estimated deck at the north mouth',async()=>{
 const trace=all.find(r=>r.surveyDeck&&same(r.points.at(-1),nb[0].points[0]));assert.ok(trace,'a survey trace ends where the northbound deck starts');
 const route=dense(join(tail(stations(trace),70),stations(nb[0]),head(stations(nb[1]),90)));
 await drive(route,nb[0].id,{survey:true});
});

test('southbound: off the Charlestown lower deck onto the Zakim survey at City Square',async()=>{
 const last=sb.at(-1),trace=all.find(r=>r.surveyDeck&&same(r.points[0],last.points.at(-1)));assert.ok(trace,'a survey trace starts where the lower deck ends');
 const route=dense(join(tail(stations(last),150),head(stations(trace),70)));
 await drive(route,last.id,{survey:true});
});

test('northbound exit 23 leaves the carriageway at its gore and lands on the street',async()=>{
 const ramp=['i93-nb-exit-23','i93-nb-exit-23-2'].map(id=>byId.get(id));assert.ok(ramp.every(Boolean));
 const main=nb.find(r=>same(r.points.at(-1),ramp[0].points[0]))??nb.find(r=>same(r.points[0],ramp[0].points[0]));assert.ok(main,'the exit leaves at a carriageway piece end');
 const before=same(main.points.at(-1),ramp[0].points[0])?tail(stations(main),60):tail(stations(nb[nb.indexOf(main)-1]),60);
 // The street that carries on in the ramp's heading from the vertex it lands on (any record through that vertex, either way).
 const end=ramp[1].points.at(-1),heading=[end[0]-ramp[1].points.at(-2)[0],end[1]-ramp[1].points.at(-2)[1]];
 const ways=index.roads.filter(r=>!r.id.startsWith('i93-')&&!r.elevations).flatMap(r=>{const k=r.points.findIndex(p=>same(p,end));return k<0?[]:[r.points.slice(k),r.points.slice(0,k+1).reverse()].filter(s=>s.length>1).map(points=>({road:r,points}));});
 const cos=({points:[a,b]})=>((b[0]-a[0])*heading[0]+(b[1]-a[1])*heading[1])/Math.hypot(b[0]-a[0],b[1]-a[1])/Math.hypot(...heading);
 const onward=ways.sort((a,b)=>cos(b)-cos(a))[0];assert.ok(onward&&cos(onward)>.7,'the ramp lands on a street vertex and a street carries on from it');
 const landing=head(onward.points.map(p=>({x:p[0],z:p[1],y:sampleRoadElevation(index,onward.road,...p)})),25);
 assert.ok(Math.abs(ramp[1].elevations.at(-1)-landing[0].y)<.15,'the ramp ends at the street height');
 await drive(dense(join(before,stations(ramp[0]),stations(ramp[1]),landing)),ramp[0].id);
});

test('the northbound carriageway ends at barriers the car cannot pass, short of the closed end',async()=>{
 const end=nb.at(-1);assert.equal(end.closed,'end');assert.equal(sb[0].closed,'start');
 const route=dense(join(tail(stations(nb.at(-2)),80),stations(end))),total=length(stations(end));
 const {state}=await drive(route,end.id,{stopAtEnd:false});
 const last=end.points.at(-1),before=end.points.at(-2),ux=(last[0]-before[0])/Math.hypot(last[0]-before[0],last[1]-before[1]),uz=(last[1]-before[1])/Math.hypot(last[0]-before[0],last[1]-before[1]);
 const short=(last[0]-state.x)*ux+(last[1]-state.z)*uz;
 assert.ok(short>1&&short<12,`the car stops ${short.toFixed(1)} m short of the ${total.toFixed(0)} m piece's closed end`);
 assert.ok(Math.abs(state.speed)<1,'and stays stopped');
});
