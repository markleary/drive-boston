import assert from 'node:assert/strict';
import test from 'node:test';
import {curbRoadClearance} from '../src/simulation/road-curbs.ts';
import {loadMetroCity} from './helpers/metro-city.mjs';
const road=(id,points,extra={})=>({id,name:id,points,width:10,oneway:0,...extra});
const flat={elevation:{width:2,height:2,cellSize:200,originX:-100,originZ:-100,heights:new Float32Array(4)}};

test('curb clearance removes transverse interior caps but preserves parallel edges, dead ends and lower curbs beneath overpasses',()=>{
 const a=road('a',[[0,0],[10,0],[20,0]]),check=curbRoadClearance(flat,[a]);
 assert.equal(check(5,0,0,1),true);assert.equal(check(10,0,0,1),true,'resampled vertex is not a dead end');
 assert.equal(check(0,0,0,1),false);assert.equal(check(20,0,0,1),false);
 assert.equal(check(5,4,1,0),false);assert.equal(check(5,7,0,1),false);
 assert.equal(curbRoadClearance(flat,[{...a,elevations:[5,5,5]}])(5,0,0,1),false);
 const b=road('b',[[20,0],[40,0]],{deckWidths:[16,10],elevations:[0,0]});
 assert.equal(curbRoadClearance(flat,[a,b])(20,6,0,1),true,'a widened connected seam must not retain its old cap');
});

test('the actual Charles River Dam municipal seam has no curb across its joined roadbed',async()=>{
 const city=await loadMetroCity({tiles:['0_-2','0_-3']}),check=curbRoadClearance(city,city.roads);
 const a=[332.468,-1979.637],b=[340.792,-1993.504],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
 for(const t of [.15,.3,.5,.7,.85])assert.equal(check(a[0]+dx*t,a[1]+dz*t,dx/length,dz/length),true,`cap at ${t}`);
});
