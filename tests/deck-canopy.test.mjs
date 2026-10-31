import assert from 'node:assert/strict';
import test from 'node:test';
import {canopyHitsDeck,STREET_CANOPY,PARK_CANOPY} from '../src/simulation/deck-canopy.ts';
import {readJson} from './helpers/metro-city.mjs';

const viaduct={id:'viaduct',name:'Viaduct',width:10,oneway:1,points:[[0,-100],[0,100]],elevations:[7,7]};
const street={id:'street',name:'Street',width:10,oneway:0,points:[[50,-100],[50,100]],elevations:[0,0]};
const high={id:'high',name:'High bridge',width:10,oneway:0,points:[[100,-100],[100,100]],elevations:[40,40]};
const bore={id:'bore',name:'Bore',width:10,oneway:1,points:[[-50,-100],[-50,0],[-50,100]],elevations:[0,6,6],tunnel:{clearance:5.2,covered:[[0,100]]}};
const city={roads:[viaduct,street,high,bore]};

test('a tree whose crown would reach a raised deck is refused; trees beside at-grade streets and under tall bridges are not',()=>{
  assert.equal(canopyHitsDeck(city,5+2,0,0,STREET_CANOPY),true,'a street tree 2 m off a 7 m viaduct grows through it');
  assert.equal(canopyHitsDeck(city,5+5,0,0,STREET_CANOPY),false,'a street tree clears the viaduct beyond its crown reach');
  assert.equal(canopyHitsDeck(city,5+5,0,0,PARK_CANOPY),true,'a wider park crown at the same spot still reaches it');
  assert.equal(canopyHitsDeck(city,50+5+2,0,0,STREET_CANOPY),false,'a verge tree beside an at-grade street is kept');
  assert.equal(canopyHitsDeck(city,50+4,0,0,STREET_CANOPY),true,'a tree on at-grade pavement is not');
  assert.equal(canopyHitsDeck(city,100,0,0,STREET_CANOPY),false,'a street tree under a 40 m bridge stays below the deck');
  assert.equal(canopyHitsDeck(city,-50,-50,0,STREET_CANOPY),false,'a covered bore never blocks the surface above it');
  assert.equal(canopyHitsDeck(city,-50+7,50,0,STREET_CANOPY),true,'its open ramp at 6 m does');
});

test('nothing is planted under the I-93 North entrance from Cross / Sudbury Street where it climbs to the Zakim',()=>{
  const ramp=readJson('central-artery.json').roads.find(r=>r.id==='central-artery-cross-street-north-on');
  const c={roads:[ramp]};
  // The reported spot: the ramp is 6 to 10 m over the West End street level here.
  for(const [x,z] of [[1240,-1761],[1226,-1772],[1216,-1786]])for(const side of [-6,0,6])assert.equal(canopyHitsDeck(c,x+side,z,.3,STREET_CANOPY),true,`${x+side},${z}`);
});
