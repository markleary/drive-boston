import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {addTunnels,tunnelExitSigns} from '../src/render/tunnels.ts';
import {tunnelGeometry,tunnelPointAt} from '../src/simulation/tunnels.ts';
import {sampleRoadElevation} from '../src/simulation/road-surfaces.ts';

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

test('real tunnel sign fronts face approaching traffic and their backs hide mirrored lettering',()=>{
  const roads=JSON.parse(readFileSync(new URL('../public/data/central-artery.json',import.meta.url),'utf8')).roads;
  const view=addTunnels(new THREE.Scene(),{...city,roads});view.group.updateMatrixWorld(true);
  try{
    const signs=[];view.group.traverse(object=>{if(object.userData.tunnelSignFace)signs.push(object);});
    assert.ok(signs.length>10);
    for(const face of signs){
      assert.equal(face.material.side,THREE.FrontSide,`${face.name} must never show reversed type on its rear`);
      const backing=face.getObjectByName('Tunnel sign backing');assert.ok(backing,`${face.name} has an opaque rear panel`);
      assert.equal(backing.material.transparent,false);
      const center=face.getWorldPosition(new THREE.Vector3()),normal=new THREE.Vector3(0,0,1).transformDirection(face.matrixWorld);
      const fromFront=new THREE.Raycaster(center.clone().addScaledVector(normal,2),normal.clone().negate());
      assert.equal(fromFront.intersectObject(face,true)[0]?.object,face,`${face.name} is legible from its intended approach`);
      const fromBack=new THREE.Raycaster(center.clone().addScaledVector(normal,-2),normal.clone());
      assert.equal(fromBack.intersectObject(face,true)[0]?.object,backing,`${face.name} presents metal to reverse traffic`);
      assert.ok(!fromBack.intersectObject(face,true).some(hit=>hit.object===face),`${face.name} printed face is culled from behind`);
      if(face.userData.roadId){
        const route=roads.find(r=>r.id===face.userData.roadId),p=tunnelPointAt(route,face.userData.station),travel=new THREE.Vector3(Math.sin(p.yaw),0,Math.cos(p.yaw));
        assert.ok(normal.dot(travel)*(face.userData.backwards?1:-1)>.999,`${face.name} orientation follows its mapped carriageway`);
      }
    }
    const reported=view.group.getObjectByName('EXIT ↗ / Government Center / Clinton Street');assert.ok(reported,'covers the exact sign reported in the screenshot');
  }finally{dispose(view.group);}
});

test('lane paint follows both the slope and crossfall of merging pavement',()=>{
  const banked={...road,deckEdgeElevations:road.elevations.map(y=>[y-1,y+1])},local={...city,roads:[banked]},view=addTunnels(new THREE.Scene(),local);
  try{
    let painted=0;view.group.traverse(object=>{
      if(!object.isMesh||object.material.color?.getHex()!==0xede9ca)return;
      const positions=object.geometry.attributes.position;for(let i=0;i<positions.count;i++){
        const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i),gap=y-sampleRoadElevation(local,banked,x,z);
        assert.ok(gap>.015&&gap<.08,`paint follows banked deck at ${x},${z}: gap ${gap}`);painted++;
      }
    });assert.ok(painted>100);
  }finally{dispose(view.group);}
});

test('solid edge paint opens at a shared merge but remains on independent stacked roads',()=>{
  const main={...road,width:12,points:[[0,0],[0,100]],elevations:[0,0]},ramp={...road,id:'joining-ramp',name:'Joining ramp',width:6,points:[[0,30],[15,45]],elevations:[0,0],tunnel:{clearance:5.6}};
  const paintedAt=(view,x,y,z)=>{
    view.group.updateMatrixWorld(true);const marks=[];view.group.traverse(object=>{if(object.isMesh&&object.material.color?.getHex()===0xede9ca)marks.push(object);});
    return new THREE.Raycaster(new THREE.Vector3(x,y+1,z),new THREE.Vector3(0,-1,0),0,2).intersectObjects(marks,false).length>0;
  };
  const merged=addTunnels(new THREE.Scene(),{...city,roads:[main,ramp]}),stacked=addTunnels(new THREE.Scene(),{...city,roads:[main,{...ramp,elevations:[-8,-8]}]});
  try{
    assert.equal(paintedAt(merged,5.3,0,10),true,'exterior road edge is still marked');
    assert.equal(paintedAt(merged,5.3,0,34),false,'a solid border does not cross the shared merge pavement');
    assert.equal(paintedAt(stacked,5.3,0,34),true,'another bore underneath does not erase an independent road edge');
  }finally{dispose(merged.group);dispose(stacked.group);}
});
