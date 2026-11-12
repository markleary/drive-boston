import assert from 'node:assert/strict';
import test from 'node:test';
import {canopyHitsDeck,STREET_CANOPY,PARK_CANOPY} from '../src/simulation/deck-canopy.ts';
import {readJson} from './helpers/metro-city.mjs';
import {crownExtent,TREE_SCALE_RANGE} from '../src/render/foliage.ts';

const viaduct={id:'viaduct',name:'Viaduct',width:10,oneway:1,points:[[0,-100],[0,100]],elevations:[7,7]};
const street={id:'street',name:'Street',width:10,oneway:0,points:[[50,-100],[50,100]],elevations:[0,0]};
const high={id:'high',name:'High bridge',width:10,oneway:0,points:[[100,-100],[100,100]],elevations:[40,40]};
const bore={id:'bore',name:'Bore',width:10,oneway:1,points:[[-50,-100],[-50,0],[-50,100]],elevations:[0,6,6],tunnel:{clearance:5.2,covered:[[0,100]]}};
const city={roads:[viaduct,street,high,bore]};

test('a tree whose crown would reach a raised deck is refused; trees beside at-grade streets and under tall bridges are not',()=>{
  assert.equal(canopyHitsDeck(city,5+2,0,0,STREET_CANOPY),true,'a street tree 2 m off a 7 m viaduct grows through it');
  assert.equal(canopyHitsDeck(city,5+8,0,0,STREET_CANOPY),false,'a street tree clears the viaduct beyond its crown reach');
  assert.equal(canopyHitsDeck(city,5+8,0,0,PARK_CANOPY),true,'a wider park crown at the same spot still reaches it');
  assert.equal(canopyHitsDeck(city,50+5+2,0,0,STREET_CANOPY),false,'a verge tree beside an at-grade street is kept');
  assert.equal(canopyHitsDeck(city,50+4,0,0,STREET_CANOPY),true,'a tree on at-grade pavement is not');
  assert.equal(canopyHitsDeck(city,100,0,0,STREET_CANOPY),false,'a street tree under a 40 m bridge stays below the deck');
  assert.equal(canopyHitsDeck(city,-50,-50,0,STREET_CANOPY),false,'a covered bore never blocks the surface above it');
  assert.equal(canopyHitsDeck(city,-50+7,50,0,STREET_CANOPY),true,'its open ramp at 6 m does');
});

test('a footbridge the city lists keeps trees out of its deck, its ramps and its steps',()=>{
  // A ramp from the ground at x=0 to 3.4 m at x=40, then a level span: no road record, only the city's list of footbridge decks.
  const deck={id:'test',width:2.4,points:[[0,0],[10,0],[20,0],[30,0],[40,0],[70,0]],elevations:[.05,.9,1.75,2.6,3.45,3.45]},bare={roads:[]},listed={roads:bare.roads,footbridges:[deck]};
  assert.equal(canopyHitsDeck(bare,55,0,0,STREET_CANOPY),false,'without the list nothing stands there');
  assert.equal(canopyHitsDeck(listed,55,0,0,STREET_CANOPY),true,'a tree in the span grows through it');
  assert.equal(canopyHitsDeck(listed,55,1.2+7,0,STREET_CANOPY),true,'and one whose crown reaches the rail');
  assert.equal(canopyHitsDeck(listed,55,1.2+7.7,0,STREET_CANOPY),false,'a street tree clears the deck beyond its crown reach');
  assert.equal(canopyHitsDeck(listed,55,1.2+7.7,0,PARK_CANOPY),true,'a wider park crown there still reaches it');
  assert.equal(canopyHitsDeck(listed,5,0,0,STREET_CANOPY),true,'none in the foot of the ramp');
  assert.equal(canopyHitsDeck(listed,5,1.2+1,0,STREET_CANOPY),false,'but one may stand beside it where the ramp is still at the ground');
  assert.equal(canopyHitsDeck({roads:bare.roads,footbridges:[]},55,0,0,STREET_CANOPY),false,'the index follows the list it was built for');
  // The installed bridges: the street tree that stood in the Silber Way ramp beside Back Street, and every raised station of every deck.
  const decks=readJson('city.json').footbridges,c={roads:[],footbridges:decks};assert.equal(decks.length,6);
  assert.equal(canopyHitsDeck(c,-2112,-67.5,-1.2,STREET_CANOPY),true,'the Silber Way ramp');
  for(const d of decks)d.points.forEach(([x,z],i)=>{if(i%5===0)assert.equal(canopyHitsDeck(c,x,z,Math.min(...d.elevations)-.05,PARK_CANOPY),true,`${d.id} station ${i}`);});
});

test('nothing is planted under the I-93 North entrance from Cross / Sudbury Street where it climbs to the Zakim',()=>{
  const ramp=readJson('central-artery.json').roads.find(r=>r.id==='central-artery-cross-street-north-on');
  const c={roads:[ramp]};
  // The reported spot: the ramp is 6 to 10 m over the West End street level here.
  for(const [x,z] of [[1240,-1761],[1226,-1772],[1216,-1786]])for(const side of [-6,0,6])assert.equal(canopyHitsDeck(c,x+side,z,.3,STREET_CANOPY),true,`${x+side},${z}`);
});

test('canopy bounds cover the drawn tree geometry at every distance level and the largest instance scale',()=>{
  const scale=TREE_SCALE_RANGE[1];
  for(const [canopy,park,fieldScale] of [[STREET_CANOPY,false,1],[PARK_CANOPY,true,1.65]]){
    const extent=crownExtent(park);
    assert.ok(canopy.reach>=extent.reach*fieldScale*scale,`reach ${canopy.reach} covers ${(extent.reach*fieldScale*scale).toFixed(2)}`);
    assert.ok(canopy.top>=extent.top*fieldScale*scale,`top ${canopy.top} covers ${(extent.top*fieldScale*scale).toFixed(2)}`);
  }
});
