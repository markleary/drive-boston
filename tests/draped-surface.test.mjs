import assert from 'node:assert/strict';
import test from 'node:test';
import {DrapedSurface,drapedSurface,surfaceNormal} from '../src/render/draped-surface.ts';
import {parkSurface} from '../src/render/area-surfaces.ts';
import {sampleElevation,terrainVertexNormal} from '../src/simulation/terrain.ts';
import {inTunnelPortal} from '../src/simulation/tunnels.ts';
import {drain} from '../src/render/pacing.ts';
import {seeded} from '../src/render/materials.ts';
import {loadMetroCity} from './helpers/metro-city.mjs';

const hills=(width,height,slope=(i,j)=>Math.sin(i*.7)*1.5+Math.cos(j*.45)*2+i*.2,originX=0,originZ=0)=>({bounds:{minX:originX,maxX:originX+(width-1)*6,minZ:originZ,maxZ:originZ+(height-1)*6},roads:[],elevation:{width,height,cellSize:6,originX,originZ,heights:Float32Array.from({length:width*height},(_,n)=>slope(n%width,Math.floor(n/width)))}});
const ringArea=ring=>Math.abs(ring.reduce((sum,[x,z],i)=>{const [nx,nz]=ring[(i+1)%ring.length];return sum+x*nz-z*nx;},0))/2;
const polygonArea=rings=>ringArea(rings[0])-rings.slice(1).reduce((n,r)=>n+ringArea(r),0);
/** Triangles as index triples, their summed plan area, and a check that each faces up. */
function triangles(geometry){
  const p=geometry.attributes.position,ix=geometry.index;assert.ok(ix,'draped surfaces are indexed');
  const list=[];let area=0;
  for(let t=0;t<ix.count;t+=3){
    const a=ix.getX(t),b=ix.getX(t+1),c=ix.getX(t+2),cross=(p.getX(b)-p.getX(a))*(p.getZ(c)-p.getZ(a))-(p.getZ(b)-p.getZ(a))*(p.getX(c)-p.getX(a));
    assert.ok(cross<0,'upward, non-degenerate triangle');area-=cross/2;list.push([a,b,c]);
  }
  return {list,area};
}
/** Edges used by one triangle only: the mesh's outline, if it has no cracks. */
function openEdges(geometry){
  const ix=geometry.index,edges=new Map();
  for(let t=0;t<ix.count;t+=3)for(let j=0;j<3;j++){const u=ix.getX(t+j),v=ix.getX(t+(j+1)%3),k=u<v?u*4294967296+v:v*4294967296+u;edges.set(k,(edges.get(k)??0)+1);}
  const open=[];for(const [k,n] of edges){assert.ok(n<=2,'no edge is shared by three triangles');if(n===1)open.push([Math.floor(k/4294967296),k%4294967296]);}
  return open;
}
const toSegment=(x,z,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/l)):0;return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz);};
/** Every open edge lies on the polygon's outline (or the clip bounds): interior edges all have their neighbour. */
function assertWatertight(geometry,rings,bounds,slack=1e-4){
  const p=geometry.attributes.position;
  for(const [u,v] of openEdges(geometry)){
    const x=(p.getX(u)+p.getX(v))/2,z=(p.getZ(u)+p.getZ(v))/2;let d=bounds?Math.min(Math.abs(x-bounds.minX),Math.abs(x-bounds.maxX),Math.abs(z-bounds.minZ),Math.abs(z-bounds.maxZ)):Infinity;
    for(const ring of rings)for(let i=0;i<ring.length&&d>slack;i++)d=Math.min(d,toSegment(x,z,ring[i],ring[(i+1)%ring.length]));
    assert.ok(d<=slack,`an interior edge at ${x},${z} has no neighbour (${d} from the outline)`);
  }
}
const one=(city,rings,options)=>{const surface=new DrapedSurface(city,{portals:false,...options});drain(surface.add(rings));return {surface,geometry:surface.geometry()};};

test('a grid-aligned square is the terrain\'s own triangles on shared corners',()=>{
  const city=hills(6,6),rings=[[[6,6],[18,6],[18,18],[6,18]]],{surface,geometry}=one(city,rings,{offset:.045});
  const {list,area}=triangles(geometry),p=geometry.attributes.position;
  assert.equal(list.length,8,'two terrain triangles for each of the four cells');assert.equal(p.count,9,'nine grid corners, each stored once');
  assert.ok(Math.abs(area-144)<1e-9);assert.ok(geometry.index.array instanceof Uint16Array);assert.equal(surface.stats.fallbacks,0);
  for(let i=0;i<p.count;i++){
    assert.equal(p.getX(i)%6,0);assert.equal(p.getZ(i)%6,0);
    assert.ok(Math.abs(p.getY(i)-sampleElevation(city,p.getX(i),p.getZ(i))-.045)<1e-6);
    assert.equal(geometry.attributes.uv.getX(i),Math.fround(p.getX(i)/7));assert.equal(geometry.attributes.uv.getY(i),Math.fround(p.getZ(i)/7));
  }
  assertWatertight(geometry,rings);geometry.dispose();
});

test('normals are the terrain mesh\'s vertex normals, interpolated across each terrain triangle',()=>{
  const city=hills(8,8),grid=city.elevation,{geometry}=one(city,[[[1.5,2.25],[33.5,3],[35,31.25],[2,34]]]),p=geometry.attributes.position,n=geometry.attributes.normal;
  const corner=[0,1,0],a=[0,1,0],b=[0,1,0],c=[0,1,0];let corners=0;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),z=p.getZ(i),length=Math.hypot(n.getX(i),n.getY(i),n.getZ(i));assert.ok(Math.abs(length-1)<1e-6);assert.ok(n.getY(i)>0);
    if(x%6===0&&z%6===0){
      // On a grid vertex the normal is the terrain mesh's own (the tile builder writes the same function's result).
      terrainVertexNormal(grid,x/6,z/6,corner);corners++;
      assert.ok(Math.abs(n.getX(i)-corner[0])<1e-6&&Math.abs(n.getY(i)-corner[1])<1e-6&&Math.abs(n.getZ(i)-corner[2])<1e-6);
    }
  }
  assert.ok(corners>10);
  // Inside the lower triangle of cell (2, 3): the three corner normals weighted as the rasterizer weights them.
  terrainVertexNormal(grid,2,3,a);terrainVertexNormal(grid,3,3,b);terrainVertexNormal(grid,2,4,c);
  const out=[0,0,0];surfaceNormal(grid,12+6*.25,18+6*.5,out);
  const mixed=[0,1,2].map(k=>a[k]*.25+b[k]*.25+c[k]*.5),length=Math.hypot(...mixed);
  for(let k=0;k<3;k++)assert.ok(Math.abs(out[k]-mixed[k]/length)<1e-12);
  geometry.dispose();
});

test('holes, outlines that touch in a point and vertices on grid lines keep the exact area without cracks',()=>{
  const city=hills(8,8);
  // A notch whose apex touches a grid line, a hole inside one terrain triangle, a diamond hole with corners on grid corners.
  const rings=[[[0,0],[30,0],[30,6],[21,6],[19.5,12],[18,6],[12,6],[12,3],[9,3],[9,6],[6,6],[6,30],[0,30]].reverse(),[[1,13],[2.5,13],[2.5,14.5],[1,14.5]],[[3,18],[5,21],[3,24],[1,21]]];
  const {surface,geometry}=one(city,rings),{area,list}=triangles(geometry);
  assert.ok(Math.abs(area-polygonArea(rings))<1e-4,`${area} vs ${polygonArea(rings)}`);assert.equal(surface.stats.fallbacks,0,JSON.stringify(surface.stats.reasons));
  assertWatertight(geometry,rings);assert.ok(list.length<surface.stats.fragments,'fragments are merged, not drawn one by one');
  const p=geometry.attributes.position;
  for(const [a,b,c] of list){const x=(p.getX(a)+p.getX(b)+p.getX(c))/3,z=(p.getZ(a)+p.getZ(b)+p.getZ(c))/3,y=(p.getY(a)+p.getY(b)+p.getY(c))/3;assert.ok(Math.abs(y-sampleElevation(city,x,z)-.024)<1e-4,'every triangle lies in one terrain plane');}
  geometry.dispose();
});

test('random centimetre polygons on and off the grid lines stay exact and watertight',()=>{
  const city=hills(12,12),random=seeded(4711);let fragments=0,triangleCount=0;
  for(let n=0;n<160;n++){
    // A star-shaped ring; every third polygon snaps its vertices to half-cell positions, where grid lines and diagonals meet.
    const cx=20+random()*26,cz=20+random()*26,count=3+Math.floor(random()*14),snap=n%3===0?3:.01,ring=[];
    for(let i=0;i<count;i++){const angle=(i+random()*.8)/count*Math.PI*2,r=1+random()*17;ring.push([Math.round((cx+Math.cos(angle)*r)/snap)*snap,Math.round((cz+Math.sin(angle)*r)/snap)*snap]);}
    const distinct=ring.filter((p,i)=>{const q=ring[(i+1)%ring.length];return p[0]!==q[0]||p[1]!==q[1];});if(distinct.length<3||ringArea(distinct)<.05)continue;
    const rings=[distinct],reference=parkSurface(city,rings),q=reference.attributes.position;let expected=0;
    for(let i=0;i<q.count;i+=3)expected+=Math.abs((q.getX(i+1)-q.getX(i))*(q.getZ(i+2)-q.getZ(i))-(q.getZ(i+1)-q.getZ(i))*(q.getX(i+2)-q.getX(i)))/2;
    const {surface,geometry}=one(city,rings),{area,list}=triangles(geometry);
    // Earcut decides what a self-touching star covers; the merged surface must cover what its fragments did.
    assert.ok(Math.abs(area-expected)<2e-3,`polygon ${n}: ${area} vs ${expected}`);assert.equal(surface.stats.fallbacks,0,`polygon ${n}: ${JSON.stringify(surface.stats.reasons)}`);
    assertWatertight(geometry,rings);
    fragments+=surface.stats.fragments;triangleCount+=list.length;reference.dispose();geometry.dispose();
  }
  assert.ok(triangleCount<fragments,'merging pays on arbitrary shapes too');
});

test('edges that run down a cell diagonal far from the origin are cut where they lie',()=>{
  // Here x + z rounds: the ends of an edge on the line x + z = K compute as a few 1e-13 m to either side of it, so
  // the quotient that places a crossing along the edge is anything at all, or a division by zero.
  const city=hills(20,20,undefined,600,-2610),random=seeded(93),on=(K,x)=>[x/1000,(K*1000-x)/1000],cm=v=>Math.round(v*100)/100;let inner=0;
  for(let n=0;n<400;n++){
    // Two millimetre vertices on one cell diagonal (a third between them in every other polygon), one or two centimetre vertices off it.
    const k=8+Math.floor(random()*23),K=-2010+6*k,lo=Math.max(600,486+6*k)+1,hi=Math.min(714,600+6*k)-1;
    const xa=Math.round((lo+random()*(hi-lo-3))*1000),xb=xa+Math.round((2+random()*(hi-lo-3))*1000);if(xb>hi*1000)continue;
    const a=on(K,xa),b=on(K,xb),mid=on(K,Math.round((xa+xb)/2)),side=random()<.5?1:-1,off=(sign,t)=>{const d=1+random()*14,x=a[0]+(b[0]-a[0])*t;return [cm(x+sign*d*.7+random()),cm(K-x+sign*d*.7+random())];};
    const c=off(side,.2+random()*.6),ring=n%4===3?[a,off(-side,.2+random()*.6),b,c]:n%2?[a,mid,b,c]:[a,b,c];
    if(ring.some(([x,z])=>x<601||x>713||z<-2609||z>-2497))continue;
    const rings=[ring],reference=parkSurface(city,rings),q=reference.attributes.position;let expected=0;
    for(let i=0;i<q.count;i+=3)expected+=Math.abs((q.getX(i+1)-q.getX(i))*(q.getZ(i+2)-q.getZ(i))-(q.getZ(i+1)-q.getZ(i))*(q.getX(i+2)-q.getX(i)))/2;
    const {surface,geometry}=one(city,rings),p=geometry.attributes.position;
    assert.ok(p.array.every(Number.isFinite),`polygon ${n}: every vertex is a point`);
    const xs=ring.map(v=>v[0]),zs=ring.map(v=>v[1]);
    for(let i=0;i<p.count;i++)assert.ok(p.getX(i)>=Math.min(...xs)-1e-3&&p.getX(i)<=Math.max(...xs)+1e-3&&p.getZ(i)>=Math.min(...zs)-1e-3&&p.getZ(i)<=Math.max(...zs)+1e-3,`polygon ${n}: a vertex at ${p.getX(i)},${p.getZ(i)} lies outside it`);
    const {area}=triangles(geometry);
    // Float32 resolves a quarter of a millimetre here, on outlines up to a hundred metres round.
    assert.ok(Math.abs(area-expected)<.03&&Math.abs(area-ringArea(ring))<.03,`polygon ${n}: ${area} vs ${expected} (${ringArea(ring)})`);
    assert.equal(surface.stats.fallbacks,0,`polygon ${n}: ${JSON.stringify(surface.stats.reasons)}`);assertWatertight(geometry,rings,undefined,1e-3);
    if(ring.length===4&&n%4===3)inner++;reference.dispose();geometry.dispose();
  }
  assert.ok(inner>40,'kites whose own diagonal may be the triangulation\'s inner edge');
});

/** Triangles bucketed in 3 m cells for point lookups. */
function lookup(position,index){
  const cells=new Map(),count=index?index.count:position.count,tri=new Float64Array(count*2);
  for(let t=0;t<count;t+=3){
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for(let j=0;j<3;j++){const v=index?index.getX(t+j):t+j,x=position.getX(v),z=position.getZ(v);tri[(t+j)*2]=x;tri[(t+j)*2+1]=z;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
    for(let cx=Math.floor((minX-1e-3)/3);cx<=Math.floor((maxX+1e-3)/3);cx++)for(let cz=Math.floor((minZ-1e-3)/3);cz<=Math.floor((maxZ+1e-3)/3);cz++){const k=cx*1000003+cz,l=cells.get(k);if(l)l.push(t);else cells.set(k,[t]);}
  }
  const distance=(t,x,z)=>{
    let inside=true,best=Infinity,sign=0;
    for(let j=0;j<3;j++){const a=[tri[(t+j)*2],tri[(t+j)*2+1]],b=[tri[(t+(j+1)%3)*2],tri[(t+(j+1)%3)*2+1]],cross=(b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0]);
      if(cross!==0){if(!sign)sign=Math.sign(cross);else if(Math.sign(cross)!==sign)inside=false;}best=Math.min(best,toSegment(x,z,a,b));}
    return inside?0:best;
  };
  return {count,centroid:t=>[(tri[t*2]+tri[t*2+2]+tri[t*2+4])/3,(tri[t*2+1]+tri[t*2+3]+tri[t*2+5])/3],
    reach(x,z){let best=Infinity;for(const t of cells.get(Math.floor(x/3)*1000003+Math.floor(z/3))??[]){const d=distance(t,x,z);if(d===0)return 0;best=Math.min(best,d);}return best;}};
}

const metro=await loadMetroCity({tiles:['0_-1','-1_-5','0_-3']});
test('real pavement covers what the old tessellation covered, on the terrain, in a fraction of the triangles and bytes',()=>{
  let oldTriangles=0,newTriangles=0,oldBytes=0,newBytes=0,faces=0;
  for(const tile of ['0_-1','-1_-5'].map(key=>metro.loadedTiles.get(key))){
    const layers=[[tile.sidewalks.map(w=>w.rings),.03],[tile.driveways,.035],[tile.streetPavement??[],.045],[tile.streetSidewalks??[],.012],[tile.deckPavement??[],.03]];
    for(const [polygons,offset] of layers)for(const rings of polygons){
      const reference=parkSurface(metro,rings,offset),{surface,geometry}=one(metro,rings,{offset});
      const before=lookup(reference.attributes.position,null),after=lookup(geometry.attributes.position,geometry.index),p=geometry.attributes.position,ix=geometry.index;
      // Each old triangle's middle lies in the new surface and each new one's in the old: the same ground, no more,
      // no less, to the millimetre (Float32 resolves half a millimetre this far from the origin, and the old
      // tessellation kept slivers that exist only in that rounding).
      for(let t=0;t<before.count;t+=3){const [x,z]=before.centroid(t);assert.ok(after.reach(x,z)<1e-3,`${tile.key}: pavement lost at ${x},${z}`);}
      for(let t=0;t<after.count;t+=3){
        const [x,z]=after.centroid(t);assert.ok(before.reach(x,z)<1e-3,`${tile.key}: pavement added at ${x},${z}`);
        const y=(p.getY(ix.getX(t))+p.getY(ix.getX(t+1))+p.getY(ix.getX(t+2)))/3;assert.ok(Math.abs(y-sampleElevation(metro,x,z)-offset)<.002,`${tile.key}: crosses the terrain at ${x},${z}`);
      }
      triangles(geometry);assert.equal(surface.stats.fallbacks,0,JSON.stringify(surface.stats.reasons));
      oldTriangles+=before.count/3;newTriangles+=after.count/3;faces+=surface.stats.faces;
      oldBytes+=Object.values(reference.attributes).reduce((n,a)=>n+a.array.byteLength,0);newBytes+=Object.values(geometry.attributes).reduce((n,a)=>n+a.array.byteLength,ix.array.byteLength);
      reference.dispose();geometry.dispose();
    }
  }
  assert.ok(faces>30000,'exercise real junctions, folds and terrain cells');
  assert.ok(newTriangles<oldTriangles*.3,`${newTriangles} of ${oldTriangles} triangles`);assert.ok(newBytes<oldBytes*.12,`${newBytes} of ${oldBytes} bytes`);
});

test('embankment pavement with vertices on cell diagonals stays finite and exact',()=>{
  // Tile 0_-3's paved embankments are millimetre polygons with several vertices on one cell diagonal (654.164, -2556.164
  // and others on x + z = -1902), so earcut's inner edges run down it; one of them once came out at infinity.
  const tile=metro.loadedTiles.get('0_-3'),polygons=tile.deckPavement;assert.ok(polygons.length>10);
  let onDiagonal=0;const grid=metro.elevation;
  for(const rings of polygons){
    for(const ring of rings)for(const [x,z] of ring){const s=(x+z-grid.originX-grid.originZ)/grid.cellSize;if(Math.abs(s-Math.round(s))<1e-9&&(x-grid.originX)%grid.cellSize!==0)onDiagonal++;}
    const reference=parkSurface(metro,rings,.03),q=reference.attributes.position;let expected=0;
    for(let i=0;i<q.count;i+=3)expected+=Math.abs((q.getX(i+1)-q.getX(i))*(q.getZ(i+2)-q.getZ(i))-(q.getZ(i+1)-q.getZ(i))*(q.getX(i+2)-q.getX(i)))/2;
    const {surface,geometry}=one(metro,rings,{offset:.03});
    for(const name of ['position','normal','uv'])assert.ok(geometry.attributes[name].array.every(Number.isFinite),`${name} is finite`);
    assert.ok(Math.abs(triangles(geometry).area-expected)<.02+expected*1e-4,`${triangles(geometry).area} vs ${expected}`);
    assert.equal(surface.stats.fallbacks,0,JSON.stringify(surface.stats.reasons));
    geometry.computeBoundingBox();assert.ok(geometry.boundingBox.min.x>=0&&geometry.boundingBox.max.x<=1100&&geometry.boundingBox.min.z>=-3100&&geometry.boundingBox.max.z<=-1900);
    reference.dispose();geometry.dispose();
  }
  assert.ok(onDiagonal>3,'the fixture still has vertices on cell diagonals');
});

test('a layer shares vertices between its polygons and comes out as one mesh',()=>{
  const tile=metro.loadedTiles.get('0_-1'),polygons=tile.sidewalks.map(w=>w.rings),layer=drapedSurface(metro,polygons,{offset:.03,portals:false});
  let apart=0,area=0;for(const rings of polygons){const {geometry}=one(metro,rings,{offset:.03});apart+=geometry.attributes.position.count;area+=triangles(geometry).area;geometry.dispose();}
  assert.ok(layer.attributes.position.count<=apart);assert.ok(Math.abs(triangles(layer).area-area)<.01);
  assert.ok(layer.boundingSphere.radius>300&&layer.boundingSphere.radius<800,'culling bounds are ready with the geometry');
  for(const name of ['position','normal','uv'])assert.ok(layer.attributes[name].array.every(Number.isFinite));
  layer.dispose();
});

test('a park cut at a tile seam meets itself there with the same vertices',()=>{
  const park=metro.parks.filter(p=>p.rings[0].some(v=>v[0]<0)&&p.rings[0].some(v=>v[0]>0)&&p.rings[0].every(v=>v[1]>-1000&&v[1]<0)).sort((a,b)=>ringArea(b.rings[0])-ringArea(a.rings[0]))[0];
  assert.ok(park,'a park spans the seam between tiles -1_-1 and 0_-1');
  const west={minX:-1000,maxX:0,minZ:-1000,maxZ:0},east={minX:0,maxX:1000,minZ:-1000,maxZ:0};
  const a=one(metro,park.rings,{bounds:west}),b=one(metro,park.rings,{bounds:east}),whole=one(metro,park.rings,{bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:0}});
  assert.ok(Math.abs(triangles(a.geometry).area+triangles(b.geometry).area-triangles(whole.geometry).area)<.01,'no gap or overlap at x = 0');
  const seam=g=>{const p=g.attributes.position,out=new Set();for(let i=0;i<p.count;i++)if(p.getX(i)===0)out.add(`${p.getY(i)},${p.getZ(i)}`);return out;};
  const left=seam(a.geometry),right=seam(b.geometry);assert.ok(left.size>4);assert.deepEqual([...left].sort(),[...right].sort(),'both tiles put the same points on the seam');
  for(const part of [a,b]){assert.equal(part.surface.stats.fallbacks,0);assertWatertight(part.geometry,park.rings,part===a?west:east);part.geometry.dispose();}
  whole.geometry.dispose();
});

test('tunnel portals stay open in draped pavement',()=>{
  const road={id:'test-portal',name:'Ramp',points:[[0,-40],[0,0],[0,40]],elevations:[0,-5,-10],width:8,oneway:1,tunnel:{clearance:5,covered:[[50,80]]}};
  const city={bounds:{minX:-60,maxX:60,minZ:-60,maxZ:60},roads:[road],elevation:{originX:-60,originZ:-60,width:21,height:21,cellSize:6,heights:new Float32Array(441)}};
  const rings=[[[-20,-26],[20,-26],[20,-14],[-20,-14]]],open=drapedSurface(city,[rings],{offset:.045}),whole=drapedSurface(city,[rings],{offset:.045,portals:false});
  const {list,area}=triangles(open),p=open.attributes.position;
  assert.ok(Math.abs(triangles(whole).area-480)<1e-6);assert.ok(area<400&&area>300,`${area} m² left around the portal`);
  for(const [a,b,c] of list)assert.equal(inTunnelPortal(city,(p.getX(a)+p.getX(b)+p.getX(c))/3,(p.getZ(a)+p.getZ(b)+p.getZ(c))/3),false,'no pavement over the portal');
  for(const name of ['position','normal','uv'])assert.ok(open.attributes[name].array.every(Number.isFinite));
  assert.equal(new Set(open.index.array).size,p.count,'no vertex is left without a triangle');
  open.dispose();whole.dispose();
});
