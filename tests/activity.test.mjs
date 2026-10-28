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
