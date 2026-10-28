import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RoadTileCoverage,roadMidpoint} from '../src/simulation/road-tile-coverage.ts';
import {tilesNear} from '../src/simulation/city-tiles.ts';

const city=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url)));
const coverage=new RoadTileCoverage(city,()=>city.roads);

test('mobile coverage includes both far owner tiles at the Perimeter Road junction',()=>{
  const x=5476.109,z=283.192;
  for(const radius of [180,450,700]){
    const wanted=new Set(coverage.tilesNear(x,z,radius).map(t=>t.key));
    assert.ok(wanted.has('6_-1'));assert.ok(wanted.has('4_-1'));
  }
  const local=new Set(tilesNear(city,x,z,450).map(t=>t.key));
  assert.ok(!local.has('6_-1'));assert.ok(!local.has('4_-1'),'fixture must exercise owners beyond the mobile radius');
  for(const id of ['16506-0-0','16503-0-1']){
    const road=city.roads.find(r=>r.id===id);assert.ok(road);
    const [x,z]=roadMidpoint(road);assert.ok(['6_-1','4_-1'].includes(`${Math.floor(x/1000)}_${Math.floor(z/1000)}`));
  }
});

test('road dependencies are local, deduplicated and released once the road leaves the unload window',()=>{
  const fake={tiles:{size:1000,keys:['0_0','1_0','2_0','3_0','4_0']},roads:[
    {id:'long',width:20,points:[[900,400],[3300,400]]},
    {id:'other',width:10,points:[[3000,900],[3900,900]]},
  ]};
  const index=new RoadTileCoverage(fake,()=>fake.roads);
  const nearby=index.tilesNear(950,400,180);
  assert.ok(nearby.some(t=>t.key==='2_0'&&t.distance===0));
  assert.equal(nearby.filter(t=>t.key==='2_0').length,1);
  assert.ok(!nearby.some(t=>t.key==='3_0'));
  assert.ok(!index.tilesNear(100,400,700).some(t=>t.key==='2_0'));
  assert.ok(index.tilesNear(950,587,180).some(t=>t.key==='2_0'),'pavement width reaches the query even if its centerline does not');
});
