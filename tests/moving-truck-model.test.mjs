import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createCar} from '../src/render/car.ts';
import {MOVING_TRUCK,PLAYER_CARS} from '../src/simulation/player-cars.ts';

test('moving truck is larger than the NPC box truck and its cargo shares the physics dimensions',()=>{
  const car=createCar('moving-truck');
  try{
    const cargo=car.group.getObjectByName('MovingTruckCargoBox'),bounds=new THREE.Box3().setFromObject(cargo);
    assert.ok(bounds.max.y-MOVING_TRUCK.groundY>=11*.3048);
    assert.ok(Math.abs(bounds.max.y-(MOVING_TRUCK.cargo.center.y+MOVING_TRUCK.cargo.halfExtents.y))<.015);
    assert.ok(Math.abs(bounds.min.z-(MOVING_TRUCK.cargo.center.z-MOVING_TRUCK.cargo.halfExtents.z))<.2,'rear step adds less than 20 cm behind cargo');
    assert.ok(PLAYER_CARS['moving-truck'].halfLength*2>6.6);
    assert.ok(PLAYER_CARS['moving-truck'].mass>7000);
    for(const name of ['StorrowMoversLeft','StorrowMoversRight','StorrowMoversRear'])assert.ok(car.group.getObjectByName(name));
    let triangles=0;car.group.traverse(o=>{if(o.isMesh){const p=o.geometry.attributes.position,n=o.geometry.attributes.normal;triangles+=(o.geometry.index?.count??p.count)/3;for(let i=0;i<p.count;i++)assert.ok(Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)+n.getX(i)+n.getY(i)+n.getZ(i)));}});
    assert.ok(triangles<50000,`${triangles} triangles`);
  }finally{car.dispose();}
});

for(const direction of [1,-1])test(`bridge strike visibly folds the ${direction>0?'front':'rear'} box while retaining the opposite end, then repairs exactly`,()=>{
  const car=createCar('moving-truck');
  try{
    const sign=car.group.getObjectByName('StorrowMoversRight'),position=sign.geometry.attributes.position,rest=Float32Array.from(position.array);
    const cab=car.group.children.find(o=>o.isMesh&&o.material.isMeshPhysicalMaterial),cabRest=Float32Array.from(cab.geometry.attributes.position.array);
    car.setDamage(1,direction);
    let moved=0,retained=0;
    for(let i=0;i<position.count;i++){
      const y=rest[i*3+1],z=rest[i*3+2],delta=position.getY(i)-y;
      if(y>2.4&&(direction>0?z>.7:z<-3.2)){assert.ok(delta<-.25);moved++;}
      if(direction>0?z<-2:z>0){assert.equal(position.getY(i),y);retained++;}
    }
    assert.ok(moved>=6&&retained>50);assert.ok(car.group.getObjectByName('MovingTruckTornRoof').visible);
    assert.deepEqual(cab.geometry.attributes.position.array,cabRest,'cab remains intact below the impact');
    car.setDamage(0);assert.deepEqual(position.array,rest);assert.equal(car.group.getObjectByName('MovingTruckTornRoof').visible,false);
  }finally{car.dispose();}
});

test('moving truck wheel animation and repair follow the physics state',()=>{
  const car=createCar('moving-truck');
  try{
    const base={x:0,y:.94,z:0,yaw:0,speed:3,steering:.2,wheelAngles:[1,2,3,4],suspension:[.34,.35,.36,.37],storrowDamage:.8,storrowDirection:-1};
    car.update(base,false);
    const wheels=car.group.children.filter(o=>o.name.endsWith('Wheel'));assert.equal(wheels.length,4);
    assert.deepEqual(wheels.map(w=>w.children[0].rotation.x),base.wheelAngles);
    assert.equal(wheels[0].rotation.y,.2);assert.equal(wheels[2].rotation.y,0);
    assert.ok(car.group.getObjectByName('MovingTruckTornRoof').visible);
    car.update({...base,storrowDamage:0},false);assert.equal(car.group.getObjectByName('MovingTruckTornRoof').visible,false);
  }finally{car.dispose();}
});

test('front fenders are closed, outward-facing painted panels attached continuously to the cab',()=>{
  const car=createCar('moving-truck');
  try{
    car.group.updateMatrixWorld(true);
    for(const side of [-1,1]){
      const fender=car.group.getObjectByName(side<0?'MovingTruckLeftFender':'MovingTruckRightFender');
      assert.ok(fender);
      for(const z of [1.35,1.60,1.90,2.20,2.50,2.80,3.10,3.40,3.60])for(const y of [.40,.51]){
        const ray=new THREE.Raycaster(new THREE.Vector3(side*2,y,z),new THREE.Vector3(-side,0,0),0,2);
        const hits=ray.intersectObject(fender,false);
        assert.ok(hits.length>=2,`closed fender skin missing at ${side}, ${y}, ${z}`);
        assert.ok(hits[0].face.normal.x*side>.7,'outer skin normals face out');
        assert.ok(hits.at(-1).distance-hits[0].distance>.06,'fender has material depth, not a floating thin strip');
      }
      const well=car.group.getObjectByName(side<0?'MovingTruckLeftWheelWell':'MovingTruckRightWheelWell');
      assert.ok(well.children.every(mesh=>mesh.material.color.getHex()===0x1b211f));
      const bounds=new THREE.Box3().setFromObject(well);assert.ok(bounds.min.y>-.40,'liner remains inside the upper wheel cavity');
    }
  }finally{car.dispose();}
});

test('front tires clear the recessed liners through steering lock and full suspension travel',()=>{
  const car=createCar('moving-truck'),spec=PLAYER_CARS['moving-truck'];
  try{
    const point=new THREE.Vector3();
    for(const side of [-1,1]){
      const wheel=car.group.getObjectByName(side<0?'MovingTruckFrontLeftWheel':'MovingTruckFrontRightWheel');
      for(const steer of [-spec.maxSteering,0,spec.maxSteering])for(const suspension of [spec.suspensionRest,spec.suspensionRest-spec.travel]){
        wheel.rotation.y=steer;wheel.position.y=-.08-suspension;car.group.updateMatrixWorld(true);
        wheel.traverse(mesh=>{if(!mesh.isMesh)return;const p=mesh.geometry.attributes.position;for(let i=0;i<p.count;i++){
          point.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);
          if(point.y<-.35||Math.abs(point.x)>1.17)continue;
          assert.ok(Math.hypot(point.y+.38,point.z-2.20)<.618,'tire keeps at least 1 cm below the liner');
          assert.ok(Math.abs(point.x)>.59,'steered tire clears the recessed liner back wall');
        }});
      }
    }
  }finally{car.dispose();}
});

test('camera visibility preserves intact, damaged and repaired roof states',()=>{
  const car=createCar('moving-truck');
  try{
    const tears=car.group.getObjectByName('MovingTruckTornRoof'),inside=new THREE.Vector3(0,.5,2),outside=new THREE.Vector3(8,5,-12);
    const visible=()=>{for(let node=tears;node;node=node.parent)if(!node.visible)return false;return true;};
    for(const damage of [0,.8,0]){
      car.setDamage(damage);
      for(let cycle=0;cycle<2;cycle++){
        car.setCameraPosition(inside);car.setDamage(damage);assert.equal(car.bodyVisible,false);assert.equal(visible(),false);
        car.setCameraPosition(outside);car.setDamage(damage);assert.equal(car.bodyVisible,true);assert.equal(visible(),damage>.08);
      }
    }
    car.setCameraPosition(inside);car.setDamage(.8);assert.equal(visible(),false);
    car.setDamage(0);car.setCameraPosition(outside);assert.equal(tears.visible,false,'repair performed in hood view remains intact');
  }finally{car.dispose();}
});
