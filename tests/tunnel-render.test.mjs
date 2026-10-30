import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {addTunnels,tunnelExitSigns} from '../src/render/tunnels.ts';
import {tunnelGeometry} from '../src/simulation/tunnels.ts';

const road={id:'test-mainline',name:'Central Artery Northbound',points:[[0,0],[0,40],[0,220]],elevations:[0,-8,-8],width:13.6,oneway:1,tunnel:{clearance:5.6,covered:[[40,220]],capEnd:true}};
const city={roads:[road],bounds:{minX:-200,maxX:200,minZ:-200,maxZ:300},buildings:[],landmarks:[],curbs:[],signals:[],spawn:{x:0,z:0,yaw:0}};
function dispose(group){const materials=new Set(),textures=new Set();group.traverse(o=>{o.geometry?.dispose();for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])materials.add(m);});for(const m of materials){for(const value of Object.values(m))if(value?.isTexture)textures.add(value);m.dispose();}for(const t of textures)t.dispose();}

test('tunnel render preserves the collision shell, closure and black terminal',()=>{
  const scene=new THREE.Scene(),view=addTunnels(scene,city),physical=tunnelGeometry(city,road);
  try{
    for(const [label,key]of [['tile walls','walls'],['ceiling','roof'],['concrete closure','barriers'],['black void','caps']]){
      const object=view.group.getObjectByName(`${road.name} ${label}`);assert.ok(object,`${label} is visible`);
      assert.deepEqual(object.geometry.attributes.position.array,physical[key].vertices,`${label} matches the collider`);
      assert.deepEqual(object.geometry.index.array,physical[key].indices);
    }
    const back=view.group.getObjectByName(`${road.name} black void`);assert.equal(back.material.color.getHex(),0);assert.equal(back.material.fog,false,'distance haze cannot wash out the black void');
    assert.equal(view.group.userData.closures,1);assert.ok(view.group.getObjectByName('Boston Lure easter egg'));
    let count=0;view.group.traverse(o=>{if(o.isMesh){count++;const p=o.geometry.attributes.position;assert.ok(Array.from(p.array).every(Number.isFinite));}});
    assert.ok(count<35,`fixtures should be spatially batched, got ${count} meshes`);
  }finally{dispose(view.group);}
});

test('local tunnel light follows underground occupants and leaves daylight streets unchanged',()=>{
  const view=addTunnels(new THREE.Scene(),city),light=view.group.getObjectByName('Nearby tunnel light');
  try{
    light.visible=false;view.update({x:0,y:-7.2,z:90});assert.equal(light.visible,true,'startup light warmup cannot leave the interior fill hidden');assert.ok(light.intensity>0);assert.ok(light.position.y<-2.4,'light stays beneath the ceiling');
    view.update({x:0,y:.7,z:90});assert.equal(light.visible,false);assert.equal(light.intensity,0,'street directly above the tunnel stays outside');
    view.update({x:0,y:-3.2,z:20});assert.equal(light.intensity,0,'open approach retains daylight');
    view.update({x:100,y:-7.2,z:90});assert.equal(light.intensity,0,'outside walls does not illuminate the city');
  }finally{dispose(view.group);}
});


test('advance exit signs identify the correct stacked bore before the branch',()=>{
  const upper={...road,id:'upper-mainline'},lower={...road,id:'lower-mainline',elevations:[-12,-20,-20]};
  const ramp={id:'government-center-exit',name:'Government Center / North Street · I-93 North exit',points:[[0,120],[20,140],[40,160]],elevations:[-8,-6,0],width:6.4,oneway:1,tunnel:{clearance:5.6,covered:[[0,25]]}};
  const signs=tunnelExitSigns({...city,roads:[lower,upper,ramp]});assert.equal(signs.length,1);assert.equal(signs[0].road.id,upper.id);
  assert.equal(signs[0].station,80,'the sign precedes the mapped fork by forty metres');assert.ok(signs[0].lines.includes('Government Center'));assert.ok(signs[0].lines.includes('North Street'));
});
