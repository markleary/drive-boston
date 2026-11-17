import assert from 'node:assert/strict';
import test from 'node:test';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {SCIENCE_PARK_STATION,HALF,RAIL,START,LENGTH,CROWN,LECHMERE_TRACKS,lechmereViaductParts,viaductLayout,viaductPoint,viaductSoffit,viaductStation,viaductStations,VIADUCT_SOLID} from '../src/simulation/lechmere-viaduct.ts';
import {drawnStreets} from '../src/simulation/drawn-streets.ts';
import {loadMetroCity,windowCity} from './helpers/metro-city.mjs';

const bounds={minX:-80,maxX:680,minZ:-2320,maxZ:-1760};
const metro=await loadMetroCity({bounds}),city=windowCity(metro,bounds),layout=viaductLayout();

test('twelve spans in order tile the 518 m between the station and the far abutment',()=>{
 assert.equal(layout.spans.length,12);assert.equal(layout.spans.filter(s=>s.kind==='arch').length,10);
 assert.equal(layout.spans[2].kind,'draw');assert.equal(layout.spans[11].kind,'girder');
 const pieces=[...layout.spans,...layout.piers].sort((a,b)=>a.from-b.from);
 assert.equal(pieces[0].from,START);assert.equal(pieces.at(-1).to,START+LENGTH);
 for(let i=1;i<pieces.length;i++)assert.ok(Math.abs(pieces[i].from-pieces[i-1].to)<1e-9,`no gap or overlap at ${pieces[i].from}`);
 for(const span of layout.spans.slice(3,11))assert.ok(Math.abs(span.to-span.from-41.25)<1e-9,'the dam arches are alike');
});

test('stations and offsets round-trip along the mapped tracks',()=>{
 for(const s of [50,130,300,470,555])for(const across of [-HALF,0,3]){
  const p=viaductPoint(s,across),back=viaductStation(...p);
  assert.ok(Math.abs(back.s-s)<.01&&Math.abs(back.across-across)<.01,`${s}, ${across}`);
 }
 const marks=viaductStations(START,START+LENGTH,25);assert.equal(marks[0],START);assert.equal(marks.at(-1),START+LENGTH);
 for(let i=1;i<marks.length;i++)assert.ok(marks[i]>marks[i-1]&&marks[i]-marks[i-1]<=25+1e-9);
 assert.ok(LECHMERE_TRACKS.length>=4);
});

test('the structure begins where the surveyed station ends, a hand under its platforms',()=>{
 const station=[...metro.loadedTiles.values()].flatMap(t=>t.buildings).find(b=>b.id===SCIENCE_PARK_STATION);assert.ok(station,'Science Park station is in the package');
 const data=metro.geometry.get(station.id);let far=-Infinity;
 for(let i=0;i<data.positions.length;i+=3)far=Math.max(far,viaductStation(data.positions[i],data.positions[i+2]).s);
 assert.ok(Math.abs(far-START)<1.5,`station mesh ends at ${far.toFixed(1)}`);
 assert.ok(RAIL<9.4&&RAIL>8.9,'top of rail just under the 9.4 m platforms');
});

test('every roadway the tiles draw under the viaduct passes under a span with room, clear of the piers',()=>{
 let paved=0;const streets=[...metro.loadedTiles.values()].map(tile=>({tile,drawn:drawnStreets(tile)}));
 const drawn=(x,z)=>streets.some(({tile,drawn})=>x>=tile.tx*tile.size&&x<(tile.tx+1)*tile.size&&z>=tile.tz*tile.size&&z<(tile.tz+1)*tile.size&&drawn.paved(x,z));
 for(let s=START;s<=START+LENGTH;s+=.5)for(let across=-HALF-.8;across<=HALF+.8;across+=.5){
  const p=viaductPoint(s,across);if(!drawn(...p))continue;paved++;
  const room=viaductSoffit(s,layout)-sampleElevation(city,...p);
  assert.ok(room>=4.2,`${room.toFixed(2)} m over the roadway at station ${s.toFixed(1)}, ${across.toFixed(1)} m across (${p.map(v=>v.toFixed(1))})`);
 }
 assert.ok(paved>800,`Nashua Street, Museum Way and Charlestown Avenue pass beneath (${paved} samples)`);
});

test('piers stand clear of the dam road and its sidewalks',()=>{
 const dam=city.roads.filter(r=>['10963-0-0','7515-0-0','10965-0-0','14555-0-0'].includes(r.id));assert.equal(dam.length,4);
 for(const road of dam)for(const p of road.points){const at=viaductStation(...p);assert.ok(at.across<-(HALF+.8+9),`the Cambridge-bound line is ${(-at.across).toFixed(1)} m from the viaduct's centre`);}
});

test('geometry: finite, closed over the deck, and standing on its ground',()=>{
 const parts=lechmereViaductParts(city);let triangles=0,top=-Infinity,bottom=Infinity;
 for(const [name,positions] of Object.entries(parts.positions)){
  assert.equal(positions.length%9,0,name);assert.equal(parts.uvs[name].length,positions.length/3*2,name);triangles+=positions.length/9;
  for(let i=0;i<positions.length;i+=3){assert.ok(Number.isFinite(positions[i])&&Number.isFinite(positions[i+1])&&Number.isFinite(positions[i+2]),name);top=Math.max(top,positions[i+1]);bottom=Math.min(bottom,positions[i+1]);}
 }
 assert.equal(parts.arches,10);assert.ok(parts.poles>=20);assert.ok(triangles>3000&&triangles<40000,`${triangles} triangles`);
 assert.ok(bottom<-4&&top>17&&top<19,'from under the river bed to the tower cap');
 for(const name of VIADUCT_SOLID)assert.ok(parts.positions[name].length>0,name);
 // The crown of an arch stands well over the dam's crest beside the road.
 const span=layout.spans[5],mid=(span.from+span.to)/2,p=viaductPoint(mid,0);assert.ok(CROWN-sampleElevation(city,...p)>5.2);
});
