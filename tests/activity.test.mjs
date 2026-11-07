import assert from 'node:assert/strict';
import test from 'node:test';
import {createActivityProfile} from '../src/simulation/activity.ts';

test('activity uses neighborhood boundaries including holes and disconnected pieces',()=>{
  const box=(x,z,w)=>[[x,z],[x+w,z],[x+w,z+w],[x,z+w]];
  const profile=createActivityProfile({neighborhoods:[
    {id:'commercial',name:'Downtown',rings:[box(0,0,100),box(20,20,10),box(200,0,20)]},
    {id:'residential',name:'Beacon Hill',rings:[box(20,20,10)]},
  ]});
  assert.equal(profile(10,10).level,'busy');
  assert.equal(profile(25,25).level,'residential','an interior hole must not inherit the surrounding commercial population');
  assert.equal(profile(210,10).level,'busy','a separate part of the neighborhood retains its activity');
  assert.equal(profile(-100,-100).level,'residential','unclassified edges of the study area stay quiet');
});

test('the northern cities are mixed and downtown Melrose is busier than its residential streets',()=>{
  const box=(x,z,w,h)=>[[x,z],[x+w,z],[x+w,z+h],[x,z+h]];
  const profile=createActivityProfile({neighborhoods:[
    {id:'melrose',name:'Melrose',rings:[box(-1500,-13500,3500,3500)]},
    {id:'malden',name:'Malden',rings:[box(-1500,-10000,5000,2500)]},
  ]});
  assert.equal(profile(700,-11650).level,'mixed','Main Street in downtown Melrose');
  assert.equal(profile(1500,-11000).level,'residential','Melrose Highlands side streets');
  assert.equal(profile(2000,-9000).level,'mixed');
});
