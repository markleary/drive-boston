import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMetroCity } from './helpers/metro-city.mjs';
import { pointInside } from '../src/simulation/roads.ts';
import { waterHeight } from '../src/simulation/water-level.ts';
import detail from '../src/data/fellsmere.json' with {type:'json'};
import { addFellsmerePark, fellsmereUpperTerrace } from '../src/render/fellsmere-park.ts';
import { WATER_SURFACE_OFFSET } from '../src/render/area-surfaces.ts';

test('Fellsmere pond spans two streamed tiles with one fountain per lobe and solid terraces', async () => {
  const city=await loadMetroCity({tiles:['-2_-9','-1_-9']});
  const pond=city.water.find(w=>w.name==='Fellsmere Pond'), level=waterHeight(city,pond)+WATER_SURFACE_OFFSET;
  const fountains=[];
  let lookoutMesh;
  for(const minX of [-2000,-1000]){
    const site=addFellsmerePark(city,pond,{bounds:{minX,maxX:minX+1000,minZ:-9000,maxZ:-8000},
      onRock(vertices,indices){assert.ok(indices.length);if(minX===-1000)lookoutMesh=vertices;}});
    for(const group of site.children.filter(g=>g.name==='Fellsmere Pond fountain')){
      const {x,y,z}=group.position;
      assert.ok(x>=minX&&x<minX+1000);
      assert.ok(pointInside([x,z],pond.rings[0]));
      assert.equal(y,level);
      fountains.push([x,z]);
    }
  }
  assert.equal(fountains.length,2);
  assert.ok(Math.abs(fountains[0][1]-fountains[1][1])>200);
  // Downward probes through each paved deck must meet an upward-facing
  // solid triangle. The path below Quarry Hill stays open between levels.
  function topAt(x,z){
    let top=-Infinity;
    for(let i=0;i<lookoutMesh.length;i+=9){
      const [a,y,b,c,v,d,e,w,f]=lookoutMesh.subarray(i,i+9);
      const det=(c-a)*(f-b)-(e-a)*(d-b);
      if(det>=-1e-6)continue;
      const u=((x-a)*(f-b)-(e-a)*(z-b))/det,t=((c-a)*(z-b)-(x-a)*(d-b))/det;
      if(u>=0&&t>=0&&u+t<=1)top=Math.max(top,y+u*(v-y)+t*(w-y));
    }
    return top;
  }
  assert.ok(topAt(-848,-8769)>level+7);
  assert.ok(topAt(-856.6,-8755.8)>level+.5);
  assert.equal(topAt(-851.1,-8756.3),-Infinity);
});

test('Fellsmere turf ends at the sidewalks, path junctions and terrace approaches', async () => {
  const city = await loadMetroCity({tiles:['-2_-9','-1_-9']});
  const covers = (faces, point) => faces.some(([outer, ...holes]) =>
    pointInside(point, outer) && !holes.some(ring => pointInside(point, ring)));
  const lawns = Object.values(detail.lawns).flat();
  const walks = [...detail.walks.asphalt, ...detail.walks.paving];
  const terraces = [...fellsmereUpperTerrace, [detail.lowerApron]];
  const sidewalks = [...city.loadedTiles.values()].flatMap(tile => tile.streetSidewalks);
  const streets = [...city.loadedTiles.values()].flatMap(tile => tile.streetPavement);

  // Both curbs of the Fellsway median and both tile owners of the pond grounds.
  for (const p of [[-862.16,-8586], [-798.16,-8586], [-847.15,-8550],
    [-1022.53,-8586], [-759.01,-8700], [-968.11,-8760]]) {
    assert.ok(covers(sidewalks, p), `Expected concrete at ${p}`);
    assert.equal(covers(lawns, p), false, `Turf on sidewalk at ${p}`);
  }
  for (const p of [[-832.23,-8585.32], [-853.13,-8889.07]]) assert.ok(covers(lawns, p));

  const ids = new Set(detail.walks.ids);
  const paths = city.parkPaths.filter(p => ids.has(p.id));
  assert.equal(paths.length, ids.size);
  for (const path of paths) {
    for (let i=1; i<path.points.length; i++) {
      const [x,z] = path.points[i-1], [endX,endZ] = path.points[i];
      const dx=endX-x, dz=endZ-z, length=Math.hypot(dx,dz);
      for (let along=.05; along<length; along+=2) {
        for (const offset of [-.42,0,.42]) {
          const side=path.width*offset;
          const p=[x+(along*dx-side*dz)/length, z+(along*dz+side*dx)/length];
          assert.equal(covers(lawns,p),false,`Turf on ${path.id} at ${p}`);
          assert.ok(covers(walks,p)||covers(terraces,p)||covers(sidewalks,p)||covers(streets,p),
            `Gap in ${path.id} at ${p}`);
        }
      }
    }
  }
});
