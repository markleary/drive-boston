import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {Ray} from '@dimforge/rapier3d-compat';
import {DrivingPhysics,carSteeringLimit} from '../src/physics/vehicle.ts';
import {ULTRA_BEE} from '../src/physics/bike.ts';
import {meshBuildingIds} from '../src/simulation/building-collisions.ts';
import {roadProjection,sampleRoadElevation} from '../src/simulation/road-surfaces.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {inTunnelPortal,tunnelPointAt,tunnelStations} from '../src/simulation/tunnels.ts';
import {loadMetroCity,windowCity,readJson,installExactMeshes} from './helpers/metro-city.mjs';

const source=readJson('central-artery.json'),tunnels=source.roads.filter(r=>r.tunnel);
const points=tunnels.flatMap(r=>r.points),bounds={minX:Math.min(...points.map(p=>p[0]))-100,maxX:Math.max(...points.map(p=>p[0]))+100,minZ:Math.min(...points.map(p=>p[1]))-100,maxZ:Math.max(...points.map(p=>p[1]))+100};
const metro=await loadMetroCity({bounds:{...bounds,minX:Math.min(bounds.minX,0),minZ:Math.min(bounds.minZ,-3000)}}),city=windowCity(metro,bounds);city.geometry=metro.geometry;
const zakim=metro.buildings.find(b=>b.id==='BOS-2E9SM-83L3W-UVT08');assert.ok(zakim,'load the survey bridge from its owning tile');if(!city.buildings.some(b=>b.id===zakim.id))city.buildings.push(zakim);
let pendingPhysics,pendingStreetPhysics;
const released={throttle:0,brake:0,steer:0,handbrake:false};
async function physics(){
  pendingPhysics??=DrivingPhysics.create(city,{meshBuildingIds}).then(p=>{const installed=installExactMeshes(p,city);assert.ok(installed.has('BOS-2E9SM-83L3W-UVT08'),'retained Zakim survey shell participates in every drive');p.world.step();return p;});
  return pendingPhysics;
}
after(async()=>{if(pendingPhysics)(await pendingPhysics).dispose();if(pendingStreetPhysics)(await pendingStreetPhysics).dispose();});
const mainIds=['central-artery-northbound','central-artery-southbound'];
const auxiliaryId='central-artery-cross-street-north-on';
const mainlines=mainIds.map(id=>tunnels.find(r=>r.id===id));
function stationOf(road,p){const hit=roadProjection(road,...p),s=tunnelStations(road);return s[hit.index]+(s[hit.index+1]-s[hit.index])*hit.t;}
function routeSection(road,start=0,end=tunnelStations(road).at(-1)){
  const count=Math.max(1,Math.ceil(Math.abs(end-start)/2.5));return Array.from({length:count+1},(_,i)=>({...tunnelPointAt(road,start+(end-start)*i/count),road}));
}
function nearestJoin(road,atStart){
  const p=atStart?road.points[0]:road.points.at(-1),height=atStart?road.elevations[0]:road.elevations.at(-1);
  return tunnels.filter(r=>r!==road).map(parent=>({parent,distance:roadProjection(parent,...p).distance,dy:Math.abs(sampleRoadElevation(city,parent,...p)-height),station:stationOf(parent,p)})).filter(j=>j.distance<.3&&j.dy<.15).sort((a,b)=>a.distance-b.distance)[0];
}
function surfaceLeg(road,atStart){
  const record=source.provenance.routes.find(r=>r.id===road.id);if(!record.surfaceStreetIds)return[];
  const mouth=tunnelPointAt(road,atStart?0:tunnelStations(road).at(-1)),candidates=[];
  for(const id of record.surfaceStreetIds){
    const street=metro.roads.find(r=>r.id===id),total=tunnelStations(street).at(-1);
    for(const reverse of [false,true]){
      if(street.oneway!==0&&(reverse?street.oneway===1:street.oneway===-1))continue;
      const join=tunnelPointAt(street,atStart?(reverse?0:total):(reverse?total:0));
      if(Math.hypot(join.x-mouth.x,join.z-mouth.z)>.02)continue;
      const start=atStart?(reverse?Math.min(30,total):Math.max(0,total-30)):(reverse?total:0),end=atStart?(reverse?0:total):(reverse?Math.max(0,total-30):Math.min(30,total));
      const route=routeSection(street,start,end).map(p=>({...p,y:sampleElevation(city,p.x,p.z)})),a=route[atStart?route.length-2:0],b=route[atStart?route.length-1:1];
      const error=Math.atan2(Math.sin(Math.atan2(b.x-a.x,b.z-a.z)-mouth.yaw),Math.cos(Math.atan2(b.x-a.x,b.z-a.z)-mouth.yaw));
      candidates.push({route,score:Math.abs(error)});
    }
  }
  assert.ok(candidates.length,`${road.id} connects to a legal surface approach`);
  return candidates.sort((a,b)=>a.score-b.score)[0].route;
}
async function drive(route,kind,label){
  const p=await physics();p.setVehicleType(kind);const start=route[0],next=route[1],end=route.at(-1);
  p.reset(start.x,start.z,Math.atan2(next.x-start.x,next.z-start.z),start.road.id);
  // A source-only bridge extension has no manifest road ID beyond its mouth.
  p.body.setTranslation({x:start.x,y:start.y+(kind==='car'?.85:.7),z:start.z},true);
  for(let i=0;i<60;i++)p.step({...released,brake:1},1/60);
  let cursor=1,lastProgress=0,minY=Infinity;
  const length=route.reduce((s,v,i)=>i?s+Math.hypot(v.x-route[i-1].x,v.z-route[i-1].z):0,0),maxFrames=Math.ceil((length/4+35)*60);
  for(let frame=0;frame<maxFrames;frame++){
    const state=p.getState(),previous=cursor;
    while(cursor<route.length-1&&Math.hypot(route[cursor].x-state.x,route[cursor].z-state.z)<3.5)cursor++;
    if(cursor>previous)lastProgress=frame;
    assert.ok(frame-lastProgress<600,`${kind} blocked ${label} on ${route[cursor].road.id} at ${state.x.toFixed(2)},${state.z.toFixed(2)}, y=${state.y.toFixed(2)}, target ${route[cursor].x.toFixed(2)},${route[cursor].z.toFixed(2)}`);
    assert.ok(1-2*(state.rotation.x**2+state.rotation.z**2)>(kind==='car'?.95:.65),`${kind} tipped on ${label} at ${state.x.toFixed(2)},${state.z.toFixed(2)}, y=${state.y.toFixed(2)}, up=${(1-2*(state.rotation.x**2+state.rotation.z**2)).toFixed(3)}`);minY=Math.min(minY,state.y);
    if(cursor===route.length-1&&Math.hypot(state.x-end.x,state.z-end.z)<2){if(end.survey)assert.ok(1-2*(state.rotation.x**2+state.rotation.z**2)>.96,'survey lane arrival remains level');assert.ok(Math.abs(state.y-end.y-(kind==='car'?.67:.577))<.6,`${kind} ends on intended destination: ${state.y}/${end.y}`);return{minY,state};}
    let target=cursor,look=0;while(target<route.length-1&&look<6){look+=Math.hypot(route[target+1].x-route[target].x,route[target+1].z-route[target].z);target++;}
    const aim=route[target],dx=aim.x-state.x,dz=aim.z-state.z,angle=Math.atan2(Math.sin(Math.atan2(dx,dz)-state.yaw),Math.cos(Math.atan2(dx,dz)-state.yaw));
    const wheelbase=kind==='car'?2.66:ULTRA_BEE.wheelbase,limit=kind==='car'?carSteeringLimit(state.speed):Math.min(ULTRA_BEE.maxSteering,Math.atan(ULTRA_BEE.maxLateralAcceleration*ULTRA_BEE.wheelbase/(state.speed**2+12)));
    const steer=Math.atan2(2*wheelbase*Math.sin(angle),Math.hypot(dx,dz))/limit;
    p.step({...released,throttle:state.speed<7?.45:0,brake:state.speed>8?.2:0,steer},1/60);
  }
  assert.fail(`${kind} failed to finish ${label}: ${JSON.stringify(p.getState())}`);
}
async function bridgeExtension(road,atStart){
  const p=await physics(),total=tunnelStations(road).at(-1),mouth=tunnelPointAt(road,atStart?0:total),direction=atStart?-1:1,extension=[];
  for(let d=2.5;d<=20;d+=2.5){
    const x=mouth.x+Math.sin(mouth.yaw)*d*direction,z=mouth.z+Math.cos(mouth.yaw)*d*direction;
    const ray=p.world.castRay(new Ray({x,y:mouth.y+3,z},{x:0,y:-1,z:0}),6,true,undefined,undefined,p.chassisCollider,p.body);
    assert.ok(ray,`Zakim source road beyond ${road.id} mouth supports ${x},${z}`);
    const y=mouth.y+3-ray.timeOfImpact;assert.ok(Math.abs(y-mouth.y)<2,'bridge mouth joins its surveyed deck');extension.push({...mouth,x,y,z,road,survey:true});
  }
  return atStart?extension.reverse():extension;
}

test('Central Artery has separately profiled directional bores and continuous source ramp joins',()=>{
  assert.ok(mainlines.every(Boolean));assert.ok(tunnels.length>=10,'both bores and Boston surface ramps are present');
  for(const road of tunnels){
    assert.equal(road.elevations.length,road.points.length);assert.equal(road.traffic,false,'closed southern cutoff cannot feed ambient traffic');
    for(let i=1;i<road.points.length;i++){
      const length=Math.hypot(road.points[i][0]-road.points[i-1][0],road.points[i][1]-road.points[i-1][1]);
      assert.ok(length>.001);assert.ok(Math.abs(road.elevations[i]-road.elevations[i-1])/length<=.121,`${road.id} has excessive grade at section ${i}`);
    }
    if(!mainIds.includes(road.id)&&road.id!==auxiliaryId)assert.ok(nearestJoin(road,true)||nearestJoin(road,false),`${road.id} connects at matching source coordinates and elevation`);
  }
  assert.equal(mainlines[0].tunnel.capStart,true);assert.equal(mainlines[1].tunnel.capEnd,true);
  for(const main of mainlines)assert.ok(Math.min(...main.elevations)<-8,'mainline actually occupies an underground level');
});

for(const road of mainlines)for(const kind of ['car','ultrabee'])test(`${kind} traverses ${road?.id} and the retained Zakim mouth`,async()=>{
  assert.ok(road);const total=tunnelStations(road).at(-1),north=road.id.endsWith('northbound');
  const tunnelRoute=routeSection(road,north?12:0,north?total:total-12),extension=await bridgeExtension(road,!north);
  const result=await drive(north?[...tunnelRoute,...extension]:[...extension,...tunnelRoute],kind,road.id);
  assert.ok(result.minY<-8,'full drive visits the deep covered bore');
});

for(const road of tunnels.filter(r=>!mainIds.includes(r.id)))for(const kind of ['car','ultrabee'])test(`${kind} traverses ${road.name} between its surface portal and connected bore`,async()=>{
  const startJoin=nearestJoin(road,true),endJoin=nearestJoin(road,false),total=tunnelStations(road).at(-1);
  let route=routeSection(road);
  if(startJoin)route=[...routeSection(startJoin.parent,Math.max(0,startJoin.station-28),startJoin.station),...route.slice(1)];
  else route=[...surfaceLeg(road,true),...route.slice(1)];
  if(endJoin)route=[...route,...routeSection(endJoin.parent,endJoin.station,Math.min(tunnelStations(endJoin.parent).at(-1),endJoin.station+28)).slice(1)];
  if(road.id===auxiliaryId)route=[...route,...await bridgeExtension(road,false)];
  else{assert.ok(startJoin||endJoin,'ramp has a connected bore');if(!endJoin)route=[...route,...surfaceLeg(road,false).slice(1)];}
  await drive(route,kind,road.id);
});

for(const record of source.provenance.routes)test(`${record.id} leaves adjoining and crossed surface lanes supported and free of tunnel obstructions`,async()=>{
  // Isolate terrain/decks/tunnel shells from unrelated survey-building defects.
  // The full car/bike drives above separately retain all surveyed collisions.
  pendingStreetPhysics??=DrivingPhysics.create({...city,buildings:[],roads:city.roads.filter(r=>r.tunnel)});
  const p=await pendingStreetPhysics,ramp=tunnels.find(r=>r.id===record.id);p.world.step();
  let samples=0;
  for(const id of new Set([...(record.surfaceStreetIds??[]),...record.crossedSurfaceStreetIds])){
    const street=metro.roads.find(r=>r.id===id);assert.ok(street,`load surface street ${id}`);
    const total=tunnelStations(street).at(-1);
    for(let s=0;s<=total;s+=1)for(const across of [-street.width/2+1.2,0,street.width/2-1.2]){
      const q=tunnelPointAt(street,s),x=q.x+Math.cos(q.yaw)*across,z=q.z-Math.sin(q.yaw)*across,ground=sampleElevation(city,x,z);
      if(roadProjection(ramp,x,z).distance>ramp.width/2+street.width+8)continue;
      assert.equal(inTunnelPortal(city,x,z),false,`${id} surface lane excavated at ${x},${z}`);
      const hit=p.world.castRay(new Ray({x,y:ground+2.5,z},{x:0,y:-1,z:0}),3,true,undefined,undefined,p.chassisCollider,p.body);
      assert.ok(hit,`${id} surface lane loses support at ${x},${z}`);
      const height=ground+2.5-hit.timeOfImpact;
      assert.ok(Math.abs(height-ground)<.22,`${id} surface lane blocked at ${x},${z}: collider ${height}, terrain ${ground}`);samples++;
    }
  }
  assert.ok(samples>15,'audit the intersection and adjoining driving lanes');
});

// These paths cross the pictured intersection, rather than starting a drive
// already aligned inside a ramp. Exercise both directions, with both vehicles.
const groundRoute=points=>points.map(([x,z])=>({x,z,y:sampleElevation(city,x,z),road:{id:'surface'}}));
const throughRoutes=[
  ['Lincoln Street',groundRoute([[1387.184,-274.217],[1384.843,-259.449],[1383.208,-252.193],[1380.884,-241.374],[1378.688,-233.061],[1377.154,-227.254]])],
  ['Essex / Surface Road',groundRoute([[1409.059,-269.836],[1396.5,-264.748],[1384.843,-259.449],[1377.283,-257.416],[1371.598,-255.77],[1357.768,-244.076],[1341.031,-229.47]])],
  ['Essex Street',groundRoute([[1343.819,-260.911],[1371.598,-255.77],[1377.302,-254.715],[1383.208,-252.193],[1397.165,-246.574],[1410.766,-241.099]])],
];
for(const [name,route]of throughRoutes)for(const reverse of [false,true])for(const kind of ['car','ultrabee'])test(`${kind} crosses ${name} ${reverse?'reverse':'forward'} past the Lincoln / Essex ramps`,async()=>{
  await drive(reverse?route.slice().reverse():route,kind,`${name} surface crossing`);
});
