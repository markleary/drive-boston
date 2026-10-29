import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {addTobinBridgeDetails} from '../src/render/tobin-bridge.ts';
import {tobinBridgeSpine} from '../src/simulation/tobin-bridge.ts';
import {bridgeSupports,deckEdge} from '../src/simulation/road-surfaces.ts';

const fixture=()=>{
  const points=Array.from({length:153},(_,i)=>[0,i*10]),elevations=points.map((_,i)=>12+29*Math.min(1,i/80));
  const lower={id:'tobin-lower',name:'Tobin Bridge',points,elevations,width:10.9728,oneway:1,bridge:{id:'tobin',thickness:.7,clearanceEstimated:true}};
  const upper={...lower,id:'tobin-upper',points:[...points].reverse(),elevations:elevations.map(y=>y+6.8).reverse()};
  return{roads:[lower,upper],buildings:[],landmarks:[],signals:[],curbs:[],bounds:{minX:-100,maxX:100,minZ:-100,maxZ:1600},spawn:{x:0,z:0,yaw:0},sources:[],
    tobinBridge:{lowerRoadId:lower.id,upperRoadId:upper.id,mainSpan:[871.824,1336.644],mainPiers:[982.314,1226.154],littleSpan:[415.25,549.06]}};
};
const castGeometry=solid=>{
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(solid.vertices,3));geometry.setIndex(new THREE.BufferAttribute(solid.indices,1));
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));mesh.updateMatrixWorld();return mesh;
};

test('Tobin stations retain the independent heights when upper road direction is reversed',()=>{
  const city=fixture(),spine=tobinBridgeSpine(city);
  for(const s of [0,200,480,1050,1520]){const p=spine.sample(s,6);assert.ok(Math.abs(p.upper-p.lower-6.8)<1e-8);assert.equal(p.x,-6);assert.equal(p.z,s);}
  assert.deepEqual(bridgeSupports(city,city.roads[0]),[]);assert.deepEqual(bridgeSupports(city,city.roads[1]),[]);
});

test('Tobin steel follows the deck edge through source bends without changing storeys',()=>{
  const city=fixture(),lower=city.roads[0],upper=city.roads[1];lower.points=[[0,0],[0,100],[80,160],[200,160]];lower.elevations=[12,15,18,22];upper.points=[...lower.points].reverse();upper.elevations=lower.elevations.map(y=>y+6.8).reverse();
  const spine=tobinBridgeSpine(city);
  for(let i=0;i<spine.stations.length;i++){
    const p=spine.sample(spine.stations[i],6),edge=deckEdge(lower,i,1,lower.width/2-6);
    assert.ok(Math.hypot(p.x-edge[0],p.z-edge[1])<1e-7);assert.ok(Math.abs(p.upper-p.lower-6.8)<1e-7);
  }
});

test('Tobin cantilevers keep both decks clear and collide with aircraft at the steel peaks',()=>{
  const city=fixture(),scene=new THREE.Scene(),model=addTobinBridgeDetails(scene,city),spine=tobinBridgeSpine(city);
  const mesh=castGeometry(model.collisions[0]);
  // Sample both road lanes all the way along the crossing; vertical clearance
  // checks include the upper-deck floor beams and the Little Mystic portals.
  const stations=[...Array.from({length:216},(_,i)=>5+i*7),...city.tobinBridge.mainSpan,...city.tobinBridge.littleSpan];
  for(const s of stations)for(const across of [-3.6,0,3.6])for(const level of ['lower','upper']){
    const p=spine.sample(s,across),ray=new THREE.Raycaster(new THREE.Vector3(p.x,p[level]+.15,p.z),new THREE.Vector3(0,1,0),0,4.6);
    assert.equal(ray.intersectObject(mesh).length,0,`${level} clearance at ${s}/${across}`);
  }
  const p=spine.sample(city.tobinBridge.mainPiers[0],city.roads[0].width/2+1.16),ray=new THREE.Raycaster(new THREE.Vector3(p.x,120,p.z),new THREE.Vector3(0,-1,0),0,100);
  const hits=ray.intersectObject(mesh);assert.ok(hits.length>0);assert.ok(hits[0].point.y>74&&hits[0].point.y<77,'aircraft hits the tall green chord');
  assert.equal(model.group.userData.concretePiers,6);assert.equal(model.group.userData.lanesPerDeck,3);
  assert.ok(model.group.userData.gussets>200);assert.ok(model.group.userData.rivets>1200);
});

test('Tobin detail stays spatially batched with finite nondegenerate triangles',()=>{
  const model=addTobinBridgeDetails(new THREE.Scene(),fixture());let triangles=0;
  assert.ok(model.group.children.length<120,'the bridge must not add a mesh for every bolt');
  for(const mesh of model.group.children){
    const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal;triangles+=p.count/3;
    assert.ok(mesh.geometry.boundingSphere.radius<200,'parts remain locally cullable');
    for(let i=0;i<p.count;i++){
      assert.ok(Number.isFinite(p.getX(i))&&Number.isFinite(p.getY(i))&&Number.isFinite(p.getZ(i)));
      assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-5);
    }
  }
  assert.ok(triangles<180000);assert.ok(model.collisions[0].indices.length/3<25000);
});

test('legacy maps do not get an unattached Tobin landmark',()=>{
  const city=fixture();delete city.tobinBridge;const scene=new THREE.Scene(),model=addTobinBridgeDetails(scene,city);
  assert.equal(model.collisions.length,0);assert.equal(scene.children.length,0);
});
