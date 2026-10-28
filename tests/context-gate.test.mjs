import assert from 'node:assert/strict';
import test from 'node:test';
import {createContextGate} from '../src/render/context-gate.ts';
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('startup waits even when native loss precedes the loss event',async()=>{
  let lost=true,calls=0;const gate=createContextGate(()=>lost);
  const ready=gate.run(()=>++calls);await turn();assert.equal(calls,0);
  lost=false;gate.restore();assert.equal(await ready,1);
});

test('an interrupted compile that never settles cannot hang restoration or create duplicate work',async()=>{
  const gate=createContextGate(()=>false);let calls=0;
  const ready=gate.run(()=>++calls===1?new Promise(()=>{}):'restored');
  await turn();assert.equal(calls,1);gate.lose();await turn();assert.equal(calls,1);
  gate.restore();assert.equal(await ready,'restored');assert.equal(calls,2);
});

test('rejected old-context work is consumed while genuine initialization errors propagate',async()=>{
  const gate=createContextGate(()=>false);let rejectOld,calls=0;
  const ready=gate.run(()=>++calls===1?new Promise((_,reject)=>{rejectOld=reject;}):'new context');
  await turn();gate.lose();gate.restore();assert.equal(await ready,'new context');
  rejectOld(new Error('old context rejected late'));await turn();
  await assert.rejects(gate.run(()=>{throw new Error('real shader error');}),/real shader error/);
});

test('multiple losses retry only after each restoration',async()=>{
  const gate=createContextGate(()=>false);let calls=0;
  const ready=gate.run(()=>++calls<3?new Promise(()=>{}):'ready');
  await turn();gate.lose();gate.restore();await turn();assert.equal(calls,2);
  gate.lose();await turn();assert.equal(calls,2);gate.restore();assert.equal(await ready,'ready');
});
