import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {resolveCity,loadTile} from '../src/simulation/city-tiles.ts';
import {parseTile,gunzip} from '../src/simulation/tile-format.ts';
import {TUNNEL_PASSAGE_BUILDING_IDS,prepareBuildingTunnelPassage} from '../src/simulation/tunnel-passages.ts';
import {roadProjection,sampleRoadElevation} from '../src/simulation/road-surfaces.ts';
import {sourceFootingGeometry,addSourceFooting} from '../src/render/source-footings.ts';
import {tileSourceGeometry} from '../src/render/tile-geometry.ts';
import {read,readJson} from './helpers/metro-city.mjs';

const city=await resolveCity(readJson('city.json'),read),raw=parseTile(await gunzip(await read('tiles/t_1_-2.bin'))),loaded=await loadTile(city,1,-2,read);
const roads=city.roads.filter(r=>r.tunnel);
function triangles(data,kind){const result=[];for(let i=0;i<data[kind].length;i+=3)result.push([0,1,2].map(j=>Array.from(data.positions.subarray(data[kind][i+j]*3,data[kind][i+j]*3+3))));return result;}
function inPassage(x,y,z){return roads.some(r=>{const p=roadProjection(r,x,z),floor=sampleRoadElevation(city,r,x,z);return p.distance<r.width/2+.38&&y>floor-.48&&y<floor+r.tunnel.clearance+.43;});}

for(const id of TUNNEL_PASSAGE_BUILDING_IDS){
const building=raw.buildings.find(b=>b.id===id),source=raw.geometry.get(id),adapted=loaded.geometry.get(id);
test(`${building.name} gets finite approach apertures; original source and upper floors stay intact`,()=>{
 assert.notEqual(adapted,source);const before=source.positions.slice();prepareBuildingTunnelPassage(city,building,source);assert.deepEqual(source.positions,before,'runtime adaptation cannot mutate source survey vertices');
 const other=raw.buildings.find(b=>!TUNNEL_PASSAGE_BUILDING_IDS.has(b.id)),otherData=raw.geometry.get(other.id);assert.equal(prepareBuildingTunnelPassage(city,other,otherData),otherData);
 for(const kind of ['facade','roof']){
  const retained=new Set(triangles(adapted,kind).map(t=>JSON.stringify(t)));let upper=0;
  for(const triangle of triangles(source,kind))if(triangle.every(p=>p[1]>20)){assert.ok(retained.has(JSON.stringify(triangle)),'upper survey triangles remain exact');upper++;}
  assert.ok(upper>0,`${kind} has upper structure to preserve`);
 }
});
test(`${building.name} streamed facade and roof triangles leave the finite vehicle corridors open`,()=>{
 const area=triangle=>{const [a,b,c]=triangle,u=b.map((v,i)=>v-a[i]),v=c.map((x,i)=>x-a[i]);return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;};let originalArea=0,adaptedArea=0;
 for(const kind of ['facade','roof']){
  for(const triangle of triangles(source,kind))originalArea+=area(triangle);
  for(const triangle of triangles(adapted,kind)){adaptedArea+=area(triangle);const center=[0,1,2].map(k=>triangle.reduce((sum,p)=>sum+p[k],0)/3);assert.equal(inPassage(...center),false,'adapted shell must not refill a tunnel passage');}
 }
 assert.ok(originalArea-adaptedArea>10,'a finite part of the actual obstructing source shell is removed');
 assert.ok(adaptedArea>originalArea*.9,'the rest of the measured building remains');
});
test(`${building.name} generated footings share the adapted render/collision aperture`,()=>{
 const input=tileSourceGeometry(adapted),geometry=sourceFootingGeometry(city,building,input),p=geometry.attributes.position;
 for(let i=0;i<p.count;i+=3){const center=[0,1,2].map(k=>[0,1,2].reduce((sum,j)=>sum+p.array[(i+j)*3+k],0)/3);assert.equal(inPassage(...center),false);}
 const scene=new THREE.Scene(),collision=addSourceFooting(scene,city,building,input);
 if(collision)assert.deepEqual(collision.vertices,scene.children[0].geometry.attributes.position.array,'the exact visible footing supplies Rapier');
 geometry.dispose();input.dispose();for(const object of scene.children)object.geometry.dispose();
});

}
