import assert from 'node:assert/strict';
import test from 'node:test';
import {roadGraph} from '../src/simulation/traffic.ts';
import {loadCentralCity} from './helpers/metro-city.mjs';

const road=(id,a,b,extra={})=>({id,name:'Main Avenue',width:16,oneway:0,points:[a,b],...extra});
const city=roads=>({bounds:{minX:-100,maxX:200,minZ:-100,maxZ:100},spawn:{x:0,z:0,yaw:0},roads,buildings:[],signals:[]});

function follow(edges,ids){
 let route=edges.filter(e=>e.road.id===ids[0]).map(e=>[e]);
 for(const id of ids.slice(1))route=route.flatMap(path=>{
  const previous=path.at(-1),a=previous.points.at(-2),b=previous.points.at(-1),dx=b[0]-a[0],dz=b[1]-a[1];
  return edges.filter(e=>e.road.id===id&&e.start===previous.end&&e.end!==previous.start).filter(e=>{
   const ex=e.points[1][0]-e.points[0][0],ez=e.points[1][1]-e.points[0][1];return(dx*ex+dz*ez)/(Math.hypot(dx,dz)*Math.hypot(ex,ez))>-.8;
  }).map(e=>[...path,e]);
 });
 assert.ok(route.length,`traffic must continue through ${ids.join(' → ')}`);return route[0];
}

test('short source fragments connect major streets while short dead-end chains stay excluded',()=>{
 const c=city([
  road('first',[0,0],[40,0]),road('short-a',[40,0],[46,0]),road('short-b',[46,0],[54,0]),road('last',[54,0],[100,0]),
  road('stub-a',[40,0],[40,6]),road('stub-b',[40,6],[40,12]),road('stub-c',[40,12],[40,18]),
 ]),{edges}=roadGraph(c);
 follow(edges,['first','short-a','short-b','last']);follow(edges,['last','short-b','short-a','first']);
 assert.equal(edges.filter(e=>e.road.id.startsWith('stub')).length,0,'dead-end fragments must not become extra traffic spawn streets');
});

test('named OSM primary and secondary routes keep their narrow carriageways outside busy districts',()=>{
 const c=city([
  road('primary',[0,0],[40,0],{width:7.6,kind:'primary'}),
  road('secondary',[40,0],[80,0],{width:7.6,kind:'secondary'}),
  road('quiet-local',[0,20],[40,20],{name:'Quiet Street',width:7,kind:'residential'}),
  road('unnamed',[0,40],[40,40],{name:'Unnamed primary',width:7.6,kind:'primary'}),
 ]),{edges}=roadGraph(c);
 follow(edges,['primary','secondary']);assert.ok(edges.every(e=>['primary','secondary'].includes(e.road.id)),'existing quiet local-street filtering remains in place');
});

test('short connectors do not join a road that merely crosses their endpoint on another level',()=>{
 const c=city([road('upper',[0,0],[40,0],{elevations:[4,4]}),road('short',[40,0],[46,0],{elevations:[4,4]}),road('lower',[46,0],[90,0])]);
 assert.equal(roadGraph(c).edges.filter(e=>e.road.id==='short').length,0);
});

test('real Cambridge traffic continues past the former Massachusetts Avenue terminal in both directions',async()=>{
 const {edges}=roadGraph(await loadCentralCity());
 const id=n=>`osm-${n}-0`;
 const common=[1329523286,961263635,826552799,961263634,379698390,86792411];
 const north=[...common,1267768719,1264680796,1417967613,1264679770,1321779880,1092687153].map(id);
 const south=[1092687153,1321779880,1264679769,1271019443,1267768720,...common.slice().reverse()].map(id);
 const route=follow(edges,north);follow(edges,south);
 const formerTerminal=route.find(e=>e.road.id===id(86792411));
 assert.ok(edges.some(e=>e.start===formerTerminal.end&&e.end!==formerTerminal.start&&e.road.id===id(1267768719)),'the observed stopped car now has a legal forward continuation at the fork');
 assert.ok(route.filter(e=>e.length<12).length>=5,'the regression must exercise the real short source ways');
});
