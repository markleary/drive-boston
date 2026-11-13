import './helpers/npc-fleet.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {drawnStreets,CLEARANCE,STALL_REACH} from '../src/simulation/drawn-streets.ts';
import {LAMP_ROOM,SIGN_ROOM,TREE_ROOM,VERGE,postClear,roadwayEdge,streetFurnitureSteps,streetRibbons,vergePlace} from '../src/simulation/street-furniture.ts';
import {roadCells} from '../src/simulation/road-cells.ts';
import {createStreetLife} from '../src/render/street-life.ts';
import {hasMetroData} from './helpers/metro-city.mjs';
import {alongWalk,drawnGround,loadStreetCity,residentTiles,roadIndex,tileFurniture} from './helpers/street-furniture.mjs';

const near=(a,b,eps=1e-9)=>Math.abs(a-b)<=eps;
const box=(x0,z0,x1,z1)=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
/** A tile whose pavement is given in metres from its own corner. */
const tileAt=(tx,tz,pavement,more={})=>{const placed=polygons=>polygons.map(rings=>rings.map(ring=>ring.map(([x,z])=>[tx*1000+x,tz*1000+z])));return {tx,tz,size:1000,...more,streetPavement:placed(pavement),driveways:placed(more.driveways??[])};};
// A street 10 m wide up the tile with a side street off it to the west, a second carriageway 3 m east of it, and
// a square with an island in it. One stall on a lot beside the second carriageway.
const street=[[[100,0],[110,0],[110,1000],[100,1000],[100,508],[0,508],[0,500],[100,500]]],carriageway=[box(113,0,121,1000)],square=[box(300,300,400,400),box(340,340,360,360)];
const tile=tileAt(0,0,[street,carriageway,square],{driveways:[[box(124,190,140,210)]],parking:[13000,20000,0]}),streets=drawnStreets(tile);

test('the drawn streets of a tile: where its pavement is, how near, and where a line crosses it',()=>{
  assert.equal(drawnStreets(tile),streets,'indexed once and kept with the tile');
  for(const [x,z,want] of [[105,50,true],[111.5,50,false],[117,999,true],[50,504,true],[50,510,false],[99.9,499,false],[320,350,true],[350,350,false],[-1,504,false],[105,1000,false],[105,999.999,true]])assert.equal(streets.paved(x,z),want,`(${x}, ${z})`);
  // pavement within a margin: the median's middle is 1.5 m from either roadway, the island's 10 m from the square's
  assert.equal(streets.near(111.5,50,1.4),false);assert.equal(streets.near(111.5,50,CLEARANCE+.01),true);assert.equal(streets.near(111,50,TREE_ROOM),true);
  assert.equal(streets.near(350,350,CLEARANCE),false);assert.equal(streets.near(341,350,TREE_ROOM),true);
  // a point beyond the border is answered for the pavement this tile holds: the side street runs out at x = 0
  assert.equal(streets.near(-.5,504,1),true);assert.equal(streets.near(-.5,520,1),false);
  // a line east across the street, the median and the carriageway
  const across=streets.spans(105,50,1,0,-10,30);assert.deepEqual(across.known,[-10,30]);
  assert.equal(across.spans.length,4);for(const [i,want] of [-5,5,8,16].entries())assert.ok(near(across.spans[i],want,1e-6),`${across.spans}`);
  // a line that leaves the tile is known as far as the border, paved or not
  const north=streets.spans(105,50,0,-1,0,80);assert.ok(near(north.known[1],50)&&north.spans.length===2&&near(north.spans[0],0,1e-6)&&near(north.spans[1],50,1e-6));
  assert.deepEqual(streets.spans(-50,504,-1,0,0,30).spans,[]);const missed=streets.spans(-50,504,-1,0,0,30).known;assert.ok(!(missed[1]>missed[0]),'a line that misses the tile is not known at all');
  // through the island: paved, the hole, paved
  const island=streets.spans(310,350,1,0,0,100).spans;assert.equal(island.length,4);for(const [i,want] of [0,30,50,90].entries())assert.ok(near(island[i],want,1e-6));
  assert.ok(near(streets.inset(105,50),50)&&streets.inset(-3,504)<0);
  const [lo,hi]=streets.within(105,50,0,-1,TREE_ROOM);assert.ok(near(hi,50-TREE_ROOM)&&lo<-900,'the stretch of a line that keeps a room inside the border');
  assert.ok(streets.within(105,.5,1,0,TREE_ROOM)[0]>streets.within(105,.5,1,0,TREE_ROOM)[1],'none of a line along the border does');
});

test('the drawn streets answer as the polygons do, point for point',()=>{
  // an L of pavement with a notch and a slanted edge, tested against a plain crossing count and edge distance
  const rings=[[[10,10],[400,35],[420,300],[250,310],[240,120],[90,140],[60,420],[12,400]],[[100,40],[200,45],[190,90],[110,80]]],t=tileAt(3,-2,[rings]),s=drawnStreets(t),ground=drawnGround(new Map([['3_-2',{...t,key:'3_-2'}]]));
  let seed=11;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<4000;i++){
    const x=3000-5+random()*460,z=-2000-5+random()*460,room=.2+random()*1.2;
    assert.equal(s.paved(x,z),ground.roadway(x,z),`paved at (${x}, ${z})`);
    if(s.inset(x,z)>-CLEARANCE+room)assert.equal(s.near(x,z,room),ground.roadway(x,z,room),`within ${room} m at (${x}, ${z})`);
  }
});

test('a stall and its lot are found by the tile that lists them',()=>{
  assert.ok(streets.stall(130,200,0)&&streets.stall(130,202.5,0)&&!streets.stall(130,202.7,0)&&streets.stall(130,202.7,.2),'5.2 m deep along the car');
  assert.ok(streets.stall(131.2,200,0)&&!streets.stall(131.5,200,0)&&streets.stall(131.5,200,.3),'2.6 m wide');
  assert.ok(streets.lot(130,200,0)&&!streets.lot(141,200,.5)&&streets.lot(140.3,200,.5));
  assert.ok(STALL_REACH>2.9&&STALL_REACH<2.95);
  assert.equal(drawnStreets(tileAt(5,5,[])).stall(5130,5200,1),false);
});

test('the verge is two metres beyond the roadway as drawn, wherever the centre line runs in it',()=>{
  // the centre line down the middle: 5 m to either edge; east of it the median is 3 m wide, so the place is its middle
  assert.deepEqual(roadwayEdge(streets,[105,300],-1,0,5),{edge:5,next:Infinity});
  const east=roadwayEdge(streets,[105,300],1,0,5);assert.ok(near(east.edge,5,1e-6)&&near(east.next,8,1e-6));
  const west=vergePlace(streets,[105,300],-1,0,5,TREE_ROOM);assert.ok(near(west[0],100-VERGE,1e-6)&&west[1]===300);
  const median=vergePlace(streets,[105,300],1,0,5,TREE_ROOM);assert.ok(near(median[0],111.5,1e-6),'midway between the two roadways');
  // the same roadway under a line drawn 2 m from its west edge, by a street said to be 7 m wide: the places do not move
  assert.ok(near(vergePlace(streets,[102,300],-1,0,3.5,TREE_ROOM)[0],98,1e-6)&&near(vergePlace(streets,[102,300],1,0,3.5,TREE_ROOM)[0],111.5,1e-6));
  // and the second carriageway plants the same median from its side
  assert.ok(near(vergePlace(streets,[117,300],-1,0,4,TREE_ROOM)[0],111.5,1e-6)&&near(vergePlace(streets,[117,300],1,0,4,TREE_ROOM)[0],123,1e-6));
  // a line drawn along the kerb, just off the pavement: the roadway is still the stretch beside it
  assert.ok(near(vergePlace(streets,[99.5,300],-1,0,5,TREE_ROOM)[0],98,1e-6)&&near(roadwayEdge(streets,[99.5,300],1,0,5).edge,10.5,1e-6));
  // a median too narrow for a grate holds no tree, though a lamp post fits
  const narrow=drawnStreets(tileAt(0,1,[[box(100,0,110,1000)],[box(112,0,120,1000)]]));
  assert.equal(vergePlace(narrow,[105,1300],1,0,5,TREE_ROOM),undefined);assert.ok(near(vergePlace(narrow,[105,1300],1,0,5,LAMP_ROOM)[0],111,1e-6));
  // no pavement drawn at the station: no verge
  assert.equal(roadwayEdge(streets,[200,700],1,0,5),undefined);
});

test('pavement that leads away is no roadway edge: a junction mouth, another street\'s line, a run past reach',()=>{
  // in the mouth of the side street the pavement runs on to the border, 105 m off
  assert.equal(roadwayEdge(streets,[105,504],-1,0,5),undefined);assert.equal(vergePlace(streets,[105,504],-1,0,5,TREE_ROOM),undefined);
  // a wide square is followed to its far kerb, unless that pavement is another street's
  const wide=drawnStreets(tileAt(2,2,[[box(100,0,130,1000)]]));
  assert.ok(near(roadwayEdge(wide,[2105,2300],1,0,5).edge,25,1e-6)&&near(vergePlace(wide,[2105,2300],1,0,5,TREE_ROOM)[0],2132,1e-6));
  assert.equal(roadwayEdge(wide,[2105,2300],1,0,5,(x,z)=>x>2118&&x<2126),undefined,'the second carriageway of one roadway has stations of its own');
  assert.ok(roadwayEdge(wide,[2105,2300],1,0,5,(x,z)=>x>2140),'a street beyond the kerb is no matter');
  assert.equal(roadwayEdge(drawnStreets(tileAt(2,3,[[box(100,0,180,1000)]])),[2105,3300],1,0,5),undefined,'75 m of pavement is a street leading away');
});

test('a station and side is planted by the tile its roadway ends in, once',()=>{
  // a street along the border between two tiles: 4 m of it in the west tile, 6 m in the east one, its line in the west
  const a=drawnStreets(tileAt(0,2,[[box(996,0,1000,1000)]])),b=drawnStreets(tileAt(1,2,[[box(0,0,6,1000)]])),at=[999,2300];
  assert.equal(roadwayEdge(a,at,1,0,5),undefined,'the roadway runs on into the next tile');assert.equal(vergePlace(a,at,1,0,5,TREE_ROOM),undefined);
  const far=roadwayEdge(b,at,1,0,5);assert.ok(near(far.edge,7,1e-6),'which finds its kerb');assert.ok(near(vergePlace(b,at,1,0,5,TREE_ROOM)[0],1008,1e-6));
  assert.ok(near(vergePlace(a,at,-1,0,5,TREE_ROOM)[0],994,1e-6));assert.equal(vergePlace(b,at,-1,0,5,TREE_ROOM),undefined,'and the west side is the west tile\'s alone');
  // a border beyond the street's nominal edge and a metre is nobody's hand-over: the tile cannot tell where the roadway ends
  const c=drawnStreets(tileAt(0,3,[[box(980,0,1000,1000)]])),d=drawnStreets(tileAt(1,3,[[box(0,0,6,1000)]]));
  assert.equal(roadwayEdge(c,[985,3300],1,0,5),'border');assert.equal(roadwayEdge(d,[985,3300],1,0,5),undefined);
});

test('a tile plants only where it sees the ground all round: a place at its border slides along the street',()=>{
  // half a metre inside the north border the place would stand within its room of ground the tile cannot see
  const here=vergePlace(streets,[105,.5],-1,0,5,TREE_ROOM);assert.ok(here&&near(here[0],98,1e-6)&&near(here[1],3.5,1e-6),`${here}`);
  assert.ok(streets.inset(...here)>=TREE_ROOM&&postClear(streets,...here,TREE_ROOM));
  // a kerb that runs along the border leaves no such place at any station
  const edge=drawnStreets(tileAt(0,4,[[box(0,0,1000,3)]]));assert.equal(vergePlace(edge,[500,4001.5],0,-1,1.5,TREE_ROOM),undefined);
  assert.ok(near(vergePlace(edge,[500,4001.5],0,1,1.5,TREE_ROOM)[1],4005,1e-6));
  // the border between the kerb and the place: drawn in from it while the grate still has its room to the kerb
  const tight=drawnStreets(tileAt(0,5,[[box(100,0,110,1000)]])),lean=[[100,0],[110,0],[110,1000],[100,1000]];
  assert.ok(tight.inset(98,5300)>TREE_ROOM&&lean.length===4);
  const beside=drawnStreets(tileAt(0,6,[[box(2.8,0,12,1000)]])),drawn=vergePlace(beside,[7,6300],-1,0,5,TREE_ROOM);
  assert.ok(drawn&&near(drawn[0],TREE_ROOM,1e-6),'1.6 m from the kerb instead of 2, at its room from the border');
  assert.equal(vergePlace(drawnStreets(tileAt(0,7,[[box(2,0,12,1000)]])),[7,7300],-1,0,5,TREE_ROOM),undefined,'and none where 2 m of ground is all there is');
});

test('nothing stands in a stall, or on a lot at the border where the next tile\'s stall could reach',()=>{
  // the second carriageway's east verge at the stall: x = 123 is 5.7 m from the stall's centre line, clear; a verge through the stall is not
  assert.ok(vergePlace(streets,[117,200],1,0,4,TREE_ROOM));
  const lot=tileAt(0,8,[[box(100,0,110,1000)]],{driveways:[[box(110,190,130,210)]],parking:[11200,20000,9000]}),s=drawnStreets(lot);
  assert.equal(vergePlace(s,[105,8200],1,0,5,TREE_ROOM),undefined,'the verge place lies in a stall');assert.ok(vergePlace(s,[105,8230],1,0,5,TREE_ROOM));
  assert.equal(postClear(s,112,8200,SIGN_ROOM),false);assert.equal(postClear(s,112,8230,SIGN_ROOM),true);
  // lot asphalt within a stall's reach of the border: the tile cannot see the stalls beyond it, and plants where none can reach
  const edge=tileAt(0,9,[[box(100,0,110,1000)]],{driveways:[[box(110,0,130,12)]]}),e=drawnStreets(edge),place=vergePlace(e,[105,9002],1,0,5,TREE_ROOM);
  assert.equal(postClear(e,112,9002,TREE_ROOM),false);assert.ok(e.lot(112,9002,0)&&!e.stall(112,9002,1));
  assert.ok(place&&near(place[0],112,1e-6)&&place[1]-9000>=STALL_REACH+TREE_ROOM/2,`${place}`);
  // off the lot the border's ground is the tile's own to judge
  assert.ok(near(vergePlace(e,[105,9002],-1,0,5,TREE_ROOM)[1],9002,1e-6));
});

test('a tile\'s trees and lamps: every 25 m on both verges, a lamp before each tree on one side',()=>{
  const road={id:'a',name:'Albany Street',points:[[105,100],[105,400]],width:10},cross={id:'b',name:'Side Street',points:[[105,504],[0,504]],width:8};
  const run=(t,roads,hooks={})=>{const steps=streetFurnitureSteps({},t,roads,{occupied:()=>false,random:()=>.9,...hooks});let step=steps.next();while(!step.done)step=steps.next();return step.value;};
  const plan=run(tile,[road,cross]);
  // stations at 114, 139, ... 389 on the long street (12), and at 14, 39, 64, 89 m along the side street (4), both sides
  const east=plan.trees.filter(p=>near(p[0],111.5,1e-6)),west=plan.trees.filter(p=>near(p[0],98,1e-6));
  assert.equal(east.length,12);assert.equal(west.length,12);assert.deepEqual(east.map(p=>p[1]),Array.from({length:12},(_,i)=>114+i*25));
  assert.equal(plan.trees.length,24+8,'and the side street\'s own');
  for(const p of plan.trees)assert.ok(!streets.near(p[0],p[1],TREE_ROOM));
  // lamps on one side, 5 m before each tree
  const lamps=plan.lamps.filter(p=>near(p[0],98,1e-6));assert.equal(lamps.length,12);assert.deepEqual(lamps.map(p=>p[1]),Array.from({length:12},(_,i)=>109+i*25));
  assert.equal(plan.lamps.length,12+4,'and the side street\'s four');assert.ok(plan.lamps.every(p=>!streets.near(p[0],p[1],LAMP_ROOM)));
  assert.equal(plan.posts.length,plan.trees.length+plan.lamps.length);
  // occupied ground takes none; reserved ground takes no tree nor its lamp; a deck overhead leaves the place a post but no tree
  assert.equal(run(tile,[road],{occupied:(x)=>x>105}).trees.length,12);
  const reserved=run(tile,[road],{reserved:(x)=>x<105});assert.equal(reserved.trees.length,12);assert.equal(reserved.lamps.length,0);
  const shaded=run(tile,[road],{shaded:(x)=>x<105});assert.equal(shaded.trees.length,12);assert.equal(shaded.posts.length,24+12);
  // Boylston Street is planted at half its places, by the tile's draws
  let n=0;assert.equal(run(tile,[{...road,name:'Boylston Street'}],{random:()=>(n++%2?.9:.1)}).trees.length,12);
  // alleys, narrow streets and decks have none
  assert.equal(run(tile,[{...road,width:6},{...road,name:'Public Alley 421'},{...road,elevations:[5,5]}]).trees.length,0);
  // a deck's line and a footbridge's are kept clear though no pavement is drawn for them
  const ribbons=streetRibbons({footbridges:[{id:'f',width:3,points:[[96,200],[99,260]],elevations:[0,4]}]},[road,{id:'d',name:'Deck',points:[[111.5,300],[111.5,400]],width:8,elevations:[6,6]}],{minX:0,maxX:1000,minZ:0,maxZ:1000});
  assert.ok(ribbons.raised(111.5,350)&&ribbons.raised(98,240)&&!ribbons.raised(98,300)&&!ribbons.raised(105,300),'a surface street is no deck');
  assert.ok(ribbons.any(105,300)&&ribbons.crossing(105,300,cross)&&!ribbons.crossing(105,300,road));
  // a tile with no compiled pavement keeps the survey build's rule: its own roads by their ribbons, half the width and two metres out
  const legacy=run({tx:0,tz:0,size:1000},[road,{...cross,points:[[1105,504],[1000,504]]}]);
  assert.equal(legacy.trees.length,24);assert.ok(legacy.trees.every(p=>near(Math.abs(p[0]-105),5+VERGE,1e-9)));
});

test('roads about a box come once each, in an order the box alone decides',()=>{
  const roads=[{id:'a',points:[[10,10],[600,10]]},{id:'b',points:[[700,700],[720,720]]},{id:'c',points:[[240,240],[260,260]]}],cells=roadCells(roads);
  assert.deepEqual(cells.near({minX:0,maxX:300,minZ:0,maxZ:300}).map(r=>r.id),['a','c']);assert.deepEqual(cells.near({minX:650,maxX:800,minZ:650,maxZ:800}).map(r=>r.id),['b']);
  assert.deepEqual(cells.boxes.get(roads[0]),{minX:10,maxX:600,minZ:10,maxZ:10});
});

// ---- the installed package: Newmarket Square and a divided avenue (scripts/audit-street-furniture.mjs holds every tile to the same)
const skip=!hasMetroData()&&'needs the metro package in public/data';
const city=skip?undefined:await loadStreetCity({tiles:['0_2','-2_7']}),roads=city&&roadIndex(city),ground=city&&drawnGround(city.loadedTiles);
/** How far a point lies from a road's centre line. */
const fromLine=(road,p)=>{let best=Infinity;for(let i=1;i<road.points.length;i++){const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz)));best=Math.min(best,Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz));}return best;};
/** Where the old rule stood a street's trees: half its median width and two metres from its centre line. */
const byMedianWidth=road=>{
  const out=[],verge=(road.pavedWidth??road.width)/2+VERGE;
  for(let i=1;i<road.points.length;i++){const a=road.points[i-1],b=road.points[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]),tx=(b[0]-a[0])/l,tz=(b[1]-a[1])/l;for(let d=14;d<l-8;d+=25)for(const side of [-1,1])out.push([a[0]+tx*d-tz*verge*side,a[1]+tz*d+tx*verge*side]);}
  return out;
};
const clearOf=(plan,name)=>{
  for(const [kind,places,room] of [['tree',plan.trees,TREE_ROOM],['lamp',plan.lamps,LAMP_ROOM],['sign',plan.signs.map(s=>s.position),SIGN_ROOM]])for(const p of places){
    assert.ok(!ground.roadway(p[0],p[1],room-1e-6),`${name}: a ${kind} at ${p} stands in the roadway or within ${room} m of it`);
    assert.ok(!ground.stall(p[0],p[1],room/2-1e-6),`${name}: a ${kind} at ${p} stands in a parking stall`);
  }
};

test('Newmarket Square: the trees and lamps of a roadway twice its street\'s width stand on its sidewalks',{skip},()=>{
  const tile=city.loadedTiles.get('0_2'),plan=tileFurniture(city,tile,roads),square=city.roads.find(r=>r.name==='Newmarket Square'&&r.points.some(p=>Math.hypot(p[0]-720,p[1]-2560)<60));
  assert.ok(square&&square.pavedWidth<10,'the street is 9 m by its median');
  assert.ok(plan.trees.length>300&&plan.lamps.length>150&&plan.signs.length>5,`${plan.trees.length} trees, ${plan.lamps.length} lamps, ${plan.signs.length} signs`);
  clearOf(plan,'tile 0_2');
  // by its median width the square's rows stood 6.6 m from its centre line, in a roadway 21 m wide
  const old=byMedianWidth(square).filter(p=>p[1]>2500&&p[1]<2580);assert.ok(old.length>=2&&old.every(p=>fromLine(square,p)<square.pavedWidth/2+VERGE+1e-6));
  assert.ok(old.every(p=>ground.roadway(p[0],p[1])),'the rule this replaces planted the roadway here, on both sides');
  // now the roadway about (725, 2545) holds nothing: the trees and the lamp stand 11 m and more from the line, two metres beyond either kerb
  const about=list=>list.filter(p=>Math.hypot(p[0]-725,p[1]-2545)<30),trees=about(plan.trees),lamps=about(plan.lamps);
  assert.ok(trees.length>=2&&lamps.length>=1,`${trees.length} trees and ${lamps.length} lamps at the square`);
  for(const p of [...trees,...lamps]){
    assert.ok(fromLine(square,p)>11,`${fromLine(square,p).toFixed(1)} m from the centre line`);
    assert.ok(ground.roadway(p[0],p[1],VERGE+.3)&&!ground.roadway(p[0],p[1],VERGE-.3),'two metres from the kerb');
  }
});

test('Blue Hill Avenue: two carriageways about a narrow median, their trees on the median\'s middle and the outer sidewalks',{skip},()=>{
  const tile=city.loadedTiles.get('-2_7'),plan=tileFurniture(city,tile,roads);
  clearOf(plan,'tile -2_7');
  const avenue=city.roads.filter(r=>r.name==='Blue Hill Avenue'&&r.points.some(p=>Math.hypot(p[0]+1345,p[1]-7380)<120));assert.ok(avenue.length>=6&&avenue.every(r=>r.oneway),'one-way carriageways, each with its own centre line');
  const old=avenue.flatMap(byMedianWidth).filter(p=>Math.hypot(p[0]+1345,p[1]-7380)<120);assert.ok(old.filter(p=>ground.roadway(p[0],p[1])).length>=4,'by median width the avenue\'s trees stood in its lanes');
  // trees on the median: roadway within 2 m on either hand, none within the grate's room
  const here=plan.trees.filter(p=>Math.hypot(p[0]+1345,p[1]-7380)<120),median=here.filter(p=>[0,1,2,3,4,5,6,7].filter(k=>ground.roadway(p[0]+Math.cos(k*Math.PI/4)*2.1,p[1]+Math.sin(k*Math.PI/4)*2.1)).length>=2);
  assert.ok(here.length>=20&&median.length>=4,`${median.length} of ${here.length} trees on the median`);
});

test('the walkers of Newmarket Square pace its sidewalks, once the tile is in',{skip},()=>{
  const tile=city.loadedTiles.get('0_2'),scene=new THREE.Scene(),{loaded}=residentTiles(city,new Map([['0_2',tile]]),roads),resident=loaded.get('0_2');
  // by the streets' ribbons (no tiles at hand) walks ran down the square's roadway
  const before=createStreetLife(scene,city);
  try{
    const old=before.walksNear(735,2545,60).flatMap(route=>alongWalk(route));
    assert.ok(old.filter(p=>ground.roadway(p[0],p[1])).length>40,'the rule this replaces walked the asphalt here');
  }finally{before.dispose();}
  loaded.clear();
  const life=createStreetLife(scene,city,undefined,[],{tiles:{loaded}});
  try{
    assert.equal(life.count,112,'the pool is the same size, waiting for its tiles');
    assert.equal(life.walksNear(735,2545,150).length,0,'no walk is verified against a tile that is not resident');
    loaded.set('0_2',resident);
    const walks=life.walksNear(735,2545,150);assert.ok(walks.length>40,`${walks.length} walks`);
    assert.equal(life.walksNear(735,2545,150).length,walks.length,'and they are kept');
    for(const route of walks)for(const p of alongWalk(route)){
      assert.ok(!ground.roadway(p[0],p[1],.3),`${route.road}: a walk passes within 30 cm of the roadway at ${p}`);
      assert.ok(!ground.stall(p[0],p[1],.3),`${route.road}: a walk passes through a parking stall at ${p}`);
      assert.ok(resident.posts.every(post=>Math.hypot(post[0]-p[0],post[1]-p[1])>.7),`${route.road}: a walk passes through a tree or a post at ${p}`);
    }
    // the square's own sidewalks are walked, 10 m and more from its centre line (5.7 m by its median width)
    const square=city.roads.find(r=>r.name==='Newmarket Square'&&r.points.some(p=>Math.hypot(p[0]-720,p[1]-2560)<60)),beside=walks.filter(route=>route.road==='Newmarket Square'&&Math.hypot(route.start[0]-725,route.start[1]-2545)<40);
    assert.ok(beside.length>=2&&beside.every(route=>fromLine(square,route.start)>10&&fromLine(square,route.end)>10),`${beside.map(route=>fromLine(square,route.start).toFixed(1))}`);
    // a neighbourhood fills from the pool
    life.populateAt({x:735,z:2545},{x:735,z:2545});
    const local=life.pedestrians.filter(p=>Math.hypot(p.position.x-735,p.position.z-2545)<350);assert.ok(local.length>=12,`${local.length} walkers about the square`);
    for(const person of local)assert.ok(!ground.roadway(person.position.x,person.position.z,.3));
  }finally{life.dispose();}
});
