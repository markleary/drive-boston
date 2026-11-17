import './helpers/npc-fleet.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createStreetLife} from '../src/render/street-life.ts';
import {drawnStreets} from '../src/simulation/drawn-streets.ts';
import {pointInside} from '../src/simulation/roads.ts';
import {loadStreetCity} from './helpers/street-furniture.mjs';

test('grass-verge queries preserve path openings and clearance across tile borders',()=>{
  const box=(a,b,c,d)=>[[a,b],[c,b],[c,d],[a,d]];
  const streets=drawnStreets({tx:0,tz:0,size:1000,streetPavement:[],driveways:[],streetLawns:[[box(0,10,100,12),box(48,10.2,52,11.8)]]});
  assert.ok(streets.lawn(20,11,0));
  assert.ok(streets.lawn(-.2,11,.4),'a neighbouring tile sees the verge beside its border');
  assert.ok(!streets.lawn(20,9.5,.4),'clearance ends outside the grass');
  assert.ok(!streets.lawn(50,11,.4),'an opening stays available');
  assert.ok(streets.lawn(48.2,11,.4),'a walker also clears the edge of an opening');
  assert.ok(!streets.paved(20,11),'grass is not classified as roadway');
});

test('Back Street pedestrians stay off the grass strip along their entire routes',async()=>{
  const city=await loadStreetCity({tiles:['-2_-1','-1_-1','0_-1']});
  const loaded=new Map([...city.loadedTiles].map(([key,tile])=>[key,{tile}]));
  const lawns=[...loaded.values()].flatMap(({tile})=>tile.streetLawns??[]);
  const onGrass=p=>lawns.some(r=>pointInside(p,r[0])&&!r.slice(1).some(h=>pointInside(p,h)));
  assert.ok(onGrass([-649.6,-352]),'exercise the actual Storrow-side verge at Exeter');
  const life=createStreetLife(new THREE.Scene(),city,undefined,[],{tiles:{loaded}});
  try{
    const site={x:-600,z:-365};life.populateAt(site,site);
    const back=life.pedestrians.filter(p=>p.road==='Back Street'&&!p.route.waiting);
    assert.ok(back.length>0,'retain pedestrians on Back Street’s usable sidewalk');
    for(const p of life.pedestrians){
      if(p.route.waiting)continue;
      const {start,end,length}=p.route,steps=Math.ceil(length/.5);
      for(let i=0;i<=steps;i++){
        const at=[start[0]+(end[0]-start[0])*i/steps,start[1]+(end[1]-start[1])*i/steps];
        assert.ok(!onGrass(at),`${p.road} route crosses the grass at ${at}`);
      }
    }
  }finally{life.dispose();}
});
