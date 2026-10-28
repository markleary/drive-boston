import assert from 'node:assert/strict';
import test from 'node:test';
import {EMBRACE,buildEmbraceGeometry,insideEmbracePlaza} from '../src/render/the-embrace.ts';

test('The Embrace keeps its published size and a walk-through vault',()=>{
  const {geometry,collision}=buildEmbraceGeometry(),box=geometry.boundingBox;
  assert.ok(Math.abs(box.max.y-6.1)<1e-6,'20 ft tall above the plaza');
  assert.ok(Math.abs(box.max.x-box.min.x-7.6)<1e-6,'25 ft across the sleeve face');
  assert.ok(box.min.y<-.3,'arms continue below the paving instead of ending in open tubes');
  const p=geometry.getAttribute('position'),quadrants=new Set();let headroom=Infinity,passage=Infinity;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    if(Math.abs(y)<.05)quadrants.add(`${Math.sign(x)},${Math.sign(z)}`);
    if(y>0&&Math.hypot(x,z)<.8)headroom=Math.min(headroom,y);
    if(y>0&&Math.abs(x)<.7)passage=Math.min(passage,y);
  }
  assert.equal(quadrants.size,4,'four separate arms bear on the plaza');
  assert.ok(headroom>2.4,`centre headroom ${headroom.toFixed(2)} m`);
  assert.ok(passage>2.2,`front-to-back passage headroom ${passage.toFixed(2)} m`);
  assert.ok(geometry.index.count/3<60000,'triangle budget');
  assert.ok(collision.index.count/3>500&&collision.index.count/3<5000,'compact collision hull');
});

test('The Embrace sits on its mapped Boston Common plaza',()=>{
  // OSM node 10552518542 (42.3549357, -71.0643618) in game metres.
  assert.deepEqual([EMBRACE.x,EMBRACE.z],[858.64,-538.98]);
  assert.ok(insideEmbracePlaza(EMBRACE.x,EMBRACE.z));
  assert.ok(insideEmbracePlaza(871.5,-539),'mapped plaza edge');
  assert.ok(!insideEmbracePlaza(EMBRACE.x+22,EMBRACE.z),'open lawn beyond the plaza');
});
