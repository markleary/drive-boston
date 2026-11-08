import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {resolveCity,loadTile} from '../src/simulation/city-tiles.ts';
import {surveyDeckCarriageways,surveyDeckIndex} from '../src/simulation/survey-deck-lanes.ts';
import {addSurveyDeckSurface,smoothMarkingStations,uncovered} from '../src/render/survey-deck-surface.ts';
import {read,readJson} from './helpers/metro-city.mjs';

const metro=await resolveCity(readJson('city.json'),read);
const tile=await loadTile(metro,0,-3,read),data=tile.geometry.get(tile.buildings.find(b=>b.landmark==='zakim-bridge').id);
const {carriageways,onDeck}=surveyDeckCarriageways(data);
const nearest=(x,z)=>{
 let best,distance=Infinity;
 for(const {stations} of carriageways)for(const [i,s] of stations.entries()){
  const d=Math.hypot(s.x-x,s.z-z);if(d<distance){distance=d;best={stations,index:i};}
 }
 return best;
};
const edge=(s,side)=>{const offset=side*Math.min(s.half-.3,s.lanes*3.65/2);return[s.x-s.tz*offset,s.z+s.tx*offset];};
// How far an edge-line point strays from the chord joining its neighbours.
// A straight road should not have a visible jog every two metres.
const jogAt=(stations,i)=>Math.max(...[-1,1].map(side=>{
 const a=edge(stations[i-1],side),b=edge(stations[i],side),c=edge(stations[i+1],side),dx=c[0]-a[0],dz=c[1]-a[1];
 return Math.abs(dx*(b[1]-a[1])-dz*(b[0]-a[0]))/Math.hypot(dx,dz);
}));
const worstJog=(stations,index)=>{
 let worst=0;
 for(let i=index-15;i<=index+15;i++)worst=Math.max(worst,jogAt(stations,i));
 return worst;
};

test('Zakim and Charlestown paint has no short zigzags from the surveyed deck walk',()=>{
 // Both four-lane Zakim mainlines in the reported view, then the viaduct
 // north of the river. The 15 cm paint used to jog as much as 61 cm here.
 for(const [x,z] of [[965,-2034],[979,-2049],[-177,-3868],[57.8,-2889]]){
  const {stations,index}=nearest(x,z),aligned=smoothMarkingStations(stations,onDeck);
  assert.ok(worstJog(aligned,index)<.025,`paint near ${x}, ${z} jogs ${(worstJog(aligned,index)*100).toFixed(1)} cm`);
 }
});

test('a deck constraint near the Zakim ramp merge does not create a sharp paint fallback',()=>{
 const runs=uncovered(metro,carriageways.map(c=>c.stations)),distance=s=>Math.hypot(s.x-766.24,s.z+2184.80);
 const run=runs.find(stations=>stations.some(s=>distance(s)<.01));assert.ok(run,'the reported ramp merge is covered');
 const index=run.findIndex(s=>distance(s)<.01),aligned=smoothMarkingStations(run,onDeck);
 // The smooth frame at this spot meets a surveyed protrusion. Replacing only
 // that frame with the raw measurement made a 44 cm jog in 15 cm-wide paint.
 // Include the approach neighbours so the correction cannot move the jog.
 for(let i=index;i>=index-4;i--){
  assert.equal(run[i-1].lanes,2);assert.equal(run[i].lanes,2);assert.equal(run[i+1].lanes,2);
  assert.ok(jogAt(aligned,i)<.15,`ramp shoulder paint jogs ${(jogAt(aligned,i)*100).toFixed(1)} cm near ${run[i].x.toFixed(2)}, ${run[i].z.toFixed(2)}`);
 }
});

test('an isolated deck-edge constraint is approached smoothly without moving paint off the deck',()=>{
 const stations=Array.from({length:61},(_,i)=>({x:i===0||i===60?0:(i%2?.3:-.3),z:i*2,tx:0,tz:1,y:10,yLeft:10,yRight:10,half:4.1,lanes:2}));
 // A local 60 cm protrusion into the right shoulder. Every raw cross-section
 // fits, but a straightened right paint line needs a small leftward detour.
 const contains=(x,z)=>x>=-4.1&&x<=4.1-.6*Math.exp(-((z-60)**2));
 const supported=s=>[-3.725,-3.575,-.075,.075,3.575,3.725].every(o=>contains(s.x-s.tz*o,s.z+s.tx*o));
 assert.ok(stations.every(supported),'the measured paint starts inside the deck');
 const free=smoothMarkingStations(stations);assert.equal(supported(free[30]),false,'the obstruction requires a correction');
 const original=structuredClone(stations),aligned=smoothMarkingStations(stations,contains);
 assert.deepEqual(stations,original,'constrained paint leaves the source survey unchanged');
 assert.ok(aligned.every(supported),'both edges of every paint line remain supported');
 for(const i of [0,stations.length-1])assert.deepEqual(aligned[i],stations[i],'the run endpoints remain fixed');
 for(let i=8;i<stations.length-8;i++)assert.ok(jogAt(aligned,i)<.15,`the correction creates a ${(jogAt(aligned,i)*100).toFixed(1)} cm jog at ${aligned[i].z.toFixed(1)} m`);
});

test('clearance corrections handle short paint groups without pulling across a lane change',()=>{
 const stations=Array.from({length:24},(_,i)=>({x:i===0||i===23?0:(i%2?.3:-.3),z:i*2,tx:0,tz:1,y:10,yLeft:10,yRight:10,half:i===10||i===11?4.1:i===16?2.3:10,lanes:i===10||i===11?2:i===16?1:4}));
 const contains=(x,z)=>{const half=z>=19&&z<=23?4.1:z>=31&&z<=33?2.3:10;return x>=-half&&x<=half-.6*Math.exp(-((z-20)**2));};
 const free=smoothMarkingStations(stations),aligned=smoothMarkingStations(stations,contains);
 for(let i=0;i<aligned.length;i++){
  for(const key of ['x','z','tx','tz'])assert.ok(Number.isFinite(aligned[i][key]));
  assert.equal(aligned[i].lanes,stations[i].lanes);
  if(i!==10&&i!==11)assert.deepEqual(aligned[i],free[i],'the two-station correction does not reach different painted lines');
 }
 assert.ok(Math.abs(aligned[10].x-aligned[11].x)<.1,'the short painted stretch moves together');
 for(const i of [10,11])for(const o of [-3.725,-3.575,-.075,.075,3.575,3.725])assert.ok(contains(aligned[i].x-aligned[i].tz*o,aligned[i].z+aligned[i].tx*o),'the short paint group stays on its deck');
});

test('an unsupported alignment with no local detour retains the whole measured paint stretch',()=>{
 const stations=Array.from({length:21},(_,i)=>({x:i===10?-.9:0,z:i*2,tx:0,tz:1,y:10,yLeft:10,yRight:10,half:4.1,lanes:2}));
 // The raw cross-section fits a narrow recess. The smoothed centre lies over
 // 50 cm away from any supported location with its heading unchanged.
 const contains=(x,z)=>Math.abs(x+.9*Math.exp(-((z-20)**2)))<=3.75;
 const supported=s=>[-3.725,-3.575,-.075,.075,3.575,3.725].every(o=>contains(s.x-s.tz*o,s.z+s.tx*o));
 assert.ok(stations.every(supported));
 const free=smoothMarkingStations(stations);assert.equal(supported(free[10]),false);
 const aligned=smoothMarkingStations(stations,contains);
 assert.deepEqual(aligned,stations,'fallback keeps one continuous measured stretch rather than inserting a raw station into smooth paint');
 assert.ok(aligned.every(supported));
});

test('interacting deck-edge corrections are revalidated and remain smooth and bounded',()=>{
 const stations=Array.from({length:61},(_,i)=>({x:i===0||i===60?0:(i%2?.3:-.3),z:i*2,tx:0,tz:1,y:10,yLeft:10,yRight:10,half:4.1,lanes:2}));
 // Opposite shoulders intrude 6 m apart. The smaller left intrusion at 58 m
 // initially admits straight paint, but blocks the first detour toward 60 m.
 const contains=(x,z)=>x>=-4.1+.6*Math.exp(-((z-66)**2))+.225*Math.exp(-((z-58)**2))&&x<=4.1-.6*Math.exp(-((z-60)**2));
 const supported=s=>[-3.725,-3.575,-.075,.075,3.575,3.725].every(o=>contains(s.x-s.tz*o,s.z+s.tx*o));
 assert.ok(stations.every(supported));
 const free=smoothMarkingStations(stations);assert.ok(supported(free[29]),'the intervening edge initially admits paint');
 assert.equal(supported(free[30]),false);assert.equal(supported(free[33]),false);
 const aligned=smoothMarkingStations(stations,contains);
 assert.ok(aligned.every(supported),'interpolation cannot introduce new unsupported paint');
 for(const [i,s] of aligned.entries())assert.ok(Math.hypot(s.x-free[i].x,s.z-free[i].z)<=.500001,'a clearance correction remains within half a metre of the road alignment');
 for(let i=8;i<stations.length-8;i++)assert.ok(jogAt(aligned,i)<.15,`interacting constraints leave a ${(jogAt(aligned,i)*100).toFixed(1)} cm jog at ${aligned[i].z.toFixed(1)} m`);
 for(const i of [0,stations.length-1])assert.deepEqual(aligned[i],stations[i]);
});

test('paint alignment preserves curves, endpoints and measured lane widths without changing the survey',()=>{
 const radius=100,stations=Array.from({length:81},(_,i)=>{
  const angle=i*2/radius,noise=i===0||i===80?0:(i%2?.25:-.25),r=radius+noise;
  return{x:r*Math.sin(angle),z:radius-r*Math.cos(angle),tx:Math.cos(angle),tz:Math.sin(angle),y:10+i*.02,yLeft:10+i*.02+.1,yRight:10+i*.02-.1,half:i<40?10:8,lanes:i<40?4:3};
 });
 const original=structuredClone(stations),aligned=smoothMarkingStations(stations);
 assert.deepEqual(stations,original,'pavement and physical parapets keep their raw survey');
 assert.equal(aligned.length,stations.length);
 for(const i of [0,stations.length-1]){
  assert.equal(aligned[i].x,stations[i].x);assert.equal(aligned[i].z,stations[i].z);
  assert.ok(Math.hypot(aligned[i].tx-stations[i].tx,aligned[i].tz-stations[i].tz)<1e-12,'endpoint headings keep paint inside the original cross-section');
 }
 for(const [i,s] of aligned.entries()){
  assert.ok(Math.abs(Math.hypot(s.x,s.z-radius)-radius)<.3,'the curve retains its 100 m radius');
  assert.ok(Math.abs(Math.hypot(s.tx,s.tz)-1)<1e-9,'paint normals use a unit tangent');
  for(const key of ['lanes','half','y','yLeft','yRight'])assert.equal(s[key],stations[i][key],`${key} at station ${i}`);
 }
});

test('alignment keeps paint on the surveyed ramps and preserves oblique merge endpoints',()=>{
 const index=surveyDeckIndex(data);
 const supported=s=>{
  const width=s.half*2,shoulder=Math.max(.3,(width-s.lanes*3.65)/2),lane=(width-2*shoulder)/s.lanes;
  if(lane<3.4)return true;
  for(let k=0;k<=s.lanes;k++)for(const edge of [-.075,.075]){
   const offset=-s.half+shoulder+k*lane+edge,x=s.x-s.tz*offset,z=s.z+s.tx*offset,near=s.y+(offset>0?s.yLeft-s.y:s.y-s.yRight)*offset/s.half;
   if(Number.isNaN(index.deck(x,z,near)))return false;
  }
  return true;
 };
 let checked=0;
 for(const run of uncovered(metro,carriageways.map(c=>c.stations))){
  const aligned=smoothMarkingStations(run,onDeck);
  // Near the Charlestown split, a walk's last chord can be oblique to the
  // deck: replacing its heading swung a shoulder line 4.5 m off the road.
  for(const i of [0,run.length-1])for(const side of [-1,1]){
   const a=edge(run[i],side),b=edge(aligned[i],side);
   assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-9,'merge endpoint paint keeps its surveyed cross-section');
  }
  for(let i=0;i<run.length;i++)if(supported(run[i])){
   checked++;assert.ok(supported(aligned[i]),`paint crosses a deck edge or obstruction at ${run[i].x.toFixed(2)}, ${run[i].z.toFixed(2)}`);
  }
 }
 assert.ok(checked>6000,'checked the mainlines and narrow ramps along the whole survey');
});

test('short or narrow marking runs keep their extents and remain finite',()=>{
 const station={x:0,z:0,tx:0,tz:1,y:10,yLeft:10,yRight:10,half:1.7,lanes:1};
 for(const stations of [[],[station],[station,{...station,z:2}],[station,{...station,x:.1,z:1},{...station,z:2}]]){
  const aligned=smoothMarkingStations(stations);assert.equal(aligned.length,stations.length);
  for(const s of aligned){assert.equal(s.half,1.7);assert.equal(s.lanes,1);for(const key of ['x','z','tx','tz'])assert.ok(Number.isFinite(s[key]));}
 }
});

test('rendered shoulder lines and lane dashes use the smooth alignment and stay on the sloping deck',()=>{
 const height=(x,z)=>10+x*.03+z*.02,half=10;
 const stations=Array.from({length:61},(_,i)=>{
  const x=i===0||i===60?0:(i%2?.3:-.3),z=i*2,angle=i%2?.12:-.12,tx=Math.sin(angle),tz=Math.cos(angle);
  return{x,z,tx,tz,y:height(x,z),yLeft:height(x-tz*half,z+tx*half),yRight:height(x+tz*half,z-tx*half),half,lanes:4};
 });
 const corners=[[-12,-2],[12,-2],[-12,122],[12,122]],geometry={positions:Float32Array.from(corners.flatMap(([x,z])=>[x,height(x,z),z])),roof:new Uint16Array([0,2,1,1,2,3]),facade:new Uint16Array()};
 const asphalt=new THREE.MeshBasicMaterial(),paint=new THREE.MeshBasicMaterial();asphalt.name='asphalt';paint.name='paint';
 const group=addSurveyDeckSurface(new THREE.Group(),{roads:[]},geometry,{asphalt,paint},{carriageways:[{stations}],surface:height});
 let checked=0;
 try{
  for(const mesh of group.children){
   if(mesh.material.name!=='paint')continue;
   const p=mesh.geometry.getAttribute('position');
   for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);if(z<12||z>108)continue;checked++;
    const distance=Math.min(...[-7.3,-3.65,0,3.65,7.3].flatMap(offset=>[Math.abs(x-offset-.075),Math.abs(x-offset+.075)]));
    assert.ok(distance<.003,`rendered paint leaves the straight alignment at ${x}, ${z}`);
    assert.ok(Math.abs(y-height(x,z)-.06)<.003,'paint follows the deck grade and crossfall after alignment');
   }
  }
  assert.ok(checked>500,'both solid shoulders and dashed lane dividers were inspected');
 }finally{group.traverse(o=>o.geometry?.dispose());asphalt.dispose();paint.dispose();}
});
