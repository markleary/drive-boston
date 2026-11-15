import assert from 'node:assert/strict';
import test from 'node:test';
import {storrowRecoveryCandidates,storrowRetreatCandidates} from '../src/simulation/storrow-recovery.ts';
import {roadProjection} from '../src/simulation/road-surfaces.ts';
const road=(id,points,extra={})=>({id,name:'Storrow Drive',width:9,oneway:0,points,...extra});
const site={id:'test',roadId:'under',x:0,z:20,yaw:0,halfDepth:4,width:9,station:20,roadY:0};
const city=roads=>({roads,bounds:{minX:-200,minZ:-200,maxX:200,maxZ:300},buildings:[],spawn:{x:0,z:0,yaw:0}});
const planned=(roads,pose={x:-1.5,z:10,yaw:0},direction=1)=>storrowRecoveryCandidates(city(roads),site,pose,direction,3.8,1.21);

test('repaired truck follows a curved road rather than continuing the portal tangent into grass',()=>{
 const roads=[road('under',[[0,0],[0,26],[25,51],[30,100]])],poses=planned(roads);
 assert.ok(poses.length>5);assert.ok(poses[0].x>0,'the first exit follows the bend');
 for(const pose of poses){assert.ok(roadProjection(roads[0],pose.x,pose.z).distance<1.6);assert.ok(pose.z>28);assert.equal(pose.roadId,'under');}
 assert.ok(poses.some(p=>p.yaw>.5),'heading follows the bend');
});

test('source seams change road ID and digitization direction while retaining lane and truck facing',()=>{
 const roads=[road('under',[[0,0],[0,28]]),road('next',[[0,100],[0,30]])],poses=planned(roads);
 assert.ok(poses.length>8);for(const pose of poses){assert.equal(pose.roadId,'next');assert.ok(Math.abs(pose.x+1.5)<1e-8);assert.ok(Math.abs(pose.yaw)<1e-8);}
});

test('backing through a bridge repairs on its far side with the nose still facing back toward it',()=>{
 const roads=[road('under',[[0,-100],[0,100]])],poses=planned(roads,{x:-1.5,z:31,yaw:0},-1);
 assert.ok(poses.length>8);for(const pose of poses){assert.ok(pose.z<12);assert.ok(Math.abs(pose.x+1.5)<1e-8);assert.ok(Math.abs(pose.yaw)<1e-8);}
});

test('continuation avoids a perpendicular side street and a stacked elevated road',()=>{
 const roads=[road('under',[[0,0],[0,28]]),road('wrong-level',[[0,28],[0,200]],{elevations:[6,6]}),road('side',[[0,28],[100,28]]),road('next',[[0,29],[3,200]])],poses=planned(roads);
 assert.ok(poses.length>5);assert.ok(poses.every(p=>p.roadId==='next'));
});

test('no continuation gives no repair positions beyond the pavement end',()=>{
 assert.deepEqual(planned([road('under',[[0,0],[0,28]])]),[]);
 assert.deepEqual(planned([road('under',[[0,0],[0,36]])]),[],'center on pavement is insufficient when the nose crosses the end');
});

for(const reverse of [false,true])test(`retreat follows the curved approach across a source seam while preserving ${reverse?'reverse':'forward'} strike facing`,()=>{
 const transform=([x,z])=>reverse?[-x,40-z]:[x,z];
 const roads=[road('under',[[0,6],[0,36]].map(transform)),road('approach',[[-65,-70],[-35,-38],[-12,-10],[0,5]].map(transform))];
 const [x,z]=transform([-1.5,10]),pose={x,z,yaw:0};
 // The impact center is unchanged under this reflection. Both nose directions
 // remain +Z at the crossing; reverse hits retreat in +Z instead of -Z.
 const poses=storrowRetreatCandidates(city(roads),{...site,yaw:reverse?Math.PI:0},pose,reverse?-1:1,3.8,1.21);
 assert.ok(poses.length>6);assert.ok(poses.every(p=>p.roadId==='approach'));
 for(const p of poses){
  assert.ok(reverse?p.z>30:p.z<10,'retreat stays on the approach side');
  assert.ok(Math.cos(p.yaw)>0,'truck is not turned around');
  const fx=Math.sin(p.yaw),fz=Math.cos(p.yaw);
  for(const along of [-3.8,-1.9,0,1.9,3.8])for(const across of [-1.21,0,1.21]){
   assert.ok(roads.some(r=>roadProjection(r,p.x+fx*along+fz*across,p.z+fz*along-fx*across).distance<r.width/2-.1),'complete footprint follows the pavement');
  }
 }
 assert.ok(poses.some(p=>Math.sin(p.yaw)>.5),'nose follows the original approach heading around the bend');
});

test('retreat cannot jump to an unconnected nearby road when the approach ends',()=>{
 const roads=[road('under',[[0,15],[0,36]]),road('nearby',[[-40,10],[40,10]]),road('parallel',[[6,-100],[6,30]])];
 assert.deepEqual(storrowRetreatCandidates(city(roads),site,{x:0,z:18,yaw:0},1,3.8,1.21),[]);
});
