import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {loadMetroCity} from './helpers/metro-city.mjs';
import {tileShellGeometry} from '../src/render/tile-geometry.ts';
import {planMasonryStoop} from '../src/render/porch-stairs.ts';
import {closestRoad,pointInside} from '../src/simulation/roads.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {otherBuildingHulls} from '../src/simulation/city-tiles.ts';

const city=await loadMetroCity({tiles:['-2_8','-2_9']});

test('Mattapan hollow building is a Boston survey with an exterior-visible roof',()=>{
  const b=city.buildings.find(b=>b.id==='BOS-NA8BR-YJOW2-4D067');assert.equal(b.source,'boston-obj');
  const data=city.geometry.get(b.id),g=tileShellGeometry(data,b,true),mesh=new THREE.Mesh(g,new THREE.MeshBasicMaterial({side:THREE.FrontSide}));mesh.updateMatrixWorld();
  const p=g.attributes.position,n=g.attributes.normal,ray=new THREE.Raycaster();let samples=0;
  // The large 23.826 m roof used to be entirely down-facing, so a ray from
  // above could see through it while the small rooftop box stayed visible.
  for(let i=0;i<p.count;i+=3){
    if(Math.abs(p.getY(i)-23.826)>.02)continue;
    assert.ok(n.getY(i)>.99,'the measured main roof faces the sky');
    const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;
    ray.set(new THREE.Vector3(x,50,z),new THREE.Vector3(0,-1,0));
    assert.ok(ray.intersectObject(mesh).length,'roof must render with ordinary front-face culling');samples++;
  }
  assert.ok(samples>30);g.dispose();mesh.material.dispose();
});

test('431 River Street masonry steps solve the full terrain descent and ground every block',()=>{
  const b=city.buildings.find(b=>b.id==='BOS-WYV6T-M2KK0-RW7TK');assert.equal(b.source,'boston-obj');
  const ground=(x,z)=>sampleElevation(city,x,z);let checked=0;
  for(let e=0;e<b.footprint.length;e++){
    const a=b.footprint[e],c=b.footprint[(e+1)%b.footprint.length],dx=c[0]-a[0],dz=c[1]-a[1],length=Math.hypot(dx,dz);
    if(length<5)continue;
    const nx=dz/length,nz=-dx/length,mx=(a[0]+c[0])/2,mz=(a[1]+c[1])/2,road=closestRoad(city,mx,mz,true);
    if(((road.x-mx)*nx+(road.z-mz)*nz)/road.distance<.48)continue;
    const spans=Math.ceil(length/6),span=length/spans;
    for(let s=0;s<spans;s++){
      const along=(s+.5)*span,origin=[a[0]+dx*along/length,a[1]+dz*along/length];
      const site={origin,tangent:[nz,-nx],normal:[nx,nz],frontDepth:0,width:1.82,depth:1.5,frontage:length,along:length/2-along,setback:road.distance-road.road.width/2,landingY:b.baseElevation+1.12};
      const neighbors=otherBuildingHulls(city,b,...origin,35);
      const clear=p=>!neighbors.some(other=>pointInside(p,other.footprint));
      const plan=planMasonryStoop(site,ground,clear);if(!plan)continue;
      assert.ok(plan.steps.length>5,'the old five-step flight cannot span this foundation');
      assert.ok(plan.platform.top-plan.landing.top>3);
      for(const block of [plan.platform,...plan.steps,plan.landing]){
        const direction=block===plan.platform?site.normal:plan.direction;
        for(let i=0;i<=8;i++)for(let j=0;j<=8;j++){
          const x=block.center[0]+direction[1]*block.width*(i/8-.5)+direction[0]*block.depth*(j/8-.5);
          const z=block.center[1]-direction[0]*block.width*(i/8-.5)+direction[1]*block.depth*(j/8-.5);
          assert.ok(block.bottom<=ground(x,z),'solid masonry reaches ground under the whole step');
          assert.ok(block.top>ground(x,z));assert.ok(clear([x,z]));
        }
      }
      checked++;
    }
  }
  assert.ok(checked>0,'real River Street frontage must retain a grounded entrance');
});

test('a masonry entrance is omitted when no terrain-grounded flight fits',()=>{
  const site={origin:[0,0],tangent:[1,0],normal:[0,1],frontDepth:0,width:1.82,depth:1.5,frontage:3,along:0,setback:3,landingY:6};
  assert.equal(planMasonryStoop(site,()=>0),undefined);
  assert.equal(planMasonryStoop({...site,landingY:1,setback:10},()=>2),undefined,'do not bury the platform');
});
