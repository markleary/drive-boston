import assert from 'node:assert/strict';
import test from 'node:test';
import {createRouteSignalLookup} from '../src/simulation/traffic-route-signals.ts';

const stations=points=>{
 const out=[0];for(let i=1;i<points.length;i++)out.push(out.at(-1)+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));return out;
};

test('dense route curves produce one stop per intersection visit and retain later revisits',()=>{
 const corners=[[-100,0],[100,0],[100,80],[-100,80],[-100,0],[100,0]],points=[corners[0]];
 for(let i=1;i<corners.length;i++){
  const a=corners[i-1],b=corners[i],n=Math.hypot(b[0]-a[0],b[1]-a[1])*4;
  for(let j=1;j<=n;j++)points.push([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n]);
 }
 // Shuffled source junctions also verify final stops follow route order.
 const lookup=createRouteSignalLookup([[0,80],[0,0],[100,40]]);
 assert.deepEqual(lookup(points,stations(points)),[92,232,372,652]);
});

test('signal search includes long segment interiors across negative cell boundaries and keeps its strict radius',()=>{
 const points=[[-200,-64],[200,-64]],lookup=createRouteSignalLookup([[-190,-64],[-65,-55.001],[0,-55],[64,-72.999],[300,-64]]);
 assert.deepEqual(lookup(points,stations(points)),[2,127,256]);
});

test('dense bridge routes never inspect distant metro junctions after indexing them',()=>{
 let distantReads=0;
 const far=Array.from({length:2500},(_,i)=>{const point=[];Object.defineProperty(point,0,{get(){distantReads++;return 5000+i*3;}});point[1]=7000;return point;});
 const lookup=createRouteSignalLookup([...far,[0,0],[1000,0]]);distantReads=0;
 const points=Array.from({length:8001},(_,i)=>[-500+i*.25,0]);
 assert.deepEqual(lookup(points,stations(points)),[492,1492]);
 assert.equal(distantReads,0,'a long resampled bridge must not scan unrelated city signals per segment');
});
