import assert from 'node:assert/strict';
import test from 'node:test';
import {roadGraph} from '../src/simulation/traffic.ts';
import {loadMetroCity} from './helpers/metro-city.mjs';

const city=await loadMetroCity({tiles:[]}),roads=[...city.roads,...city.surveyRoads??[]],{edges}=roadGraph(city);
const graphed=new Set(edges.map(e=>e.road.id));

function through(ids){
 const allowed=new Set(ids),pending=edges.filter(e=>e.road.id===ids[0]).map(e=>[e]),seen=new Set();
 while(pending.length){
  const path=pending.shift(),last=path.at(-1);if(seen.has(last.id))continue;seen.add(last.id);
  if(last.road.id===ids.at(-1)){
   const sequence=path.map(e=>e.road.id).filter((id,i,a)=>!i||id!==a[i-1]);
   assert.deepEqual(sequence,ids);return;
  }
  for(const next of edges)if(next.start===last.end&&next.end!==last.start&&allowed.has(next.road.id))pending.push([...path,next]);
 }
 assert.fail(`No forward traffic route through ${ids.join(' → ')}`);
}

test('the shipped highways have no explicit traffic exclusions and only the disconnected Logan terminal exit is pruned',()=>{
 const highway=roads.filter(r=>r.kind==='motorway'||r.kind==='motorway_link'||r.tunnel);
 assert.deepEqual(highway.filter(r=>r.traffic===false).map(r=>r.id),[]);
 // Both the terminal exit and Airport Road arrive at the same node; no road
 // leaves it in the permitted direction. Keep this known dead end out of the
 // fleet until its missing onward connection is repaired.
 const missing=highway.filter(r=>!graphed.has(r.id)).map(r=>r.id).sort();
 assert.deepEqual(missing,['i90-eb-exit-137-terminals',...Array.from({length:6},(_,i)=>`i90-eb-exit-137-terminals-${i+2}`)].sort());
 const tunnels=highway.filter(r=>r.id.startsWith('central-artery-'));
 assert.equal(tunnels.length,13);assert.ok(tunnels.every(r=>graphed.has(r.id)),'both I-93 bores and every surface ramp carry traffic');
});

test('southbound traffic can take Exit 18 all the way through Leverett to Nashua Street',()=>{
 through(['i93-sb-40','i93-sb-exit-18','i93-sb-exit-18-2','leverett-connector-south','11201-0-0']);
});

test('Storrow eastbound and Charles Street both feed the Leverett northbound survey merge',()=>{
 const onward=['leverett-connector-north','i93-zakim-leverett-nb-01','i93-zakim-leverett-nb-02','i93-zakim-nb-05'];
 through(['storrow-leverett-east',...Array.from({length:4},(_,i)=>`storrow-leverett-east-${i+2}`),...onward]);
 through(['13138-0-0',...onward]);
});
