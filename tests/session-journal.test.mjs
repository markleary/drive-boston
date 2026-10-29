import assert from 'node:assert/strict';
import test from 'node:test';
import {createSessionJournal} from '../src/simulation/session-journal.ts';
const store=()=>{const data=new Map();return{data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};};
test('a renderer restart retains the last snapshot without pretending to know the cause',()=>{
  const storage=store();let now=1000;const session=createSessionJournal(storage,()=>now);
  session.start();now=601000;session.capture('Vehicle: bike\nFPS: 56\nContext losses: 0');
  const restarted=createSessionJournal(storage,()=>now+1000);
  assert.match(restarted.previousReport,/Vehicle: bike/);assert.match(restarted.previousReport,/no pagehide recorded/);
  assert.match(restarted.previousReport,/does not identify the cause/);
  // Repeated crashes during startup must not overwrite the useful older drive.
  assert.equal(createSessionJournal(storage).previousReport,restarted.previousReport);
});
test('normal exits are distinguished and starting again on a live page retains the session age',()=>{
  const storage=store();let now=100;const session=createSessionJournal(storage,()=>now);
  session.start();session.capture('last drive');now=1000;session.start();assert.equal(session.startedAt,100);
  session.close();assert.match(createSessionJournal(storage).previousReport,/pagehide recorded/);
  session.capture('restored from bfcache');assert.equal(session.startedAt,100);
  assert.match(createSessionJournal(storage).previousReport,/no pagehide recorded/);
});
test('journal storage stays bounded and never embeds previous reports into the current snapshot',()=>{
  const storage=store();
  for(let i=0;i<100;i++){const session=createSessionJournal(storage);session.start();session.capture('x'.repeat(50000));}
  assert.equal(storage.data.size,2);
  assert.ok(storage.getItem('backbay-session-v1').length<16500);assert.ok(storage.getItem('backbay-session-report-v1').length<=16000);
});
test('blocked, full or malformed browser storage cannot interrupt the drive',()=>{
  const denied={getItem(){throw Error('blocked');},setItem(){throw Error('quota');}};
  for(const storage of [undefined,denied,{getItem:key=>key==='backbay-session-v1'?'{bad':null,setItem(){}}]){
    const session=createSessionJournal(storage);session.start();session.capture('driving');session.close();assert.equal(session.previousReport,'');
  }
});
