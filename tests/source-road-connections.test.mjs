import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveCity} from '../src/simulation/city-tiles.ts';
import {bridgeSupports,deckEdge,sampleRoadElevation} from '../src/simulation/road-surfaces.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {DrivingPhysics,carSteeringLimit} from '../src/physics/vehicle.ts';
import {read,readJson,windowCity} from './helpers/metro-city.mjs';

const metro=await resolveCity(readJson('city.json'),read);
const connections=[
 ['14622-0-0','osm-262605757-0'],
 ['14653-0-0','osm-1377669404-0'],
 ['14673-0-0','osm-8648787-0'],
 ['14709-0-0','osm-8647560-0'],
];

test('bounded support exclusions keep surveyed lower crossings clear while retaining other bridge piers',()=>{
 const road={id:'bridge',name:'Bridge',points:[[0,0],[0,220]],width:10,elevations:[10,10],bridge:{thickness:.6}},city={roads:[road]};
 const original=bridgeSupports(city,road);assert.ok(original.length>=6);
 road.bridge.supportExclusions=[[75,130]];
 const supported=bridgeSupports(city,road);
 assert.ok(supported.every(p=>p.z<75||p.z>130),'no column or beam is generated across the surveyed lower crossing');
 assert.deepEqual(supported,original.filter(p=>p.z<75||p.z>130),'piers outside the bounded crossing remain unchanged');
});

function connection(aid,bid){
 const a=metro.roads.find(r=>r.id===aid),b=metro.roads.find(r=>r.id===bid);
 const ai=[0,a.points.length-1].find(i=>[b.points[0],b.points.at(-1)].some(p=>Math.hypot(p[0]-a.points[i][0],p[1]-a.points[i][1])<.001));
 const bi=[0,b.points.length-1].find(i=>Math.hypot(b.points[i][0]-a.points[ai][0],b.points[i][1]-a.points[ai][1])<.001);
 return{a,b,ai,bi};
}

test('mixed-source bridge joins share a full deck section and keep the outer terrain landing',()=>{
 for(const ids of connections){
  const {a,b,ai,bi}=connection(...ids);
  assert.equal(b.bridge?.kind,'connected-source-approach',`${b.id} needs the source boundary profile`);
  assert.ok(Math.abs(a.elevations[ai]-b.elevations[bi])<.0002,`${a.name} still has a source height step`);
  const aEdges=[-1,1].map(side=>deckEdge(a,ai,side)),bEdges=[-1,1].map(side=>deckEdge(b,bi,side));
  for(const p of aEdges)assert.ok(bEdges.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<.00001),`${a.name} leaves a wedge at the deck edge`);
  const outer=bi===0?b.points.length-1:0;
  assert.ok(Math.abs(b.elevations[outer]-sampleElevation(metro,...b.points[outer]))<.006,`${a.name} approach misses its outer street`);
 }
});

for(const ids of connections)for(const reverse of [false,true])test(`car traverses ${ids[1]} and its mixed-source join ${reverse?'outbound':'inbound'}`,async()=>{
 const {a,b,ai,bi}=connection(...ids);
 const into=bi===0?[...b.points].reverse():[...b.points],away=ai===0?[...a.points]:[...a.points].reverse();
 const route=[...into,...away.slice(1)];if(reverse)route.reverse();
 const points=[...a.points,...b.points],bounds={minX:Math.min(...points.map(p=>p[0]))-25,maxX:Math.max(...points.map(p=>p[0]))+25,minZ:Math.min(...points.map(p=>p[1]))-25,maxZ:Math.max(...points.map(p=>p[1]))+25};
 const city=windowCity(metro,bounds),physics=await DrivingPhysics.create(city),released={throttle:0,brake:0,steer:0,handbrake:false};
 const start=route[0],next=route[1],end=route.at(-1),startRoad=reverse?a:b;
 try{
  physics.reset(...start,Math.atan2(next[0]-start[0],next[1]-start[1]),startRoad.id);
  for(let i=0;i<60;i++)physics.step({...released,brake:1},1/60);
  let cursor=1,finished=false;
  for(let frame=0;frame<45*60;frame++){
   const state=physics.getState();
   while(cursor<route.length-1&&Math.hypot(state.x-route[cursor][0],state.z-route[cursor][1])<6)cursor++;
   const target=route[cursor],distance=Math.hypot(target[0]-state.x,target[1]-state.z);
   const angle=Math.atan2(Math.sin(Math.atan2(target[0]-state.x,target[1]-state.z)-state.yaw),Math.cos(Math.atan2(target[0]-state.x,target[1]-state.z)-state.yaw));
   const steer=Math.atan2(2*2.66*Math.sin(angle),Math.max(4,distance))/carSteeringLimit(state.speed);
   physics.step({...released,throttle:state.speed<5?.32:0,brake:state.speed>6?.12:0,steer},1/60);
   // At the old seam the car fell 6.4 m or struck the raised slab end.
   const expected=Math.max(sampleRoadElevation(city,a,state.x,state.z),sampleRoadElevation(city,b,state.x,state.z));
   const seam=a.points[ai];
   if(Math.hypot(state.x-seam[0],state.z-seam[1])<3)assert.ok(state.y>expected-.3,`${a.name}: car fell at the source seam`);
   if(cursor===route.length-1&&Math.hypot(state.x-end[0],state.z-end[1])<2){finished=true;break;}
  }
  assert.ok(finished,`${a.name}: car failed to cross the repaired join: ${JSON.stringify(physics.getState())}`);
 }finally{physics.dispose();}
});

test('car follows the Memorial Drive U-turn through its interior-vertex merge',async()=>{
 const approach=metro.roads.find(r=>r.id==='osm-1413566724-0'),ramp=metro.roads.find(r=>r.id==='osm-8616106-0'),parent=metro.roads.find(r=>r.id==='osm-8615862-0');
 const join=ramp.points.at(-1),merge=parent.points.findIndex(p=>Math.hypot(p[0]-join[0],p[1]-join[1])<.001);
 assert.ok(merge>0&&merge<parent.points.length-1,'the source junction is inside the parent road');
 assert.ok(Math.abs(sampleRoadElevation(metro,parent,...join)-ramp.elevations.at(-1))<.0002);
 assert.ok(Math.abs(sampleRoadElevation(metro,approach,...ramp.points[0])-ramp.elevations[0])<.006);
 const route=[...approach.points,...ramp.points.slice(1),...parent.points.slice(merge+1,merge+12)],end=route.at(-1);
 const city=windowCity(metro,{minX:-580,maxX:-280,minZ:-1380,maxZ:-1120}),physics=await DrivingPhysics.create(city),released={throttle:0,brake:0,steer:0,handbrake:false};
 try{
  physics.reset(...route[0],Math.atan2(route[1][0]-route[0][0],route[1][1]-route[0][1]),approach.id);
  for(let i=0;i<60;i++)physics.step({...released,brake:1},1/60);
  let cursor=1,finished=false;
  for(let frame=0;frame<60*60;frame++){
   const s=physics.getState();
   while(cursor<route.length-1&&Math.hypot(s.x-route[cursor][0],s.z-route[cursor][1])<3.5)cursor++;
   const p=route[cursor],distance=Math.hypot(p[0]-s.x,p[1]-s.z),angle=Math.atan2(Math.sin(Math.atan2(p[0]-s.x,p[1]-s.z)-s.yaw),Math.cos(Math.atan2(p[0]-s.x,p[1]-s.z)-s.yaw));
   const steer=Math.atan2(2*2.66*Math.sin(angle),Math.max(3.5,distance))/carSteeringLimit(s.speed);
   physics.step({...released,throttle:s.speed<3?.3:0,brake:s.speed>4?.12:0,steer},1/60);
   if(Math.hypot(s.x-join[0],s.z-join[1])<3)assert.ok(Math.abs(s.y-ramp.elevations.at(-1)-.85)<.9,'car dropped or climbed at the Memorial merge');
   if(cursor===route.length-1&&Math.hypot(s.x-end[0],s.z-end[1])<2){finished=true;break;}
  }
  assert.ok(finished,`car stopped in the repaired U-turn: ${JSON.stringify(physics.getState())}`);
 }finally{physics.dispose();}
});
