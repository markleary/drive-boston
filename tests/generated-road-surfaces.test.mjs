import assert from 'node:assert/strict';
import test from 'node:test';
import {parkSurface} from '../src/render/area-surfaces.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {deckEdge} from '../src/simulation/road-surfaces.ts';
import {pointInside} from '../src/simulation/roads.ts';
import {loadMetroCity} from './helpers/metro-city.mjs';

const city=await loadMetroCity({tiles:['-1_-4','-1_-5','-2_0']});
const contains=(p,rings)=>pointInside(p,rings[0])&&!rings.slice(1).some(h=>pointInside(p,h));

test('compiled Sullivan Square and hillside pavement stays above every terrain triangle it covers',()=>{
 let triangles=0;
 for(const tile of city.loadedTiles.values())for(const [field,offset] of [['streetPavement',.045],['streetSidewalks',.012],['deckPavement',.03]]){
  assert.ok(tile[field],`${tile.key} has generated ${field}`);
  for(const rings of tile[field]){
   const geometry=parkSurface(city,rings,offset),p=geometry.attributes.position,n=geometry.attributes.normal;
   for(let i=0;i<p.count;i+=3){
    // The centroid catches triangles that bridge across a DEM crest even
    // when all three vertices individually touch the ground.
    let x=0,y=0,z=0;for(let j=0;j<3;j++){x+=p.getX(i+j)/3;y+=p.getY(i+j)/3;z+=p.getZ(i+j)/3;}
    assert.ok(Math.abs(y-sampleElevation(city,x,z)-offset)<.002,`${tile.key} ${field} crosses the terrain at ${x},${z}`);
    assert.ok(n.getY(i)>0,`${tile.key} ${field} has a backwards face`);triangles++;
   }
   geometry.dispose();
  }
 }
 assert.ok(triangles>10000,'exercise real compiled junctions, folds and terrain cells');
});

test('exposed Main Street deck edges are paved and the ground under the nearby viaduct is not',()=>{
 const tile=city.loadedTiles.get('-1_-5');
 const elevated=city.roads.find(r=>r.id==='osm-82332101-0');assert.ok(elevated?.elevations,'retain the actual raised road');
 // The reviewed bridge no longer dips into the old embankment probe. Check
 // its actual generated edges rather than requiring that obsolete ground fill.
 for(let i=0;i<elevated.points.length;i++)for(const side of [-1,1]){
  const p=deckEdge(elevated,i,side);
  if(sampleElevation(city,...p)>elevated.elevations[i]+.15)assert.ok(tile.deckPavement.some(r=>contains(p,r)),'any exposed edge has asphalt');
 }
 // The generator must not put a ground ribbon under an elevated span.
 const open=city.roads.flatMap(r=>r.elevations&&!r.tunnel?r.points.map((p,i)=>({p,y:r.elevations[i]})):[]).find(v=>v.p[0]>-900&&v.p[0]<-100&&v.p[1]>-4900&&v.p[1]<-4000&&v.y-sampleElevation(city,...v.p)>5);
 assert.ok(open);assert.ok(!tile.deckPavement.some(r=>contains(open.p,r)),'open ground below the viaduct stays unpaved');
});

test('all generated source links meet both parents with matching heights and full deck sections',()=>{
 const links=city.roads.filter(r=>r.sourceSeam);assert.ok(links.length>=4);
 for(const link of links)for(const [end,id] of [[0,link.sourceSeam.roads[0]],[link.points.length-1,link.sourceSeam.roads[1]]]){
  const parent=city.roads.find(r=>r.id===id),p=link.points[end],index=parent.points.findIndex(q=>q[0]===p[0]&&q[1]===p[1]);
  assert.ok(index===0||index===parent.points.length-1,`${link.id} connects exactly to ${id}`);
  if(!link.elevations)continue;
  assert.ok(Math.abs(link.elevations[end]-parent.elevations[index])<.0002,`${link.id} has no height step`);
  const edges=[-1,1].map(side=>deckEdge(parent,index,side));
  for(const side of [-1,1]){const edge=deckEdge(link,end,side);assert.ok(edges.some(q=>Math.hypot(q[0]-edge[0],q[1]-edge[1])<.0001),`${link.id} has no edge wedge`);}
 }
});
