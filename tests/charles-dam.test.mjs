import assert from 'node:assert/strict';
import test from 'node:test';
import {DrivingPhysics,carSteeringLimit} from '../src/physics/vehicle.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {sampleDriveSurface} from '../src/simulation/road-surfaces.ts';
import {drawnStreets} from '../src/simulation/drawn-streets.ts';
import {loadMetroCity,windowCity,readJson} from './helpers/metro-city.mjs';

// Charles River Dam Road between Leverett Circle and Cambridge (build-charles-dam.py): one graded street on the dam.
const NORTHBOUND=['10963-0-0','7515-0-0','10965-0-0','14555-0-0'],SOUTHBOUND=['14556-0-0','10964-0-0','10961-0-0','10962-0-0'];
const bounds={minX:150,maxX:650,minZ:-2120,maxZ:-1760},metro=await loadMetroCity({bounds}),city=windowCity(metro,bounds),record=readJson('provenance.json').charlesRiverDam;
const byId=id=>{const found=city.roads.filter(r=>r.id===id);assert.equal(found.length,1,id);return found[0];};
const chain=ids=>ids.flatMap((id,k)=>byId(id).points.slice(k?1:0));
const dense=(points,step=1)=>{const out=[];for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/step));for(let j=0;j<n;j++)out.push([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n]);}return[...out,points.at(-1)];};
const north=dense(chain([...NORTHBOUND,'museum-dam-north-connection'])),south=dense(chain(SOUTHBOUND));

test('every piece of the dam road is a surface street with its name, and the stage is recorded',()=>{
 assert.ok(record,'run build-charles-dam.py');assert.equal(record.roads.sources.filter(r=>r.elevations).length,5);
 for(const id of [...NORTHBOUND,...SOUTHBOUND]){
  const road=byId(id);for(const field of ['elevations','bridge','deckWidths','deckTangents','startLevel','endLevel'])assert.ok(!(field in road),`${id} ${field}`);
  assert.equal(road.name,'Charles River Dam Road',id);
  assert.ok(road.pavedWidth>=7,`${id} is measured between its curbs (${road.pavedWidth})`);
 }
 for(const id of ['8427-0-0','8477-0-0','14681-0-0'])assert.equal(byId(id).name,'Science Park');
 // A street keeps its source vertices, not a deck profile's 3 m stations: the tile builder paints lane dashes on segments of 8 m or more.
 for(const id of ['7515-0-0','10965-0-0','14555-0-0'])assert.equal(byId(id).points.length,2,`${id} is one straight segment`);
 for(const id of [...NORTHBOUND,...SOUTHBOUND])assert.ok(byId(id).points.some((p,i,all)=>i&&Math.hypot(p[0]-all[i-1][0],p[1]-all[i-1][1])>=8)||id==='10962-0-0'||id==='10963-0-0',`${id} has a segment long enough for lane paint`);
 assert.ok(!city.roads.some(r=>r.elevations&&r.points.some(p=>north.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<6))&&!/^(leverett|storrow)/.test(r.id)),'no deck lies on the dam road');
});

test('both roadways are drawn asphalt along their whole length, lock included (the median is on each line\'s left)',()=>{
 const tiles=[...metro.loadedTiles.values()].map(tile=>({tile,drawn:drawnStreets(tile)}));
 const paved=(x,z)=>tiles.some(({tile,drawn})=>x>=tile.tx*tile.size&&x<(tile.tx+1)*tile.size&&z>=tile.tz*tile.size&&z<(tile.tz+1)*tile.size&&drawn.paved(x,z));
 for(const line of [north,south])for(let i=1;i<line.length-1;i++){
  const [x,z]=line[i],dx=line[i+1][0]-line[i-1][0],dz=line[i+1][1]-line[i-1][1],l=Math.hypot(dx,dz);
  for(const across of [0,1.5,3])assert.ok(paved(x-dz/l*across,z+dx/l*across),`no asphalt at ${x.toFixed(1)}, ${z.toFixed(1)}, ${across} m across`);
 }
});

test('one smooth profile: gentle grades, no step along either roadway, both roadways level with each other',()=>{
 let steepest=0,step=0,apart=0;
 for(const line of [north,south]){
  const heights=line.map(p=>sampleElevation(city,...p));
  for(let i=1;i<line.length;i++){const d=Math.hypot(line[i][0]-line[i-1][0],line[i][1]-line[i-1][1]);steepest=Math.max(steepest,Math.abs(heights[i]-heights[i-1])/d);}
  for(let i=2;i<line.length;i++)step=Math.max(step,Math.abs(heights[i]-2*heights[i-1]+heights[i-2]));
  for(const [i,p] of line.entries())assert.ok(Math.abs(sampleDriveSurface(city,...p).height-heights[i])<.03,'the drive surface is the ground');
 }
 for(const p of south.slice(30,-30)){let best=north[0],d=Infinity;for(const q of north){const e=Math.hypot(p[0]-q[0],p[1]-q[1]);if(e<d){d=e;best=q;}}apart=Math.max(apart,Math.abs(sampleElevation(city,...p)-sampleElevation(city,...best)));}
 assert.ok(steepest<.06,`steepest metre ${(steepest*100).toFixed(1)}%`);assert.ok(step<.03,`grade break of ${(step*100).toFixed(1)} cm in a metre`);
 assert.ok(apart<.08,`the two roadways stand ${apart.toFixed(2)} m apart`);
 assert.ok(sampleElevation(city,461,-1899.5)>1.4,'the lock is filled under the road');
});

const released={throttle:0,brake:0,steer:0,handbrake:false};
async function drive(line,label,lane){
 const physics=await DrivingPhysics.create(city),route=line.map((p,i)=>{const a=line[Math.max(0,i-1)],b=line[Math.min(line.length-1,i+1)],l=Math.hypot(b[0]-a[0],b[1]-a[1]);return {x:p[0]-(b[1]-a[1])/l*lane,z:p[1]+(b[0]-a[0])/l*lane};});
 try{
  const start=route[0],next=route[3],end=route.at(-1);physics.reset(start.x,start.z,Math.atan2(next.x-start.x,next.z-start.z));
  for(let i=0;i<90;i++)physics.step({...released,brake:1},1/60);
  let cursor=1,last=0,pitch=0,roll=0,jolt=0,air=0,previous=physics.getState();
  for(let frame=0;frame<90*60;frame++){
   const state=physics.getState();
   while(cursor<route.length-1&&Math.hypot(route[cursor].x-state.x,route[cursor].z-state.z)<5){cursor++;last=frame;}
   assert.ok(frame-last<420,`${label}: blocked at ${state.x.toFixed(1)}, ${state.z.toFixed(1)}, y ${state.y.toFixed(2)}`);
   if(frame>30){pitch=Math.max(pitch,Math.abs(state.rotation.x));roll=Math.max(roll,Math.abs(state.rotation.z));jolt=Math.max(jolt,Math.abs((state.y-previous.y)-(previous.y-(previous.py??previous.y))));air=Math.max(air,state.y-sampleElevation(city,state.x,state.z));}
   state.py=previous.y;previous=state;
   if(cursor===route.length-1&&Math.hypot(state.x-end.x,state.z-end.z)<4)return {pitch,roll,jolt,air};
   let target=cursor,look=0;while(target<route.length-1&&look<9){look+=Math.hypot(route[target+1].x-route[target].x,route[target+1].z-route[target].z);target++;}
   const p=route[target],dx=p.x-state.x,dz=p.z-state.z,angle=Math.atan2(Math.sin(Math.atan2(dx,dz)-state.yaw),Math.cos(Math.atan2(dx,dz)-state.yaw));
   physics.step({...released,throttle:state.speed<13?.5:0,brake:state.speed>14.5?.15:0,steer:Math.atan2(2*2.66*Math.sin(angle),Math.hypot(dx,dz))/carSteeringLimit(state.speed)},1/60);
  }
  assert.fail(`${label} did not finish`);
 }finally{physics.dispose();}
}
for(const [label,line] of [['toward Cambridge',north],['toward Boston',south]])for(const lane of [-2.5,2.5])test(`a car at 30 mph crosses the dam ${label} without a jolt, ${lane<0?'left':'right'} lane`,async()=>{
 const ride=await drive(line,label,lane);
 assert.ok(ride.pitch<.09&&ride.roll<.06,`pitch ${ride.pitch.toFixed(3)}, roll ${ride.roll.toFixed(3)}`);
 assert.ok(ride.jolt<.012,`the body jumps ${(ride.jolt*100).toFixed(1)} cm between frames`);
 assert.ok(ride.air<1.05,`the car rides ${ride.air.toFixed(2)} m over the ground`);
});
