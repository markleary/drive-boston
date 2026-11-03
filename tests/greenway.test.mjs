import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {greenway,inGreenway,insideGreenwayRings,obsoleteGreenwayCurb,outsideGreenwayPath,replacesGreenwayPark} from '../src/simulation/greenway.ts';
import {parseTile,pavementEdges} from '../src/simulation/tile-format.ts';
import {parkSurface} from '../src/render/area-surfaces.ts';

const tile=key=>{const bytes=gunzipSync(readFileSync(new URL(`../public/data/tiles/t_${key}.bin`,import.meta.url)));return parseTile(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));};

test('the screenshot ramp loses its interior curb traces while live street edges stay intact',()=>{
  const north=tile('1_-2');let removed=0;
  for(const line of north.curbs)for(let i=1;i<line.length;i++){
    const a=line[i-1],b=line[i],x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
    if(x>1330&&x<1460&&z>-1600&&z<-1420&&obsoleteGreenwayCurb(x,z))removed+=Math.hypot(a[0]-b[0],a[1]-b[1]);
  }
  assert.ok(removed>800,`${removed.toFixed(1)} m of flattened interior curb traces removed`);
  for(const key of ['1_-2','1_-1']){const t=tile(key);for(const p of t.pavements){const edges=pavementEdges(t,p);for(const point of [...edges.left,...edges.right])assert.equal(obsoleteGreenwayCurb(...point),false,`live curb-to-curb pavement ${p.road} at ${point}`);}}
  assert.equal(obsoleteGreenwayCurb(0,0),false);
});

test('the corridor has distinct landscapes from North Meadow to Chinatown and leaves other parks alone',()=>{
  for(const name of ['North Meadow','North End Parks','Armenian Heritage Park','Wharf District Parks','Urban Arboretum','Fort Point Channel Parks','Dewey Square','Chinatown and Mary Soo Hoo Parks'])assert.ok(greenway.parcels.some(p=>p.name===name),name);
  assert.ok(greenway.surfaces.some(p=>p.kind==='boardwalk'));
  assert.ok(greenway.surfaces.filter(p=>p.kind==='garden').length>20);
  assert.equal(replacesGreenwayPark({id:'park-315-0-0'}),true);
  assert.equal(replacesGreenwayPark({id:'park-75-0-0'}),false,'East Boston Greenway is unrelated');
  assert.equal(replacesGreenwayPark({id:'park-454-0-0'}),false,'Christopher Columbus Park stays independent');
});

test('North End lawns replace the underlying plaza without overlapping paving sheets',()=>{
  for(const point of [[1480.896,-1390.979],[1487.169,-1384.999],[1493.269,-1379.381]]){
    assert.ok(greenway.surfaces.some(a=>a.kind==='lawn'&&insideGreenwayRings(point,a.rings)));
    assert.equal(greenway.bases.some(a=>insideGreenwayRings(point,a.rings)),false,'no buried plaza at street-view seam');
  }
});

test('Cross Street frontage restores brick beside the Salem Street curb without covering the main roadway',()=>{
  const brick=p=>greenway.frontages.some(a=>insideGreenwayRings(p,a.rings));
  assert.equal(greenway.frontages.length,2,'both brick frontage blocks from the sidewalk inventory');
  for(const p of [[1508.15,-1435.88],[1502.69,-1440.11],[1496.61,-1444.76]])assert.ok(brick(p),'asphalt overlay is replaced by brick beside the reported curb');
  for(const p of [[1497.608,-1435.007],[1511.258,-1423.748],[1560.154,-1389.565]])assert.equal(brick(p),false,'through roadway and Salem intersection stay asphalt');
  assert.equal(obsoleteGreenwayCurb(1514.977,-1433.383),false,'the real plaza curb is retained');
});

test('replacing a park path preserves both exterior ends and the walking surface is continuous across a tile seam',()=>{
  const points=[[1300,-1642],[1345,-1642]],pieces=outsideGreenwayPath(points);
  assert.ok(pieces.length>=2);assert.deepEqual(pieces[0][0],points[0]);assert.deepEqual(pieces.at(-1).at(-1),points.at(-1));
  for(const line of pieces)for(let i=1;i<line.length;i++)assert.equal(inGreenway((line[i-1][0]+line[i][0])/2,(line[i-1][1]+line[i][1])/2),false);
  assert.deepEqual(outsideGreenwayPath([[0,0],[10,10]]),[[[0,0],[10,10]]]);
  const city={roads:[],bounds:{minX:1800,maxX:2000,minZ:-1100,maxZ:-900}},crossing=greenway.parcels.find(p=>p.rings[0].some(v=>v[1]<-1000)&&p.rings[0].some(v=>v[1]>-1000));
  assert.ok(crossing);
  const full=parkSurface(city,crossing.rings),a=parkSurface(city,crossing.rings,.024,undefined,{minX:1000,maxX:2000,minZ:-2000,maxZ:-1000}),b=parkSurface(city,crossing.rings,.024,undefined,{minX:1000,maxX:2000,minZ:-1000,maxZ:0});
  const area=g=>{const p=g.attributes.position;let sum=0;for(let i=0;i<p.count;i+=3){const cross=(p.getX(i+1)-p.getX(i))*(p.getZ(i+2)-p.getZ(i))-(p.getZ(i+1)-p.getZ(i))*(p.getX(i+2)-p.getX(i));assert.ok(cross<0,'upward, non-degenerate triangles');sum-=cross/2;}return sum;};
  assert.ok(Math.abs(area(full)-area(a)-area(b))<.03,'no gap or overlap at z=-1000');for(const g of [full,a,b])g.dispose();
});
