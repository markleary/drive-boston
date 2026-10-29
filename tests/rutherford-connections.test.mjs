import assert from 'node:assert/strict';
import test from 'node:test';
import {DrivingPhysics,carSteeringLimit} from '../src/physics/vehicle.ts';
import {sampleRoadElevation,deckEdge} from '../src/simulation/road-surfaces.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {loadMetroCity,windowCity} from './helpers/metro-city.mjs';

const bounds={minX:130,maxX:900,minZ:-3200,maxZ:-2150};
const metro=await loadMetroCity({bounds}),city=windowCity(metro,bounds);
const released={throttle:0,brake:0,steer:0,handbrake:false};

test('Rutherford underpass clears the full road width and stays below the retained Austin crossing',()=>{
 const lower=city.roads.filter(r=>r.bridge?.kind==='rutherford-underpass');
 assert.equal(lower.length,7);
 for(const road of lower)for(let i=0;i<road.points.length;i++)for(const side of [-1,0,1]){
  const p=side?deckEdge(road,i,side):road.points[i],surface=road.elevations[i];
  assert.ok(surface-sampleElevation(city,...p)>.1,`${road.id} has terrain protruding into the ${side} edge`);
 }
 const p=[570.726,-2689.06],upper=city.roads.find(r=>r.id==='17665-0-0'),under=city.roads.find(r=>r.id==='17663-0-0');
 assert.ok(sampleRoadElevation(city,upper,...p)-upper.bridge.thickness-sampleRoadElevation(city,under,...p)>6,'the upper road remains independently supported above the lower road');
});

test('both Charlestown fork mouths carry the entire shared main-road cross-section',()=>{
 const main=city.roads.find(r=>r.id==='osm-94668374-0'),forks=[city.roads.find(r=>r.id==='osm-59009759-0'),city.roads.find(r=>r.id==='osm-8614837-0')];
 const edges=[-1,1].map(side=>deckEdge(main,main.points.length-1,side));
 for(const road of forks){
  const i=road.points.findIndex(p=>Math.hypot(p[0]-main.points.at(-1)[0],p[1]-main.points.at(-1)[1])<.001);
  const other=[-1,1].map(side=>deckEdge(road,i,side));
  for(const p of edges)assert.ok(other.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<.00001),`${road.id} narrows the shared fork mouth`);
 }
});

async function drive(ids,{underpass=false,upper=false,lane=false,aboveUnderpass=false}={}){
 const roads=ids.map(id=>({reverse:id.startsWith('-'),road:city.roads.find(r=>r.id===(id.startsWith('-')?id.slice(1):id))}));
 for(const {road}of roads)assert.ok(road);
 const route=[];
 for(const {road,reverse}of roads){
  const points=road.points.map((p,i)=>({p,width:road.deckWidths?.[i]??road.width}));if(reverse)points.reverse();
  const dense=[];
  for(let i=1;i<points.length;i++){
   const a=points[i-1],b=points[i],count=Math.max(1,Math.ceil(Math.hypot(b.p[0]-a.p[0],b.p[1]-a.p[1])/3));
   for(let j=0;j<count;j++)dense.push({p:[a.p[0]+(b.p[0]-a.p[0])*j/count,a.p[1]+(b.p[1]-a.p[1])*j/count],width:a.width+(b.width-a.width)*j/count});
  }
  dense.push(points.at(-1));
  for(const {p,width}of dense)if(!route.length||Math.hypot(p[0]-route.at(-1).x,p[1]-route.at(-1).z)>.001)route.push({x:p[0],z:p[1],road,width});
 }
 if(lane){
  const original=route.map(p=>({...p}));
  for(let i=0;i<route.length;i++){
   const a=original[Math.max(0,i-1)],b=original[Math.min(original.length-1,i+1)],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz),offset=original[i].width/4;
   route[i].x-=dz/length*offset;route[i].z+=dx/length*offset;
  }
 }
 const physics=await DrivingPhysics.create(city),start=route[0],next=route[1],end=route.at(-1);
 try{
  physics.reset(start.x,start.z,Math.atan2(next.x-start.x,next.z-start.z),start.road.id);
  for(let i=0;i<60;i++)physics.step({...released,brake:1},1/60);
  let cursor=1,lastProgress=0,minY=Infinity,maxY=-Infinity;
  for(let frame=0;frame<150*60;frame++){
   const state=physics.getState(),previous=cursor;
   while(cursor<route.length-1&&Math.hypot(route[cursor].x-state.x,route[cursor].z-state.z)<4)cursor++;
   if(cursor>previous)lastProgress=frame;
   assert.ok(frame-lastProgress<480,`blocked on ${route[cursor].road.id} at ${state.x.toFixed(2)}, ${state.z.toFixed(2)} (y ${state.y.toFixed(2)})`);
   minY=Math.min(minY,state.y);maxY=Math.max(maxY,state.y);
   assert.ok(Math.abs(state.rotation.x)<.4&&Math.abs(state.rotation.z)<.4,'car remains upright through every source join');
   if(cursor===route.length-1&&Math.hypot(state.x-end.x,state.z-end.z)<2){
    if(underpass)assert.ok(minY<-3,'car actually descended into the restored underpass');
    if(upper)assert.ok(maxY>6,'car actually reached the Austin bridge deck');
    if(aboveUnderpass)assert.ok(minY>1.5,'car stays on the retained Austin surface above the excavated underpass');
    assert.ok(Math.abs(state.y-sampleRoadElevation(city,end.road,end.x,end.z)-.67)<.65,'car arrives on the intended exit surface');
    return;
   }
   let target=cursor,look=0;
   while(target<route.length-1&&look<6){look+=Math.hypot(route[target+1].x-route[target].x,route[target+1].z-route[target].z);target++;}
   const p=route[target],dx=p.x-state.x,dz=p.z-state.z,angle=Math.atan2(Math.sin(Math.atan2(dx,dz)-state.yaw),Math.cos(Math.atan2(dx,dz)-state.yaw));
   const steer=Math.atan2(2*2.66*Math.sin(angle),Math.hypot(dx,dz))/carSteeringLimit(state.speed);
   physics.step({...released,throttle:state.speed<7?.4:0,brake:state.speed>8?.15:0,steer},1/60);
  }
  assert.fail(`route did not finish: ${JSON.stringify(physics.getState())}`);
 }finally{physics.dispose();}
}

test('southbound car descends through Rutherford and returns to the surface street',()=>drive(['17655-0-0','17657-0-0','17669-0-0','17662-0-0','17660-0-0'],{underpass:true}));
test('northbound car descends through Rutherford and returns to the surface street',()=>drive(['17719-0-0','17675-0-0','17668-0-0','17663-0-0','17677-0-0','11010-0-0'],{underpass:true}));
test('Charlestown approach climbs through its northbound fork onto Austin Street',()=>drive(['osm-94668374-0','osm-59009759-0','14588-0-0'],{upper:true}));
test('Austin Street southbound fork reaches the Charlestown surface landing',()=>drive(['14587-0-0','osm-8614837-0','-osm-94668374-0'],{upper:true}));
test('northbound car stays in its travel lane through the Charlestown fork',()=>drive(['osm-94668374-0','osm-59009759-0','14588-0-0'],{upper:true,lane:true}));
test('southbound car stays in its travel lane through the Charlestown fork',()=>drive(['14587-0-0','osm-8614837-0','-osm-94668374-0'],{upper:true,lane:true}));
test('southbound car stays in its lane across all restored Rutherford sections',()=>drive(['17655-0-0','17657-0-0','17669-0-0','17662-0-0','17660-0-0'],{underpass:true,lane:true}));
test('northbound car stays in its lane across all restored Rutherford sections',()=>drive(['17719-0-0','17675-0-0','17668-0-0','17663-0-0','17677-0-0','11010-0-0'],{underpass:true,lane:true}));
test('Austin westbound remains supported above the restored underpass',()=>drive(['10739-0-0','10740-0-0','17665-0-0','17666-0-0','17671-0-0'],{aboveUnderpass:true,lane:true}));
test('Austin eastbound remains supported above the restored underpass',()=>drive(['17667-0-0','10741-0-0','-10739-0-0'],{aboveUnderpass:true,lane:true}));
