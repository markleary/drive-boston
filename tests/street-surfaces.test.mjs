import assert from 'node:assert/strict';
import test from 'node:test';
import {TriangleWriter} from '../src/render/geometry-writer.ts';
import {drapedStripInto,drapedRibbonInto} from '../src/render/terrain-ground.ts';
import {pavementEdges,pavementSpan} from '../src/simulation/tile-format.ts';
import {pointInside} from '../src/simulation/roads.ts';
import {roadMidpoint} from '../src/simulation/road-tile-coverage.ts';
import {hasMetroData,loadMetroCity} from './helpers/metro-city.mjs';

const flat={bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100},elevation:{width:3,height:3,cellSize:100,originX:-100,originZ:-100,heights:[2,2,2,2,2,2,2,2,2]},roads:[],tunnels:[]};

test('pavement edges decode from tile-origin centimetres',()=>{
  const {left,right}=pavementEdges({tx:2,tz:-1,size:1000},{road:'r',edges:[150,25,-120,75,1000,0,900,0,7]});
  assert.deepEqual(left,[[2001.5,-999.75],[2010,-1000]]);assert.deepEqual(right,[[1998.8,-999.25],[2009,-1000]]);
});

test('a crosswalk spans the pavement edges at its own station, wherever the centerline sits between them',()=>{
  const edges={left:[[0,5],[20,5],[40,9]],right:[[0,-5],[20,-5],[40,-9]]};
  assert.deepEqual(pavementSpan(edges,[10,0],1,0),[-5,5]);assert.deepEqual(pavementSpan(edges,[30,0],1,0),[-7,7]);
  assert.deepEqual(pavementSpan(edges,[30,0],-1,0),[-7,7],'the same span seen from the far end');
  assert.equal(pavementSpan(edges,[45,0],1,0),undefined,'no span beyond the recorded edges');
  const offset={left:[[0,8],[40,8]],right:[[0,-2],[40,-2]]};
  assert.deepEqual(pavementSpan(offset,[20,0],1,0),[-2,8]);assert.deepEqual(pavementSpan(offset,[20,0],-1,0),[-8,2],'offsets flip with the direction, lower first');
});

test('Boylston Street\'s crosswalks follow the curbs where the roadway narrows and shifts off the centerline',{skip:!hasMetroData()},async()=>{
  const city=await loadMetroCity({bounds:{minX:0,maxX:1000,minZ:-1000,maxZ:0}}),road=city.roads.find(r=>r.id==='17569-0-0');
  assert.ok(road&&road.pavedWidth>20,'the whole segment measures over 20 m');
  const tile=city.loadedTiles.get('0_-1'),record=tile.pavements.find(p=>p.road===road.id);assert.ok(record,'tile 0_-1 owns the record');
  const edges=pavementEdges(tile,record),span=(a,b)=>{const len=Math.hypot(b[0]-a[0],b[1]-a[1]),tx=(b[0]-a[0])/len,tz=(b[1]-a[1])/len;return pavementSpan(edges,[a[0]+tx*8,a[1]+tz*8],tx,tz);};
  const west=span(road.points[0],road.points[1]),east=span(road.points.at(-1),road.points.at(-2));
  assert.ok(west&&Math.abs(west[1]-west[0]-14)<.5,`the west crossing spans the 14 m roadway there (${west})`);
  assert.ok(east&&east[1]-east[0]>19&&Math.abs(east[0]+east[1])>10,`the east crossing spans a 20 m roadway shifted off the centerline (${east})`);
});

test('a strip between measured edges covers the quads a ribbon would, following each edge',()=>{
  const sink=new TriangleWriter();
  drapedStripInto(sink,flat,[[0,5],[20,5],[40,9]],[[0,-5],[20,-5],[40,-9]],.045);
  const p=sink.position,n=sink.count;assert.ok(n>=12&&n%3===0);
  let area=0,maxZ=0;
  for(let i=0;i<n;i+=3){const ax=p[i*3],az=p[i*3+2],bx=p[i*3+3],bz=p[i*3+5],cx=p[i*3+6],cz=p[i*3+8];area+=Math.abs((bx-ax)*(cz-az)-(bz-az)*(cx-ax))/2;}
  for(let k=0;k<n;k++){assert.ok(Math.abs(p[k*3+1]-2.045)<1e-6,'draped onto the ground plus the offset');maxZ=Math.max(maxZ,Math.abs(p[k*3+2]));}
  assert.ok(Math.abs(area-(200+20*14))<1e-3,'a 10 m parallel section then a flare to 18 m');assert.ok(Math.abs(maxZ-9)<1e-9,'the far end reaches the measured 9 m edge');
  const ribbon=new TriangleWriter();drapedRibbonInto(ribbon,flat,[[0,0],[20,0]],10,.045);
  const strip=new TriangleWriter();drapedStripInto(strip,flat,[[0,5],[20,5]],[[0,-5],[20,-5]],.045);
  assert.equal(strip.count,ribbon.count,'same subdivision as the constant-width ribbon');
  for(let k=0;k<strip.count;k++)assert.ok(strip.normal[k*3+1]>.99,'strip triangles wind upward like the ribbon (left is the +normal side)');
  for(let k=0;k<strip.count;k++)for(let c=0;c<3;c++)assert.ok(Math.abs(strip.position[k*3+c]-ribbon.position[k*3+c])<1e-9,'vertex for vertex the ribbon');
});

test('the shipped package carries curb-bounded roadways, inventory sidewalks, islands and driveways',{skip:!hasMetroData()},async()=>{
  const city=await loadMetroCity({bounds:{minX:-2500,maxX:-1500,minZ:600,maxZ:1500}}),roadsById=new Map();
  for(const road of city.roads)roadsById.set(road.id,[...roadsById.get(road.id)??[],road]);
  let records=0,sidewalks=0,bricks=0,islands=0,driveways=0,mfa=false;
  for(const [key,tile] of city.loadedTiles){
    const x0=tile.tx*tile.size,z0=tile.tz*tile.size,inside=([x,z])=>x>=x0&&x<x0+tile.size&&z>=z0&&z<z0+tile.size;
    const owned=city.roads.filter(r=>!r.elevations&&!r.tunnel&&inside(roadMidpoint(r)));
    assert.equal(tile.pavements.length,owned.length,`${key}: one record per owned surface road`);
    for(const record of tile.pavements){
      const candidates=roadsById.get(record.road);assert.ok(candidates?.length,`${key}: ${record.road} exists`);
      const {left,right}=pavementEdges(tile,record);assert.ok(left.length>=2&&left.length===right.length);
      const road=candidates.reduce((best,r)=>Math.hypot((left[0][0]+right[0][0])/2-r.points[0][0],(left[0][1]+right[0][1])/2-r.points[0][1])<Math.hypot((left[0][0]+right[0][0])/2-best.points[0][0],(left[0][1]+right[0][1])/2-best.points[0][1])?r:best);
      const first=road.points[0],last=road.points.at(-1);
      assert.ok(Math.hypot((left[0][0]+right[0][0])/2-first[0],(left[0][1]+right[0][1])/2-first[1])<road.width,`${key}: ${road.name} record starts at the road`);
      assert.ok(Math.hypot((left.at(-1)[0]+right.at(-1)[0])/2-last[0],(left.at(-1)[1]+right.at(-1)[1])/2-last[1])<road.width,`${key}: ${road.name} record ends at the road`);
      for(let i=0;i<left.length;i++){const w=Math.hypot(left[i][0]-right[i][0],left[i][1]-right[i][1]);assert.ok(w>=2.3&&w<=60,`${key}: ${road.name} roadway ${w.toFixed(1)} m wide`);}
      if(record.walk)assert.ok(record.walk.every(v=>v===0||v===1));
      records++;
    }
    for(const walk of tile.sidewalks){assert.ok(walk.rings[0].length>=3&&walk.rings[0].every(p=>inside(p)||true));if(walk.material==='brick')bricks++;sidewalks++;}
    for(const rings of tile.islands){
      assert.ok(rings[0].length>=3);islands++;
      const cx=rings[0].reduce((s,p)=>s+p[0],0)/rings[0].length,cz=rings[0].reduce((s,p)=>s+p[1],0)/rings[0].length;
      for(const road of city.roads)for(const p of road.points)if(Math.hypot(p[0]-cx,p[1]-cz)<30)assert.ok(!pointInside(p,rings[0]),`${key}: island holds no street vertex of ${road.name}`);
    }
    for(const rings of tile.driveways){
      assert.ok(rings[0].length>=3);driveways++;
      // The driveway loop at the MFA's Fenway entrance: curbed, inside the park polygon, an OSM service way but no centerline.
      if(pointInside([-1657,1117],rings[0]))mfa=true;
      // Parts are clipped to their tile; a service way that duplicates a mapped street may overlap it (it hides under the roadway asphalt).
      for(const p of rings[0])assert.ok(p[0]>=x0-.01&&p[0]<=x0+tile.size+.01&&p[1]>=z0-.01&&p[1]<=z0+tile.size+.01,`${key}: driveway part stays inside its tile`);
    }
  }
  assert.ok(records>500&&sidewalks>500&&bricks>0&&islands>5&&driveways>5,`Fenway window: ${records} roadways, ${sidewalks} sidewalks (${bricks} brick), ${islands} islands, ${driveways} driveways`);
  assert.ok(mfa,'the MFA Fenway pull-off is paved');
  const ratios=city.roads.filter(r=>r.name==='Riverway'&&r.pavedWidth).map(r=>r.pavedWidth/r.width).sort((a,b)=>a-b);
  assert.ok(ratios.length>10&&ratios[ratios.length>>1]>1.3,'the Riverway parkway is much wider than its class guess');
  assert.ok(city.roads.filter(r=>r.pavedWidth).length>city.roads.length*.7,'most surface roads were measured on both sides');
});
