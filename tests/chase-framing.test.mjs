import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createCar} from '../src/render/car.ts';
import {applyChaseViewOffset,boomCeiling,groundChaseFraming,portraitChaseInset,ROOF_ROOM} from '../src/render/chase-framing.ts';

function screenBounds(box,camera,width,height){
  camera.updateMatrixWorld();const points=[];
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new THREE.Vector3(x,y,z).project(camera));
  return{left:(Math.min(...points.map(p=>p.x))+1)*width/2,right:(Math.max(...points.map(p=>p.x))+1)*width/2,top:(1-Math.max(...points.map(p=>p.y)))*height/2,bottom:(1-Math.min(...points.map(p=>p.y)))*height/2};
}

test('portrait chase keeps the real coupe above the touch controls across phone sizes and orbit angles',()=>{
  const car=createCar(),box=new THREE.Box3().setFromObject(car.group);
  try{
    for(const [width,height] of [[320,568],[375,667],[393,852],[430,932]])for(const speed of [0,20])for(const zoom of [.65,1,2])for(const yaw of [0,.4,-.4,Math.PI/2,Math.PI]){
      const framing=groundChaseFraming(false,speed,zoom,yaw,true),camera=new THREE.PerspectiveCamera(55+Math.min(5,speed*.13),width/height,.15,2200);
      camera.position.set(-Math.sin(yaw)*framing.follow,framing.height,-Math.cos(yaw)*framing.follow);
      camera.lookAt(Math.sin(yaw)*framing.ahead,framing.lookHeight,Math.cos(yaw)*framing.ahead);
      applyChaseViewOffset(camera,width,height,portraitChaseInset(true,width,height));
      const bounds=screenBounds(box,camera,width,height),context=JSON.stringify({width,height,speed,zoom,yaw,bounds});
      assert.ok(bounds.left>=12&&bounds.right<=width-12,`car must stay horizontally visible: ${context}`);
      assert.ok(bounds.top>130,`car must stay below the compact top HUD: ${context}`);
      assert.ok(bounds.bottom<height-215,`car must stay above the control band: ${context}`);
    }
  }finally{car.dispose();}
});

test('desktop and landscape keep their existing chase boom and projection',()=>{
  for(const riding of [false,true])for(const speed of [0,20])for(const zoom of [.65,1,2]){
    const frame=groundChaseFraming(riding,speed,zoom,.2,false);
    assert.equal(frame.follow,((riding?4.8:7.8)+Math.min(riding?2.5:5,speed*.16))*zoom);
    assert.equal(frame.height,(riding?2.1:2.8)*zoom);
    assert.equal(frame.ahead,riding?3*Math.cos(.2):9);
  }
  assert.equal(portraitChaseInset(false,393,852),0);
  assert.equal(portraitChaseInset(true,852,393),0);
  const camera=new THREE.PerspectiveCamera(55,852/393,.15,2200),expected=camera.projectionMatrix.clone();
  applyChaseViewOffset(camera,852,393,0);assert.ok(camera.projectionMatrix.equals(expected));
  applyChaseViewOffset(camera,393,852,220);assert.equal(camera.view.enabled,true);
  camera.aspect=852/393;applyChaseViewOffset(camera,852,393,0);
  assert.equal(camera.view.enabled,false);assert.ok(camera.projectionMatrix.equals(expected),'rotation must remove the portrait offset');
});

test('a third-person camera keeps under a tunnel roof lower than its boom reaches',()=>{
  const roofed={ceiling:3.2,covered:true},cut={ceiling:3.4,covered:false};
  assert.equal(boomCeiling(undefined,undefined),undefined,'no limit in the open');
  assert.equal(boomCeiling(cut,cut),undefined,'nor in a walled cut without a roof');
  assert.equal(boomCeiling(roofed,roofed),3.2-ROOF_ROOM);
  assert.equal(boomCeiling(cut,roofed),3.4-ROOF_ROOM,'entering: the vehicle is under the roof and the camera, still in the cut behind it, comes down at its own place');
  assert.equal(boomCeiling(roofed,cut),3.2-ROOF_ROOM,'leaving: the camera is under the roof after the vehicle has left it');
  assert.equal(boomCeiling(roofed,undefined),3.2-ROOF_ROOM,'the vehicle has left the tunnel record altogether');
  assert.equal(boomCeiling(undefined,roofed),3.2-ROOF_ROOM,'the boom swings out of the tunnel\'s plan: the roof over the vehicle');
  // The car's body rides 0.66 m over the road. Storrow Drive's roof (3.2 m) is lower than the boom, the Turnpike's (4.2 m) and the Central Artery's (5.2 m) are not.
  const boom=.66+groundChaseFraming(false,0,1,0,false).height;
  assert.ok(3.2-ROOF_ROOM<boom,'Storrow Drive\'s tunnel lowers the camera');assert.ok(4.2-ROOF_ROOM>boom&&5.2-ROOF_ROOM>boom,'the higher tunnels leave it where it was');
  // The near plane (0.15 m, at most 60 degrees of view) reaches 0.09 m above the eye of a level camera.
  assert.ok(ROOF_ROOM>2*.15*Math.tan(Math.PI/6));
});
