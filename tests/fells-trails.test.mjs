import assert from 'node:assert/strict';
import test from 'node:test';
import { parkSurfaceRuns, trailEdges } from '../src/simulation/fells-trails.ts';
import { naturalTrailInto } from '../src/render/fells-surfaces.ts';
import { TriangleWriter } from '../src/render/geometry-writer.ts';
import { sampleElevation } from '../src/simulation/terrain.ts';
const woodland={id:'fells',name:'Middlesex Fells Reservation',rings:[[[0,0],[100,0],[100,100],[0,100]],[[40,40],[60,40],[60,60],[40,60]]]};
const path={id:'walk',width:3,points:[[-10,50],[110,50]]};

test('trails change to soil precisely inside the woodland, retaining paving outside and through holes',()=>{
  const runs=parkSurfaceRuns(path,[woodland]);
  assert.deepEqual(runs.map(r=>r.natural),[false,true,false,true,false]);
  assert.deepEqual(runs.map(r=>r.points),[[[-10,50],[0,50]],[[0,50],[40,50]],[[40,50],[60,50]],[[60,50],[100,50]],[[100,50],[110,50]]]);
  assert.deepEqual(parkSurfaceRuns({...path,bridge:true},[woodland]),[{points:path.points,natural:false}]);
  assert.deepEqual(parkSurfaceRuns(path,[]),[{points:path.points,natural:false}]);
});

test('overlapping Fells polygons retain a continuous trail without seams',()=>{
  const second={...woodland,rings:[[[30,0],[120,0],[120,100],[30,100]]]};
  const runs=parkSurfaceRuns({...path,points:[[1,25],[115,25]]},[woodland,second]);
  assert.equal(runs.length,1);assert.equal(runs[0].natural,true);
  assert.deepEqual(runs[0].points[0],[1,25]);assert.deepEqual(runs[0].points.at(-1),[115,25]);
});

test('natural edges keep the mapped riding line and width while adjoining fragments agree',()=>{
  const full=trailEdges([[0,10],[100,10]],3),a=trailEdges([[0,10],[50,10]],3),b=trailEdges([[50,10],[100,10]],3);
  assert.deepEqual(a.left.at(-1),b.left[0]);assert.deepEqual(a.right.at(-1),b.right[0]);
  for(let i=0;i<full.left.length;i++){
    const l=full.left[i],r=full.right[i];assert.equal((l[1]+r[1])/2,10);
    const width=Math.hypot(l[0]-r[0],l[1]-r[1]);assert.ok(width>2.65&&width<3.35);
  }
});

test('hilly trail render stays on wheel terrain with upward faces and finite edge UVs',()=>{
  const size=24,city={roads:[],bounds:{minX:0,maxX:138,minZ:0,maxZ:138},elevation:{width:size,height:size,cellSize:6,originX:0,originZ:0,heights:Array.from({length:size*size},(_,i)=>Math.sin(i%size*.4)*3+Math.cos(Math.floor(i/size)*.4)*5)}};
  const writer=new TriangleWriter();naturalTrailInto(writer,city,[[10,10],[35,65],[100,90]],3);
  const g=writer.geometry(),p=g.getAttribute('position'),uv=g.getAttribute('uv');
  assert.ok(p.count>100);let maxError=0;
  for(let i=0;i<p.count;i++){
    assert.ok(Number.isFinite(uv.getX(i))&&uv.getX(i)>=-1e-6&&uv.getX(i)<=1.00001);
    assert.ok(Math.abs(p.getY(i)-sampleElevation(city,p.getX(i),p.getZ(i))-.052)<.001);
  }
  for(let i=0;i<p.count;i+=3){
    const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;
    const y=(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3;
    maxError=Math.max(maxError,Math.abs(y-sampleElevation(city,x,z)-.052));
    const ax=p.getX(i+1)-p.getX(i),az=p.getZ(i+1)-p.getZ(i),bx=p.getX(i+2)-p.getX(i),bz=p.getZ(i+2)-p.getZ(i);
    assert.ok(az*bx-ax*bz>=-1e-6,'front faces point up');
  }
  assert.ok(maxError<.02,`no visible terrain cutting through soil: ${maxError}`);g.dispose();
});
