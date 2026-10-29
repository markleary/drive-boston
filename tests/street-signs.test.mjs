import assert from 'node:assert/strict';import test from 'node:test';
import {planStreetSigns,BLADE_HEIGHTS} from '../src/simulation/street-signs.ts';
import {pointInside} from '../src/simulation/roads.ts';
import {loadCentralCity} from './helpers/metro-city.mjs';
const distance=(p,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);};
const city=await loadCentralCity(),ground=city.roads.filter(r=>!r.elevations);
const clear=(x,z)=>ground.every(r=>r.points.every((p,i)=>!i||distance([x,z],r.points[i-1],p)>=r.width/2+.8))&&!city.buildings.some(b=>pointInside([x,z],b.footprint));
const placed=planStreetSigns(city.roads,clear);
/** Directions of the named street's segments that meet a corner (a bend there has two). */
function streetDirections(name,corner){
  const dirs=[];
  for(const r of city.roads)if(r.name.replace(/\bStreet\b/,'ST').replace(/\bAvenue\b/,'AVE').toUpperCase()===name)for(let i=1;i<r.points.length;i++)if(distance(corner,r.points[i-1],r.points[i])<.5){const dx=r.points[i][0]-r.points[i-1][0],dz=r.points[i][1]-r.points[i-1][1],l=Math.hypot(dx,dz);if(l>.1)dirs.push([dx/l,dz/l]);}
  return dirs;
}
test('street signs stand at a sparse set of real corners, clear of lanes and buildings',()=>{
  const names=new Map();for(const r of city.roads)for(const p of r.points){const k=`${Math.round(p[0]*2)},${Math.round(p[1]*2)}`,s=names.get(k)??new Set();s.add(r.name);names.set(k,s);}
  const intersections=[...names.values()].filter(s=>s.size>1).length;
  assert.ok(placed.length>150,`signs remain common enough to navigate by (${placed.length})`);
  assert.ok(placed.length<intersections*.3,`most corners carry no sign (${placed.length} of ${intersections})`);
  for(const s of placed){assert.ok(clear(...s.position),`pole clear at ${s.position}`);assert.ok(Math.hypot(s.position[0]-s.corner[0],s.position[1]-s.corner[1])<25,'pole stands at its corner');}
});
test('each blade runs parallel to the street it names, the side street above the main street',()=>{
  const stacked=placed.filter(s=>s.blades.length===2);
  assert.ok(stacked.length>20&&stacked.length<placed.length*.7,`some, not all, corners also name the side street (${stacked.length}/${placed.length})`);
  for(const s of placed){
    assert.equal(s.blades[0].height,BLADE_HEIGHTS[0]);if(s.blades[1]){assert.equal(s.blades[1].height,BLADE_HEIGHTS[1]);assert.notEqual(s.blades[1].name,s.blades[0].name);}
    for(const blade of s.blades){
      const dirs=streetDirections(blade.name,s.corner);assert.ok(dirs.length,`${blade.name} meets its corner`);
      // The blade's face normal is (sin yaw, cos yaw); parallel to the street means that normal is across it.
      const along=Math.min(...dirs.map(dir=>Math.abs(Math.sin(blade.yaw)*dir[0]+Math.cos(blade.yaw)*dir[1])));
      assert.ok(along<.05,`${blade.name} blade faces across its street (|cos| ${along.toFixed(3)})`);
    }
  }
});
test('tiles choose the same corners as a whole-city build',()=>{
  const size=1000,key=p=>`${p.position[0].toFixed(3)},${p.position[1].toFixed(3)}|${p.blades.map(b=>b.name).join('/')}`;
  const tiled=[],tiles=new Set(placed.map(s=>`${Math.floor(s.corner[0]/size)},${Math.floor(s.corner[1]/size)}`));
  for(const t of tiles){
    const [tx,tz]=t.split(',').map(Number),x0=tx*size,z0=tz*size,m=160;
    const near=city.roads.filter(r=>r.points.some(p=>p[0]>=x0-m&&p[0]<x0+size+m&&p[1]>=z0-m&&p[1]<z0+size+m));
    tiled.push(...planStreetSigns(near,clear,(x,z)=>x>=x0&&x<x0+size&&z>=z0&&z<z0+size));
  }
  assert.deepEqual(tiled.map(key).sort(),placed.map(key).sort());
});
