import assert from 'node:assert/strict';
import test from 'node:test';
import {DrivingPhysics,carSteeringLimit} from '../src/physics/vehicle.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {sampleRoadElevation,roadProjection} from '../src/simulation/road-surfaces.ts';
import {resolveCity} from '../src/simulation/city-tiles.ts';
import {read,readJson,windowCity} from './helpers/metro-city.mjs';

const metro=await resolveCity(readJson('city.json'),read),city=windowCity(metro,{minX:-1760,maxX:-1160,minZ:-990,maxZ:-650});
const released={throttle:0,brake:0,steer:0,handbrake:false};
const main=['osm-961263635-0','osm-826552799-0','osm-961263634-0','osm-379698390-0','osm-86792411-0','osm-1267768719-0','osm-1264680796-0','osm-1417967613-0','osm-1264679770-0','osm-1321779880-0'];
const south=[...main.slice(0,5),'osm-1267768720-0','osm-1271019443-0','osm-1264679769-0','osm-1321779880-0'];
const road=id=>{const r=city.roads.find(r=>r.id===id);assert.ok(r,`mapped road ${id}`);return r;};
function path(ids,reverse=false,offset=0,reverseFirst=false){
 const points=[];
 for(const id of ids){const r=road(id),p=r.points.map(p=>({x:p[0],z:p[1],road:r}));if((!points.length&&reverseFirst)||(points.length&&Math.hypot(points.at(-1).x-p.at(-1).x,points.at(-1).z-p.at(-1).z)<.02))p.reverse();points.push(...(points.length?p.slice(1):p));}
 if(reverse)points.reverse();
 return points.map((p,i)=>{const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],n=Math.hypot(b.x-a.x,b.z-a.z)||1;return{...p,x:p.x-(b.z-a.z)/n*offset,z:p.z+(b.x-a.x)/n*offset};});
}
async function drive(points,{underpass=false}={}){
 const routeRoads=[...new Set(points.map(p=>p.road))],sampled=[];for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/3));for(let j=0;j<n;j++)sampled.push({...a,x:a.x+(b.x-a.x)*j/n,z:a.z+(b.z-a.z)*j/n});}sampled.push(points.at(-1));points=sampled;
 const physics=await DrivingPhysics.create(city),[a,b]=points;let cursor=1,lastProgress=0,underDeck=0;
 try{
  physics.reset(a.x,a.z,Math.atan2(b.x-a.x,b.z-a.z),a.road.id);
  for(let i=0;i<60;i++)physics.step({...released,brake:1},1/60);
  for(let frame=0;frame<120*60;frame++){
   const s=physics.getState(),before=cursor;
   // Rounded turns can pass beside a mapped vertex; continue along the route instead of steering back to it.
   while(cursor<points.length-1&&(Math.hypot(s.x-points[cursor].x,s.z-points[cursor].z)<3.5||Math.hypot(s.x-points[cursor+1].x,s.z-points[cursor+1].z)<Math.hypot(s.x-points[cursor].x,s.z-points[cursor].z)))cursor++;
   if(cursor>before)lastProgress=frame;
   assert.ok(frame-lastProgress<420,`road/barrier collision blocked ${points[cursor].road.id} at ${s.x.toFixed(2)},${s.z.toFixed(2)}`);
   if(underpass){
    assert.ok(s.y-sampleElevation(city,s.x,s.z)<1.2,'Memorial Drive must remain on the lower roadway');
    if(Math.hypot(s.x+1470,s.z+783)<28)underDeck++;
   }else{
    const nearest=routeRoads.slice().sort((a,b)=>roadProjection(a,s.x,s.z).distance-roadProjection(b,s.x,s.z).distance)[0],expected=sampleRoadElevation(city,nearest,s.x,s.z);
    assert.ok(Math.abs(s.y-expected-.67)<.8,`vehicle must stay on the connected deck: ${points[cursor].road.id}`);
   }
   if(cursor===points.length-1&&Math.hypot(s.x-points[cursor].x,s.z-points[cursor].z)<2){if(underpass)assert.ok(underDeck>30,'route actually crosses beneath Massachusetts Avenue');return;}
   let target=cursor,look=0;while(target<points.length-1&&look<6){look+=Math.hypot(points[target+1].x-points[target].x,points[target+1].z-points[target].z);target++;}
   const p=points[target],distance=Math.hypot(p.x-s.x,p.z-s.z),angle=Math.atan2(Math.sin(Math.atan2(p.x-s.x,p.z-s.z)-s.yaw),Math.cos(Math.atan2(p.x-s.x,p.z-s.z)-s.yaw));
   const steer=Math.atan2(2*2.66*Math.sin(angle),Math.max(4,distance));
   physics.step({...released,throttle:s.speed<5?.55:0,brake:s.speed>6?.15:0,steer:steer/carSteeringLimit(s.speed)},1/60);
  }
  assert.fail('did not complete the mapped junction route');
 }finally{physics.dispose();}
}

for(const reverse of [false,true])test(`Cambridge Massachusetts Avenue stays on the upper deck ${reverse?'toward Harvard Bridge':'toward Amherst Street'}`,()=>drive(path(reverse?south:main,reverse,2.2)));
for(const id of ['osm-138789021-0','osm-138789031-0'])test(`Memorial Drive ${id} passes beneath Massachusetts Avenue`,()=>drive(path([id]),{underpass:true}));
const slips=[
 {id:'osm-8616015-0',points:()=>path(['osm-8616015-0','osm-1264679770-0','osm-1321779880-0'])},
 {id:'osm-8616018-0',points:()=>path(['osm-8616018-0','osm-826552799-0','osm-961263635-0'])},
 {id:'osm-188046759-0',points:()=>path(['osm-961263635-0','osm-826552799-0','osm-961263634-0','osm-188046759-0'])},
 {id:'osm-1417967612-0',points:()=>path(['osm-1321779880-0','osm-1264679769-0','osm-1417967612-0'],false,0,true)},
];
// Use the mapped one-way fork and slip direction, and traverse the merge itself.
for(const {id,points}of slips)test(`Cambridge slip road ${id} joins the elevated junction without a blocking barrier`,()=>drive(points()));
