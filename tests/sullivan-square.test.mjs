import assert from 'node:assert/strict';
import test from 'node:test';
import {DrivingPhysics,carSteeringLimit} from '../src/physics/vehicle.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {deckEdge,sampleDriveSurface} from '../src/simulation/road-surfaces.ts';
import {pointInside} from '../src/simulation/roads.ts';
import {loadMetroCity,windowCity,readJson,installExactMeshes} from './helpers/metro-city.mjs';

const metro=await loadMetroCity({tiles:['-1_-4','-1_-5','0_-4']}),source=readJson('sullivan-square-source.json');
const chain=source.bridgeChains[0].roads.map(id=>metro.roads.find(r=>r.id===id));
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const maffa=source.streetCorridors[0].roads.map(id=>metro.roads.find(r=>r.id===id));

test('Mystic rail overpass is straight and retains a constant deck width',()=>{
 const [a,b]=source.bridgeChains[0].landings,dx=b[0]-a[0],dz=b[1]-a[1],length=distance(a,b);
 for(const r of chain)for(let i=0;i<r.points.length;i++){
  const p=r.points[i];assert.ok(Math.abs((p[0]-a[0])*dz-(p[1]-a[1])*dx)/length<.00001,'centerline follows the landing-to-landing axis');
  assert.ok(Math.abs(distance(deckEdge(r,i,-1),deckEdge(r,i,1))-12)<.00001,'parallel deck edges');
 }
});

test('Maffa has continuous full-width pavement under I-93 and past the station lots',()=>{
 const records=new Map();
 for(const tile of metro.loadedTiles.values())for(const rec of tile.pavements){
  const e=rec.edges,rows=[];for(let i=0;i<e.length;i+=4)rows.push([e[i]/100+tile.tx*tile.size,e[i+1]/100+tile.tz*tile.size,e[i+2]/100+tile.tx*tile.size,e[i+3]/100+tile.tz*tile.size]);records.set(rec.road,rows);
 }
 let previous;
 for(const r of maffa){
  const rows=records.get(r.id);assert.ok(rows,`measurement for ${r.id}`);assert.equal(r.pavedWidth,14);
  for(const row of rows)assert.ok(Math.abs(distance(row.slice(0,2),row.slice(2))-14)<.015,`${r.id} retains its carriageway width`);
  if(previous)assert.ok(rows[0].every((v,i)=>Math.abs(v-previous[i])<1e-8),'both edges match across each source join');previous=rows.at(-1);
  for(let i=1;i<r.points.length;i++){
   const a=r.points[i-1],b=r.points[i],length=distance(a,b),dx=(b[0]-a[0])/length,dz=(b[1]-a[1])/length;
   for(let d=1;d<length;d+=2)for(const offset of [-6,0,6]){
    const p=[a[0]+dx*d-dz*offset,a[1]+dz*d+dx*offset],inside=rings=>pointInside(p,rings[0])&&!rings.slice(1).some(h=>pointInside(p,h));
    assert.ok([...metro.loadedTiles.values()].some(t=>t.streetPavement.some(inside)),`asphalt covers ${p}`);
    assert.ok(![...metro.loadedTiles.values()].some(t=>t.sidewalks.some(w=>inside(w.rings))||t.islands.some(inside)),`no obsolete concrete crosses ${p}`);
   }
  }
 }
});

test('Mystic/Main retains a continuous bridge above the railway with matched full-width joins',()=>{
 for(const r of chain)for(let i=1;i<r.points.length;i++)assert.ok(Math.abs(r.elevations[i]-r.elevations[i-1])/distance(r.points[i],r.points[i-1])<.08,`${r.id} has a gentle approach`);
 for(let i=1;i<chain.length;i++){
  const a=chain[i-1],b=chain[i];assert.deepEqual(a.points.at(-1),b.points[0]);assert.equal(a.elevations.at(-1),b.elevations[0]);
  assert.equal(a.endLevel,1);assert.equal(b.startLevel,1);
  for(const side of [-1,1])assert.ok(distance(deckEdge(a,a.points.length-1,side),deckEdge(b,0,side))<.0001,'matching deck edges across the source split');
 }
 const seam=chain.at(-1);assert.ok(seam.elevations[0]>5.5,'the false low landing is gone');
 const rail=chain[1];assert.ok(rail.elevations.every((y,i)=>y-sampleElevation(metro,...rail.points[i])>.75+4.5),'retain rail corridor clearance');
 for(const [r,i] of [[chain[0],0],[chain.at(-1),chain.at(-1).points.length-1]])assert.ok(Math.abs(r.elevations[i]-sampleElevation(metro,...r.points[i]))<.006,'real street landing remains fixed');
});

test('verified Sullivan access gaps have asphalt while the curbed walkway remains concrete',()=>{
 const tile=metro.loadedTiles.get('-1_-4'),inside=(p,rings)=>pointInside(p,rings[0])&&!rings.slice(1).some(h=>pointInside(p,h));
 for(const p of [[-125,-3840],[-106,-3908]])assert.ok(tile.driveways.some(r=>inside(p,r)),`verified pavement at ${p}`);
 // An interior sidewalk point between the two paved parking areas.
 const p=[-122.915,-3866.375];assert.ok(tile.sidewalks.some(w=>inside(p,w.rings)),'probe lies in the surveyed walkway');assert.ok(!tile.driveways.some(r=>inside(p,r)),'retain the curbed island');
});

function tail(road,p){
 const candidates=metro.roads.filter(r=>!r.elevations&&r.points.some(q=>distance(p,q)<.01));
 const next=candidates.find(r=>r.name===road.name)??candidates[0];assert.ok(next,'outer bridge landing has a surface-road continuation');
 const index=next.points.findIndex(q=>distance(p,q)<.01);let pts=index===0?next.points:[...next.points].reverse();
 const out=[p];let length=0;
 for(let i=1;i<pts.length&&length<16;i++){
  const a=pts[i-1],b=pts[i],d=distance(a,b),n=Math.max(1,Math.ceil(d/2));
  for(let j=1;j<=n&&length<16;j++){out.push([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n]);length+=d/n;}
 }
 return out;
}

for(const route of ['Mystic/Main','Maffa Way'])for(const reverse of [false,true])test(`car drives ${route} ${reverse?'reverse':'forward'} through its connections`,async()=>{
 const local=windowCity(metro,{minX:-300,maxX:100,minZ:-4140,maxZ:-3700}),physics=await DrivingPhysics.create(local,{meshBuildingIds:new Set(local.buildings.filter(b=>b.collision==='mesh').map(b=>b.id))});
 installExactMeshes(physics,metro);
 let points=[...tail(chain[0],chain[0].points[0]).reverse().slice(0,-1),...chain.flatMap((r,i)=>i?r.points.slice(1):r.points),...tail(chain.at(-1),chain.at(-1).points.at(-1)).slice(1)];
 if(route==='Maffa Way'){
  const raw=maffa.flatMap((r,i)=>i?r.points.slice(1):r.points);points=[raw[0]];
  for(let i=1;i<raw.length;i++){const a=raw[i-1],b=raw[i],n=Math.ceil(distance(a,b)/3);for(let j=1;j<=n;j++)points.push([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n]);}
 }
 if(reverse)points.reverse();const held={throttle:0,brake:0,steer:0,handbrake:false};
 try{
  physics.reset(...points[0],Math.atan2(points[1][0]-points[0][0],points[1][1]-points[0][1]));for(let i=0;i<60;i++)physics.step({...held,brake:1},1/60);
  let cursor=1,lastProgress=0;
  for(let frame=0;frame<120*60;frame++){
   const s=physics.getState(),old=cursor;while(cursor<points.length-1&&Math.hypot(s.x-points[cursor][0],s.z-points[cursor][1])<3)cursor++;
   if(cursor>old)lastProgress=frame;assert.ok(frame-lastProgress<480,`blocked near point ${cursor} at ${s.x},${s.z}`);
   const surface=sampleDriveSurface(local,s.x,s.z,s.y);assert.ok(Math.abs(s.y-surface.height-.67)<.55,`vehicle stays supported at ${s.x},${s.z}`);
   if(cursor===points.length-1&&Math.hypot(s.x-points[cursor][0],s.z-points[cursor][1])<3){assert.ok(Math.abs(s.y-sampleElevation(local,s.x,s.z)-.67)<.3,'arrives on the ground beyond the span');return;}
   let target=cursor,look=0;while(target<points.length-1&&look<7){look+=distance(points[target],points[target+1]);target++;}
   const p=points[target],angle=Math.atan2(Math.sin(Math.atan2(p[0]-s.x,p[1]-s.z)-s.yaw),Math.cos(Math.atan2(p[0]-s.x,p[1]-s.z)-s.yaw));
   const steer=Math.atan2(2*2.66*Math.sin(angle),Math.max(4,Math.hypot(p[0]-s.x,p[1]-s.z)));
   physics.step({...held,throttle:s.speed<6?.6:0,brake:s.speed>7?.2:0,steer:Math.max(-1,Math.min(1,steer/carSteeringLimit(s.speed)))},1/60);
  }
  assert.fail('crossing did not finish');
 }finally{physics.dispose();}
});
