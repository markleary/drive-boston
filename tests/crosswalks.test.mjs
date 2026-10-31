import assert from 'node:assert/strict';
import test from 'node:test';
import {junctionIndex,junctionIndexSteps,planCrosswalks,STRIPE_LENGTH,CROSSWALK_SETBACK,MIN_SPACING} from '../src/simulation/crosswalks.ts';
import {pavementEdges,pavementSpan,polylineLength} from '../src/simulation/tile-format.ts';
import {roadMidpoint} from '../src/simulation/road-tile-coverage.ts';
import {hasMetroData,loadMetroCity} from './helpers/metro-city.mjs';

const road=(id,points,width,name=id,extra={})=>({id,name,points,width,oneway:0,...extra});
const near=(a,b,tolerance=.05)=>Math.abs(a-b)<tolerance;
const plan=(roads,{signals=[],edges=new Map(),others=[]}={})=>planCrosswalks(roads,junctionIndex(roads,signals),r=>edges.get(r.id),others);
const on=(list,id)=>list.filter(c=>c.road.id===id).sort((a,b)=>a.at[0]-b.at[0]||a.at[1]-b.at[1]);

test('crosswalks belong to junctions: a stem is striped across its mouth, the through street beside a comparable street, never at a dead end or a mid-street split',()=>{
  // Main Street, 16 m class, split mid-block at x=100; Side Street (12.2 m) ends on its mid-vertex, Narrow Lane (9 m) on the other half, both dead-ending away from it.
  const m1=road('m1',[[0,0],[50,0],[100,0]],16,'Main Street'),m2=road('m2',[[100,0],[150,0],[175,0],[200,0]],16,'Main Street');
  const side=road('side',[[50,0],[50,80]],12.2,'Side Street'),lane=road('lane',[[175,0],[175,60]],9,'Narrow Lane'),dead=road('dead',[[150,0],[150,-80]],12.2,'Dead Street');
  const out=plan([m1,m2,side,lane,dead]);
  const main=on(out,'m1').concat(on(out,'m2'));
  assert.deepEqual(main.map(c=>+c.at[0].toFixed(1)),[42.9,57.1,142.9,157.1],'both sides of Side Street and Dead Street (half 6.1 m plus the 1 m setback), nothing at the ends, the split or the 9 m lane');
  assert.ok(main.every(c=>near(c.at[1],0)&&near(Math.abs(c.tx),1)),'stations on the centerline, stripes along it');
  assert.deepEqual(main.map(c=>c.span),[[-8,8],[-8,8],[-8,8],[-8,8]],'the nominal width without a record');
  const [mouth]=on(out,'side');assert.ok(mouth&&near(mouth.at[0],50)&&near(mouth.at[1],8+CROSSWALK_SETBACK)&&near(mouth.tz,1),`Side Street's crosswalk starts 1 m beyond Main Street's half width, heading away (${mouth?.at})`);
  assert.equal(on(out,'side').length,1,'no crosswalk at Side Street\'s dead end');
  const [laneMouth]=on(out,'lane');assert.ok(laneMouth&&near(laneMouth.at[1],9),'the narrow lane is still striped across its own mouth');
  assert.equal(on(out,'dead').length,1);assert.equal(out.length,7);
});

test('a traffic signal justifies crosswalks across the through street at a narrow side street; an alley or an unnamed way never does',()=>{
  const main=road('main',[[0,0],[50,0],[100,0],[150,0]],16,'Main Street'),lane=road('lane',[[50,0],[50,60]],9,'Narrow Lane'),alley=road('alley',[[100,0],[100,-40]],7,'Back Alley');
  assert.deepEqual(on(plan([main,lane,alley]),'main'),[],'neither the 9 m lane nor the alley stripes the 16 m street');
  const lit=plan([main,lane,alley],{signals:[[52,3]]});
  assert.deepEqual(on(lit,'main').map(c=>+c.at[0].toFixed(1)),[44.5,55.5],'with a signal at the lane: offsets of 4.5 m plus the setback');
  assert.ok(on(lit,'main').every(c=>c.priority>100),'signal crosswalks outrank the rest');
  assert.equal(on(lit,'alley').length,0,'alleys are not striped');
  // A 5 m lane at a signal puts the two sides' centres 10 m apart, under the minimum spacing: both sides of one junction stay.
  const narrow=plan([main,road('path',[[50,0],[50,60]],5,'Narrow Path')],{signals:[[52,3]]});
  assert.deepEqual(on(narrow,'main').map(c=>+c.at[0].toFixed(1)),[46.5,53.5],'both sides of the signalled junction');
});

test('the junction index builds in steps so a tile build can pace it',()=>{
  const roads=Array.from({length:1000},(_,i)=>road(`r${i}`,[[i*10,0],[i*10,50]],7));
  const steps=junctionIndexSteps(roads,[]);let yields=0,r=steps.next();while(!r.done){yields++;r=steps.next();}
  assert.equal(yields,2,'a yield every 400 roads');assert.equal(r.value.legsAt([40,0]).length,1);
  assert.equal(junctionIndex(roads,[]).legsAt([40,50]).length,1,'the synchronous wrapper builds the same index');
});

test('the station follows the crossing street\'s measured record, so a side street meeting a wide roadway is striped beyond its far curb, not inside it',()=>{
  // Twin one-way carriageways 12 m apart whose records both span the whole 28 m roadway (z -20..8); a side street
  // leaves the north line southward across the south line without a node there (Hathorn Street at Broadway).
  const north=road('north',[[0,0],[100,0],[200,0]],16,'Broadway',{oneway:1,pavedWidth:27.9}),south=road('south',[[200,-12],[104,-12],[0,-12]],16,'Broadway',{oneway:1,pavedWidth:27.9});
  const stem=road('stem',[[100,0],[100,-80]],12.2,'Hathorn Street'),branch=road('branch',[[104,-12],[104,60]],12.2,'Franklin Street');
  const strip=(z0,z1)=>({left:[[0,z0],[200,z0]],right:[[0,z1],[200,z1]]});
  const edges=new Map([['north',strip(-20,8)],['south',strip(-20,8)],['stem',{left:[[94,0],[94,-80]],right:[[106,0],[106,-80]]}]]);
  const out=plan([north,south,stem,branch],{edges,others:[...edges.values()]});
  const [mouth]=on(out,'stem');assert.ok(mouth&&near(mouth.at[1],-20-CROSSWALK_SETBACK,.6)&&near(mouth.tz,-1),`the stem's crosswalk starts just beyond the roadway's south edge (${mouth?.at})`);
  assert.deepEqual(mouth.span.map(v=>+v.toFixed(1)),[-6,6],'and spans the stem\'s own record');
  const [far]=on(out,'branch');assert.ok(far&&near(far.at[1],8+CROSSWALK_SETBACK,.6),`the branch leaving north is striped beyond the north edge (${far?.at})`);
  // The two carriageways split at x=100 and x=104 would each stripe the shared asphalt on both sides: one crosswalk per side survives.
  const across=out.filter(c=>c.road.name==='Broadway').sort((a,b)=>a.at[0]-b.at[0]);
  assert.equal(across.length,2,`one crosswalk each side of the junction, not two (${across.map(c=>c.road.id+'@'+c.at[0].toFixed(1))})`);
  assert.ok(across.every(c=>c.span[1]-c.span[0]>27),'each spans the whole roadway');
  assert.ok(across[1].at[0]-across[0].at[0]>MIN_SPACING,'and they stay apart');
});

test('a fork\'s asphalt widening past the node is walked out of before the stripes start',()=>{
  // Two streets diverging at 30 degrees from a junction with a cross street; the straight one's record flares toward the other.
  const straight=road('straight',[[0,0],[80,0]],7,'Washington Street'),fork=road('fork',[[0,0],[69.3,40]],7,'Washington Street'),cross=road('cross',[[0,-60],[0,0],[0,60]],10,'Marginal Road');
  const flare={left:[[0,-3.5],[80,-3.5]],right:[[0,3.5],[10,6],[30,16],[80,16]]};
  const edges=new Map([['straight',flare]]);
  const out=plan([straight,fork,cross],{edges,others:[flare]});
  const [onFork]=on(out,'fork');assert.ok(onFork,'the fork is striped across its mouth');
  // The fork line z=x/sqrt(3) leaves the flare (z=6 at x=10 rising to 16 at x=30) about 17.5 m out; the record at the node alone would stop it at 4.5 m.
  const d=Math.hypot(onFork.at[0],onFork.at[1]);assert.ok(d>17&&d<21,`beyond where the straight street's record still covers it (${d.toFixed(1)} m out, not 4.5)`);
});

test('crosswalks on one roadway closer than the minimum spacing keep the stronger junction; parallel streets are not confused for one roadway',()=>{
  const main=road('main',[[0,0],[40,0],[47,0],[100,0]],16,'Main Street'),a=road('a',[[40,0],[40,60]],12.2,'First Street'),b=road('b',[[47,0],[47,-60]],12.2,'Second Street');
  const twin=road('twin',[[0,30],[40,30],[100,30]],16,'Other Street'),c=road('c',[[40,30],[40,90]],12.2,'Third Street');
  const out=plan([main,a,b,twin,c]);
  assert.deepEqual(on(out,'main').map(c=>+c.at[0].toFixed(1)),[32.9,54.1],'the crosswalks between the two side streets, 7 m apart, collapse to the outer pair');
  assert.deepEqual(on(out,'twin').map(c=>+c.at[0].toFixed(1)),[32.9,47.1],'the street 30 m away keeps its own pair');
});

test('Hathorn Street at Broadway in Somerville is striped beyond the south carriageway, and no crosswalk on the tile lies inside a crossing roadway record',{skip:!hasMetroData()},async()=>{
  const key='-1_-5',city=await loadMetroCity({tiles:[key]}),tile=city.loadedTiles.get(key),x0=tile.tx*tile.size,z0=tile.tz*tile.size;
  const owned=city.roads.filter(r=>{const m=roadMidpoint(r);return m[0]>=x0&&m[0]<x0+tile.size&&m[1]>=z0&&m[1]<z0+tile.size;});
  const records=new Map();for(const p of [...tile.pavements,...tile.borderPavements])if(!records.has(p.road))records.set(p.road,p);
  const edgesOf=r=>{const p=records.get(r.id);return p&&p.edges.length>=8?pavementEdges(tile,p):undefined;},others=[...records.values()].map(p=>pavementEdges(tile,p));
  const out=planCrosswalks(owned,junctionIndex(city.roads,city.signals),edgesOf,others);
  const hathorn=out.filter(c=>c.road.id==='osm-9430150-0').sort((a,b)=>a.at[1]-b.at[1]);
  assert.equal(hathorn.length,2,'a crosswalk at each end of Hathorn Street');
  const south=city.roads.find(r=>r.id==='osm-682681927-0'),southEdge=pavementSpan(edgesOf(south),[-585,-4094],.94,.35);
  assert.ok(southEdge&&southEdge[1]>7.5&&southEdge[1]<10,`the south carriageway's record reaches ${southEdge?.[1].toFixed(1)} m south of its centerline`);
  const [mouth]=hathorn;assert.ok(mouth.at[1]>-4089&&mouth.at[1]<-4085,`the mouth crosswalk starts beyond that edge, not between the carriageways at 8 m (${mouth.at})`);
  const broadway=out.filter(c=>c.road.name==='Broadway'&&c.at[0]>-650&&c.at[0]<-350).sort((a,b)=>a.at[0]-b.at[0]);
  assert.ok(broadway.length>=8&&broadway.length<=14,`Broadway between Cross Street and Lombardi Street keeps a crosswalk per junction side, not per carriageway split (${broadway.length})`);
  for(let i=1;i<broadway.length;i++)assert.ok(Math.hypot(broadway[i].at[0]-broadway[i-1].at[0],broadway[i].at[1]-broadway[i-1].at[1])>MIN_SPACING-1,'spaced along the roadway');
  // The invariant the screenshot broke: no crosswalk centre inside the record of another street that meets its road
  // (a connector under 18 m measures its width to the roadway it lies in, so its record is skipped as the planner does;
  // the branches of a street forking around a median, Middlesex Avenue at Mystic Avenue, share one synthetic roadway).
  const index=junctionIndex(city.roads,city.signals),nearest=(p,line)=>{let best;for(let i=1;i<line.length;i++){const [x0,z0]=line[i-1],dx=line[i][0]-x0,dz=line[i][1]-z0,l2=dx*dx+dz*dz;if(!l2)continue;const u=Math.max(0,Math.min(1,((p[0]-x0)*dx+(p[1]-z0)*dz)/l2)),x=x0+dx*u,z=z0+dz*u,d=Math.hypot(p[0]-x,p[1]-z);if(!best||d<best.d){const l=Math.sqrt(l2);best={d,at:[x,z],tx:dx/l,tz:dz/l};}}return best;};
  const inside=[];
  for(const c of out){const p=[c.at[0]+c.tx*STRIPE_LENGTH/2,c.at[1]+c.tz*STRIPE_LENGTH/2],meeting=new Set();
    for(const v of c.road.points)if(Math.hypot(v[0]-p[0],v[1]-p[1])<35)for(const l of index.legsAt(v))if(l.road!==c.road&&l.road.name!==c.road.name&&!l.road.elevations&&polylineLength(l.road.points)>=18)meeting.add(l.road);
    for(const r of meeting){const e=edgesOf(r);if(!e)continue;const n=nearest(p,r.points);if(!n||Math.abs(n.tx*c.tx+n.tz*c.tz)>=.8)continue;const span=pavementSpan(e,n.at,n.tx,n.tz);if(!span)continue;const off=(p[1]-n.at[1])*n.tx-(p[0]-n.at[0])*n.tz;if(off>span[0]+.5&&off<span[1]-.5)inside.push(`${c.road.name} at ${p.map(v=>v.toFixed(0))} in ${r.name} (${r.id})`);}}
  assert.deepEqual(inside,[]);
});

test('Boylston Street\'s carriageways split between tiles -4_2 and -5_2 keep one crosswalk per side of the junction when each tile plans the roads near it',{skip:!hasMetroData()},async()=>{
  const keys=['-4_2','-5_2'],city=await loadMetroCity({tiles:keys}),index=junctionIndex(city.roads,city.signals),kept=[];
  for(const key of keys){
    const tile=city.loadedTiles.get(key),x0=tile.tx*tile.size,z0=tile.tz*tile.size,x1=x0+tile.size,z1=z0+tile.size;
    const owns=r=>{const m=roadMidpoint(r);return m[0]>=x0&&m[0]<x1&&m[1]>=z0&&m[1]<z1;};
    // The builder plans the roads whose bounds overlap the owned roads' extents grown by 40 m and draws the owned ones.
    const ownedRoads=city.roads.filter(owns),owned=new Set(ownedRoads),box=r=>({minX:Math.min(...r.points.map(p=>p[0])),maxX:Math.max(...r.points.map(p=>p[0])),minZ:Math.min(...r.points.map(p=>p[1])),maxZ:Math.max(...r.points.map(p=>p[1]))});
    const reach=ownedRoads.map(box).reduce((a,b)=>({minX:Math.min(a.minX,b.minX),maxX:Math.max(a.maxX,b.maxX),minZ:Math.min(a.minZ,b.minZ),maxZ:Math.max(a.maxZ,b.maxZ)}));
    const near=city.roads.filter(r=>{const b=box(r);return b.minX<=reach.maxX+40&&b.maxX>=reach.minX-40&&b.minZ<=reach.maxZ+40&&b.maxZ>=reach.minZ-40;});
    const records=new Map();for(const p of [...tile.pavements,...tile.borderPavements])if(!records.has(p.road))records.set(p.road,p);
    const edgesOf=r=>{const p=records.get(r.id);return p&&p.edges.length>=8?pavementEdges(tile,p):undefined;},others=[...records.values()].map(p=>pavementEdges(tile,p));
    assert.ok(planCrosswalks(ownedRoads,index,edgesOf,others).some(c=>c.road.name==='Boylston Street'&&Math.abs(c.at[0]+4203)<2),`planned alone, tile ${key} keeps a Boylston Street crosswalk at x -4203`);
    kept.push(...planCrosswalks(near,index,edgesOf,others).filter(c=>owned.has(c.road)).map(c=>({...c,tile:key})));
  }
  const boylston=kept.filter(c=>c.road.name==='Boylston Street'&&Math.abs(c.at[0]+4203)<2);
  assert.equal(boylston.length,1,`one crosswalk across the roadway at x -4203, not one per tile (${boylston.map(c=>c.tile+':'+c.road.id)})`);
  for(const a of kept)for(const b of kept){if(a===b||a.tile===b.tile||Math.abs(a.tx*b.tx+a.tz*b.tz)<.8)continue;const d=Math.hypot(a.at[0]-b.at[0],a.at[1]-b.at[1]);assert.ok(d>=MIN_SPACING||Math.hypot(a.node[0]-b.node[0],a.node[1]-b.node[1])<1,`${a.road.name} and ${b.road.name} ${d.toFixed(1)} m apart across the border`);}
});
