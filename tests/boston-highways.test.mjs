import './helpers/npc-fleet.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {loadMetroCity} from './helpers/metro-city.mjs';
import {addTunnels,highwayLegend} from '../src/render/tunnels.ts';
import {isHighwayDeck,isMotorway,openStretches,stations} from '../src/simulation/motorway.ts';
import {inTunnelPortal,tunnelCoveredAt,tunnelGeometry,tunnelPointAt,tunnelStations,tunnelSurfaceLandingAt} from '../src/simulation/tunnels.ts';
import {deckUndersideAt,roadProjection,roadWidthAt,sampleRoadElevation} from '../src/simulation/road-surfaces.ts';
import {planI93ExitSigns,EXIT_SIGN_POST} from '../src/simulation/i93-exit-signs.ts';
import {planEntranceSigns,entranceGantry,entranceSignStands,ENTRANCE_CLEARANCE,ENTRANCE_PANEL,GANTRY_SETBACK} from '../src/simulation/entrance-signs.ts';
import {planHighwaySigns,warningLegend,clearRoadside,inLanes,roadsidePoint,POST_ROOM,ROADSIDE_REACH,WARNING_POST} from '../src/simulation/highway-signs.ts';
import {highwayMasts,mastHead,MAST_ARM,MAST_HEIGHT,MAST_LIGHT,MAST_OUT,MAST_SPACING,STREET_LIGHT} from '../src/simulation/highway-lighting.ts';
import {roadGraph} from '../src/simulation/traffic.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';

// Synthetic records shaped like the Turnpike's and Storrow Drive's (scripts/build-boston-highways.py): one-way
// records with a lane count, decks in city.json and walled or roofed stretches as tunnel records of the sidecar.
const line=(x0,x1,z=0,step=20)=>{const n=Math.max(1,Math.round(Math.abs(x1-x0)/step));return Array.from({length:n+1},(_,i)=>[x0+(x1-x0)*i/n,z]);};
const deck=(id,points,extra={})=>({id,name:'I-90 East · Test',kind:'motorway',points,width:15.2,oneway:1,lanes:3,elevations:points.map(()=>2),deckWidths:points.map(()=>15.2),startLevel:1,endLevel:1,bridge:{id:'i90',kind:'boston-highway',thickness:.75},...extra});
const cut=(id,points,covered,extra={})=>({...deck(id,points,extra),bridge:undefined,highway:'i90',startLevel:-1,endLevel:-1,tunnel:{clearance:4.2,covered}});

test('a walled cut draws its open stretches as highway and its roofed ones as tunnel',()=>{
  const road=cut('i90-eb-02',line(0,400),[[100,180],[300,400]]);
  const open=openStretches(road);
  assert.deepEqual(open.map(p=>[p[0][0],p.at(-1)[0]]),[[0,100],[180,300]]);
  assert.ok(open[0].length>2,'the stretch keeps the record\'s own vertices');
  assert.deepEqual(openStretches(cut('i90-eb-03',line(0,100),[])).map(p=>[p[0][0],p.at(-1)[0]]),[[0,100]],'a cut with no roof is open throughout');
  assert.deepEqual(openStretches(cut('i90-eb-04',line(0,100),[[0,100]])),[]);
  assert.deepEqual(openStretches(deck('i90-eb-01',line(0,100))),[],'a deck is no tunnel record');
  assert.ok(isMotorway(road)&&!isHighwayDeck(road)&&isHighwayDeck(deck('i90-eb-01',line(0,100))));
});

test('exit signs stand ahead of the gore on the carriageway a ramp leaves, numbered or not, never under a roof',()=>{
  const ramp=(id,from)=>({...deck(id,[[from,0],[from+40,8],[from+90,20]]),kind:'motorway_link',lanes:1,name:'ramp'});
  const roads=[deck('i90-eb-01',line(-900,-400)),deck('i90-eb-02',line(-400,0)),ramp('i90-eb-exit-131',0),deck('i90-eb-03',line(0,400)),
    cut('i90-eb-04',line(400,800),[[100,400]]),ramp('i90-eb-exit-134',800),deck('i90-eb-05',line(800,1200)),
    {...deck('storrow-eb-01',line(0,300,500)),name:'Storrow Drive East'},{...ramp('storrow-eb-exit-clarendon',300),points:[[300,500],[340,508],[390,520]]},{...deck('storrow-eb-02',line(300,600,500)),name:'Storrow Drive East'}];
  const signs=planI93ExitSigns(roads),by=Object.fromEntries(signs.map(s=>[s.rampId,s]));
  assert.deepEqual(Object.keys(by).sort(),['i90-eb-exit-131','storrow-eb-exit-clarendon'],'the sign for Exit 134 would hang under the roof 120 m before its gore: the tunnel signs that one');
  assert.equal(by['i90-eb-exit-131'].road.id,'i90-eb-02');assert.equal(by['i90-eb-exit-131'].station,400-120);assert.equal(by['i90-eb-exit-131'].number,'131');
  const storrow=by['storrow-eb-exit-clarendon'];
  assert.equal(storrow.number,undefined,'Storrow Drive\'s exits carry no number');assert.ok(storrow.scale<1&&storrow.road.id==='storrow-eb-01'&&Math.abs(storrow.station-(300-80))<1e-9);
});

test('an entrance sign stands over the ramp beyond its street landing, in the open',()=>{
  // The reviewed legend is the Dartmouth Street entrance's: a ramp level on its street for 12 m, then down a slot to its roof.
  const points=line(0,240,0,3),ramp=(extra={})=>({...cut('i90-wb-entrance-copley',points,[[130,240]]),kind:'motorway_link',lanes:1,width:6,deckWidths:points.map(()=>6),name:'I-90 West · Entrance from Dartmouth Street',
    elevations:points.map(p=>-Math.max(0,p[0]-12)*.04),startLevel:0,tunnel:{clearance:4.2,covered:[[130,240]],surfaceLandings:[[0,12]]},...extra});
  const [sign]=planEntranceSigns([deck('i90-wb-19',line(240,400)),ramp()]);
  assert.equal(sign.station,12+GANTRY_SETBACK,'beyond the landing, where the walls of the slot have risen');
  assert.deepEqual([sign.shield,sign.direction,[...sign.lines],sign.pike],['90','WEST',['New York'],true]);
  const gantry=entranceGantry(sign);
  assert.deepEqual(gantry.posts.map(p=>[p.x,+p.z.toFixed(2)]),[[21,-3.55],[21,3.55]],'a post behind each wall of the slot');
  assert.ok(Math.abs(gantry.bottom-(sign.approach.y+ENTRANCE_CLEARANCE))<1e-9&&Math.abs(gantry.top-gantry.bottom-ENTRANCE_PANEL.height)<1e-9&&ENTRANCE_CLEARANCE>=5,'the panel hangs clear of a truck on the ramp');
  // No landing: the ramp's first metres. Under a roof or on a ramp too short for it there is none, and none without the ramp.
  assert.equal(planEntranceSigns([ramp({tunnel:{clearance:4.2,covered:[[130,240]]}})])[0].station,GANTRY_SETBACK);
  assert.deepEqual(planEntranceSigns([ramp({tunnel:{clearance:4.2,covered:[[15,240]],surfaceLandings:[[0,12]]}})]),[]);
  assert.deepEqual(planEntranceSigns([{...ramp(),points:points.slice(0,7),elevations:points.slice(0,7).map(()=>0),deckWidths:points.slice(0,7).map(()=>6)}]),[]);
  assert.deepEqual(planEntranceSigns([deck('i90-wb-19',line(240,400))]),[]);
});

test('Storrow Drive\'s warnings stand on their records in the open',()=>{
  const roads=[{...deck('storrow-eb-01',line(0,300)),name:'Storrow Drive East'},{...cut('storrow-eb-02',line(300,700),[[150,400]]),name:'Storrow Drive East'}];
  const highwaySigns=[{kind:'cars-only',road:'storrow-eb-01',station:25},{kind:'clearance',road:'storrow-eb-02',station:80,clearance:'10\'-0"'},{kind:'clearance',road:'storrow-eb-02',station:200,clearance:'10\'-0"'},{kind:'clearance',road:'missing',station:5}];
  const placed=planHighwaySigns({roads,highwaySigns});
  assert.deepEqual(placed.map(p=>[p.sign.kind,p.road.id,p.approach.x]),[['cars-only','storrow-eb-01',25],['clearance','storrow-eb-02',380]],'the one under the roof and the one without a record are left out');
  assert.deepEqual(warningLegend(highwaySigns[0]),['CARS','ONLY']);assert.deepEqual(warningLegend(highwaySigns[1]),['LOW','CLEARANCE','10\'-0"']);
  assert.deepEqual(planHighwaySigns({roads}),[]);
});

test('the Turnpike is lit along its carriageways and Storrow Drive and the ramps are not',()=>{
  const masts=highwayMasts(deck('i90-eb-01',line(0,400)));
  assert.equal(masts.length,400/MAST_SPACING);assert.ok(masts.every(m=>Math.abs(m.z-(15.2/2+.55))<1e-9&&m.y===2),'on the right of eastbound traffic, at the pavement edge');
  assert.ok(Math.abs(masts[1].x-masts[0].x-MAST_SPACING)<1e-9);
  const west=highwayMasts(deck('i90-wb-01',line(400,0)));assert.ok(west.every(m=>Math.abs(m.z+(15.2/2+.55))<1e-9),'and on the other side going west');
  const roofed=highwayMasts(cut('i90-eb-02',line(0,400),[[100,300]]));
  assert.ok(roofed.length&&roofed.every(m=>m.x<100-MAST_SPACING/2+1e-9||m.x>300+MAST_SPACING/2-1e-9),'none under a roof nor at its portal');
  assert.deepEqual(highwayMasts({...deck('storrow-eb-01',line(0,400)),name:'Storrow Drive East'}),[]);
  // A street bridge over the road: no mast under its slab (the underside of whatever stands over a point, as deckUndersideAt gives it).
  const bridged=highwayMasts(deck('i90-eb-01',line(0,400)),(x,z,above)=>x>170&&x<190?above+2:Infinity);
  assert.equal(bridged.length,masts.length-1);assert.ok(!bridged.some(m=>m.x>170&&m.x<190)&&highwayMasts(deck('i90-eb-01',line(0,400)),()=>Infinity).length===masts.length);
  assert.deepEqual(highwayMasts({...deck('i90-eb-exit-131',line(0,400)),kind:'motorway_link'}),[]);
});

test('no roadside post stands in a lane at its own level: a sign or a mast stands beyond the ramp beside its road',()=>{
  // An eastbound carriageway along z 0, 15.2 m wide and 2 m up. From x 100 to 300 a ramp 5 m wide adjoins it on the right (+z, going east
  // with z south) at its level: the pavement edge, where a post would stand, is in the ramp's lane.
  const ground={elevation:{width:3,height:3,cellSize:400,originX:-200,originZ:-400,heights:Array(9).fill(0)}};
  const main=deck('i90-eb-01',line(0,400)),beside=line(100,300,7.6+2.5),ramp=deck('i90-eb-exit-9',beside,{width:5,deckWidths:beside.map(()=>5),lanes:1});
  const lanes=roads=>(x,z,y=2)=>inLanes(ground,roads,x,z,y);
  assert.ok(lanes([main,ramp])(150,7.6+MAST_OUT),'the pavement edge beside the ramp is in the ramp\'s lane');
  assert.ok(!lanes([main])(150,7.6+MAST_OUT)&&!lanes([main])(150,7.6+WARNING_POST)&&!lanes([main])(150,7.6+EXIT_SIGN_POST),'a road\'s own edge is never in its lanes');
  assert.ok(lanes([main])(150,7.6+POST_ROOM-.05)&&lanes([main])(150,0),'which reach a post\'s room beyond the pavement');
  assert.ok(!lanes([main,ramp])(50,7.6+MAST_OUT)&&!lanes([main,ramp])(360,7.6+MAST_OUT),'nor before the ramp begins or after it ends');
  // only lanes at the post's own level count: not a bridge overhead, not a street on the ground under a viaduct
  const over=line(100,300,7.6+2.5),bridge=deck('street-bridge',over,{width:5,deckWidths:over.map(()=>5),elevations:over.map(()=>9)}),street={id:'street',name:'Street',points:over,width:5,oneway:0};
  assert.ok(!lanes([main,bridge])(150,7.6+MAST_OUT)&&!lanes([main,street])(150,7.6+MAST_OUT));
  assert.ok(lanes([street])(150,10.1,.4)&&lanes([{...street,pavedWidth:9}])(150,10.1+4.6,.4)&&!lanes([street])(150,10.1+4.6,.4),'a street on the ground by its measured roadway');
  // a walled cut alongside is lanes in the open and none under its roof
  const trench=cut('i90-eb-entrance-9',over,[[100,200]],{width:5,deckWidths:over.map(()=>5)});
  assert.ok(lanes([main,trench])(150,7.6+MAST_OUT)&&!lanes([main,trench])(250,7.6+MAST_OUT),'(the cut runs from x 100: roofed from x 200 on)');
  // the paving beside a deck's lanes is shoulder: a post may stand in it
  assert.ok(!lanes([deck('storrow-wb-01',line(0,400),{roadway:line(0,400).map(()=>[12,7.6])})])(150,11));

  // the place of a post: the first clear one going out from the edge, half a metre at a time
  const blocked=(x,z)=>lanes([main,ramp])(x,z),at=tunnelPointAt(main,150),place=clearRoadside(at,MAST_OUT,blocked);
  assert.ok(place&&Math.abs(place.post-(7.6+MAST_OUT+5))<1e-9,`beyond the ramp, ${place?.post} m from the centre line`);
  const foot=roadsidePoint(place,place.post);assert.ok(Math.abs(foot.x-150)<1e-9&&Math.abs(foot.z-place.post)<1e-9,'on the right of eastbound traffic');
  assert.ok(foot.z-(7.6+5)>=POST_ROOM&&foot.z-(7.6+5)<POST_ROOM+.5,'a post\'s room beyond the ramp\'s pavement and no further');
  assert.deepEqual({...place,post:0},{...at,post:0},'the approach itself is unchanged');
  assert.equal(clearRoadside(tunnelPointAt(main,50),MAST_OUT,blocked).post,7.6+MAST_OUT,'where nothing is beside the road the post stays at its edge');
  assert.equal(clearRoadside(at,MAST_OUT,blocked,3),undefined,'no place within reach');assert.equal(clearRoadside(at,MAST_OUT,()=>true),undefined);
  assert.ok(Math.abs(clearRoadside(at,MAST_OUT,(x,z)=>z<7.6+MAST_OUT+ROADSIDE_REACH-1e-6).post-(7.6+MAST_OUT+ROADSIDE_REACH))<1e-9,'the reach itself is tried');
  // westbound the right hand is -z, northbound +x, southbound -x
  for(const [points,side] of [[line(400,0),[0,-1]],[line(0,400).map(([x])=>[0,-x]),[1,0]],[line(0,400).map(([x])=>[0,x]),[-1,0]]]){
    const p=tunnelPointAt(deck('i90-wb-01',points),150),q=roadsidePoint(p,10);assert.ok(Math.abs(q.x-p.x-side[0]*10)<1e-9&&Math.abs(q.z-p.z-side[1]*10)<1e-9);
  }

  // the masts of the carriageway: those beside the ramp stand beyond it, their arms over its lane, the others where they stood
  const plain=highwayMasts(main),placed=highwayMasts(main,undefined,(x,z,y)=>lanes([main,ramp])(x,z,y));
  assert.equal(placed.length,plain.length);
  for(const [i,m] of placed.entries()){
    assert.equal(m.x,plain[i].x);assert.ok(Math.abs(m.z-(m.x>=100&&m.x<=300?7.6+MAST_OUT+5:7.6+MAST_OUT))<1e-9,`mast at x ${m.x} stands at z ${m.z}`);
    assert.ok(!lanes([main,ramp])(m.x,m.z)&&lanes([main,ramp])(mastHead(m).x,mastHead(m).z),'clear of every lane, its luminaire over one');
  }
  // and one that finds no place is left out
  const none=highwayMasts(main,undefined,x=>x>100&&x<300);assert.ok(none.length===plain.filter(m=>!(m.x>100&&m.x<300)).length&&none.length<plain.length&&none.every(m=>m.z===7.6+MAST_OUT));
});

test('a mast\'s night light shines from its luminaire and lights the road beneath as a street lamp does',()=>{
  const east=highwayMasts(deck('i90-eb-01',line(0,400)))[0],west=highwayMasts(deck('i90-wb-01',line(400,0)))[0];
  for(const mast of [east,west]){
    const head=mastHead(mast),inward=-Math.sign(mast.z);
    assert.ok(Math.abs(head.x-mast.x)<1e-9&&Math.abs(head.z-(mast.z+inward*MAST_ARM))<1e-9,'the head hangs over the lanes at the end of the arm');
    assert.ok(head.y-mast.y>MAST_HEIGHT-.6&&head.y-mast.y<MAST_HEIGHT,'at the top of the mast');
    // The night light is given the road under the head and rises from there: it stands inside the head (0.12 m deep), as a
    // street lamp's stands inside its globe, so the fixture is not lit by its own light, and never metres below it.
    assert.ok(Math.abs(mast.y+MAST_LIGHT.rise-head.y)<.06,`the light hangs ${(head.y-mast.y-MAST_LIGHT.rise).toFixed(2)} m from the middle of the head`);
  }
  assert.deepEqual(STREET_LIGHT,{rise:5.6,intensity:70,distance:21},'street lamps keep their light');
  // What reaches the road r metres from the point under a light: three's point light falls off with the square of the
  // distance and fades out at its reach (getDistanceAttenuation), times the cosine at the road.
  const onRoad=(light,r)=>{const d=Math.hypot(light.rise,r);return light.intensity/(d*d)*(1-(d/light.distance)**4)**2*light.rise/d;};
  const under=onRoad(MAST_LIGHT,0)/onRoad(STREET_LIGHT,0);
  assert.ok(under>.55&&under<.7,`the road under a mast is lit ${under.toFixed(2)} times as brightly as under a street lamp`);
  assert.ok(onRoad(MAST_LIGHT,10)>1.5*onRoad(STREET_LIGHT,10)&&onRoad(MAST_LIGHT,MAST_SPACING/2)>0,'higher up, it lights a wider pool: across three lanes and to the middle between two masts');
});

// ---- the installed package
const city=await loadMetroCity({tiles:[]});
const highway=city.roads.filter(r=>/^(i90|storrow|route1a)-/.test(r.id)),byId=new Map(highway.map(r=>[r.id,r]));
const family=prefix=>highway.filter(r=>new RegExp(`^${prefix}-\\d+$`).test(r.id)).sort((a,b)=>Number(a.id.split('-').at(-1))-Number(b.id.split('-').at(-1)));

test('the package carries the Turnpike and Storrow Drive as decks and tunnel records that continue each other',()=>{
  assert.ok(highway.length>250&&byId.size===highway.length,'unique record ids');
  for(const prefix of ['i90-eb','i90-wb','storrow-eb','storrow-wb']){
    const chain=family(prefix);assert.ok(chain.length>=10,`${prefix} pieces`);
    for(let i=1;i<chain.length;i++){
      const a=chain[i-1],b=chain[i];
      assert.deepEqual(a.points.at(-1),b.points[0],`${a.id} meets ${b.id}`);assert.ok(Math.abs(a.elevations.at(-1)-b.elevations[0])<1e-3,`${a.id} and ${b.id} meet at one height`);
    }
    assert.ok(chain.every(r=>r.oneway===1&&Number.isInteger(r.lanes)&&isMotorway(r)));
  }
  for(const r of highway){
    assert.equal(r.elevations.length,r.points.length);assert.ok(r.tunnel?r.highway&&!r.bridge:r.bridge.kind==='boston-highway',`${r.id} is a deck or a highway tunnel record`);
    if(r.tunnel){const total=tunnelStations(r).at(-1);assert.ok(r.tunnel.covered.every(([a,b])=>a>=0&&b<=total+.01&&b>a),`${r.id} covered intervals`);}
  }
  const closed=highway.filter(r=>r.closed).map(r=>[r.id.replace(/-\d+$/,''),r.closed]);
  assert.deepEqual(closed.sort(),[['i90-eb','start'],['i90-wb','end']],'only the Turnpike reaches the edge of the map; Storrow Drive runs on as streets at both ends');
  assert.ok(!highway.some(r=>/toll/i.test(r.name)),'no toll plaza');
});

test('Storrow Drive keeps its low tunnel and passes low under the Harvard Bridge',()=>{
  const tunnel=family('storrow-eb').filter(r=>r.tunnel?.covered.length);
  assert.ok(tunnel.length>=1&&tunnel.every(r=>r.tunnel.clearance===3.2),'the tunnel at the Esplanade is posted 10 ft');
  assert.ok(highway.filter(r=>r.id.startsWith('i90-')&&r.tunnel).every(r=>r.tunnel.clearance===4.2),'the Turnpike\'s tunnels keep their 13 ft 9 in');
  const covered=tunnel.reduce((sum,r)=>sum+r.tunnel.covered.reduce((s,[a,b])=>s+b-a,0),0);assert.ok(covered>200&&covered<450,`the tunnel is about 300 m long (${covered.toFixed(0)} m roofed)`);
  // Massachusetts Avenue crosses both carriageways on the Harvard Bridge's approach: the roadway dips under it.
  for(const prefix of ['storrow-eb','storrow-wb']){
    const low=Math.min(...family(prefix).flatMap(r=>r.points.map((p,i)=>p[0]>-1320&&p[0]<-1180?r.elevations[i]:Infinity)));
    assert.ok(low<-1.8,`${prefix} goes down under Massachusetts Avenue (${low.toFixed(2)} m)`);
  }
  const signs=city.highwaySigns??[];
  assert.ok(signs.filter(s=>s.kind==='clearance').length>=6&&signs.filter(s=>s.kind==='cars-only').length>=6,'low clearance and cars only warnings');
  assert.ok(signs.every(s=>byId.has(s.road)&&s.road.startsWith('storrow-')&&s.station>=0&&s.station<=stations(byId.get(s.road).points).at(-1)+.01));
  assert.ok(signs.filter(s=>s.kind==='clearance').every(s=>/^\d+'-\d+"$/.test(s.clearance)));
  assert.ok(planHighwaySigns(city).length>=12);
});

test('exit signs and lighting masts stand on the installed carriageways in the open',()=>{
  const signs=planI93ExitSigns(city.roads).filter(s=>!s.rampId.startsWith('i93-'));
  assert.ok(signs.some(s=>s.rampId==='i90-eb-exit-131'&&s.number==='131')&&signs.some(s=>s.rampId==='i90-wb-exit-131'),'Exit 131 is signed both ways');
  assert.ok(signs.some(s=>s.rampId.startsWith('storrow-')&&!s.number));
  assert.ok(signs.every(s=>!(s.road.tunnel&&tunnelCoveredAt(s.road,s.station))));
  let masts=0,lit=0;
  for(const road of highway){
    const list=highwayMasts(road);masts+=list.length;lit+=list.length>0;
    assert.ok(list.every(m=>Number.isFinite(m.x+m.y+m.z)));if(!/^i90-(eb|wb)-\d+$/.test(road.id))assert.equal(list.length,0,`${road.id} carries no masts`);
  }
  assert.ok(masts>350&&lit>60,`the Turnpike is lit along its length (${masts} masts on ${lit} records)`);
});

test('no sign post and no mast stands in a lane on the installed package, and each stands on the right of its traffic',()=>{
  // the lanes of the roads around a point, as the tile builder asks for them
  const CELL=200,cells=new Map(),box=new Map();
  for(const road of city.roads){
    let a=Infinity,b=-Infinity,c=Infinity,d=-Infinity;for(const [x,z] of road.points){a=Math.min(a,x);b=Math.max(b,x);c=Math.min(c,z);d=Math.max(d,z);}box.set(road,[a,b,c,d]);
    for(let i=Math.floor(a/CELL);i<=Math.floor(b/CELL);i++)for(let j=Math.floor(c/CELL);j<=Math.floor(d/CELL);j++){const key=`${i},${j}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(road);}
  }
  const around=(x,z,m=30)=>{const out=new Set();for(let i=Math.floor((x-m)/CELL);i<=Math.floor((x+m)/CELL);i++)for(let j=Math.floor((z-m)/CELL);j<=Math.floor((z+m)/CELL);j++)for(const road of cells.get(`${i},${j}`)??[]){const [a,b,c,d]=box.get(road);if(a<=x+m&&b>=x-m&&c<=z+m&&d>=z-m)out.add(road);}return[...out];};
  const lanes=(x,z,y)=>inLanes(city,around(x,z),x,z,y),inLane=(x,z,y)=>around(x,z).filter(road=>inLanes(city,[road],x,z,y)).map(road=>road.id);
  // A post is as tall as its structure: it must not come up through a pavement over its own road either (a street at the rim of its cut, a
  // deck beside it), `rise` metres up from its foot. The rule asks for the lanes at the post's level only; this holds the package to the rest.
  const through=(x,z,y,rise)=>{const out=new Set();for(let h=y+1;h<y+rise;h+=1)for(const id of inLane(x,z,h))out.add(id);return[...out];};
  // beyond the pavement on the right hand of the road's traffic: +n, n = (-tz, tx)
  const right=(road,x,z)=>{const hit=roadProjection(road,x,z),a=road.points[hit.index],b=road.points[hit.index+1];return(b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0])>0&&hit.distance>=roadWidthAt(road,x,z)/2;};
  // (a warning's face ends 4.2 m over the road, an exit sign's pole 7.3 m)
  const signs=[...planHighwaySigns(city).map(s=>({road:s.road,approach:s.approach,out:WARNING_POST,rise:4.2})),...planI93ExitSigns(city.roads).map(s=>({road:s.road,approach:s.approach,out:EXIT_SIGN_POST,rise:7.3}))];
  assert.ok(signs.length>=30,`${signs.length} roadside signs`);let moved=0;
  for(const {road,approach,out,rise} of signs){
    const place=clearRoadside(approach,out,(x,z)=>lanes(x,z,approach.y));assert.ok(place,`the sign on ${road.id} finds a place within reach`);
    const foot=roadsidePoint(place,place.post);assert.deepEqual(inLane(foot.x,foot.z,approach.y),[],`the post of the sign on ${road.id} at ${foot.x.toFixed(0)}, ${foot.z.toFixed(0)}`);
    assert.deepEqual(through(foot.x,foot.z,approach.y,rise),[],`the post of the sign on ${road.id} at ${foot.x.toFixed(0)}, ${foot.z.toFixed(0)} comes up through a pavement`);
    assert.ok(right(road,foot.x,foot.z),`the sign on ${road.id} stands on the right of its traffic`);
    // the surveyed roadway beside the lanes is all on this side of the post
    if(road.roadway)assert.ok(place.post>=approach.edge+out-1e-9&&approach.edge>=approach.width/2);
    if(place.post>approach.edge+out+1e-9)moved++;
  }
  const overhead=(x,z,above)=>deckUndersideAt(city,x,z,above);let masts=0,shifted=0;
  for(const road of highway){
    const plain=highwayMasts(road,overhead),placed=highwayMasts(road,overhead,lanes);masts+=placed.length;assert.ok(placed.length<=plain.length);
    for(const m of placed){
      assert.deepEqual(inLane(m.x,m.z,m.y),[],`a mast of ${road.id} at ${m.x.toFixed(0)}, ${m.z.toFixed(0)}`);assert.ok(right(road,m.x,m.z),`a mast of ${road.id} stands on the right of its traffic`);
      assert.deepEqual(through(m.x,m.z,m.y,MAST_HEIGHT),[],`a mast of ${road.id} at ${m.x.toFixed(0)}, ${m.z.toFixed(0)} comes up through a pavement`);
      const head=mastHead(m);assert.ok(lanes(head.x,head.z,m.y),`the luminaire of the mast of ${road.id} at ${m.x.toFixed(0)}, ${m.z.toFixed(0)} hangs over a lane`);
      if(!plain.some(p=>Math.hypot(p.x-m.x,p.z-m.z)<1e-6))shifted++;
    }
  }
  assert.ok(masts>350,`${masts} masts`);
  // (13 masts stood in the lane of a ramp beside their carriageway, and the CARS ONLY sign at the University Road exit in the exit's)
  assert.ok(moved>=1&&shifted>=5,`${moved} signs and ${shifted} masts stand beyond a ramp beside their road`);
});

test('the tunnels sign every installed exit by its number or by none, the two of a fork side by side, and no panel among the cars',()=>{
  for(const road of highway){
    const legend=highwayLegend(road);
    if(/· Exit /.test(road.name))assert.match(legend[0],/^EXIT(?: \d+[A-Z]?)?  ↗$/,`${road.id}: ${road.name}`);
    assert.ok(legend.every(line=>line&&!/^(to|the) /.test(line)),`${road.id}: ${legend.join(' / ')}`);
  }
  const view=addTunnels(new THREE.Scene(),city);
  try{
    const panels=[];view.group.traverse(o=>{if(o.userData.tunnelSignFace&&o.userData.roadId)panels.push(o);});
    assert.ok(panels.some(o=>o.name==='EXIT  ↗ / Beacon Street / Arlington Street'),'Storrow Drive\'s exit inside its tunnel carries no number');
    assert.ok(!panels.some(o=>/^EXIT [a-z]/.test(o.name)));
    // Different legends on one road never share a place: where a ramp tunnel forks, its two exits hang side by side.
    let forks=0;
    for(let i=0;i<panels.length;i++)for(let j=i+1;j<panels.length;j++){
      const a=panels[i],b=panels[j];if(a.userData.roadId!==b.userData.roadId||a.name===b.name)continue;
      const apart=a.position.distanceTo(b.position),room=(a.geometry.parameters.width+b.geometry.parameters.width)/2;
      assert.ok(apart>=room,`${a.name} and ${b.name} on ${a.userData.roadId} hang ${apart.toFixed(2)} m apart`);
      if(a.userData.station===b.userData.station){forks++;assert.ok(/↖/.test(a.name)!==/↖/.test(b.name),`${a.name} and ${b.name} point apart`);}
    }
    assert.ok(forks>=3,`the Turnpike's ramp tunnels fork (${forks} gantries with two legends)`);
    for(const panel of panels){
      const road=byId.get(panel.userData.roadId)??city.roads.find(r=>r.id===panel.userData.roadId),floor=tunnelPointAt(road,panel.userData.station).y,bottom=panel.position.y-panel.geometry.parameters.height/2-floor;
      assert.ok(bottom>=2.25-1e-6,`${panel.name} on ${road.id} hangs ${bottom.toFixed(2)} m over the road`);
      assert.ok(panel.position.y+panel.geometry.parameters.height/2-floor<road.tunnel.clearance,`${panel.name} on ${road.id} hangs under its roof`);
    }
  }finally{view.group.traverse(o=>{o.geometry?.dispose();for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])m.dispose();});}
});

test('a street bridge over the cut spans it: Tremont Street, the walls beneath every bridge and the masts',()=>{
  // Boston's segments start Tremont Street's southern piece at level 0 on the bridge node over the eastbound carriageway:
  // the stage takes it as the bridge's ramp, so the three pieces are one deck from Marginal Road to Herald Street.
  const bridge=['16345-0-0','16346-0-0','14792-0-0'].map(id=>city.roads.find(r=>r.id===id));
  assert.ok(bridge.every(r=>r?.elevations&&r.bridge?.kind==='elevated'),'all three pieces are decks');
  for(let i=1;i<3;i++){assert.deepEqual(bridge[i-1].points.at(-1),bridge[i].points[0]);assert.ok(Math.abs(bridge[i-1].elevations.at(-1)-bridge[i].elevations[0])<1e-3,'the pieces meet at one height');}
  assert.ok(Math.abs(bridge[2].elevations.at(-1)-sampleElevation(city,...bridge[2].points.at(-1)))<.05,'and the ramp lands on the ground at Herald Street');
  let steepest=0;for(const r of bridge){const along=stations(r.points);for(let i=1;i<along.length;i++)if(along[i]-along[i-1]>.7)steepest=Math.max(steepest,Math.abs(r.elevations[i]-r.elevations[i-1])/(along[i]-along[i-1]));}
  assert.ok(steepest<.085,`no step and no steep ramp on the bridge (${(steepest*100).toFixed(1)}%)`);
  for(const prefix of ['i90-eb','i90-wb']){
    // (a vertex of the bridge over the road's pavement: the carriageway lies on its surveyed roadway, which is not centred on the city's line the bridge was split at)
    const under=family(prefix).find(r=>bridge.some(b=>b.points.some(p=>roadProjection(r,...p).distance<roadWidthAt(r,...p)/2)));assert.ok(under,`${prefix} passes under the bridge`);
    for(const b of bridge)for(let i=0;i<b.points.length;i++){
      const hit=roadProjection(under,...b.points[i]);if(hit.distance>roadWidthAt(under,...b.points[i])/2)continue;
      assert.ok(b.elevations[i]-.75-sampleRoadElevation(city,under,...b.points[i])>=3.4,`room under the slab over ${under.id}`);
    }
  }
  // Columbus Avenue's southern landings stood on the slope of the cut, 8 m from the node over the westbound carriageway: both
  // carriageways now land where the avenue has climbed out of it, and the bridge runs level instead of falling to the old landings.
  for(const [piece,rest] of [['14733-0-0-deck','14733-0-0'],['15800-0-0-deck','15800-0-0']]){
    const ramp=city.roads.find(r=>r.id===piece),street=city.roads.find(r=>r.id===rest);
    assert.ok(ramp?.elevations&&street&&!street.elevations,`${piece} carries the bridge on to the street`);
    const shared=ramp.startLevel===0?[ramp.points[0],0]:[ramp.points.at(-1),ramp.points.length-1];
    assert.ok(street.points.some(p=>p[0]===shared[0][0]&&p[1]===shared[0][1])&&Math.abs(ramp.elevations[shared[1]]-sampleElevation(city,...shared[0]))<.05,'landing on the street at its ground');
    const along=stations(ramp.points);let grade=0;for(let i=1;i<along.length;i++)if(along[i]-along[i-1]>.7)grade=Math.max(grade,Math.abs(ramp.elevations[i]-ramp.elevations[i-1])/(along[i]-along[i-1]));
    assert.ok(grade<.07,`${piece} is no ramp to speak of (${(grade*100).toFixed(1)}%)`);
  }
  // The cut's walls rise to the ground beside it plus a parapet, which is where a level bridge's deck lies: under a bridge they stop at its slab.
  const decks=city.roads.filter(r=>r.elevations&&!r.tunnel).map(road=>{const xs=road.points.map(p=>p[0]),zs=road.points.map(p=>p[1]);return{road,minX:Math.min(...xs)-12,maxX:Math.max(...xs)+12,minZ:Math.min(...zs)-12,maxZ:Math.max(...zs)+12};});
  let beneath=0;
  for(const road of highway.filter(r=>r.tunnel)){
    const walls=tunnelGeometry(city,road).walls;
    for(let i=0;i<walls.vertices.length;i+=3){
      const x=walls.vertices[i],y=walls.vertices[i+1],z=walls.vertices[i+2];let surface;
      for(const d of decks){
        if(x<d.minX||x>d.maxX||z<d.minZ||z>d.maxZ||roadProjection(d.road,x,z).distance>roadWidthAt(d.road,x,z)/2-.25)continue;
        surface??=sampleRoadElevation(city,road,x,z);const top=sampleRoadElevation(city,d.road,x,z);if(top<surface+2.5)continue;
        // (under a sloping ramp piece the 0.4 m wall's far corner reaches a few centimetres into the slab: never to its surface)
        beneath++;assert.ok(y<=top-.3,`a wall of ${road.id} stands through ${d.road.id} (${d.road.name}) at ${x.toFixed(0)}, ${z.toFixed(0)}`);
      }
    }
  }
  assert.ok(beneath>500,`walls pass under street bridges (${beneath} wall vertices beneath a slab)`);
  const all=highway.flatMap(r=>highwayMasts(r)),clear=highway.flatMap(r=>highwayMasts(r,(x,z,above)=>deckUndersideAt(city,x,z,above)));
  assert.ok(clear.length<all.length&&clear.length>all.length*.9,`masts under a bridge are left out (${all.length-clear.length} of ${all.length})`);
});

test('a bridge with a landing down in the cut is level between its banks: Beacon Street, Cambridge Street and Arlington Street',()=>{
  const piece=id=>{const r=city.roads.find(r=>r.id===id);assert.ok(r?.elevations,`${id} is a deck piece`);return r;};
  // The sharpest change of grade along a chain of pieces, a joint between two pieces included, and its steepest grade.
  const shape=ids=>{
    const pieces=ids.map(piece),grades=[];
    for(let k=0;k<pieces.length;k++){
      const r=pieces[k],along=stations(r.points);
      if(k){assert.deepEqual(pieces[k-1].points.at(-1),r.points[0],`${ids[k-1]} runs on into ${ids[k]}`);assert.ok(Math.abs(pieces[k-1].elevations.at(-1)-r.elevations[0])<1e-3,'at one height');}
      for(let i=1;i<along.length;i++)if(along[i]-along[i-1]>.7)grades.push((r.elevations[i]-r.elevations[i-1])/(along[i]-along[i-1]));
    }
    return{pieces,steepest:Math.max(...grades.map(Math.abs)),sharpest:Math.max(...grades.slice(1).map((g,i)=>Math.abs(g-grades[i]))),top:Math.max(...pieces.flatMap(r=>r.elevations))};
  };
  const room=(pieces,prefix)=>{
    const under=family(prefix).filter(r=>pieces.some(b=>b.points.some(p=>roadProjection(r,...p).distance<roadWidthAt(r,...p)/2)));assert.ok(under.length,`${prefix} passes under the bridge`);let least=Infinity;
    for(const r of under)for(const b of pieces)b.points.forEach((p,i)=>{if(roadProjection(r,...p).distance<=roadWidthAt(r,...p)/2)least=Math.min(least,b.elevations[i]-.75-sampleRoadElevation(city,r,...p));});
    return least;
  };
  // Beacon Street by Fenway Park: the Blandford Street Steps come up to the westbound bridge from beside the Turnpike. Their landing
  // down there kept the whole chain on build-metro.py's lifted nodes: 8.5 to 10 m with a 1.5 m dip at the node the steps reach,
  // 4 m over the eastbound bridge beside it.
  const west=shape(['9354-0-0','9353-0-0','15629-0-0']),east=shape(['15627-0-0','8898-0-0','8875-0-0']);
  assert.ok(west.sharpest<.04,`no break on the westbound bridge (${(west.sharpest*100).toFixed(1)}%)`);assert.ok(west.steepest<.05,`nor a ramp (${(west.steepest*100).toFixed(1)}%)`);
  assert.ok(Math.abs(west.top-east.top)<.75,`the two carriageways are one bridge (${west.top.toFixed(2)} and ${east.top.toFixed(2)} m)`);
  for(const prefix of ['i90-eb','i90-wb'])assert.ok(room(west.pieces,prefix)>=3.4,`room under the westbound slab over ${prefix}`);
  const steps=shape(['7661-0-0']),landing=steps.pieces[0];assert.ok(Math.abs(landing.elevations[0]-sampleElevation(city,...landing.points[0]))<.05,'the steps still start on the ground beside the Turnpike');
  assert.ok(Math.abs(landing.elevations.at(-1)-west.pieces[0].elevations.at(-1))<1e-3,'and reach the deck at its height');assert.ok(steps.steepest<.18,`climbing the bank at ${(steps.steepest*100).toFixed(1)}%, not copying its steps`);
  // Cambridge Street over the Allston ramps: one carriageway's western landing lies 1.4 m over the ramps, a hair under what counted as a bank.
  const north=shape(['11810-0-0','7281-0-0','7280-0-0']),south=shape(['8714-0-0','8648-0-0','10285-0-0']);
  assert.ok(Math.abs(north.top-south.top)<.5,`Cambridge Street's carriageways are one bridge (${north.top.toFixed(2)} and ${south.top.toFixed(2)} m)`);assert.ok(north.sharpest<.06&&north.steepest<.1);
  // Arlington Street: the Turnpike's entrance leaves the street at the bridge's northern landing and counted as a road beneath it there.
  // (the deck falls 3.5% from the northern bank to the southern one, 2 m lower: its crest at the northern node is the 4% that is left of a 19% peak)
  const arlington=shape(['16349-0-0','16350-0-0','16351-0-0']);assert.ok(arlington.sharpest<.06,`no peak on the Arlington Street bridge (${(arlington.sharpest*100).toFixed(1)}%)`);assert.ok(arlington.steepest<.06);
  for(const prefix of ['i90-eb','i90-wb'])assert.ok(room(arlington.pieces,prefix)>=3.4,`room under the Arlington Street slab over ${prefix}`);
});

test('Brookline\'s two bridges over the Turnpike: Carlton Street is level between its banks, Saint Mary\'s Street is one bridge, and the road keeps its floor beneath both',()=>{
  const piece=id=>city.roads.find(r=>r.id===id),grade=r=>{const along=stations(r.points);let g=0;for(let i=1;i<along.length;i++)if(along[i]-along[i-1]>.7)g=Math.max(g,Math.abs(r.elevations[i]-r.elevations[i-1])/(along[i]-along[i-1]));return g;};
  // Carlton Street: OpenStreetMap maps the span and the two legs it parts into at its southern end as three bridge ways, and each was
  // profiled between the survey's ground at its own ends. Their common node lies over the bank of the cut: the deck fell 3 m to it
  // from the legs (26% and 21%) and climbed out again, and the Turnpike was taken 3.4 m under that low point, 3.3 m below its own cut.
  const span=piece('osm-1388687878-0'),leg=piece('osm-1388687881-0'),arm=piece('osm-1388687882-0'),north=piece('osm-429053400-0-deck'),street=piece('osm-429053400-0');
  assert.ok([span,leg,arm,north].every(r=>r?.elevations&&r.bridge?.kind==='elevated'),'the span, its two legs and the piece that carries it on to the bank are decks');assert.ok(street&&!street.elevations,'the street keeps the rest');
  assert.deepEqual([span.startLevel,span.endLevel,leg.startLevel,arm.endLevel,north.startLevel,north.endLevel],[1,1,1,1,1,0],'the node of the three ways is a node of the bridge');
  const node=span.elevations[0];assert.deepEqual(leg.points[0],span.points[0]);assert.deepEqual(arm.points.at(-1),span.points[0]);assert.ok(Math.abs(leg.elevations[0]-node)<1e-3&&Math.abs(arm.elevations.at(-1)-node)<1e-3,'the three ways meet at one height');
  assert.ok(Math.abs(north.elevations[0]-span.elevations.at(-1))<1e-3&&north.points[0][0]===span.points.at(-1)[0]);
  assert.ok(Math.max(...span.elevations)-Math.min(...span.elevations)<.5&&Math.min(...span.elevations)>1.5,`the span is level (${Math.min(...span.elevations).toFixed(2)} to ${Math.max(...span.elevations).toFixed(2)} m)`);
  for(const [r,i] of [[leg,leg.points.length-1],[arm,0],[north,north.points.length-1]])assert.ok(Math.abs(r.elevations[i]-sampleElevation(city,...r.points[i]))<.05,`${r.id} lands on the ground`);
  assert.ok(grade(span)<.03&&grade(north)<.03&&grade(arm)<.08&&grade(leg)<.14,`no fall to the node (${[span,north,arm,leg].map(r=>(grade(r)*100).toFixed(1)).join(', ')}%)`);
  // Saint Mary's Street is the line between Boston and Brookline, and both sources carried its bridge: Brookline's copy ran down the bank
  // to the bridge's first node, crossed the cut as a second deck from its floor up and ended in a stub. Only Boston's levelled bridge is left.
  for(const id of ['osm-48917525-0','osm-43100845-0','osm-93120171-0'])assert.ok(!piece(id),`${id}, a copy of the bridge, has left the package`);
  const boston=['9794-0-0','9790-0-0','9792-0-0','9793-0-0'].map(piece);assert.ok(boston.every(r=>r?.elevations));
  const over=city.roads.filter(r=>r.elevations&&!r.tunnel&&!isMotorway(r)&&roadProjection(r,-2636.7,147.5).distance<12);assert.deepEqual(over.map(r=>r.id).sort(),['9790-0-0','9792-0-0'],'one deck over the cut on the street\'s line');
  for(const p of [[-2626.388,88.33],[-2642.013,184.151]])assert.ok(city.roads.filter(r=>!r.elevations&&r.points.some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<.05)).length>=1,'the streets beyond each landing still meet the bridge');
  // The road beneath: 3.4 m under each slab, and no dip under either bridge (it lay at -5.7 m under Carlton Street and -4.8 m under Saint Mary's Street).
  for(const [name,pieces,x,z] of [['Carlton Street',[span],-2844,55],["Saint Mary's Street",boston,-2637,148]])for(const prefix of ['i90-eb','i90-wb']){
    const records=family(prefix),points=records.flatMap(r=>r.points.map((q,i)=>({q,y:r.elevations[i],r}))),at=points.reduce((best,c)=>Math.hypot(c.q[0]-x,c.q[1]-z)<Math.hypot(best.q[0]-x,best.q[1]-z)?c:best);
    const beside=points.filter(c=>{const d=Math.hypot(c.q[0]-at.q[0],c.q[1]-at.q[1]);return d>60&&d<110;});assert.ok(beside.length>10&&Math.hypot(at.q[0]-x,at.q[1]-z)<25);
    // (the westbound road comes down to Carlton Street on the eastbound one's profile, which it shares since the two carriageways lie
    // at one height: 0.65 m under where it stands 60 to 110 m east of the bridge, which is its fall toward the low point of the cut)
    assert.ok(at.y>=Math.min(...beside.map(c=>c.y))-.75,`${prefix} does not dip under ${name}: ${at.y.toFixed(2)} m against ${Math.min(...beside.map(c=>c.y)).toFixed(2)} m beside it`);
    assert.ok(Math.abs(at.y-.35-sampleElevation(city,...at.q))<1.2||at.r.tunnel,`${prefix} rides on its ground under ${name}`);
    for(const b of pieces)b.points.forEach((q,i)=>{for(const r of records)if(roadProjection(r,...q).distance<=roadWidthAt(r,...q)/2)assert.ok(b.elevations[i]-.75-sampleRoadElevation(city,r,...q)>=3.4,`room under ${b.id} over ${r.id}`);});
  }
});

test('a bridge\'s landing in a hollow of the ground is raised to the deck: Carlton Street\'s two legs are one surface, and Cambridge Street no longer dips to its bridge in Allston',()=>{
  const piece=id=>{const r=city.roads.find(r=>r.id===id);assert.ok(r,id);return r;};
  // The ground every 2 m along a street from one of its ends.
  const beyond=(id,reversed,length=40)=>{
    const points=reversed?[...piece(id).points].reverse():piece(id).points,out=[];let done=0,next=0;
    for(let i=1;i<points.length&&next<=length;i++){const a=points[i-1],b=points[i],d=Math.hypot(b[0]-a[0],b[1]-a[1]);for(;next<=done+d&&next<=length;next+=2){const t=d?(next-done)/d:0;out.push(sampleElevation(city,a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t));}done+=d;}
    return out;
  };
  // Carlton Street. OpenStreetMap ends the bridge's two legs on the slope the survey shows under it (0.8 and 1.1 m), and the junction of Carlton
  // and Mountfort Streets was graded down to them: the level deck fell 0.9 and 0.6 m to landings 11 m apart, and the legs, each drawn at its full
  // width, overlapped with the northbound slab half a metre over the southbound one, a ledge across the southbound lane.
  const span=piece('osm-1388687878-0'),leg=piece('osm-1388687881-0'),arm=piece('osm-1388687882-0'),node=span.elevations[0],low=[leg.elevations.at(-1),arm.elevations[0]];
  assert.ok(low.every(y=>node-y<.1&&node-y>-.02),`the junction south of the bridge is level with it (landings at ${low.map(y=>y.toFixed(2)).join(' and ')} m under a deck at ${node.toFixed(2)} m)`);
  let overlap=0;
  for(const [a,b] of [[leg,arm],[arm,leg]])a.points.forEach((q,i)=>{if(roadProjection(b,...q).distance<=b.width/2){overlap++;assert.ok(Math.abs(a.elevations[i]-sampleRoadElevation(city,b,...q))<.06,`${a.id} and ${b.id} lie at one height where they overlap, at ${q}`);}});
  assert.ok(overlap>=6,'the two legs do overlap');
  for(const [id,reversed,landing] of [['osm-43100841-0',false,low[0]],['osm-1388687883-0',true,low[1]],['osm-8814750-0',true,low[1]]]){
    const ground=beyond(id,reversed);assert.ok(Math.min(...ground)>=landing-.05&&ground.every((y,i)=>!i||y>=ground[i-1]-.05),`${id} leaves the junction without a dip (${ground.slice(0,8).map(y=>y.toFixed(2)).join(' ')})`);
  }
  // Cambridge Street west of the Allston ramps: its two carriageways landed 2.7 and 1.6 m under their deck, the street back at the deck's
  // height 20 m on after a climb of 16%.
  for(const [id,end,street,reversed] of [['11810-0-0',0,'11811-0-0',true],['10285-0-0',-1,'10845-0-0',false]]){
    const ramp=piece(id),landing=ramp.elevations.at(end),top=ramp.elevations.at(end?0:-1),ground=beyond(street,reversed,30);   // (30 m: the street tops its plateau beyond)
    assert.ok(Math.abs(landing-sampleElevation(city,...ramp.points.at(end)))<.05,`${id} lands on the ground`);assert.ok(top-landing>-.02&&top-landing<.35,`${id} comes down ${(top-landing).toFixed(2)} m to its landing`);   // (the landing takes the grid's centimetres)
    assert.ok(Math.abs(ground[0]-landing)<.05&&ground.every((y,i)=>!i||y>=ground[i-1]-.05),`${street} does not dip to the bridge (${ground.slice(0,10).map(y=>y.toFixed(2)).join(' ')})`);
    assert.ok(Math.max(...ground.slice(1).map((y,i)=>(y-ground[i])/2))<.13,`and climbs on to its plateau gently`);
  }
});

test('streets that start or end on Storrow Drive join it in the traffic graph',()=>{
  const {nodes,edges}=roadGraph(city);
  for(const [street,leaves] of [['25498-0-0',true],['12137-0-0',false]]){
    const road=city.roads.find(r=>r.id===street),p=leaves?road.points[0]:road.points.at(-1),near=new Set(nodes.map((n,i)=>Math.hypot(n[0]-p[0],n[1]-p[1])<5?i:-1).filter(i=>i>=0));
    const here=edges.filter(e=>near.has(e.start)||near.has(e.end)),on=e=>e.road.id.startsWith('storrow-');
    assert.ok(here.some(e=>e.road===road&&near.has(leaves?e.start:e.end)),`${road.name} (${street}) is in the graph at Storrow Drive`);
    assert.ok(here.some(e=>on(e)&&near.has(e.end))&&here.some(e=>on(e)&&near.has(e.start)),'and the parkway is split there, arriving and leaving');
  }
});

test('traffic can follow each carriageway from end to end and enters and leaves the Turnpike at its closed ends',()=>{
  const {nodes,edges}=roadGraph(city),out=new Map();
  for(const e of edges){const list=out.get(e.start);if(list)list.push(e);else out.set(e.start,[e]);}
  const reach=(from,to)=>{
    const goal=new Set(edges.filter(e=>e.road===to).map(e=>e.end)),seen=new Set(),queue=[...new Set(edges.filter(e=>e.road===from).map(e=>e.start))];
    for(const n of queue)seen.add(n);
    while(queue.length){const n=queue.pop();if(goal.has(n))return true;for(const e of out.get(n)??[])if(isMotorway(e.road)&&!seen.has(e.end)){seen.add(e.end);queue.push(e.end);}}
    return false;
  };
  for(const prefix of ['i90-eb','i90-wb','storrow-eb','storrow-wb']){
    const chain=family(prefix);assert.ok(edges.some(e=>e.road===chain[0])&&edges.some(e=>e.road===chain.at(-1)),`${prefix} is in the traffic graph`);
    assert.ok(reach(chain[0],chain.at(-1)),`${prefix}: lanes continue from its first record to its last`);
  }
  assert.ok(edges.filter(e=>e.source).some(e=>e.road===family('i90-eb')[0]),'traffic emerges from the barrier at the Newton line');
  assert.ok(edges.filter(e=>e.sink).some(e=>e.road===family('i90-wb').at(-1)),'and vanishes into the westbound one');
  // The Turnpike joins Interstate 93 inside the Central Artery tunnel.
  const artery=city.roads.find(r=>r.id==='central-artery-northbound'),ramp=byId.get('i90-to-i93-north');
  assert.ok(artery&&ramp&&artery.points.some((p,i)=>p[0]===ramp.points.at(-1)[0]&&p[1]===ramp.points.at(-1)[1]&&Math.abs(artery.elevations[i]-ramp.elevations.at(-1))<.02),'the ramp from the Turnpike ends on a vertex of the northbound bore at its height');
});

test('no ground stands in the pavement of an installed highway deck',()=>{
  // A route's pieces: a carriageway's are all numbered (i90-eb-01 …); a ramp's first keeps the route's id and the rest add -2, -3 ….
  const first=new Set(),last=new Set(),seen=new Map();
  for(const road of highway){
    const base=road.id.replace(/-\d+$/,''),piece=base!==road.id&&(byId.has(base)||/^(i90|storrow)-(eb|wb)$/.test(base)),k=piece?base:road.id,n=piece?Number(road.id.slice(base.length+1)):1,cur=seen.get(k)??{lo:Infinity,hi:-Infinity};
    if(n<cur.lo){cur.lo=n;cur.first=road;}if(n>cur.hi){cur.hi=n;cur.last=road;}seen.set(k,cur);
  }
  for(const {first:f,last:l} of seen.values()){first.add(f);last.add(l);}
  for(const road of highway.filter(r=>!r.tunnel)){
    const along=stations(road.points),total=along.at(-1);
    for(let i=0;i<road.points.length;i++){
      // Where a route meets its street or the road it joins, the two share the ground (within the stage's LANDING_LIP).
      const meeting=(first.has(road)&&along[i]<18)||(last.has(road)&&total-along[i]<18);
      const a=road.points[Math.max(0,i-1)],b=road.points[Math.min(road.points.length-1,i+1)],l=Math.hypot(b[0]-a[0],b[1]-a[1])||1,nx=-(b[1]-a[1])/l,nz=(b[0]-a[0])/l,half=road.deckWidths[i]/2-.3;
      for(const o of [-half,-half/2,0,half/2,half])assert.ok(sampleElevation(city,road.points[i][0]+nx*o,road.points[i][1]+nz*o)<=road.elevations[i]+(meeting?.18:.01),`${road.id} at ${road.points[i]}`);
    }
  }
});


test('a ramp lies on its street inside its landing and goes down in the open beyond it: the Dartmouth Street and Haul Road entrances',()=>{
  // The runtime keeps the ground whole over a surface landing and builds no wall beside it. A landing that ran on over a road
  // already below the ground buried it: the Dartmouth Street entrance had 180 m of Huntington Avenue's island over it.
  const across=(road,s,f)=>{const p=tunnelPointAt(road,s),c=Math.cos(p.yaw),n=Math.sin(p.yaw);return f.map(o=>sampleElevation(city,p.x+c*o*p.width/2,p.z-n*o*p.width/2)).sort((a,b)=>a-b);};
  let landings=0;
  for(const road of highway.filter(r=>r.tunnel?.surfaceLandings)){
    const total=tunnelStations(road).at(-1);
    for(const [a,b] of road.tunnel.surfaceLandings){
      if(!((a<.01&&road.startLevel===0)||(b>total-.01&&road.endLevel===0)))continue;   // (a mouth where a street joins a walled road is no landing on the ground)
      landings++;
      for(let s=a;s<=b;s=s<b&&s+1>b?b:s+1){
        const lanes=across(road,s,[-2/3,-1/3,0,1/3,2/3]),over=lanes[2]-tunnelPointAt(road,s).y;
        assert.ok(over<=.2,`the ground stands ${over.toFixed(2)} m over ${road.id} inside its landing, ${s.toFixed(1)} m along it`);
      }
    }
  }
  assert.ok(landings>=6,`${landings} landings on the ground`);
  for(const [id,reach] of [['i90-wb-entrance-copley',12],['i90-eb-entrance-135',24]]){
    const road=byId.get(id),total=tunnelStations(road).at(-1),[landing]=road.tunnel.surfaceLandings,roof=Math.min(...road.tunnel.covered.map(c=>c[0]));
    assert.deepEqual(landing,[0,reach],`${id} lands on its street for ${reach} m`);
    assert.ok(roof>100&&roof<total,`${id} is roofed from ${roof} m`);
    // On the street's surface to the end of the landing, then down without a step, never steeper than its grade.
    for(let s=0;s<=reach;s+=1)assert.ok(Math.abs(across(road,s,[-1/3,0,1/3])[1]-tunnelPointAt(road,s).y)<.05,`${id} leaves the street's surface ${s} m along it`);
    for(let s=reach;s<roof;s+=1){
      const p=tunnelPointAt(road,s),q=tunnelPointAt(road,s+1);assert.ok(Math.abs(q.y-p.y)<=.106,`${id} steeper than 10.5% at ${s}`);
      // the slot is open: no roof, the ground cut over the whole pavement, and no landing left to keep it
      if(s>reach+1){assert.ok(!tunnelCoveredAt(road,s)&&!tunnelSurfaceLandingAt(road,s));for(const o of [-.9,0,.9])assert.ok(inTunnelPortal(city,p.x+Math.cos(p.yaw)*o*p.width/2,p.z-Math.sin(p.yaw)*o*p.width/2),`ground left over ${id} at ${s}`);}
    }
    for(const s of [2,reach-2]){const p=tunnelPointAt(road,s);assert.ok(!inTunnelPortal(city,p.x,p.z),`${id}: the junction keeps its ground ${s} m along the ramp`);}
    const deep=tunnelPointAt(road,roof-5);assert.ok(across(road,roof-5,[0])[0]-deep.y>4,`${id} is ${ (across(road,roof-5,[0])[0]-deep.y).toFixed(1)} m down where its roof begins`);
  }
  // Huntington Avenue's two carriageways run beside the Dartmouth Street slot on ground of their own: the slot is the survey's 6 m,
  // inside the island between them, and the ground under each carriageway's lanes is whole from the junction on. (Their centre
  // lines leave the ramp's own vertex, so the lanes are measured as traffic drives them: 0.17 of the measured roadway either side.)
  const ramp=byId.get('i90-wb-entrance-copley');assert.ok(Math.max(...ramp.deckWidths)<=6);
  for(const id of ['15703-0-0','15708-0-0']){
    const street=city.roads.find(r=>r.id===id),along=stations(street.points),lane=Math.min(3,street.pavedWidth*.17);let checked=0;
    assert.ok(street.oneway&&street.pavedWidth>=6.5,`${street.name} (${id}) keeps its two lanes`);
    for(let d=6;d<120;d+=1){
      let i=1;while(i<along.length-1&&along[i]<d)i++;
      const t=(d-along[i-1])/(along[i]-along[i-1]),a=street.points[i-1],b=street.points[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]),x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,nx=-(b[1]-a[1])/l,nz=(b[0]-a[0])/l;
      for(const o of [-lane,0,lane]){assert.ok(!inTunnelPortal(city,x+nx*o,z+nz*o),`a lane of ${street.name} (${id}) is cut for the ramp ${d} m along it`);checked++;}
    }
    assert.ok(checked>300);
  }
});

test('the Dartmouth Street entrance is signed overhead: 90 West, New York, on a gantry at the mouth of its slot',()=>{
  const signs=planEntranceSigns(city.roads);assert.deepEqual(signs.map(s=>s.rampId),['i90-wb-entrance-copley']);
  const [sign]=signs,road=sign.road,landing=road.tunnel.surfaceLandings[0][1],roof=Math.min(...road.tunnel.covered.map(c=>c[0])),gantry=entranceGantry(sign);
  assert.ok(sign.station>landing+5&&sign.station<landing+15&&sign.station<roof-60,`the gantry stands ${sign.station} m along the ramp, at its mouth`);
  assert.ok(entranceSignStands(city,sign),'nothing stands in the panel or on a post\'s place: the tile builds it');
  // The panel clears the ramp and the street beside it; each post stands on the island's ground behind a wall of the slot,
  // outside the cut and clear of the lanes of the avenue's two carriageways.
  assert.ok(gantry.bottom-sign.approach.y>=5&&gantry.bottom-sampleElevation(city,gantry.posts[0].x,gantry.posts[0].z)>=4.3);
  const lanes=['15703-0-0','15708-0-0'].flatMap(id=>{const street=city.roads.find(r=>r.id===id),offset=Math.min(3,street.pavedWidth*.17);return [-offset,offset].map(o=>({street,o}));});
  for(const post of gantry.posts){
    assert.ok(!inTunnelPortal(city,post.x,post.z),'a post stands on the ground, not in the slot');
    assert.ok(Math.abs(sampleElevation(city,post.x,post.z)-sampleElevation(city,sign.approach.x,sign.approach.z))<.3,'on the level island');
    for(const {street,o} of lanes){
      let near=Infinity;
      for(let i=1;i<street.points.length;i++){
        const a=street.points[i-1],b=street.points[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]),nx=-(b[1]-a[1])/l,nz=(b[0]-a[0])/l,ax=a[0]+nx*o,az=a[1]+nz*o,dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((post.x-ax)*dx+(post.z-az)*dz)/(l*l)));
        near=Math.min(near,Math.hypot(post.x-ax-dx*t,post.z-az-dz*t));
      }
      assert.ok(near>1.4,`a post stands ${near.toFixed(2)} m from the centre of a lane of ${street.name} (${street.id})`);
    }
  }
});

