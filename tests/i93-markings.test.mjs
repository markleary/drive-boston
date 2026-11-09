import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveCity} from '../src/simulation/city-tiles.ts';
import {LANE_DASH,laneMarkings,roadProjection} from '../src/simulation/road-surfaces.ts';
import {LANE_WIDTH,stations} from '../src/simulation/motorway.ts';
import {read,readJson} from './helpers/metro-city.mjs';

const city=await resolveCity(readJson('city.json'),read);
const road=id=>city.roads.find(road=>road.id===id);
const painted=(road,local=city)=>{
  const along=stations(road.points);
  const project=([x,z])=>{
    const hit=roadProjection(road,x,z);
    return {lateral:x-hit.x,station:along[hit.index]+(along[hit.index+1]-along[hit.index])*hit.t};
  };
  return {length:along.at(-1),lines:laneMarkings(local,road,city).map(line=>({...line,points:line.points.map(project)}))};
};

test('Medford southbound paint keeps its four through lanes and dash spacing across the six-metre source split',()=>{
  const sections=['i93-sb-07','i93-sb-08','i93-sb-09'].map(id=>painted(road(id)));
  const middle=sections[1];
  assert.ok(middle.length<6,'the five-lane source record is shorter than two car lengths');
  for(const line of middle.lines){
    const offsets=line.kind==='divider'?[-LANE_WIDTH,0,LANE_WIDTH]:[-2*LANE_WIDTH,2*LANE_WIDTH];
    for(const {lateral} of line.points)assert.ok(offsets.some(o=>Math.abs(o-lateral)<.02),`unexpected ${line.kind} at ${lateral.toFixed(2)} m`);
  }
  assert.equal(middle.lines.filter(line=>line.kind==='divider').length,3,'only the three through dividers cross the source split');

  // Follow the center dash across both seams. A dash split by the source
  // boundary is one painted interval, with the normal nine-metre gap after it.
  const intervals=[];
  let origin=0;
  for(const section of sections){
    for(const line of section.lines.filter(l=>l.kind==='divider'&&Math.abs(l.points[0].lateral)<.02)){
      const start=origin+line.points[0].station,end=origin+line.points.at(-1).station,last=intervals.at(-1);
      if(last&&Math.abs(last[1]-start)<.02)last[1]=end;
      else intervals.push([start,end]);
    }
    origin+=section.length;
  }
  for(let i=1;i<intervals.length-1;i++){
    const [start,end]=intervals[i];
    assert.ok(Math.abs(end-start-LANE_DASH[0])<.01,`dash at ${start.toFixed(2)} m has ${end-start} m of paint`);
    assert.ok(Math.abs(intervals[i+1][0]-start-LANE_DASH[1])<.01,`dash spacing at ${start.toFixed(2)} m`);
  }
});

test('a short record at a Medford northbound lane drop continues the taper begun on its preceding record',()=>{
  const first=road('i93-nb-12'),last=road('i93-nb-13'),next=road('i93-nb-14');
  const before=painted(first,{...city,roads:[first,last]}),end=painted(last,{...city,roads:[last,next]});
  const preceding=before.lines.find(l=>l.kind==='left').points.at(-1),line=end.lines.find(l=>l.kind==='left').points;
  assert.ok(end.length<13,'the final five-lane record spans only twelve metres');
  assert.ok(Math.abs(preceding.lateral-line[0].lateral)<.02,'the two records share the same shoulder paint at their seam');
  assert.ok(Math.abs(line[0].lateral-line.at(-1).lateral)<.1,'the last twelve metres finish a gradual transition');
});
