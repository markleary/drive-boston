import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createCar} from '../src/render/car.ts';
import {PLAYER_CARS} from '../src/simulation/player-cars.ts';
import {TESLA_BODY,createTeslaWordmarkGeometry} from '../src/render/tesla-model-3.ts';

const id='tesla-model-3-performance';
test('Highland Performance has bounded metre-scale geometry, clearcoat paint, tinted glazing and outward MA plates',()=>{
  const car=createCar(id),spec=PLAYER_CARS[id];
  try{
    assert.equal(car.group.name,'PlayerTeslaModel3Performance');
    assert.equal(car.group.userData.carId,id);
    const paint=car.group.getObjectByName('TeslaBody-paint');
    assert.ok(paint?.isMesh,'separate Highland body paint');
    assert.ok(paint.material.isMeshPhysicalMaterial&&paint.material.clearcoat===1,'clearcoat preserves curved body highlights');
    assert.ok(paint.material.color.r>paint.material.color.g*4&&paint.material.color.r>paint.material.color.b*4,'red paint follows the reference vehicle');
    const cabinGlass=car.group.getObjectByName('TeslaBody-cabinGlass'),roofGlass=car.group.getObjectByName('TeslaBody-roofGlass');
    for(const glazing of [cabinGlass,roofGlass]){
      assert.ok(glazing?.isMesh&&glazing.material.transparent&&glazing.material.opacity<1,'tinted glazing reveals the cabin');
      assert.equal(glazing.castShadow,false,'transparent windows must not black out the interior');
      assert.equal(glazing.material.depthWrite,false,'glazing does not occlude overlapping transparent surfaces');
    }
    assert.ok(roofGlass.material.opacity>cabinGlass.material.opacity,'panoramic roof tint is darker than the windows');
    paint.geometry.computeBoundingBox();const bounds=paint.geometry.boundingBox;
    assert.ok(Math.abs(bounds.min.z-TESLA_BODY.rear)<.045,'asymmetric rear overhang follows dimensional drawing');
    assert.ok(Math.abs(bounds.max.z-TESLA_BODY.front)<.035,'asymmetric front overhang follows dimensional drawing');
    assert.ok(Math.abs(bounds.max.x-1.0445)<.004,'2089 mm mirror-to-mirror width');
    assert.ok(Math.abs(new THREE.Box3().setFromObject(car.group).max.y-TESLA_BODY.roof)<.02,'1431 mm roof above loaded ground');
    const plates=car.group.getObjectByName('PlayerMassachusettsPlates');
    const pos=plates.geometry.attributes.position,norm=plates.geometry.attributes.normal;
    assert.equal(pos.count,8);for(let i=0;i<pos.count;i++)assert.equal(Math.sign(norm.getZ(i)),Math.sign(pos.getZ(i)));
    let triangles=0,meshes=0;
    car.group.traverse(o=>{
      if(!o.isMesh)return;meshes++;const p=o.geometry.attributes.position,n=o.geometry.attributes.normal;
      triangles+=(o.geometry.index?.count??p.count)/3;
      for(let i=0;i<p.count;i++)assert.ok(Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)+n.getX(i)+n.getY(i)+n.getZ(i)));
    });
    assert.ok(triangles<110000,`${triangles} triangles exceeds the detailed player-car budget`);assert.ok(meshes<=27,`${meshes} meshes exceeds the merged-material draw budget including the carbon spoiler`);
    for(let i=0;i<4;i++){
      const pivot=car.group.getObjectByName(`TeslaWheelPivot${i}`),spin=car.group.getObjectByName(`TeslaWheelSpin${i}`);
      assert.equal(pivot.position.x,(i%2?1:-1)*(i<2?spec.track:spec.rearTrack)/2);
      assert.equal(pivot.position.z,(i<2?1:-1)*spec.wheelbase/2);
      const rubber=spin.children.find(o=>o.material.color.getHex()===0x171a1b);
      rubber.geometry.computeBoundingBox();const size=rubber.geometry.boundingBox.getSize(new THREE.Vector3());
      assert.ok(Math.abs(size.x-(i<2?.235:.275))<.001,'staggered tyre width');
      assert.ok(Math.abs(size.y/2-(i<2?.33625:.3365))<.001,'20-inch wheel tyre radius');
    }
  }finally{car.dispose();}
});

test('red Performance calipers follow steering and suspension without rotating with the wheels',()=>{
  const car=createCar(id);
  try{
    car.update({x:0,y:.605,z:0,yaw:0,speed:12,steering:.24,wheelAngles:[.5,1,1.5,2],suspension:[.18,.20,.19,.21],braking:true},false);
    for(let i=0;i<4;i++){
      const caliper=car.group.getObjectByName(`TeslaRedBrakeCaliper${i}`),pivot=car.group.getObjectByName(`TeslaWheelPivot${i}`),spin=car.group.getObjectByName(`TeslaWheelSpin${i}`);
      assert.ok(caliper.isMesh);assert.equal(caliper.material.color.getHex(),0xe22b25);
      assert.equal(caliper.parent,pivot);assert.notEqual(caliper.parent,spin);
      assert.equal(caliper.rotation.x,0);assert.equal(spin.rotation.x,(i+1)*.5);
      assert.equal(pivot.rotation.y,i<2?.24:0);
      assert.ok(Math.abs(pivot.position.y-(-.08-[.18,.20,.19,.21][i]))<1e-10);
    }
  }finally{car.dispose();}
});


test('Performance lamps and calipers remain externally visible and rockers clear all wheel openings',()=>{
  const car=createCar(id);
  try{
    car.update({x:0,y:0,z:0,yaw:0,speed:0,steering:0,suspension:[.18875,.18875,.18875,.18875]},false);
    car.group.updateMatrixWorld(true);
    for(const side of [-1,1]){
      // The thin red lens must be in front of its thicker dark housing.
      // Probe both the long upper guide and the returning lower leg of the
      // Highland C-shaped lens, rather than the previous model's lamp strip.
      for(const [x,y] of [[.48,.340],[.58,.347],[.70,.349],[.70,.168]]){
        const ray=new THREE.Raycaster(new THREE.Vector3(side*x,y,-4),new THREE.Vector3(0,0,1));
        const hit=ray.intersectObject(car.group,true)[0];
        assert.equal(hit?.object.name,'TeslaBody-taillight','rear LED is not buried inside its housing');
      }
      for(const front of [true,false]){
        const index=(front?0:2)+(side>0?1:0),z=(front?1:-1)*1.4375;
        let visibleCaliper=false;
        for(const dy of [-.08,-.04,0,.04,.08])for(const dz of [-.02,0,.02]){
          const ray=new THREE.Raycaster(new THREE.Vector3(side*2,-.26875+dy,z+(front?-.146:.136)+dz),new THREE.Vector3(-side,0,0));
          const hit=ray.intersectObject(car.group,true)[0];
          visibleCaliper ||= hit?.object.name===`TeslaRedBrakeCaliper${index}`;
        }
        assert.ok(visibleCaliper,`red caliper ${index} is visible through the wheel`);
        for(const y of [-.40,-.37]){
          const ray=new THREE.Raycaster(new THREE.Vector3(side*2,y,z),new THREE.Vector3(-side,0,0));
          const hit=ray.intersectObject(car.group,true)[0];
          assert.ok(hit?.object.parent?.name===`TeslaWheelSpin${index}`||hit?.object.name===`TeslaRedBrakeCaliper${index}`,'a rocker must not cross the wheel face');
        }
        // End-panel rounding changes longitudinal coordinates. The opening
        // must follow the actual wheel circle after that warp, including the
        // leading/trailing quadrants that a single top-of-arch check misses.
        const shoulderRadius=(front?.33625:.3365)-.004;
        for(let degrees=6;degrees<180;degrees+=6){
          const angle=degrees*Math.PI/180;
          const ray=new THREE.Raycaster(new THREE.Vector3(side*2,-.26875+Math.sin(angle)*shoulderRadius,z+Math.cos(angle)*shoulderRadius),new THREE.Vector3(-side,0,0));
          const hit=ray.intersectObject(car.group,true)[0];
          assert.equal(hit?.object.parent?.name,`TeslaWheelSpin${index}`,`bodywork clips wheel ${index} at ${degrees} degrees around its upper shoulder`);
        }
      }
    }
  }finally{car.dispose();}
});


test('rear wordmark follows a gently raked trunk panel without a central bump or floating decal',()=>{
  const car=createCar(id),badge=createTeslaWordmarkGeometry();
  try{
    car.group.updateMatrixWorld(true);
    const paint=car.group.getObjectByName('TeslaBody-paint');
    const panelAt=(x,y)=>new THREE.Raycaster(new THREE.Vector3(x,y,-4),new THREE.Vector3(0,0,1)).intersectObject(paint,false)[0];
    for(const x of [-.25,0,.25]){
      const depths=[];
      // Restrict this to the wordmark itself. The number-plate recess below
      // the badge intentionally has a different depth and curvature.
      for(const y of [.212,.234,.255,.277,.298]){
        const hit=panelAt(x,y);assert.ok(hit,'continuous panel behind the wordmark');depths.push(hit.point.z);
        assert.ok(hit.normal.z<-.98&&hit.normal.y>=0&&hit.normal.y<.1,'badge panel normals face rearward with a gentle rake');
      }
      assert.ok(Math.max(...depths)-Math.min(...depths)<.004,'trunk rakes less than 4 mm across the badge region');
      for(let i=1;i<depths.length;i++)assert.ok(depths[i]>depths[i-1],'badge panel has no protruding central shelf');
    }
    for(const y of [.212,.255,.298]){
      const center=panelAt(0,y).point.z,left=panelAt(-.25,y).point.z,right=panelAt(.25,y).point.z;
      assert.ok(Math.abs(center-(left+right)/2)<.001,'wordmark is on a broad trunk face without a central bump');
    }
    const positions=badge.attributes.position;
    for(let i=0;i<positions.count;i++){
      const hit=panelAt(positions.getX(i),positions.getY(i));assert.ok(hit);
      const standOff=hit.point.z-positions.getZ(i);
      assert.ok(standOff>.002&&standOff<.0045,`wordmark floats ${standOff} m off trunk`);
    }
  }finally{badge.dispose();car.dispose();}
});

test('carbon spoiler has an attached leading edge, a raised solid lip and a disposable weave texture',()=>{
  const car=createCar(id);let textureDisposals=0;
  try{
    car.group.updateMatrixWorld(true);
    const spoiler=car.group.getObjectByName('TeslaBody-carbon'),paint=car.group.getObjectByName('TeslaBody-paint');
    assert.ok(spoiler?.isMesh&&spoiler.material.map,'dedicated carbon laminate and weave');
    spoiler.material.map.addEventListener('dispose',()=>textureDisposals++);
    const positions=spoiler.geometry.attributes.position,uv=spoiler.geometry.attributes.uv;
    assert.equal(uv.count,positions.count,'weave coordinates survive material merging');
    for(const x of [-.39140625,0,.39140625]){
      const edge=v=>{
        const points=[];
        for(let i=0;i<positions.count;i++)if(Math.abs(positions.getX(i)-x)<.0001&&Math.abs(uv.getY(i)-v)<.0001)
          points.push(new THREE.Vector3().fromBufferAttribute(positions,i));
        assert.ok(points.length>1,'both faces of the solid lip exist');
        points.sort((a,b)=>a.y-b.y);return points[0];
      };
      const leading=edge(0),trailing=edge(1);
      assert.ok(trailing.y-leading.y>.025,'trailing lip rises visibly instead of following the falling deck');
      for(const [point,min,max] of [[leading,.0001,.010],[trailing,.03,.12]]){
        const ray=new THREE.Raycaster(new THREE.Vector3(point.x,2,point.z+.0002),new THREE.Vector3(0,-1,0));
        const hit=ray.intersectObject(paint,false)[0];assert.ok(hit,'spoiler remains over the trunk');
        const gap=point.y-hit.point.y;assert.ok(gap>min&&gap<max,`spoiler clearance ${gap}m`);
      }
    }
  }finally{car.dispose();}
  assert.equal(textureDisposals,1,'changing vehicles releases the carbon texture');
});
