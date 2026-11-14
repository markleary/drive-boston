import assert from 'node:assert/strict';
import test from 'node:test';
import {junctionIndex,junctionIndexSteps,planCrosswalks,STRIPE_LENGTH,CROSSWALK_SETBACK,MIN_SPACING} from '../src/simulation/crosswalks.ts';
import {pavementEdges,pavementSpan,polylineLength} from '../src/simulation/tile-format.ts';
import {roadMidpoint} from '../src/simulation/road-tile-coverage.ts';
import {drawnStreets} from '../src/simulation/drawn-streets.ts';
import {hasMetroData,loadMetroCity} from './helpers/metro-city.mjs';

const road=(id,points,width,name=id,extra={})=>({id,name,points,width,oneway:0,...extra});
const near=(a,b,tolerance=.05)=>Math.abs(a-b)<tolerance;
const plan=(roads,{signals=[],edges=new Map(),others=[],ground}={})=>planCrosswalks(roads,junctionIndex(roads,signals),r=>edges.get(r.id),others,ground);
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
  // (This test is about the walk alone: with a tile that draws no asphalt beside the stripes they end at the roadway's edge wherever they stand.)
  const bare={spans:(x,z,nx,nz,from,to)=>({spans:[],known:[from,to]})},out=plan([straight,fork,cross],{edges,others:[flare],ground:bare});
  const [onFork]=on(out,'fork');assert.ok(onFork,'the fork is striped across its mouth');
  // The fork line z=x/sqrt(3) leaves the flare (z=6 at x=10 rising to 16 at x=30) about 17.5 m out; the record at the node alone would stop it at 4.5 m.
  const d=Math.hypot(onFork.at[0],onFork.at[1]);assert.ok(d>17&&d<21,`beyond where the straight street's record still covers it (${d.toFixed(1)} m out, not 4.5)`);
});

test('a crosswalk in mid block crosses its roadway whole or is not drawn, and none that ends short comes in for it',()=>{
  // Lane Street leaves a node beside Wide Avenue, which forks off at 10 degrees: the lane's line stays inside the avenue's record
  // for the 30 m the walk goes, so its crosswalk stands 31 m out, across its own 7 m and no more. Side Street ends the block at
  // x 45, with a candidate of its own 6 m before it that the first one crowds out.
  const A=10*Math.PI/180,far=[Math.cos(A)*120,Math.sin(A)*120];
  const lane=road('lane',[[0,0],[45,0]],7,'Lane Street'),avenue=road('avenue',[[0,0],far],16,'Wide Avenue'),side=road('side',[[45,-60],[45,0],[45,60]],10,'Side Street');
  const ribbon=(a,b,h)=>{const l=Math.hypot(b[0]-a[0],b[1]-a[1]),n=[-(b[1]-a[1])/l,(b[0]-a[0])/l];return {left:[[a[0]-n[0]*h,a[1]-n[1]*h],[b[0]-n[0]*h,b[1]-n[1]*h]],right:[[a[0]+n[0]*h,a[1]+n[1]*h],[b[0]+n[0]*h,b[1]+n[1]*h]]};};
  const edges=new Map([['lane',ribbon([0,0],[45,0],3.5)],['avenue',ribbon([0,0],far,8)]]),others=[...edges.values()];
  // The asphalt a tile draws, as its `spans` gives it: the paved stretches of a line, here sampled every 5 cm.
  const drawn=inside=>({spans(x,z,nx,nz,from,to){const out=[];let on=false;for(let s=from;s<=to+1e-9;s+=.05){const hit=inside(x+nx*s,z+nz*s);if(hit!==on)out.push(s);on=hit;}if(on)out.push(to);return {spans:out,known:[from,to]};}});
  const onLane=(x,z)=>x>=0&&x<=45&&Math.abs(z)<=3.5,onAvenue=(x,z)=>{const u=x*Math.cos(A)+z*Math.sin(A),v=-x*Math.sin(A)+z*Math.cos(A);return u>=0&&u<=120&&Math.abs(v)<=8;},onSide=x=>Math.abs(x-45)<=5;
  const at=inside=>on(plan([lane,avenue,side],{edges,others,ground:drawn(inside)}),'lane').map(c=>+c.at[0].toFixed(1));
  assert.deepEqual(at((x,z)=>onLane(x,z)||onAvenue(x,z)||onSide(x)),[],'one sheet of asphalt from the lane to the avenue\'s far kerb: the stripes would end 10 m short of it, and the candidate before Side Street 11 m');
  assert.deepEqual(at((x,z)=>onLane(x,z)||(onAvenue(x,z)&&x<29)||onSide(x)),[31],'where the two roadways have parted, the stripes cross the lane from kerb to kerb and stay');
  // Less than a lane of asphalt beyond the end is the kerb's own shoulder; a lane or more is a roadway left uncrossed.
  const strip=w=>(x,z)=>onLane(x,z)||(x>=0&&x<=40&&z>3.5&&z<=3.5+w)||onSide(x);
  assert.deepEqual(at(strip(3)),[31],'3 m of asphalt beyond the end: the stripes reach the roadway\'s edge');
  assert.deepEqual(at(strip(3.4)),[31],'3.4 m beyond it: still within the 3.5 m, though the ground beyond begins 10 cm short of them');
  assert.deepEqual(at(strip(3.6)),[],'3.6 m beyond it: a lane left uncrossed');
  assert.deepEqual(at(strip(4)),[],'4 m beyond it: they do not');
  // A slit between two sheets of asphalt is no edge.
  assert.deepEqual(at((x,z)=>(onLane(x,z)||onAvenue(x,z)||onSide(x))&&!(z>3.5&&z<3.6)),[],'a 10 cm slit along the lane\'s edge does not end the roadway');
  assert.deepEqual(at((x,z)=>(onLane(x,z)||onAvenue(x,z)||onSide(x))&&!(z>6.8&&z<6.9)),[],'nor does one 3.3 m out, where the 3.5 m end: the asphalt is read a break\'s width further');
  // The tip of the island between the two roadways may stand beside the end of the stripes (they reach from x 31 to 34).
  assert.deepEqual(at((x,z)=>onLane(x,z)||(onAvenue(x,z)&&x<35)||onSide(x)),[31],'the island begins a metre beyond the stripes: they end at its tip');
  // Further on it is no end for them; the candidate before Side Street stands beside it and comes in, since it crosses the lane whole.
  assert.deepEqual(at((x,z)=>onLane(x,z)||(onAvenue(x,z)&&x<36)||onSide(x)),[39],'the island begins 2 m beyond the stripes: they leave, and the crosswalk before Side Street takes their place');
  // Ground the tile cannot see is judged by the records it holds: the avenue's record lies beyond the lane's edge.
  assert.deepEqual(on(plan([lane,avenue,side],{edges,others}),'lane'),[],'without the drawn asphalt, the avenue\'s record beyond the end');
});

test('crosswalks on one roadway closer than the minimum spacing keep the stronger junction; parallel streets are not confused for one roadway',()=>{
  const main=road('main',[[0,0],[40,0],[47,0],[100,0]],16,'Main Street'),a=road('a',[[40,0],[40,60]],12.2,'First Street'),b=road('b',[[47,0],[47,-60]],12.2,'Second Street');
  const twin=road('twin',[[0,30],[40,30],[100,30]],16,'Other Street'),c=road('c',[[40,30],[40,90]],12.2,'Third Street');
  const out=plan([main,a,b,twin,c]);
  assert.deepEqual(on(out,'main').map(c=>+c.at[0].toFixed(1)),[32.9,54.1],'the crosswalks between the two side streets, 7 m apart, collapse to the outer pair');
  assert.deepEqual(on(out,'twin').map(c=>+c.at[0].toFixed(1)),[32.9,47.1],'the street 30 m away keeps its own pair');
});

test('a crosswalk reaches across a twin carriageway whose far edge steps under its line, unless another crosswalk already crosses there',()=>{
  // Two one-way carriageways of one roadway, 8 m apart, their records touching at z 4. A side street meets the north one at x 100,
  // so it is striped at x 92.9 and 107.1; the south record's far edge jogs from 12 to 14 m between x 106.6 and 107.6 (a ramp's
  // landing beginning there), right under the eastern station's line.
  const north=road('north',[[0,0],[100,0],[200,0]],16,'Broadway',{oneway:1}),stem=road('stem',[[100,0],[100,-80]],12.2,'Side Street');
  const south=road('south',[[200,8],[118,8],[0,8]],16,'Broadway',{oneway:1}),other=road('other',[[118,8],[118,80]],12.2,'Other Street');
  const southRecord={left:[[0,4],[200,4]],right:[[0,12],[106.6,12],[107.6,14],[200,14]]};
  const alone=new Map([['north',{left:[[0,-4],[200,-4]],right:[[0,4],[200,4]]}],['south',southRecord]]);
  const [west,east]=on(plan([north,stem,south],{edges:alone,others:[...alone.values()]}),'north');
  assert.deepEqual([west.at[0],east.at[0]].map(v=>+v.toFixed(1)),[92.9,107.1]);
  assert.deepEqual(west.span.map(v=>+v.toFixed(1)),[-12,4],'where the south record runs straight the western stripes cross both carriageways');
  assert.deepEqual(east.span.map(v=>+v.toFixed(1)),[-4,13],'and so do the eastern ones, to where the far edge is nearer over their 3 m; they ended on the middle line of the roadway (4 m) when the jog lay under their line');
  // The south carriageway now has a junction of its own at x 118 and stripes at x 110.9, 4 m from the eastern ones along the road,
  // and the north record's far edge jogs under that line in turn: each crosswalk would reach across the other's carriageway.
  const both=new Map([['north',{left:[[0,-4],[110.4,-4],[111.4,-6],[200,-6]],right:[[0,4],[200,4]]}],['south',southRecord]]);
  const out=plan([north,stem,south,other],{edges:both,others:[...both.values()]}),[,ne]=on(out,'north'),[sw]=on(out,'south');
  assert.equal(on(out,'north').length,2);assert.equal(on(out,'south').length,2,'every crosswalk the thinning keeps stays');
  assert.ok(near(ne.at[0],107.1)&&near(sw.at[0],110.9),`the two that face each other (${ne.at[0].toFixed(1)}, ${sw.at[0].toFixed(1)})`);
  assert.deepEqual(ne.span.map(v=>+v.toFixed(1)),[-4,4],'the north one keeps to its carriageway, where the south one already crosses the other');
  assert.deepEqual(sw.span.map(v=>+v.toFixed(1)),[-6,4],'and the south one to its own: neither crowds the other out, neither paints over the other');
});

test('such a crosswalk grows only to the edge of the roadway, and over no other crosswalk\'s stripes',()=>{
  // The same two carriageways and the jog under the eastern station's line, which takes those stripes from 4 to 13 m.
  const north=road('north',[[0,0],[100,0],[200,0]],16,'Broadway',{oneway:1}),stem=road('stem',[[100,0],[100,-80]],12.2,'Side Street'),south=road('south',[[200,8],[0,8]],16,'Broadway',{oneway:1});
  const records=new Map([['north',{left:[[0,-4],[200,-4]],right:[[0,4],[200,4]]}],['south',{left:[[0,4],[200,4]],right:[[0,12],[106.6,12],[107.6,14],[200,14]]}]]);
  const east=out=>on(out,'north')[1].span.map(v=>+v.toFixed(1));
  assert.deepEqual(east(plan([north,stem,south],{edges:records,others:[...records.values()]})),[-4,13],'with open ground beyond the south carriageway');
  // Another street's record lies beyond that edge on all three lines of the stripes (the mouth of a street in the middle of a
  // junction, as beyond a slip lane's record): the stripes would end on asphalt, and stay on their own carriageway.
  const mouth={left:[[104,13],[104,80]],right:[[125,13],[125,80]]};
  assert.deepEqual(east(plan([north,stem,south],{edges:records,others:[...records.values(),mouth]})),[-4,4],'not into a junction');
  // Beyond a kerb at an angle two of the three lines still run on a roadway: one line on open ground is the edge.
  const corner={left:[[109,13],[109,80]],right:[[125,13],[125,80]]};
  assert.deepEqual(east(plan([north,stem,south],{edges:records,others:[...records.values(),corner]})),[-4,13],'to a kerb\'s corner');
  // A street meets the south carriageway at 45 degrees and is striped across its mouth, whose stripes reach back onto that
  // carriageway under the part the eastern crosswalk would add. They run another way, so the thinning keeps both.
  const cut=road('south',[[200,8],[98,8],[0,8]],16,'Broadway',{oneway:1}),skew=road('skew',[[98,8],[158,68]],11.9,'Skew Street');
  const out=plan([north,stem,cut,skew],{edges:records,others:[...records.values()]}),[mouthStripes]=on(out,'skew');
  assert.ok(mouthStripes&&near(Math.abs(mouthStripes.tx*1+mouthStripes.tz*0),Math.SQRT1_2,.01),'the skew street\'s own crosswalk');
  assert.equal(on(out,'north').length,2);assert.deepEqual(east(out),[-4,4],'not over another crosswalk');
});

test('a vertex within a metre of a node gives it no leg: a street\'s own continuation is no street crossing it',()=>{
  // Main Street is split at x 100 and its eastern half has a vertex 0.6 m from the split. The leg from that vertex back to the
  // node pointed along the western half, which so met "another street" as wide as itself at every such split.
  const west=road('west',[[0,0],[100,0]],16,'Main Street'),east=road('east',[[100,0],[100.6,0],[200,0]],16,'Main Street'),lane=road('lane',[[100,0],[100,60]],9,'Narrow Lane');
  assert.deepEqual(on(plan([west,east,lane]),'west'),[],'a 9 m lane does not stripe the 16 m street, with or without the stray vertex');
  assert.deepEqual(on(plan([west,east,lane]),'east'),[]);
  assert.equal(plan([west,east]).length,0,'and a split with nothing but that vertex is no junction');
  // Beside a comparable street the crosswalk stands at the side street's edge. Counted as a crossing street, the eastern half's
  // record, which ends on the node, held it at the 30 m where the walk out of a record gives up.
  const side=road('side',[[100,0],[100,60]],12.2,'Side Street'),records=new Map([['east',{left:[[100,-8],[200,-8]],right:[[100,8],[200,8]]}]]);
  const [w]=on(plan([west,east,side],{edges:records,others:[...records.values()]}),'west');
  assert.ok(w&&near(w.at[0],92.9),`7.1 m from the node, not 31 (${w?.at[0].toFixed(1)})`);
});

test('a road\'s own legs justify no crosswalk on it, and are measured by their width, not walked out of its own record',()=>{
  // Elm Road turns 45 degrees at x 100, where Oak Road carries straight on. Seen from its western part, the road that runs on is
  // Oak Road and its own eastern part is the street that meets it.
  const elm=road('elm',[[0,0],[100,0],[160,60]],12.2,'Elm Road'),oak=road('oak',[[100,0],[200,0]],12.2,'Oak Road');
  const records=new Map([['elm',{left:[[0,-6.1],[100,-6.1],[160,53.9]],right:[[0,6.1],[100,6.1],[160,66.1]]}],['oak',{left:[[100,-6.1],[200,-6.1]],right:[[100,6.1],[200,6.1]]}]]);
  const out=plan([elm,oak],{edges:records,others:[...records.values()]});
  assert.deepEqual(on(out,'elm').filter(c=>c.at[0]<100),[],'no crosswalk west of the bend: only the road itself meets its western part there');
  const [east]=on(out,'elm').filter(c=>c.at[0]>100);assert.ok(east&&Math.hypot(east.at[0]-100,east.at[1])<12,`its eastern part is striped where it leaves Oak Road (${east&&Math.hypot(east.at[0]-100,east.at[1]).toFixed(1)} m from the bend)`);
  // With a third street on the bend the western part is striped too, and its own eastern part counts by its width (6.1 m
  // across at 45 degrees is 8.6 m along): walked out of its own record it never left it.
  const ash=road('ash',[[100,0],[100,-60]],12.2,'Ash Street'),all=plan([elm,oak,ash],{edges:records,others:[...records.values()]}),[west]=on(all,'elm').filter(c=>c.at[0]<100);
  assert.ok(west&&near(west.at[0],100-8.6-1,.2),`9.6 m from the bend (${west&&(100-west.at[0]).toFixed(1)}), not 31`);
});

test('beyond its end a record stands in for the road that runs on from it, and gives way to that road\'s own record',()=>{
  // Vine Street leaves a node eastward; a ramp carries its line back west. Dock Road comes in 140 degrees off its way, 16 m wide
  // on Vine Street's side where the ramp lands on it, and runs on as another road that bends 21 degrees away and is 12.5 m
  // wide on that side. Carried straight on, the width of the first record holds Vine Street 25 m up; the second record, the
  // roadway that is really there, ends 15 m up, and its edge meets Vine Street's far kerb 2.5 m further.
  const a=Math.PI*140/180,b=-Math.PI*61/180,ray=(angle,l)=>[Math.cos(angle)*l,Math.sin(angle)*l],off=(p,angle,o)=>[p[0]-Math.sin(angle)*o,p[1]+Math.cos(angle)*o];
  const vine=road('vine',[[0,0],[100,0]],9,'Vine Street'),ramp=road('ramp',[[-100,0],[0,0]],7,'Exit',{kind:'motorway_link'});
  const dockIn=road('in',[ray(a,80),[0,0]],12,'Dock Road'),dockOn=road('on',[[0,0],ray(b,100)],12,'Dock Road');
  // Offsets across each line by its own direction of travel; Vine Street lies on the positive side of the first, the negative of the second.
  const strip=(from,to,angle,lo,hi)=>({left:[off(from,angle,lo),off(to,angle,lo)],right:[off(from,angle,hi),off(to,angle,hi)]});
  const wide=strip(ray(a,80),[0,0],a+Math.PI,-5,16),onward=strip([0,0],ray(b,100),b,-5,12.5),at=out=>on(out,'vine')[0]?.at[0];
  const records=new Map([['in',wide],['on',onward]]);
  assert.ok(near(at(plan([vine,ramp,dockIn,dockOn],{edges:records,others:[...records.values()]})),18.5,.1),`a metre beyond the far corner of the road that runs on (${at(plan([vine,ramp,dockIn,dockOn],{edges:records,others:[...records.values()]}))?.toFixed(1)} m)`);
  const alone=new Map([['in',wide]]);
  assert.ok(near(at(plan([vine,ramp,dockIn,dockOn],{edges:alone,others:[...alone.values()]})),26,.1),`where that road's record is not at hand, the stand-in is all there is: 26 m (${at(plan([vine,ramp,dockIn,dockOn],{edges:alone,others:[...alone.values()]}))?.toFixed(1)})`);
  // Within a stripes' length of each other the two agree, and the stand-in stays: it is the kerb on its own side of the mouth.
  const close=new Map([['in',strip(ray(a,80),[0,0],a+Math.PI,-5,11.5)],['on',onward]]),near18=at(plan([vine,ramp,dockIn,dockOn],{edges:close,others:[...close.values()]}));
  assert.ok(near(near18,19,.1),`a record 11.5 m wide holds Vine Street 18 m up, under 3 m beyond the corner: it stays (${near18?.toFixed(1)} m)`);
  // Where the road that runs on leaves square to Vine Street and is narrow, its corner lies 4 m up; the first record's own
  // end still reaches 10 m up Vine Street at its corner, and the stripes start a metre beyond that.
  const north=road('north',[[0,0],[0,-80]],8,'Dock Road'),square=new Map([['in',wide],['north',strip([0,0],[0,-80],-Math.PI/2,-4,4)]]);
  assert.ok(near(at(plan([vine,ramp,dockIn,north],{edges:square,others:[...square.values()]})),11,.1),`never nearer than the corner of the record's own end (${at(plan([vine,ramp,dockIn,north],{edges:square,others:[...square.values()]}))?.toFixed(1)} m)`);
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

// The crosswalks a tile draws, planned as its builder plans them: every road within 40 m of the extents of the roads it owns.
async function tileCrosswalks(key){
  const city=await loadMetroCity({tiles:[key]}),tile=city.loadedTiles.get(key),x0=tile.tx*tile.size,z0=tile.tz*tile.size,x1=x0+tile.size,z1=z0+tile.size;
  const owned=new Set(city.roads.filter(r=>{const m=roadMidpoint(r);return m[0]>=x0&&m[0]<x1&&m[1]>=z0&&m[1]<z1;})),reach={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};
  for(const r of owned)for(const [x,z] of r.points){reach.minX=Math.min(reach.minX,x);reach.maxX=Math.max(reach.maxX,x);reach.minZ=Math.min(reach.minZ,z);reach.maxZ=Math.max(reach.maxZ,z);}
  const box=r=>{let a=Infinity,b=-Infinity,c=Infinity,d=-Infinity;for(const [x,z] of r.points){a=Math.min(a,x);b=Math.max(b,x);c=Math.min(c,z);d=Math.max(d,z);}return a<=reach.maxX+40&&b>=reach.minX-40&&c<=reach.maxZ+40&&d>=reach.minZ-40;},roads=city.roads.filter(box);
  const records=new Map();for(const p of [...tile.pavements,...tile.borderPavements])if(!records.has(p.road))records.set(p.road,p);
  const edgesOf=r=>{const p=records.get(r.id);return p&&p.edges.length>=8?pavementEdges(tile,p):undefined;};
  return {tile,edgesOf,crosswalks:planCrosswalks(roads,junctionIndex(city.roads,city.signals),edgesOf,[...records.values()].map(p=>pavementEdges(tile,p)),tile.streetPavement?drawnStreets(tile):undefined).filter(c=>owned.has(c.road))};
}

test('Congress Street\'s crosswalk at the eastbound landings of Exit 135 crosses both carriageways and the ramps\' landing, kerb to kerb',{skip:!hasMetroData()},async()=>{
  // The twin carriageway (17601-0-0) is measured through the two exit ramps that land on it, and its far edge steps out across
  // the second ramp's landing exactly where this crosswalk's line meets it: by that one segment the record was no twin's, and the
  // stripes ended at 10 m, on the middle of a 38 m roadway.
  const {edgesOf,crosswalks}=await tileCrosswalks('2_0'),c=crosswalks.find(c=>c.road.id==='17603-0-0'&&Math.hypot(c.at[0]-2440.4,c.at[1]-79.7)<2);
  assert.ok(c,'the crosswalk of the westbound carriageway east of Pier 4 Boulevard');
  const own=pavementSpan(edgesOf(c.road),c.at,c.tx,c.tz),twin=pavementSpan(edgesOf({id:'17601-0-0'}),c.at,c.tx,c.tz);
  assert.ok(near(c.span[0],own[0])&&own[1]<11,`from its own north kerb (${c.span[0].toFixed(1)}), past the edge of its own record at ${own[1].toFixed(1)} m`);
  assert.ok(c.span[1]>24&&c.span[1]<=twin[1]+.01&&c.span[1]-c.span[0]>37,`to the far kerb of the other carriageway at ${twin[1].toFixed(1)} m, ${(c.span[1]-c.span[0]).toFixed(1)} m in all (${c.span.map(v=>v.toFixed(1))})`);
  for(const o of crosswalks){if(o===c||Math.abs(o.tx*c.tx+o.tz*c.tz)<.8)continue;const d=Math.hypot(o.at[0]-c.at[0],o.at[1]-c.at[1]);assert.ok(d>=MIN_SPACING,`no other crosswalk across this roadway within the spacing (${o.road.id} at ${d.toFixed(1)} m)`);}
});

test('Newton Street in Brookline keeps the crosswalk of its upper roadway where the two part, and none that ends in their shared asphalt',{skip:!hasMetroData()},async()=>{
  // The upper roadway's crosswalk reaches from the north kerb to the tip of the median, 31 m from its node: it crosses its roadway
  // whole and stays. The lower roadway's stood 9 m along, where the median has ended: 15.6 m from the south kerb, with 17 m of
  // the upper roadway's asphalt beyond its end. It could not take that in (it would crowd out the upper one, the thinning
  // order pull request 133 settled), so it crossed half a roadway in mid block, and is not drawn. Nor is the third, 22.3 m from
  // the north kerb with 15 m of asphalt beyond.
  const {crosswalks}=await tileCrosswalks('-7_4'),at=(x,z)=>crosswalks.find(c=>c.road.name==='Newton Street'&&Math.hypot(c.at[0]-x,c.at[1]-z)<4);
  const upper=at(-6655.6,4749.2);
  assert.ok(upper&&near(upper.span[1]-upper.span[0],18.2,.3),`the upper roadway's, kerb to median (${upper&&(upper.span[1]-upper.span[0]).toFixed(1)} m)`);
  assert.equal(at(-6646.5,4771.1),undefined,'none across the lower roadway alone');
  assert.equal(at(-6600.1,4768.2),undefined,'none from the north kerb into the shared asphalt');
});

test('Main Street\'s crosswalk in Medford crosses the leg of Bow Street that shares its asphalt, to the kerb at Albion Street\'s corner',{skip:!hasMetroData()},async()=>{
  // Bow Street's one-way leg (osm-1317231437-0) leaves Main Street at 24 degrees from the Hicks Avenue junction, and 22 m on,
  // at this station, the two records still overlap: one sheet of asphalt from Main Street's east kerb to the leg's west kerb.
  // Main Street's own record ends 16.7 m out, in the middle of the leg's lane, where the crosswalk ended; the leg's far edge
  // bends 40 degrees off under the line (14 where the stripes end), so by that one segment its record did not count. A leg
  // that shares the roadway is crossed like a twin (the segment test crosses 100 records of another street on the package).
  const {edgesOf,crosswalks}=await tileCrosswalks('-3_-6'),c=crosswalks.find(c=>c.road.id==='osm-9038738-0'&&Math.hypot(c.at[0]+2451.5,c.at[1]+5588.3)<2);
  assert.ok(c,'the crosswalk of Main Street north of Hicks Avenue');
  const own=pavementSpan(edgesOf(c.road),c.at,c.tx,c.tz),leg=pavementSpan(edgesOf({id:'osm-1317231437-0'}),c.at,c.tx,c.tz);
  assert.ok(leg[0]<own[1]-8&&leg[1]>own[1]+5,`the leg's record (${leg.map(v=>v.toFixed(1))}) overlaps Main Street's (${own.map(v=>v.toFixed(1))}) and reaches 6.5 m beyond it`);
  assert.ok(near(c.span[0],own[0])&&near(c.span[1],leg[1]),`from Main Street's east kerb to the leg's west kerb (${c.span.map(v=>v.toFixed(1))}), ${(c.span[1]-c.span[0]).toFixed(1)} m`);
  const albion=crosswalks.find(o=>o.road.name==='Albion Street'&&Math.hypot(o.at[0]-c.at[0],o.at[1]-c.at[1])<35);
  assert.ok(albion,'where Albion Street\'s crosswalk begins at the same corner');
});

test('Lincoln Street\'s crosswalk at Cambridge Street in Allston does not grow into the junction, nor Bayswater Street\'s over the next street\'s',{skip:!hasMetroData()},async()=>{
  // Lincoln Street's stripes leave its east kerb and end 9 m out, in the junction; the record of the slip lane beside them
  // (17699-0-0) steps under their line like a twin's and would take them 18 m out, onto Cambridge Street's asphalt.
  const lincoln=(await tileCrosswalks('-5_-1')).crosswalks.find(c=>c.road.id==='17702-0-0'&&Math.hypot(c.at[0]+4413.3,c.at[1]+830.8)<2);
  assert.ok(lincoln&&near(lincoln.span[1]-lincoln.span[0],9.2,.3),`Lincoln Street's is ${lincoln&&(lincoln.span[1]-lincoln.span[0]).toFixed(1)} m`);
  // Bayswater Street's would reach the far kerb of the street that forks off it, across that street's own crosswalk.
  const {crosswalks}=await tileCrosswalks('5_-4'),bayswater=crosswalks.find(c=>c.road.id==='477-0-0'&&Math.hypot(c.at[0]-5708.6,c.at[1]+3944)<2);
  assert.ok(bayswater&&near(bayswater.span[1]-bayswater.span[0],16.7,.3),`Bayswater Street's is ${bayswater&&(bayswater.span[1]-bayswater.span[0]).toFixed(1)} m`);
  assert.ok(crosswalks.some(c=>c.road.id==='5808-0-0'&&Math.hypot(c.at[0]-bayswater.at[0],c.at[1]-bayswater.at[1])<25),'beside the crosswalk of the street that forks off');
});

test('Vienna Street, Wadsworth Street and New Whitney Street are striped at their junctions, not 27 to 31 m up the street',{skip:!hasMetroData()},async()=>{
  const from=c=>Math.hypot(c.at[0]-c.node[0],c.at[1]-c.node[1]),at=(list,id,x,z)=>list.find(c=>c.road.id===id&&Math.hypot(c.node[0]-x,c.node[1]-z)<2);
  // Neptune Road's record ends 21 m wide on this node, where the Route 1A exit lands on it, and leaves it 141 degrees from Vienna
  // Street. Carried straight on, that width took in Vienna Street 25 m up; the road Neptune Road runs on as bends 41 degrees away, has
  // its own record, and that one ends 5 m up. A third leg of the junction reaches 14 m, and the stripes start a metre beyond.
  const vienna=at((await tileCrosswalks('4_-4')).crosswalks,'13366-0-0',4098.5,-3301.2);
  assert.ok(vienna&&near(from(vienna),15,.6)&&near(vienna.span[1]-vienna.span[0],11.2,.5),`Vienna Street, across its mouth: ${vienna&&from(vienna).toFixed(1)} m from the node, ${vienna&&(vienna.span[1]-vienna.span[0]).toFixed(1)} m long`);
  // Wadsworth Street runs on east of Ashford Terrace as another road with a vertex 0.59 m from the node. The leg from that vertex
  // back to the node made the continuation a crossing street, and its record, ending on the node, held the walk to its limit.
  const {crosswalks:allston}=await tileCrosswalks('-5_-1'),wadsworth=at(allston,'6201-0-0',-4237.1,-531.3);
  assert.ok(wadsworth&&near(from(wadsworth),4,.6),`Wadsworth Street, beside Ashford Terrace: ${wadsworth&&from(wadsworth).toFixed(1)} m from the node`);
  // New Whitney Street turns a corner on this node, where another street carries straight on: its own other part is the street
  // that meets it, and it was walked out of its own record, which it never leaves.
  const {crosswalks:mission}=await tileCrosswalks('-3_1'),whitney=mission.filter(c=>c.road.id==='18122-0-0');
  assert.equal(whitney.length,1,'one crosswalk on New Whitney Street');
  assert.ok(near(from(whitney[0]),6,.6)&&whitney[0].at[1]<1810,`on its western part, at the corner: ${from(whitney[0]).toFixed(1)} m from the node`);
  // Brighton Avenue's crosswalk across both carriageways and the median strip, in the middle of the block east of Saint Lukes
  // Road, was there for a stray vertex alone: a 7 m side street does not stripe a 12 m avenue.
  assert.deepEqual(allston.filter(c=>c.road.id==='12374-0-0').map(c=>c.at.map(v=>+v.toFixed(0))),[],'none on Brighton Avenue in mid block');
});

test('no crosswalk stands where only the road itself meets its line, and Bowdoin Street keeps clear of Winter Street\'s mouth',{skip:!hasMetroData()},async()=>{
  // Johnson Avenue bends through a vertex that another piece of it touches: 30 m beyond, in mid curve, it was striped.
  const {crosswalks:north}=await tileCrosswalks('-6_-8'),johnson=north.filter(c=>c.road.id==='osm-9039110-0');
  assert.ok(johnson.length>0&&johnson.every(c=>Math.hypot(c.at[0]-c.node[0],c.at[1]-c.node[1])<15),`Johnson Avenue is striped at its junctions only (${johnson.map(c=>Math.hypot(c.at[0]-c.node[0],c.at[1]-c.node[1]).toFixed(1))} m from their nodes)`);
  // Winter Street's record lies in Bowdoin Street's roadway for 9 m from their node, leaving it at an angle; the walk out of that
  // record along Bowdoin Street's line ends after 4 m. The corner it allows would put Bowdoin Street's stripes across Winter
  // Street's mouth, on its record: not taken.
  const {crosswalks:dorchester}=await tileCrosswalks('1_4'),bowdoin=dorchester.find(c=>c.road.id==='9561-0-0'&&Math.hypot(c.node[0]-1028.9,c.node[1]-4414.2)<2);
  assert.ok(bowdoin&&near(Math.hypot(bowdoin.at[0]-bowdoin.node[0],bowdoin.at[1]-bowdoin.node[1]),16,.6)&&near(bowdoin.span[1]-bowdoin.span[0],13.2,.5),`Bowdoin Street's stays 16 m from the node, 13.2 m long (${bowdoin&&Math.hypot(bowdoin.at[0]-bowdoin.node[0],bowdoin.at[1]-bowdoin.node[1]).toFixed(1)} m, ${bowdoin&&(bowdoin.span[1]-bowdoin.span[0]).toFixed(1)} m)`);
});

test('no crosswalk stands in mid block with a roadway left uncrossed beyond its end: Louder\'s Lane, South Border Road, Chestnut Hill Avenue',{skip:!hasMetroData()},async()=>{
  // Louder's Lane runs inside Centre Street's asphalt for its first 40 m. Its crosswalk stood 31 m out, 6.5 m long at Centre
  // Street's west kerb with 25 m of asphalt beyond; the candidate at the block's other end, 5 m from its node, is the same
  // stray 4 m along, and does not come in for it.
  const lane=(await tileCrosswalks('-5_4')).crosswalks.filter(c=>c.road.id==='18901-0-0');
  assert.deepEqual(lane.map(c=>c.at.map(v=>+v.toFixed(0))),[],'none on Louder\'s Lane inside Centre Street\'s roadway');
  // South Border Road's lay on Roosevelt Circle's roadway, 12.3 m long across another crosswalk, 31 m from its node.
  assert.deepEqual((await tileCrosswalks('-3_-9')).crosswalks.filter(c=>c.road.id==='osm-80619122-0').map(c=>c.at.map(v=>+v.toFixed(0))),[],'none on South Border Road in the circle');
  // Chestnut Hill Avenue's reached 19.2 m from one kerb into a junction 28 m across.
  assert.deepEqual((await tileCrosswalks('-7_1')).crosswalks.filter(c=>c.road.id==='7780-0-0').map(c=>c.at.map(v=>+v.toFixed(0))),[],'none on Chestnut Hill Avenue in mid junction');
});

test('a crosswalk in mid block that crosses its roadway whole stays, at a kerb or at the tip of an island, and a whole one comes in for a stray',{skip:!hasMetroData()},async()=>{
  const from=c=>Math.hypot(c.at[0]-c.node[0],c.at[1]-c.node[1]),find=(list,id,x,z)=>list.find(c=>c.road.id===id&&Math.hypot(c.at[0]-x,c.at[1]-z)<3);
  // Washington Street in Brookline: 22.2 m from kerb to kerb, 30 m from its node, across the roadway two lines still share.
  const washington=find((await tileCrosswalks('-5_1')).crosswalks,'osm-1476713396-0',-4462.1,1310.7);
  assert.ok(washington&&from(washington)>29&&near(washington.span[1]-washington.span[0],22.2,.3),`Washington Street's stays (${washington&&(washington.span[1]-washington.span[0]).toFixed(1)} m, ${washington&&from(washington).toFixed(1)} m out)`);
  // Calumet Street: from the east kerb to the tip of the island where the street forks, which the far line of the stripes touches
  // for 10 cm; beside their end the island is there. Kerwin Street's ends half a metre short of its island's tip.
  const calumet=find((await tileCrosswalks('-3_2')).crosswalks,'1046-0-0',-2088.9,2422.4);
  assert.ok(calumet&&near(calumet.span[1]-calumet.span[0],13.7,.3),`Calumet Street's stays at the island's tip (${calumet&&(calumet.span[1]-calumet.span[0]).toFixed(1)} m)`);
  const kerwin=find((await tileCrosswalks('-1_6')).crosswalks,'3619-0-0',-583,6305.2);
  assert.ok(kerwin&&near(kerwin.span[1]-kerwin.span[0],12.5,.3),`Kerwin Street's stays (${kerwin&&(kerwin.span[1]-kerwin.span[0]).toFixed(1)} m)`);
  // Massachusetts Avenue in Cambridge: a crosswalk from the west kerb to the middle of the avenue had crowded out the one that
  // crosses it from kerb to kerb, 38 m; that one is drawn now.
  const avenue=find((await tileCrosswalks('-4_-4')).crosswalks,'osm-249388676-0',-3741.5,-3230.4);
  assert.ok(avenue&&near(avenue.span[1]-avenue.span[0],38.1,.4),`Massachusetts Avenue is crossed whole (${avenue&&(avenue.span[1]-avenue.span[0]).toFixed(1)} m)`);
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

test('shared-node carriageways at Charles River Dam Road keep one crossing per approach',async()=>{
 const city=await loadMetroCity({tiles:['0_-3']}),tile=city.loadedTiles.get('0_-3');
 const records=new Map([...tile.pavements,...tile.borderPavements].map(p=>[p.road,p]));
 const edges=r=>records.has(r.id)?pavementEdges(tile,records.get(r.id)):undefined;
 const roads=city.roads.filter(r=>r.points.some(p=>p[0]>-150&&p[0]<400&&p[1]>-2350&&p[1]<-1900));
 const index=junctionIndex(city.roads,city.signals),others=[...records.values()].map(p=>pavementEdges(tile,p));
 const kept=planCrosswalks(roads,index,edges,others).filter(c=>Math.hypot(c.node[0]-125.917,c.node[1]+2121.896)<1);
 assert.equal(kept.length,4,'two same-node carriageway pairs previously left six crossings');
 assert.equal(kept.filter(c=>c.road.name.includes('Land')).length,1);
 assert.equal(kept.filter(c=>c.road.name.includes("Brien")).length,1);
 assert.deepEqual(planCrosswalks([...roads].reverse(),index,edges,others).filter(c=>Math.hypot(c.node[0]-125.917,c.node[1]+2121.896)<1).map(c=>c.road.id),kept.map(c=>c.road.id));
});

test('a surface carriageway link does not invent a pedestrian crossing at a merge',()=>{
 const main=road('main',[[0,0],[30,0],[80,0]],16,'Charles River Dam Road'),link=road('link',[[30,0],[60,12]],10,'Charles River Dam Road',{kind:'tertiary_link'});
 assert.deepEqual(plan([main,link]),[]);
});
