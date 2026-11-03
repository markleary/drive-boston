import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {loadMetroCity} from './helpers/metro-city.mjs';
import {tunnelGeometry,tunnelStations,tunnelCoveredAt,tunnelSurfaceLandingAt} from '../src/simulation/tunnels.ts';
import {deckEdge,deckEdgeElevation} from '../src/simulation/road-surfaces.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';

function wallProbe(city,road){
  const data=tunnelGeometry(city,road).walls,geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(data.vertices,3));geometry.setIndex(new THREE.BufferAttribute(data.indices,1));
  const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material),ray=new THREE.Raycaster(),stations=tunnelStations(road);
  mesh.updateMatrixWorld();
  return{at(station,side){
    let i=1;while(i<stations.length-1&&stations[i]<station)i++;
    const t=(station-stations[i-1])/(stations[i]-stations[i-1]),a=deckEdge(road,i-1,side,-.08),b=deckEdge(road,i,side,-.08);
    const x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,floor=deckEdgeElevation(road,i-1,side)+(deckEdgeElevation(road,i,side)-deckEdgeElevation(road,i-1,side))*t;
    ray.set(new THREE.Vector3(x,100,z),new THREE.Vector3(0,-1,0));
    return{top:ray.intersectObject(mesh,false)[0]?.point.y,ground:sampleElevation(city,x,z),floor};
  },dispose(){geometry.dispose();material.dispose();}};
}

test('open parapets bridge terrain dips with straight grades and guard a crest between regular probes',()=>{
  const road={id:'wavy-approach',name:'Approach',points:[[0,0],[0,120]],elevations:[-7,-7],width:8,oneway:1,tunnel:{clearance:5.2,covered:[[0,20]],surfaceLandings:[[110,120]]}};
  const cellSize=.37,heights=Array.from({length:326},(_,i)=>{
    const z=i*cellSize,h=z<90?2+Math.sin(z*.4)*1.5:2;
    return Array(25).fill(i===173?4:h);
  }).flat();
  const city={roads:[road],elevation:{width:25,height:326,cellSize,originX:-4.44,originZ:0,heights}},probe=wallProbe(city,road);
  try{
    for(const side of [-1,1]){
      let slope=Infinity,previous=probe.at(20.1,side).top;
      for(let s=20.35;s<109.9;s+=.25){
        const p=probe.at(s,side);assert.ok(Number.isFinite(p.top),'the wall cap is continuous');
        assert.ok(p.top>=p.ground+.799,'the entire cap guards the terrain rather than smoothing below it');
        const next=(p.top-previous)/.25;
        assert.ok(next<=slope+.001,'wall-top grades cannot repeatedly rise and fall');
        slope=next;previous=p.top;
      }
      const crest=probe.at(173*cellSize,side);assert.ok(crest.top>=4.799,'the exact grid crest is included between metre probes');
      assert.equal(probe.at(115,side).top,undefined,'the surface landing stays free of walls');
      assert.ok(Math.abs(probe.at(10,side).top-(-7+5.2+.45))<1e-5,'the covered shell retains its roof height');
    }
  }finally{probe.dispose();}
});

test('every shipped open tunnel wall stays above its endpoint grade and surrounding ground',async()=>{
  const city=await loadMetroCity({tiles:[]});let spans=0,samples=0;
  for(const road of city.roads.filter(r=>r.tunnel)){
    // Isolate the wall before merge subtraction; overlapping bores intentionally
    // remove its driving opening, which the tunnel collision tests cover.
    const probe=wallProbe({...city,roads:[road]},road),total=tunnelStations(road).at(-1);
    const cuts=[...new Set([0,total,...(road.tunnel.covered??[[0,total]]).flat(),...(road.tunnel.surfaceLandings??[]).flat()])].sort((a,b)=>a-b);
    try{
      for(let i=1;i<cuts.length;i++){
        const lo=cuts[i-1],hi=cuts[i],mid=(lo+hi)/2;
        if(hi-lo<1||tunnelCoveredAt(road,mid)||tunnelSurfaceLandingAt(road,mid))continue;
        for(const side of [-1,1]){
          spans++;const start=lo+.25,end=hi-.25,a=probe.at(start,side),b=probe.at(end,side);
          assert.ok(Number.isFinite(a.top)&&Number.isFinite(b.top),`${road.id}: both cap endpoints exist`);
          for(let s=start;s<end;s+=1){
            const p=probe.at(s,side),grade=a.top+(b.top-a.top)*(s-start)/(end-start);
            assert.ok(p.top>=grade-.035,`${road.id} side ${side} station ${s}: cap dips below its straight endpoint grade`);
            if(s>12&&total-s>12)assert.ok(p.top>=Math.max(p.floor,p.ground)+.77,`${road.id}: terrain and roadway remain guarded`);
            samples++;
          }
        }
      }
    }finally{probe.dispose();}
  }
  assert.ok(spans>=30&&samples>3000,`audited ${spans} open wall spans and ${samples} cap samples`);
});
