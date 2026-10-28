import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {closestRoad} from '../src/simulation/roads.ts';

test('spatial road lookup returns the exact nearest drivable segment across the expanded city',()=>{
  const city=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url),'utf8'));
  for(let i=0;i<180;i++)for(const majorOnly of [false,true]){
    const x=city.bounds.minX-200+(city.bounds.maxX-city.bounds.minX+400)*((i*.61803398875)%1),z=city.bounds.minZ-200+(city.bounds.maxZ-city.bounds.minZ+400)*((i*.41421356237)%1);
    let distance=Infinity;
    for(const road of city.roads){
      if(majorOnly&&(road.width<7||/alley|public|unnamed/i.test(road.name)))continue;
      for(let k=1;k<road.points.length;k++){
        const a=road.points[k-1],b=road.points[k],dx=b[0]-a[0],dz=b[1]-a[1],len2=dx*dx+dz*dz;if(len2<1)continue;
        const t=Math.max(.05,Math.min(.95,((x-a[0])*dx+(z-a[1])*dz)/len2));distance=Math.min(distance,Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz));
      }
    }
    assert.ok(Math.abs(closestRoad(city,x,z,majorOnly).distance-distance)<1e-8,`incorrect nearest road at ${x},${z}`);
  }
});
