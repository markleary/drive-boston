import assert from 'node:assert/strict';
import test from 'node:test';
import {addBuildingPlan,buildingPlans,removeBuildingPlans} from '../src/simulation/building-plans.ts';
import {ownFarHulls,pointInPolygon} from '../src/simulation/city-tiles.ts';
import {loadMetroCity} from './helpers/metro-city.mjs';

const inOutline=(t,x,z)=>{
  for(let i=0;i<t.length;i+=6){
    const s=(ax,az,bx,bz)=>(bx-ax)*(z-az)-(bz-az)*(x-ax);
    if(s(t[i],t[i+1],t[i+2],t[i+3])>=0&&s(t[i+2],t[i+3],t[i+4],t[i+5])>=0&&s(t[i+4],t[i+5],t[i],t[i+1])>=0)return true;
  }
  return false;
};

test('the map outlines the Prudential complex by its shell, not by a hull across Huntington Avenue',async()=>{
  const city=await loadMetroCity({tiles:['-1_0']});
  const prudential=city.buildings.find(b=>b.name==='Prudential Redevelopment (Parcel 4 and 6)');
  // Its index hull is hidden, followed by the terraced massing fragments of the complex.
  const hulls=ownFarHulls(city,prudential);
  assert.ok(hulls[0].hidden&&!hulls[0].fragment);
  assert.ok(hulls.length>10&&hulls.slice(1).every(h=>h.fragment),`${hulls.length} hulls`);
  addBuildingPlan(city,prudential,city.geometry.get(prudential.id));
  const [plan]=[...buildingPlans(city)];
  assert.deepEqual(plan.hulls,hulls.map(h=>h.n));
  const t=plan.triangles;
  for(let i=0;i<t.length;i+=6)assert.ok((t[i+2]-t[i])*(t[i+5]-t[i+1])-(t[i+3]-t[i+1])*(t[i+4]-t[i])>0,'every triangle wound the same way');
  // The street vertices inside the convex hull stay clear of the outline, and the tower is inside it.
  const streets=city.roads.filter(r=>r.name==='Huntington Avenue'||r.name==='Belvidere Street').flatMap(r=>r.points).filter(([x,z])=>pointInPolygon(x,z,prudential.footprint));
  assert.ok(streets.length>=4,`${streets.length} street vertices inside the hull`);
  assert.deepEqual(streets.filter(([x,z])=>inOutline(t,x,z)),[]);
  assert.ok(inOutline(t,-641,317),'the Prudential Tower');
  removeBuildingPlans(city,[prudential]);
  assert.equal([...buildingPlans(city)].length,0);
});
