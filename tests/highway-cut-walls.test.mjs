import assert from 'node:assert/strict';
import test from 'node:test';
import {loadMetroCity} from './helpers/metro-city.mjs';
import {bareStretches,openCutFloorAt,tunnelCoveredAt,tunnelGeometry,tunnelStations,tunnelSurfaceLandingAt,WALL_CURB,WALL_GAP,WALL_LEVEL} from '../src/simulation/tunnels.ts';
import {bridgeBarriers,deckEdge,deckEdgeElevation,deckEdgeGrounded,deckUndersideAt,roadProjection,roadWidthAt,RAIL_LIP,RAIL_RUN,SHELF_DROP} from '../src/simulation/road-surfaces.ts';
import {medianBarriers,medianSpans,MEDIAN_REACH} from '../src/simulation/median-barriers.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';

// A cut's side gets a wall only where it has ground to retain or a drop to guard (`bareStretches` in tunnels.ts): elsewhere it
// keeps the curb that closes the slot between its pavement and the ground, on a road whose decks lie open on their surveyed
// roadway (Storrow Drive, the ramps). The Turnpike's carriageways are railed along the ground, and their cuts' walls carry that
// rail on, but along the median, where one barrier row stands between the two roads (tests/median-barriers.test.mjs for two decks,
// tests/median-cuts.test.mjs for the cuts). Synthetic records first, shaped like the installed ones, on a terrain grid of 2 m cells; then the package.
const LEVEL=.06,W=10,line=(x0,x1,z=0,step=3)=>{const n=Math.max(1,Math.round(Math.abs(x1-x0)/step));return Array.from({length:n+1},(_,i)=>[x0+(x1-x0)*i/n,z]);};
const deck=(id,points,highway='storrow',extra={})=>({id,name:'Test',kind:'motorway',points,width:W,oneway:1,lanes:3,elevations:points.map(()=>LEVEL),deckWidths:points.map(()=>W),startLevel:1,endLevel:1,bridge:{id:highway,kind:'boston-highway',thickness:.75},...extra});
const cut=(id,points,highway='storrow',extra={})=>({...deck(id,points,highway),bridge:undefined,highway,startLevel:-1,endLevel:-1,tunnel:{clearance:3.2,covered:[]},...extra});
/** A deck on its surveyed roadway, as scripts/highway_roadways.py leaves one: no roadway at a station it shares with a cut. */
const surveyed=(road,{first=true,last=true}={})=>({...road,roadway:road.points.map((_,i)=>(i===0&&!first)||(i===road.points.length-1&&!last)?null:[W/2,W/2])});
/** A world of `roads` on ground that `height(x, z)` gives (0 where it gives nothing). */
function world(roads,height=()=>0){
  const cellSize=2,originX=-120,originZ=-60,width=220,rows=61,heights=new Float32Array(width*rows);
  for(let j=0;j<rows;j++)for(let i=0;i<width;i++)heights[j*width+i]=height(originX+i*cellSize,originZ+j*cellSize)??0;
  return{bounds:{minX:originX,maxX:originX+(width-1)*cellSize,minZ:originZ,maxZ:originZ+(rows-1)*cellSize},buildings:[],roads,spawn:{x:0,z:0,yaw:0},elevation:{width,height:rows,cellSize,originX,originZ,heights}};
}
/** The highest wall of a record over the road, on one side (-1 north of a road that runs east, 1 south) between two x. */
function wallTop(city,road,side,x0,x1){
  const v=tunnelGeometry(city,road).walls.vertices,centre=road.points[0][1];let top=-Infinity;
  for(let i=0;i<v.length;i+=3)if(v[i]>=x0&&v[i]<=x1&&Math.sign(v[i+2]-centre)===side)top=Math.max(top,v[i+1]-LEVEL);
  return top;
}
const CURB=WALL_CURB+.02;

test('a cut on level ground keeps a curb where the decks of its road lie open, and its wall where they are railed',()=>{
  const records=highway=>[surveyed(deck(`${highway}-eb-01`,line(-60,0),highway),{last:false}),cut(`${highway}-eb-02`,line(0,120),highway),surveyed(deck(`${highway}-eb-03`,line(120,180),highway),{first:false})];
  const parkway=records('storrow'),open=world(parkway);
  for(const side of [-1,1]){
    assert.deepEqual(bareStretches(open,parkway[1],side),[[0,120]],'the whole side has nothing to retain');
    const top=wallTop(open,parkway[1],side,0,120);assert.ok(top>WALL_CURB-.02&&top<CURB,`a curb, ${top.toFixed(2)} m over the road: the slot between the pavement and the ground is closed, nothing more`);
  }
  // the deck either side has no rail on the ground, its last 3 m beside the cut included: no surveyed station there
  assert.deepEqual(parkway.filter(r=>r.bridge).map(r=>bridgeBarriers(open,r).length),[0,0],'no rail stands alone at the joint');
  // the same records with no surveyed roadway on the decks: a carriageway that is railed along the ground
  const pike=records('i90').map(r=>({...r,roadway:undefined})),railed=world(pike);
  for(const side of [-1,1]){
    assert.deepEqual(bareStretches(railed,pike[1],side),[]);
    assert.ok(wallTop(railed,pike[1],side,2,118)>.79,'the cut carries the rail on as its wall');
    for(const r of [pike[0],pike[2]])assert.ok(bridgeBarriers(railed,r).filter(p=>p.side===side).reduce((sum,p)=>sum+p.length,0)>55,'the decks are railed all along');
  }
  // a road is judged by its own decks: a ramp of the Turnpike beside those carriageways lies open as its decks do
  const ramp=[...pike,surveyed({...deck('i90-eb-exit-9',line(-60,0,30),'i90'),kind:'motorway_link',lanes:1}),{...cut('i90-eb-exit-9-2',line(0,60,30),'i90'),kind:'motorway_link',lanes:1}],mixed=world(ramp);
  assert.ok(wallTop(mixed,ramp[4],1,0,60)<CURB&&wallTop(mixed,ramp[1],1,2,118)>.79);
});

test('a wall stands where the ground beside the cut stands over the road or falls away from it, in runs',()=>{
  const road=cut('storrow-eb-02',line(0,300)),roads=[surveyed(deck('storrow-eb-01',line(-60,0)),{last:false}),road];
  // north of the cut (z < -5): a bank of 1 m for 80 m; 0.5 m for 6 m; 1.2 m for 6 m. South (z > 5): 0.5 m running on as 0.36 m (0.3 m over the road); that alone; a drop of 1 m.
  const between=(x,a,b)=>x>=a&&x<=b,BAND=.36;assert.ok(BAND-LEVEL<RAIL_LIP&&BAND-LEVEL>WALL_LEVEL&&.5-LEVEL>RAIL_LIP);
  // (set on the grid row just inside each pavement edge as well, so that the bank or the drop stands at the wall line and not a cell beyond it)
  const city=world(roads,(x,z)=>z<-3?(between(x,60,140)?1:between(x,170,176)?.5:between(x,200,206)?1.2:0):z>3?(between(x,60,100)?.5:between(x,100,130)?BAND:between(x,160,200)?BAND:between(x,230,270)?-1:0):0);
  const north=bareStretches(city,road,-1),south=bareStretches(city,road,1),walled=(bare,x)=>!bare.some(([a,b])=>x>=a&&x<=b);
  for(const x of [20,50,150,160,173,190,215,280])assert.ok(!walled(north,x),`north: no wall at ${x}`);
  for(const x of [62,100,138,203])assert.ok(walled(north,x),`north: a wall at ${x}`);
  assert.ok(Math.abs(wallTop(city,road,-1,90,110)-(1-LEVEL+.8))<.05,'the bank is retained with its parapet, 0.8 m over the ground');
  assert.ok(wallTop(city,road,-1,10,50)<CURB,'and the level stretch before it has a curb');
  // a short stretch that holds less than a rail's height is no wall: its ground is retained by the curb alone
  assert.ok(.5<SHELF_DROP&&6<RAIL_RUN);const low=wallTop(city,road,-1,171,175);assert.ok(low>.5-LEVEL&&low<.5-LEVEL+CURB,`6 m of 0.5 m bank: ${low.toFixed(2)} m of curb`);
  assert.ok(wallTop(city,road,-1,202,204)>1.2-LEVEL+.75,'6 m of 1.2 m bank: a wall, short as it is');
  // south: the wall begins over RAIL_LIP and runs on while more than WALL_LEVEL is left to retain
  for(const x of [62,90,105,125])assert.ok(walled(south,x),`south: a wall at ${x}`);
  for(const x of [20,140,165,180,195,215,285])assert.ok(!walled(south,x),`south: no wall at ${x}`);
  for(const x of [233,250,267])assert.ok(walled(south,x),`south: a wall along the drop at ${x}`);
  assert.ok(wallTop(city,road,1,240,260)>.79,'the drop is guarded');
  // an opening shorter than WALL_GAP between two walls is closed, a longer one stays open
  const gapped=gap=>{const c=world(roads,(x,z)=>z<-3&&(between(x,60,100)||between(x,100+gap,160))?1:0);return bareStretches(c,road,-1).filter(([a,b])=>a>70&&b<150);};
  assert.equal(gapped(WALL_GAP-2).length,0,'a 4 m opening is closed');assert.equal(gapped(WALL_GAP+4).length,1,'a 10 m opening stays');
});

test('two pavements side by side at one level have nothing between them; a step between them is walled',()=>{
  const main=cut('storrow-eb-02',line(0,120)),ramp=(y,z=W+.2)=>({...cut('storrow-eb-entrance-9',line(0,120,z)),kind:'motorway_link',lanes:1,elevations:line(0,120).map(()=>y)});
  const decks=[surveyed(deck('storrow-eb-01',line(-60,0)),{last:false}),surveyed({...deck('storrow-eb-entrance-8',line(-60,0,W+.2)),kind:'motorway_link',lanes:1},{last:false})];
  // (the terrain between two excavations is no ground: here it lies half a metre over both roads)
  const level=ramp(LEVEL),flat=world([...decks,main,level],()=>.5);
  assert.ok(wallTop(flat,main,1,10,110)<CURB&&wallTop(flat,level,-1,10,110)<CURB,'no wall between the carriageway and the ramp that merges with it');
  assert.ok(wallTop(flat,main,-1,10,110)>.5-LEVEL+.75,'the outer side retains its ground');
  assert.equal(openCutFloorAt(flat,60,W/2+.1,main),LEVEL);assert.equal(openCutFloorAt(flat,60,-W/2-2),undefined);
  const lower=ramp(LEVEL-1),stepped=world([...decks,main,lower],()=>.5);
  assert.ok(wallTop(stepped,main,1,10,110)>.75,'a ramp a metre lower: the carriageway\'s side is walled');
  // beside a deck at its level a cut has that pavement for its ground, and the deck no drop into the cut to guard
  const beside=surveyed({...deck('storrow-eb-entrance-9',line(0,120,W+.2)),kind:'motorway_link',lanes:1}),dip=world([...decks,main,beside],(x,z)=>z>W/2&&z<W/2+.4?-.6:0);
  assert.ok(wallTop(dip,main,1,10,110)<CURB,'the gap between the two pavements is narrower than the wall: no drop');
});

test('a rail or a wall at the joint of a deck and a cut is measured with what it carries on as',()=>{
  const first=surveyed(deck('storrow-eb-01',line(-60,0)),{last:false}),road=cut('storrow-eb-02',line(0,120));
  const dropped=(a,b,depth)=>world([first,road],(x,z)=>z>3&&x>=a&&x<=b?-depth:0),rail=city=>bridgeBarriers(city,first).filter(p=>p.side===1).reduce((sum,p)=>sum+p.length,0);
  // a drop of 1 m beside the deck's last 8 m and the cut's first 30 m: one guard across the joint
  const long=dropped(-8,30,1);assert.ok(rail(long)>6&&rail(long)<10,`${rail(long).toFixed(1)} m of rail up to the joint`);
  assert.ok(wallTop(long,road,1,1,28)>.79&&wallTop(long,road,1,40,110)<CURB,'and the cut\'s wall from it, as far as the drop goes');
  assert.equal(bridgeBarriers(long,first).filter(p=>p.side===-1).length,0,'nothing on the level side');
  // half a metre for 4 m either side of the joint: 8 m in all, less than a run and less than a rail's height
  const short=dropped(-4,4,.5);assert.equal(rail(short),0,'no rail');assert.ok(wallTop(short,road,1,0,120)<.5+CURB,'no wall');
  // 6 m of the deck and 8 m of the cut: neither is a run alone, together they are
  const joined=dropped(-6,8,.5);assert.ok(rail(joined)>4,'the deck\'s 6 m count with the cut\'s 8');assert.ok(wallTop(joined,road,1,1,7)>.79,'and the cut\'s with the deck\'s');
  // a deck that stands 2 m over its ground beside the joint keeps its rail whatever the cut does
  const high=world([first,road],(x,z)=>z>3&&x<=-1?-2:0);assert.ok(rail(high)>50);
});

test('a wall keeps its sloped nose at a street landing, and a nose that would lead into nothing is not built',()=>{
  // A ramp that leaves a street at grade and goes down at 6% beyond its 12 m landing: the slot's walls rise from the street's surface.
  const points=line(0,120),slot=highway=>({...cut(`${highway}-wb-entrance-9`,points,highway),kind:'motorway_link',lanes:1,startLevel:0,elevations:points.map(([x])=>LEVEL-Math.max(0,x-12)*.06),tunnel:{clearance:3.2,covered:[],surfaceLandings:[[0,12]]}});
  const link=highway=>surveyed({...deck(`${highway}-wb-entrance-8`,line(-200,-140,40),highway),kind:'motorway_link',lanes:1});
  const open=slot('storrow'),railed=slot('i90'),a=tunnelGeometry(world([link('storrow'),open]),open).walls,b=tunnelGeometry(world([{...link('i90'),roadway:undefined},railed]),railed).walls;
  assert.deepEqual([...a.vertices],[...b.vertices],'the slot is walled alike on either kind of road: nose, retained ground and all');
  const top=(x0,x1)=>{let y=-Infinity;for(let i=0;i<a.vertices.length;i+=3)if(a.vertices[i]>=x0&&a.vertices[i]<=x1)y=Math.max(y,a.vertices[i+1]);return y;};
  assert.equal(top(0,11.9),-Infinity,'no wall on the landing');
  assert.ok(top(12,12.5)-LEVEL<.2&&top(20,24)-LEVEL>.3&&top(57,63)>.75,`rising from the street (${(top(12,12.5)-LEVEL).toFixed(2)} m) to a parapet over the ground (${top(57,63).toFixed(2)} m)`);
  // the same landing with the road level beyond it: nothing to retain for 100 m
  const flat={...open,elevations:points.map(()=>LEVEL)},city=world([link('storrow'),flat]);
  assert.ok(wallTop(city,flat,1,12,120)<CURB&&wallTop(city,flat,-1,12,120)<CURB,'no wedge beside a road on level ground');
});

// The installed package.
const city=await loadMetroCity({tiles:[]}),highway=city.roads.filter(r=>/^(i90|storrow|route1a)-/.test(r.id)),cuts=highway.filter(r=>r.tunnel&&r.highway),decks=highway.filter(r=>r.bridge&&!r.tunnel);
const byId=new Map(highway.map(r=>[r.id,r])),carriageway=r=>r.highway==='i90'&&r.kind==='motorway';
/** The pavement edge of a record at a station, the unit vector outwards and the wall line 8 cm outside. */
function edgeAt(road,s,side){
  const stations=tunnelStations(road);let i=1;while(i<stations.length-1&&stations[i]<s)i++;
  const t=(s-stations[i-1])/(stations[i]-stations[i-1]||1),at=inset=>{const a=deckEdge(road,i-1,side,inset),b=deckEdge(road,i,side,inset);return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];};
  const e=at(0),far=at(-1),y=deckEdgeElevation(road,i-1,side)+(deckEdgeElevation(road,i,side)-deckEdgeElevation(road,i-1,side))*t;
  return{x:e[0],z:e[1],y,ox:far[0]-e[0],oz:far[1]-e[1]};
}
/** The wall of a record as drawn and collided: the highest of its surfaces over a point, from the mesh itself. */
const meshes=new WeakMap();
function wallOver(road,x,z){
  let entry=meshes.get(road);
  if(!entry){
    const {vertices:v,indices}=tunnelGeometry(city,road).walls,cells=new Map();
    for(let i=0;i<indices.length;i+=3){
      const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;if(Math.abs((v[b]-v[a])*(v[c+2]-v[a+2])-(v[b+2]-v[a+2])*(v[c]-v[a]))<1e-6)continue;
      for(let cx=Math.floor(Math.min(v[a],v[b],v[c])/4);cx<=Math.floor(Math.max(v[a],v[b],v[c])/4);cx++)for(let cz=Math.floor(Math.min(v[a+2],v[b+2],v[c+2])/4);cz<=Math.floor(Math.max(v[a+2],v[b+2],v[c+2])/4);cz++){const k=`${cx},${cz}`,list=cells.get(k);if(list)list.push(i);else cells.set(k,[i]);}
    }
    meshes.set(road,entry={v,indices,cells});
  }
  const {v,indices,cells}=entry;let top=-Infinity;
  for(const i of cells.get(`${Math.floor(x/4)},${Math.floor(z/4)}`)??[]){
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3,d=(v[b+2]-v[c+2])*(v[a]-v[c])+(v[c]-v[b])*(v[a+2]-v[c+2]);
    const l1=((v[b+2]-v[c+2])*(x-v[c])+(v[c]-v[b])*(z-v[c+2]))/d,l2=((v[c+2]-v[a+2])*(x-v[c])+(v[a]-v[c])*(z-v[c+2]))/d,l3=1-l1-l2;
    if(l1>=-1e-6&&l2>=-1e-6&&l3>=-1e-6)top=Math.max(top,l1*v[a+1]+l2*v[b+1]+l3*v[c+1]);
  }
  return top;
}
/** Every metre of a cut's open, walled stretches on one side: the step to the ground at the wall line and 1.5 and 3 m beyond it (the
 * three probes of the audit that found the walls), whether another cut's excavation lies there, and how far the wall rises over the
 * higher of road and ground. */
function sideSamples(road,side){
  const total=tunnelStations(road).at(-1),count=Math.max(1,Math.round(total)),out=[];
  for(let j=0;j<=count;j++){
    // (a quarter of a metre inside the record's ends: the mesh stops at them)
    const s=Math.max(.25,Math.min(total-.25,total*j/count));if(tunnelCoveredAt(road,s)||tunnelSurfaceLandingAt(road,s))continue;
    const e=edgeAt(road,s,side),at=d=>[e.x+e.ox*d,e.z+e.oz*d],steps=[.08,1.5,3].map(d=>sampleElevation(city,...at(d))-e.y),top=wallOver(road,...at(.08));
    out.push({s,step:total/count,steps,level:Math.max(...steps.map(Math.abs))<=WALL_LEVEL,otherCut:[.08,.7,1.5,3].some(d=>openCutFloorAt(city,...at(d),road)!==undefined),otherBore:[.08,.7,1.5,3].some(d=>inBore(...at(d),road)),
      rise:top-Math.max(e.y,sampleElevation(city,...at(.08))),over:top-e.y,slab:deckUndersideAt(city,...at(.08),e.y+2.5)<Infinity,x:e.x,z:e.z});
  }
  return out;
}
const PARAPET=.45;
/** Whether a point lies in the pavement of another tunnel record, roofed or open, or the 0.3 m beyond it: one bore's wall is cut away inside another. */
const bores=city.roads.filter(r=>r.tunnel&&r.elevations).map(road=>{const xs=road.points.map(p=>p[0]),zs=road.points.map(p=>p[1]),reach=Math.max(road.width,...(road.deckWidths??[]))/2+1;return{road,minX:Math.min(...xs)-reach,maxX:Math.max(...xs)+reach,minZ:Math.min(...zs)-reach,maxZ:Math.max(...zs)+reach};});
function inBore(x,z,except){
  for(const b of bores){
    if(b.road===except||x<b.minX||x>b.maxX||z<b.minZ||z>b.maxZ)continue;
    if(roadProjection(b.road,x,z).distance<=roadWidthAt(b.road,x,z)/2+.3)return true;
  }
  return false;
}

test('no cut of Storrow Drive or of a ramp is walled on level ground',()=>{
  // Counted as the audit counted that found them (ground within 0.25 m of the road at the wall line and 1.5 and 3 m beyond it): 2,125 m of
  // such wall stood along these roads, Storrow Drive East's median among it. What is left is an opening under WALL_GAP closed between two walls.
  let open=0,walled=0,longest=0,where='';
  for(const road of cuts.filter(r=>!carriageway(r)))for(const side of [-1,1]){
    let run=0;
    for(const p of sideSamples(road,side)){
      open+=p.step;
      if(p.level&&!p.otherCut&&p.rise>PARAPET){walled+=p.step;run+=p.step;if(run>longest){longest=run;where=`${road.id} ${side<0?'left':'right'} at station ${p.s.toFixed(0)}`;}}else run=0;
    }
  }
  assert.ok(open>9000,`${open.toFixed(0)} m of open cut side on these roads`);
  assert.ok(longest<=WALL_GAP+1,`${longest.toFixed(1)} m of wall with nothing to retain in a row (${where})`);
  assert.ok(walled<open*.01,`${walled.toFixed(0)} m of wall with nothing to retain in all`);
});

test('Storrow Drive\'s median is open past its cuts as it is along its decks: Fairfield Street and west of Charlesgate',()=>{
  // Back Street's ground stands in the eastbound pavement on the south side at three places between Massachusetts Avenue and Dartmouth
  // Street, which makes those 15, 33 and 15 m walled cuts between decks; the westbound carriageway has four more, and storrow-eb-06 is one
  // of 664 m. Their median sides were 0.8 m walls on a median that is level with both carriageways.
  for(const id of ['storrow-eb-04','storrow-eb-06','storrow-eb-13','storrow-eb-15','storrow-eb-17','storrow-wb-03','storrow-wb-06','storrow-wb-08','storrow-wb-11']){
    const road=byId.get(id);assert.ok(road?.tunnel,`${id} is a walled cut`);
    const median=sideSamples(road,-1);assert.ok(median.length>=14);
    for(const p of median){
      assert.ok(p.over<Math.max(0,p.steps[0])+WALL_CURB+.03,`${id}: ${p.over.toFixed(2)} m of wall on the median at station ${p.s.toFixed(0)}`);
      // the curb is there: the terrain is cut back 0.3 m beyond the pavement, and nothing else closes that slot
      assert.ok(p.over>Math.max(0,p.steps[0])+WALL_CURB-.03,`${id}: no curb at station ${p.s.toFixed(0)} (${p.over.toFixed(2)} m)`);
    }
  }
  // and the decks between them have no rail at the joints: 3 m of one stood at each end of every deck beside a cut
  for(const id of ['storrow-eb-12','storrow-eb-14','storrow-eb-16','storrow-eb-18','storrow-wb-02','storrow-wb-04','storrow-wb-05','storrow-wb-09','storrow-wb-10'])
    assert.equal(bridgeBarriers(city,byId.get(id)).length,0,`${id} has a rail`);
  // The south side of storrow-eb-06 has a bank to retain in places, and is walled there and nowhere else.
  const south=sideSamples(byId.get('storrow-eb-06'),1),retaining=south.filter(p=>p.steps[0]>RAIL_LIP+.1&&!p.slab),level=south.filter(p=>p.level);
  assert.ok(retaining.length>100&&level.length>250,`${retaining.length} stations of bank, ${level.length} level ones`);
  for(const p of retaining)assert.ok(p.rise>.75,`storrow-eb-06: the bank at station ${p.s.toFixed(0)} has ${p.rise.toFixed(2)} m of parapet`);
  assert.ok(level.filter(p=>p.rise>PARAPET).length<12,'and its level stretches none, but for an opening closed between two walls');
});

test('a wall that retains ground or guards a drop stands as before, whatever the road',()=>{
  // (the Turnpike's carriageways are walled all along, see below; these are Storrow Drive's cuts and the ramps')
  let retained=0,guarded=0;
  for(const road of cuts.filter(r=>!carriageway(r)))for(const side of [-1,1])for(const p of sideSamples(road,side)){
    if(p.slab||p.otherBore)continue;     // under a street bridge the wall stops at its slab; beside another bore it is cut away inside that bore, and has its floor for ground
    if(p.steps[0]>SHELF_DROP+.25){retained++;assert.ok(p.rise>.7,`${road.id}: ${p.steps[0].toFixed(2)} m of ground at station ${p.s.toFixed(0)} and ${p.rise.toFixed(2)} m of wall over it`);}
    // (a drop of a rail's height just beyond the pavement, for longer than a station or two: the edge of a viaduct's approach)
    else if(Math.max(-p.steps[0],-p.steps[1])>SHELF_DROP+.5){guarded++;assert.ok(p.over>.7,`${road.id}: a drop of ${Math.max(-p.steps[0],-p.steps[1]).toFixed(2)} m at station ${p.s.toFixed(0)} and ${p.over.toFixed(2)} m of wall`);}
  }
  assert.ok(retained>1500&&guarded>100,`${retained} stations of retained ground, ${guarded} of guarded drop`);
});

test('the Turnpike\'s carriageways keep a barrier along the ground: their cuts\' walls carry on the rail or the median barrier of their decks',()=>{
  // Its decks carry no surveyed roadway and are railed along embankments and cuts alike (`bridgeBarriers`; along the median one barrier row
  // stands for the two decks' rails), so a cut of the same carriageway on level ground keeps its 0.8 m wall: one barrier along the road,
  // whichever kind of record a stretch happens to be. Along the median a cut takes part like a deck: the row runs on between the two
  // roads and the cut has no wall of its own there (`medianSpans`).
  let level=0,walled=0,shared=0;
  for(const road of cuts.filter(carriageway))for(const side of [-1,1]){
    assert.deepEqual(bareStretches(city,road,side),[]);const spans=medianSpans(city,road,side);
    for(const p of sideSamples(road,side))if(p.level&&!p.otherCut&&!p.slab){
      level++;
      if(spans.some(([a,b])=>p.s>=a&&p.s<=b)){shared++;assert.ok(!(p.over>.1),`${road.id}: a wall of its own on the median at station ${p.s.toFixed(0)}`);}else if(p.rise>PARAPET)walled++;
    }
  }
  assert.ok(level>2000&&walled+shared>level*.97&&shared>800&&walled>800,`${walled} of ${level} level stations of the carriageways' cuts are walled, ${shared} have the row between the two roads`);
  // Interstate 90 West just west of the Bowker Overpass: 153 m of cut between two decks, its median level with the eastbound deck,
  // whose pavement its own overlaps. Its wall stood up to 0.6 m inside that deck's pavement; the eastbound deck carries the row past it.
  const road=byId.get('i90-wb-26'),median=sideSamples(road,-1);
  assert.ok(median.length>140&&median.every(p=>p.level),'its median side has nothing to retain');
  assert.ok(median.every(p=>!(p.over>.1)),'and no wall of its own');
  assert.ok(sideSamples(road,1).filter(p=>p.s>1&&p.s<152&&!p.slab).every(p=>p.over>.75),'its outer side is walled all along');
  // (the row on the median between the eastbound deck, which carries it, and what runs the other way beside it, cut or deck:
  // src/simulation/median-barriers.ts)
  const rows=decks.flatMap(r=>medianBarriers(city,r)),beside=(road,s)=>{const hit=roadProjection(road,s.x,s.z);return hit.distance<roadWidthAt(road,s.x,s.z)/2+MEDIAN_REACH&&!(hit.index===0&&hit.t<=0)&&!(hit.index===road.points.length-2&&hit.t>=1);};
  for(const [id,least]of [['i90-wb-25',150],['i90-wb-26',140],['i90-wb-27',150]]){
    const deck=byId.get(id),metres=rows.reduce((sum,run)=>sum+run.slice(1).reduce((m,s,i)=>m+(beside(deck,s)&&beside(deck,run[i])?Math.hypot(s.x-run[i].x,s.z-run[i].z):0),0),0);
    assert.ok(metres>least,`${id} has ${metres.toFixed(0)} m of barrier row on its median`);
  }
  const after=byId.get('i90-wb-27'),joint=deckEdge(after,0,-1);assert.ok(rows.some(run=>run.some(s=>Math.hypot(s.x-joint[0],s.z-joint[1])<3)),'the row runs through the joint of the cut and the deck');
  // (a deck names its road in `bridge.id`, a cut in `highway`)
  const pike=decks.filter(r=>r.bridge.id==='i90'&&r.kind==='motorway');assert.ok(pike.length>50&&pike.every(r=>!r.roadway),'no carriageway deck has a surveyed roadway');
  assert.ok(decks.filter(r=>r.bridge.id==='storrow'&&r.kind==='motorway').every(r=>r.roadway?.some(Boolean)),'every Storrow Drive deck has one');
});

test('no rail stands at a joint of a deck and a cut where the deck lies on its ground',()=>{
  // A deck's surveyed roadway ends a station short of the cut it carries on as. That last stretch was railed whatever its ground.
  let joints=0;
  for(const road of decks){
    if(!road.roadway?.some(Boolean))continue;
    const stations=tunnelStations(road),rails=bridgeBarriers(city,road);
    for(const [i,j]of [[0,1],[road.points.length-1,road.points.length-2]]){
      if(road.roadway[i]||!road.roadway[j])continue;joints++;
      for(const side of [-1,1]){
        // the middle of the stretch, on the rail's own line
        const a=deckEdge(road,i,side,.18),b=deckEdge(road,j,side,.18),x=(a[0]+b[0])/2,z=(a[1]+b[1])/2,y=(deckEdgeElevation(road,i,side)+deckEdgeElevation(road,j,side))/2,length=Math.hypot(b[0]-a[0],b[1]-a[1])||1;
        const forward=i===0?1:-1,ox=-(b[1]-a[1])/length*forward*side,oz=(b[0]-a[0])/length*forward*side;
        if(!deckEdgeGrounded(city,x,z,y,ox,oz))continue;
        assert.ok(!rails.some(p=>p.side===side&&Math.hypot(p.x-x,p.z-z)<p.length/2),`${road.id}: a rail on the ground at its joint (${x.toFixed(0)}, ${z.toFixed(0)}), station ${stations[i].toFixed(0)}`);
      }
    }
  }
  assert.ok(joints>60,`${joints} joints of a surveyed deck and what it carries on as`);
});
