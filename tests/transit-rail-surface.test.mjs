import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createRailProfile,railCovered,railSurface,railStopDistance} from '../src/simulation/transit-rail-surface.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';

const path={points:[[0,0],[0,100]],distances:[0,100],length:100};
function cityWithHeight(fn){
  const width=21,height=111,heights=Float32Array.from({length:width*height},(_,i)=>fn(i%width-10,Math.floor(i/width)-5));
  return{bounds:{minX:-10,maxX:10,minZ:-5,maxZ:105},elevation:{width,height,cellSize:1,originX:-10,originZ:-5,heights}};
}

test('rail profile follows longitudinal grade without banking into an embankment',()=>{
  const city=cityWithHeight((x,z)=>x*.3+z*.04),profile=createRailProfile(city,path);
  for(let d=5;d<96;d+=2.3){
    const s=railSurface(profile,d);
    assert.ok(s.height>=sampleElevation(city,0,d));
    assert.ok(s.height<sampleElevation(city,0,d)+.25,'only gauge crossfall raises a straight graded rail');
    assert.ok(Math.abs(s.normal.x)<1e-12);
    assert.ok(Math.abs(s.normal.z+.04/Math.hypot(1,.04))<1e-6);
  }
});

test('covered crossings pass below road terrain and share buffered visibility intervals',()=>{
  const city=cityWithHeight((x,z)=>z>=40&&z<=60?6:1),profile=createRailProfile(city,{...path,covered:[{start:40,end:60}]});
  assert.deepEqual(profile.covered,[{start:28,end:72}]);
  assert.equal(railCovered(profile,50),true);assert.equal(railCovered(profile,27),false);
  assert.equal(railCovered(profile,27,2),true);
  assert.equal(railSurface(profile,50).height,1,'rail must not climb the road above its underpass');
  for(const d of [0,27,73,100])assert.equal(railSurface(profile,d).height,1);
  assert.deepEqual(railSurface(profile,50).normal,{x:-0,y:1,z:-0});
});

test('smoothing fills small hollows but never buries visible rail or changes endpoints',()=>{
  const city=cityWithHeight((x,z)=>10+Math.sin(z*1.3)*.3),profile=createRailProfile(city,path);
  for(let d=0;d<=100;d+=.17){
    const surface=railSurface(profile,d),terrain=sampleElevation(city,0,d);
    assert.ok(surface.height>=terrain-1e-9);
    assert.ok(surface.height-terrain<.61,'a rough grid must not create a large elevated railway');
    assert.ok(Object.values(surface.normal).every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...Object.values(surface.normal))-1)<1e-9);
  }
  for(const d of [0,100])assert.equal(railSurface(profile,d).height,sampleElevation(city,0,d));
});

test('overlapping covered transitions merge and non-integral endpoints remain finite',()=>{
  const city=cityWithHeight(()=>2),route={points:[[0,0],[0,99.3]],distances:[0,99.3],length:99.3,covered:[{start:30,end:35},{start:40,end:45}]};
  const profile=createRailProfile(city,route);
  assert.deepEqual(profile.covered,[{start:18,end:57}]);
  for(const d of [-10,0,99,99.3,120]){
    const s=railSurface(profile,d);assert.equal(s.height,2);assert.ok(Object.values(s.normal).every(Number.isFinite));
  }
});

test('D passes below untagged road crossings while B keeps its surface crossings',()=>{
  const city=cityWithHeight((x,z)=>z>=40&&z<=60?6:1);
  city.roads=[{name:'Cross street',width:12,points:[[-10,50],[10,50]]}];
  const d=createRailProfile(city,{...path,line:'Green-D'}),b=createRailProfile(city,{...path,line:'Green-B'});
  assert.equal(railCovered(d,50),true);assert.equal(railSurface(d,50).height,1);
  assert.equal(railCovered(b,50),false);assert.equal(railSurface(b,50).height,6);
});

test('B bridge has continuous supported approaches and uses the street deck above the cut',()=>{
  const city=cityWithHeight(()=>1);
  city.roads=[{name:'Commonwealth Avenue',width:8,points:[[0,30],[0,70]],elevations:[5,5]}];
  const p=createRailProfile(city,{...path,line:'Green-B',bridges:[{start:40,end:60}]});
  assert.equal(railSurface(p,50).height,5);assert.equal(railCovered(p,50),false);
  assert.equal(railSurface(p,0).height,1);assert.equal(railSurface(p,100).height,1);
  for(let d=1;d<=100;d++)assert.ok(Math.abs(railSurface(p,d).height-railSurface(p,d-1).height)<.15,'a bridge way boundary must not become a height step');
});

test('station dwells move to the nearest clear whole-car position without moving clear stops',()=>{
  const p=createRailProfile(cityWithHeight(()=>1),{...path,covered:[{start:40,end:60}]});
  assert.equal(railStopDistance(p,40),14.99);
  assert.equal(railStopDistance(p,70),85.01);
  assert.equal(railStopDistance(p,90),90);
  for(const d of [40,50,70])assert.equal(railCovered(p,railStopDistance(p,d),13),false);
  const open=createRailProfile(cityWithHeight(()=>1),path);
  for(const d of [15,50,85])assert.equal(railStopDistance(open,d),d,'B/C/E surface stops retain their official positions');
});

test('station adjustment respects route ends, overlapping masks, and a 100m station neighborhood',()=>{
  const p=createRailProfile(cityWithHeight(()=>1),path);
  p.covered=[{start:0,end:20}];
  assert.equal(railStopDistance(p,15),33.01,'a stop cannot move before the route portal');
  p.covered=[{start:80,end:100}];
  assert.equal(railStopDistance(p,85),66.99,'the whole car must stay inside the last route section');
  p.covered=[{start:25,end:40},{start:50,end:60}];
  const shifted=railStopDistance(p,45);
  assert.ok(shifted>=13&&shifted<=87);assert.equal(railCovered(p,shifted,13),false,'do not shift into another nearby underpass');
  const long={...p,path:{...path,length:400},covered:[{start:10,end:310}]};
  assert.equal(railStopDistance(long,160),160,'do not relocate an inaccessible station to an unrelated place');
});

test('shipped B bridge and D underpasses have stable heights and fully visible station dwells',()=>{
  const city=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url),'utf8'));
  const bytes=gunzipSync(readFileSync(new URL('../public/data/elevation.bin',import.meta.url)));
  city.elevation.heights=Float32Array.from(new Int16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2),h=>h*.01);
  const routes=JSON.parse(readFileSync(new URL('../public/data/transit.json',import.meta.url),'utf8')).routes;
  for(const r of routes.filter(r=>['Green-B','Green-D'].includes(r.line))){
    const distances=[0];for(let i=1;i<r.points.length;i++)distances.push(distances.at(-1)+Math.hypot(r.points[i][0]-r.points[i-1][0],r.points[i][1]-r.points[i-1][1]));
    const p=createRailProfile(city,{...r,distances,length:distances.at(-1)});
    if(r.line==='Green-D')assert.ok(p.covered.length>=8,'road crossings lacking OSM tunnel tags still need an underpass');
    for(const stop of r.stops){
      const adjusted=railStopDistance(p,stop.distance);
      assert.equal(railCovered(p,adjusted,13),false,`${r.destination} must show its entire single car at ${stop.name}`);
      assert.ok(adjusted>=13&&adjusted<=p.path.length-13);
      assert.ok(Math.abs(adjusted-stop.distance)<30,'the dwell should remain beside its mapped station');
      if(r.line==='Green-D'&&['Fenway','Reservoir'].includes(stop.name))assert.notEqual(adjusted,stop.distance,'regression: these source platform points are inside terrain masks');
      if(r.line==='Green-B')assert.equal(adjusted,stop.distance);
    }
    for(let d=2;d<p.path.length;d+=2){
      if(railCovered(p,d)||railCovered(p,d-2))continue;
      const surface=railSurface(p,d),before=railSurface(p,d-2);
      assert.ok(Math.abs(surface.height-before.height)<.66,`${r.destination} at ${d}m must not climb a road bridge ridge`);
      assert.ok(Math.hypot(surface.normal.x,surface.normal.z)/surface.normal.y<.18,`${r.destination} at ${d}m must have a stable longitudinal pose`);
    }
    if(r.line==='Green-B')for(const span of r.bridges){
      for(let d=span.start-50;d<=span.end+50;d+=2){
        const s=railSurface(p,d);assert.ok(Math.hypot(s.normal.x,s.normal.z)/s.normal.y<.145,'the B bridge needs a continuous median ramp');
      }
    }
  }
});
