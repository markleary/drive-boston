import assert from 'node:assert/strict';
import test from 'node:test';
import {readJson,loadMetroCity,windowCity} from './helpers/metro-city.mjs';
import {driveRoadChain} from './helpers/drive-route.mjs';

const city=readJson('city.json'),tunnels=readJson('boston-highways.json').roads;
const roads=[...city.roads,...tunnels];
const endpoint=(road,end)=>({point:road.points.at(end),height:road.elevations.at(end)});
const samePoint=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<.002;

test('South Station elevated source ends have continuous drivable continuations',()=>{
  // The named bridge roads survived the street importer; unnamed GIS features
  // 11016 and 11071 did not. Test the dangling named ends, not a list of newly
  // generated ids, so a renamed/split continuation still has to meet them.
  for(const [id,end] of [['11072-0-0',-1],['11031-0-0',0]]){
    const road=roads.find(r=>r.id===id);assert.ok(road,id);
    const {point,height}=endpoint(road,end);
    const matches=roads.filter(r=>r!==road&&r.elevations).flatMap(r=>r.points.flatMap((p,i)=>samePoint(p,point)&&Math.abs(r.elevations[i]-height)<.02?[r]:[]));
    assert.ok(matches.length,`${id} ends unsupported at ${point}, y=${height}`);
    const width=(road.deckWidths??road.points.map(()=>road.width)).at(end);
    assert.ok(matches.some(r=>r.points.some((p,i)=>samePoint(p,point)&&Math.abs((r.deckWidths?.[i]??r.width)-width)<.1)),`${id} changes width abruptly at its continuation`);
  }
});

test('South Station rising branch connects the highway exit to its elevated connector',()=>{
  const branch=roads.filter(r=>/^i90-eb-exit-134-station-connector(?:-\d+)?$/.test(r.id));
  assert.ok(branch.length,'the omitted unnamed source ramp is generated');
  const ends=branch.flatMap(r=>[endpoint(r,0),endpoint(r,-1)]);
  for(const p of [[1412.659,324.8],[1462.219,173.588]])assert.ok(ends.some(e=>samePoint(e.point,p)),`retains source junction ${p}`);
  const junction=[1412.659,324.8],start=ends.find(e=>samePoint(e.point,junction));
  const parent=roads.filter(r=>/^i90-eb-exit-134-south-station(?:-\d+)?$/.test(r.id));
  assert.ok(parent.some(r=>r.points.some((p,i)=>samePoint(p,junction)&&Math.abs(r.elevations[i]-start.height)<.01)),
    'the branch must match the final parent profile after all dependent ramp solves');
  for(const r of branch)for(let i=1;i<r.points.length;i++){
    const grade=Math.abs(r.elevations[i]-r.elevations[i-1])/Math.hypot(r.points[i][0]-r.points[i-1][0],r.points[i][1]-r.points[i-1][1]);
    assert.ok(grade<.13,`${r.id} has an abrupt rise at ${r.points[i]}`);
  }
});

test('South Station source level-one loop stays on a continuous elevated deck',()=>{
  const loop=roads.filter(r=>/^i90-station-connector-turn(?:-\d+)?$/.test(r.id));
  assert.ok(loop.length,'the complete 546 m source loop is generated');
  assert.ok(loop.every(r=>r.bridge&&!r.tunnel),'a raised loop through a station is not a roofless tunnel excavation');
  const length=loop.reduce((sum,r)=>sum+r.points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-r.points[i][0],p[1]-r.points[i][1]),0),0);
  assert.ok(length>540&&length<550,'retain the real return loop, including its northern reach');
  assert.ok(loop.every(r=>Math.min(...r.elevations)>4),'the missing source piece cannot descend to the ground between its raised ends');
  const passages=readJson('provenance.json').bostonHighways.buildings.passages.filter(p=>p.road==='i90-station-connector-turn');
  assert.ok(passages.length,'the station shell has an elevated passage');
  for(const passage of passages)assert.ok(Math.min(passage.ceiling,passage.ceilingEnd)>9,'passage roof keeps driving clearance above the deck');
});

test('South Station incoming branch matches the named bridge throughout their pavement overlap',()=>{
  const parent=roads.find(r=>r.id==='11072-0-0'),end=parent.points.at(-1),branch=roads.filter(r=>/^i90-eb-exit-134-station-connector(?:-\d+)?$/.test(r.id));
  let matched=0;
  for(const r of branch)for(let i=0;i<r.points.length;i++){
    const p=r.points[i];if(Math.hypot(p[0]-end[0],p[1]-end[1])>30)continue;
    let best;
    for(let j=1;j<parent.points.length;j++){
      const a=parent.points[j-1],b=parent.points[j],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz)));
      const distance=Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t),height=parent.elevations[j-1]+(parent.elevations[j]-parent.elevations[j-1])*t;
      if(!best||distance<best.distance)best={distance,height};
    }
    if(best.distance<(parent.width+(r.deckWidths?.[i]??r.width))/2-.3){
      assert.ok(Math.abs(r.elevations[i]-best.height)<.02,`bridge slab crosses the branch at ${p}`);matched++;
    }
  }
  assert.ok(matched>=4,'check several overlapping stations, not only the shared endpoint');
});

// The source return loop continues north of the screenshot before coming
// back to the other bridge end; load its complete terrain and collision tiles.
const bounds={minX:1100,maxX:1700,minZ:-120,maxZ:430};
let physicalCity;
async function world(){
  if(!physicalCity){const metro=await loadMetroCity({bounds});physicalCity=windowCity(metro,bounds);physicalCity.geometry=metro.geometry;}
  return physicalCity;
}
function ordered(prefix,city){
  return city.roads.filter(r=>r.id===prefix||new RegExp(`^${prefix}-\\d+$`).test(r.id)).sort((a,b)=>(a.id===prefix?0:Number(a.id.slice(prefix.length+1)))-(b.id===prefix?0:Number(b.id.slice(prefix.length+1))));
}
function piece(road,start,end){
  return {...road,points:road.points.slice(start,end),elevations:road.elevations.slice(start,end),...(road.deckWidths?{deckWidths:road.deckWidths.slice(start,end)}:{})};
}
for(const approach of ['highway branch','named connector'])for(const reverse of [false,true])test(`drive South Station ${approach} through restored turn ${reverse?'reverse':'forward'}`,async()=>{
  const city=await world(),turn=ordered('i90-station-connector-turn',city),out=city.roads.find(r=>r.id==='11031-0-0');
  const incoming=approach==='highway branch'?ordered('i90-eb-exit-134-station-connector',city):[piece(city.roads.find(r=>r.id==='11072-0-0'),-12)];
  assert.ok(incoming.length&&turn.length,'source-complete route is installed');
  if(approach==='highway branch'){
    const join=incoming[0].points[0],parent=ordered('i90-eb-exit-134-south-station',city).find(r=>r.points.some(p=>samePoint(p,join)));
    assert.ok(parent,'branch attaches to the actual highway exit');
    const j=parent.points.findIndex(p=>samePoint(p,join));
    assert.ok(j>0,'exit has an approach to the branch');incoming.unshift(piece(parent,Math.max(0,j-8),j+1));
  }
  await driveRoadChain(city,[...incoming,...turn,piece(out,0,12)],{reverse,speed:5});
});
