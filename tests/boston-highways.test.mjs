import './helpers/npc-fleet.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {loadMetroCity} from './helpers/metro-city.mjs';
import {isHighwayDeck,isMotorway,openStretches,stations} from '../src/simulation/motorway.ts';
import {tunnelCoveredAt,tunnelGeometry,tunnelStations} from '../src/simulation/tunnels.ts';
import {deckUndersideAt,roadProjection,roadWidthAt,sampleRoadElevation} from '../src/simulation/road-surfaces.ts';
import {planI93ExitSigns} from '../src/simulation/i93-exit-signs.ts';
import {planHighwaySigns,warningLegend} from '../src/simulation/highway-signs.ts';
import {highwayMasts,MAST_SPACING} from '../src/simulation/highway-lighting.ts';
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
    const under=family(prefix).find(r=>bridge.some(b=>b.points.some(p=>roadProjection(r,...p).distance<1)));assert.ok(under,`${prefix} passes under the bridge`);
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
