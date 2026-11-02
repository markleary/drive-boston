import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveCity} from '../src/simulation/city-tiles.ts';
import {sampleDriveSurface,sampleRoadElevation} from '../src/simulation/road-surfaces.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {read,readJson} from './helpers/metro-city.mjs';
const metro=await resolveCity(readJson('city.json'),read),road=id=>metro.roads.find(r=>r.id===id);
const along=(r,t)=>{const a=r.points[0],b=r.points.at(-1);return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];};

// Reported at the Route 9 / Jamaicaway interchange (x -3199, z 2092): the first
// 15 m of Huntington Avenue inside Boston climbed 6.2 m to a cliff at the town
// line, the Jamaicaway carriageways ran under their own embankment and the ramp
// from Pond Avenue ended 24 m short of the Jamaicaway loop.
test('Huntington Avenue continues Washington Street on the ground through the town line',()=>{
 for(const [id,street] of [['14549-0-0','osm-1296770505-0'],['14547-0-0','osm-384322485-0']]){
  const piece=road(id),prev=road(street);assert.ok(piece&&prev);
  assert.equal(piece.elevations,undefined,`${id} is a surface street`);assert.equal(piece.bridge,undefined);
  const node=piece.points.find(p=>prev.points.some(q=>q[0]===p[0]&&q[1]===p[1]));assert.ok(node,'the pieces still share the town-line node');
  for(const t of [0,.25,.5,.75,1]){const [x,z]=along(piece,t),y=sampleElevation(metro,x,z);const drive=sampleDriveSurface(metro,x,z,y+1);assert.ok(Math.abs(drive.height-y)<.05,`${id} drives on the terrain at ${t}`);}
 }
 const under=road('14550-0-0'),[x,z]=under.points[0];assert.ok(Math.abs(sampleElevation(metro,x,z)-sampleRoadElevation(metro,road('8769-0-0'),x,z))>5,'the Riverway still crosses Route 9 on its deck');
});

test('the Jamaicaway and Riverway approaches ride their embankment instead of sinking under it',()=>{
 for(const id of ['8693-0-0','9074-0-0','25551-0-0','25558-0-0']){
  const r=road(id);assert.ok(r.elevations);
  for(let i=1;i<r.points.length-1;i++){const [x,z]=r.points[i];assert.ok(r.elevations[i]>=sampleElevation(metro,x,z)-.002,`${id} point ${i} sits in the lawn`);}
  for(let i=1;i<r.points.length;i++){const d=Math.hypot(r.points[i][0]-r.points[i-1][0],r.points[i][1]-r.points[i-1][1]);assert.ok(Math.abs(r.elevations[i]-r.elevations[i-1])<=.12*d+1e-6,`${id} ramps steeper than 12% at point ${i}`);}
 }
});

test('the Pond Avenue ramp reaches the Jamaicaway loop and the loop node is shared by three roads',()=>{
 const ramp=road('osm-48918271-0'),loop=[road('8686-0-0'),road('8807-0-0')],node=loop[0].points.at(-1);
 assert.deepEqual(ramp.points[0],node);assert.deepEqual(loop[1].points[0],node);
 assert.equal(ramp.elevations,undefined,'the ramp follows the terrain like the loop');
 const grade=[];for(let i=1;i<3;i++){const a=ramp.points[i-1],b=ramp.points[i];grade.push(Math.abs(sampleElevation(metro,...a)-sampleElevation(metro,...b))/Math.hypot(b[0]-a[0],b[1]-a[1]));}
 assert.ok(Math.max(...grade)<.12,`the restored tail climbs the embankment toe at ${grade.map(g=>g.toFixed(3))}`);
});

test('the culvert stubs at Blue Hill Avenue and the Riverway ramp meet their continuing streets on the ground',()=>{
 for(const [id,next] of [['16746-0-0','16743-0-0'],['25549-0-0','osm-1525900449-0']]){
  const piece=road(id),street=road(next);assert.equal(piece.startLevel,0);assert.equal(piece.endLevel,0);assert.ok(piece.bridge,'a small deck remains over the cut');
  const i=piece.points.findIndex(p=>street.points.some(q=>q[0]===p[0]&&q[1]===p[1]));assert.ok(i===0||i===piece.points.length-1);
  assert.ok(Math.abs(piece.elevations[i]-sampleElevation(metro,...piece.points[i]))<.005,`${id} steps at its junction with ${next}`);
  for(let k=0;k<piece.points.length;k++)assert.ok(piece.elevations[k]>=sampleElevation(metro,...piece.points[k])-.002);
 }
});
