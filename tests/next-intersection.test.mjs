import assert from 'node:assert/strict';
import test from 'node:test';
import {nextIntersection} from '../src/simulation/next-intersection.ts';
import {loadMetroCity} from './helpers/metro-city.mjs';

const road=(id,name,points,extra={})=>({id,name,points,width:10,oneway:0,...extra});
// Main Street runs east along z=0 in two pieces split at x=100 with no crossing there;
// Elm Street crosses at x=200, a public alley at x=150, and an overpass deck 6 m up ends above x=50.
const grid=()=>({roads:[
  road('m1','Main Street',[[0,0],[50,0],[100,0]]),road('m2','Main Street',[[100,0],[150,0],[200,0],[300,0]]),
  road('e1','Elm Street',[[200,-100],[200,0]]),road('e2','Elm Street',[[200,0],[200,100]]),
  road('a','Public Alley No. 7',[[150,0],[150,60]]),
  road('o','Overpass Road',[[50,0],[50,-80]],{elevations:[6,6],bridge:{id:'b',thickness:1,clearanceEstimated:true}}),
  road('c','Cul De Sac Way',[[300,0],[340,0]]),
]});
const east=Math.PI/2,west=-Math.PI/2;

test('next intersection follows the street past splits, alleys and overpasses',()=>{
  const city=grid(),[m1,m2]=city.roads;
  assert.deepEqual(nextIntersection(city,m1,20,0,east),{names:['Elm Street'],distance:180});
  assert.deepEqual(nextIntersection(city,m2,250,0,east),{names:['Cul De Sac Way'],distance:50});
  assert.equal(nextIntersection(city,m2,250,0,west)?.names[0],'Elm Street');
  assert.equal(nextIntersection(city,m1,20,0,west),null,'dead end behind the start of Main Street');
  assert.equal(nextIntersection(city,m1,20,0,east,150),null,'Elm Street lies beyond the search distance');
  assert.equal(nextIntersection(city,m1,20,0,east,180)?.names[0],'Elm Street');
});

test('next intersection names a Back Bay cross street in each direction',async()=>{
  const city=await loadMetroCity({tiles:[]});
  // Beacon Street between Exeter and Dartmouth.
  const beacon=city.roads.find(r=>r.name==='Beacon Street'&&Math.hypot((r.points[0][0]+r.points[1][0])/2+443.5,(r.points[0][1]+r.points[1][1])/2+358.1)<5);
  assert.ok(beacon);
  const [a,b]=beacon.points,x=(a[0]+b[0])/2,z=(a[1]+b[1])/2,yaw=Math.atan2(b[0]-a[0],b[1]-a[1]);
  const names=[nextIntersection(city,beacon,x,z,yaw)?.names[0],nextIntersection(city,beacon,x,z,yaw+Math.PI)?.names[0]].sort();
  assert.deepEqual(names,['Dartmouth Street','Exeter Street']);
});

test('next intersection ignores streets that share a vertex at a different height',async()=>{
  const city=await loadMetroCity({tiles:[]});
  // Webster Avenue's short deck shares vertices with two Newton Street decks 1.2 m and 2.7 m lower.
  const webster=city.roads.find(r=>r.id==='osm-185024514-0'),[a,b]=webster.points;
  const yaw=Math.atan2(b[0]-a[0],b[1]-a[1]),x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
  const next=nextIntersection(city,webster,x,z,yaw);
  assert.ok(next&&!next.names.includes('Newton Street'),`reported ${next?.names}`);
});
