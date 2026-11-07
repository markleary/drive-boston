import assert from 'node:assert/strict';
import test from 'node:test';
import {loadMetroCity,readJson} from './helpers/metro-city.mjs';
import {constructionCones} from '../src/simulation/construction.ts';
import {lane,roadGraph,roundedPath} from '../src/simulation/traffic.ts';
import {NPC_VEHICLES} from '../src/simulation/npc-vehicle-specs.ts';
import {constructionLanePoints,constructionPoint,planConstructionZones,CONSTRUCTION_APPROACH} from '../src/simulation/construction-zones.ts';
import {isMotorway} from '../src/simulation/motorway.ts';

const road=(id,extra={})=>({id,name:`${id} Avenue`,width:14,pavedWidth:14,oneway:1,points:[[0,-100],[0,100]],...extra});
const city=roads=>({bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000},spawn:{x:-900,z:-900,yaw:0},roads,buildings:[],signals:[]});
const plan=(roads,options={})=>planConstructionZones(city(roads),{seed:12345,...options});
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

// Width is not a label/class check: surveyed pavement has to support the
// closed lane and a full same-direction lane, even on a nominally wide road.
test('construction only closes roads with a second usable lane in the same direction',()=>{
  for(const extra of [{pavedWidth:undefined},{oneway:1,width:15,pavedWidth:6.99},{oneway:-1,pavedWidth:5.5},{oneway:0,pavedWidth:12.99},{oneway:0,width:7,pavedWidth:6.5},{width:20,pavedWidth:5},{traffic:false},{pavedWidth:14,deckWidths:[14,6.9]},{oneway:0,pavedWidth:16,deckWidths:[16,12.9]},{bridge:{id:'bridge'}},{tunnel:{clearance:5}}])assert.equal(plan([road('ineligible',extra)]).length,0,JSON.stringify(extra));
  for(const extra of [{oneway:1,pavedWidth:7},{oneway:-1,pavedWidth:7.2},{oneway:0,pavedWidth:13}]){
    const [zone]=plan([road('eligible',extra)]);assert.ok(zone,JSON.stringify(extra));
    assert.ok(zone.laneOffset+1.3<zone.pavedWidth/2,'the 2.6m vehicle fits inside the curb');
    assert.ok(zone.openOffset-1.3>=-zone.pavedWidth/2,'the widest traffic fits in the open lane');
    if(!extra.oneway)assert.ok(zone.openOffset-1.3>=0,'the detour never borrows the opposing direction');
    assert.equal(zone.direction,extra.oneway===-1?-1:zone.direction);
  }
});

test('sites clear junctions, overlapping road ribbons, transit, sharp bends and dataset edges',()=>{
  const short=road('short',{points:[[0,-60],[0,60]]});
  const crossing=road('crossing',{points:[[-100,0],[100,0]],width:7,pavedWidth:7,oneway:0});
  assert.equal(plan([short,crossing]).length,0,'a cross street keeps the entire short candidate block clear');
  const overlapping=road('parallel',{points:[[5,-100],[5,100]],width:7,pavedWidth:7,oneway:0});
  assert.equal(plan([short,overlapping]).length,0,'another carriageway cannot overlap the cone or merging envelope');
  const routes=[{points:[[-100,0],[100,0]]}];
  assert.equal(plan([short],{transitRoutes:routes}).length,0,'routes need not share source road vertices to exclude a crossing bus/tram');
  assert.equal(plan([short],{excludedRoadIds:new Set(['short'])}).length,0);
  assert.equal(plan([short],{maxZones:0}).length,0);
  const bend=road('bend',{points:[[0,-60],[0,0],[60,0]]});
  assert.equal(plan([bend]).length,0,'the machinery and lane merge require a straight worksite');
  const local=city([short]);local.coverage=[[[-20,-100],[20,-100],[20,-5],[-20,-5]]];
  assert.equal(planConstructionZones(local,{seed:12345}).length,0,'a site cannot extend outside the drivable data');
  assert.equal(plan([road('too-short',{points:[[0,-59],[0,59]]})]).length,0,'approaches and junction setbacks must fit on the source road');
});

test('a seeded layout stays fixed and adjacent worksites cannot close both road directions',()=>{
  const roads=Array.from({length:20},(_,i)=>road(`r${i}`,{points:[[i*200,-150],[i*200,150]]}));
  const first=plan(roads),again=plan([...roads].reverse()),different=plan(roads,{seed:98});
  assert.ok(first.length>=4);
  assert.deepEqual(first.map(z=>[z.roadId,z.x,z.z,z.direction,z.vehicleKind]),again.map(z=>[z.roadId,z.x,z.z,z.direction,z.vehicleKind]),'source order cannot move a worksite during reindexing');
  assert.notDeepEqual(first.map(z=>[z.roadId,z.x,z.z]),different.map(z=>[z.roadId,z.x,z.z]),'a new session seed produces another layout');
  assert.equal(new Set(first.map(z=>z.roadId)).size,first.length);
  for(let i=0;i<first.length;i++)for(let j=0;j<i;j++)assert.ok(Math.hypot(first[i].x-first[j].x,first[i].z-first[j].z)>=350);
});

test('both lanes merge around equipment and cones, opposing traffic keeps its original lane',()=>{
  for(const extra of [{oneway:1,pavedWidth:7},{oneway:-1,pavedWidth:7},{oneway:0,pavedWidth:13}]){
    const r=road('work',extra),[zone]=plan([r]);assert.ok(zone);
    const points=zone.direction===1?r.points:[...r.points].reverse();
    for(const nominal of [zone.laneOffset,Math.max(1.6,zone.openOffset)]){
      const original=constructionLanePoints(r,points,nominal,[zone]);if(nominal>zone.openOffset+.001)assert.ok(original.length>30,'a long source segment gets transition samples');
      assertFootprintClearance(zone,roundedPath(original,original.map(()=>r)));
      const lane=original.flatMap((p,i)=>{const q=original[i+1];if(!q)return[p];const count=Math.ceil(distance(p,q));return Array.from({length:count},(_,j)=>[p[0]+(q[0]-p[0])*j/count,p[1]+(q[1]-p[1])*j/count]);});
      for(const p of lane){
        const along=(p[0]-zone.x)*Math.sin(zone.yaw)+(p[1]-zone.z)*Math.cos(zone.yaw),offset=-(p[0]-zone.x)*Math.cos(zone.yaw)+(p[1]-zone.z)*Math.sin(zone.yaw);
        if(Math.abs(along)<zone.workLength/2+4)assert.ok(offset<=zone.openOffset+.001,'route clears the full work area and machinery');
        assert.ok(Math.abs(offset)+1.3<=zone.pavedWidth/2+.001,'a 2.6m NPC stays inside the curb');
        if(!r.oneway)assert.ok(offset-1.3>=-.001,'two-way traffic stays on its own side');
      }
      assert.ok(distance(lane[0],[points[0][0]-Math.cos(zone.yaw)*nominal,points[0][1]+Math.sin(zone.yaw)*nominal])<1e-8);
      assert.ok(distance(lane.at(-1),[points.at(-1)[0]-Math.cos(zone.yaw)*nominal,points.at(-1)[1]+Math.sin(zone.yaw)*nominal])<1e-8);
      // Use the runtime's actual cone positions, including both taper ends.
      for(const {along,offset}of constructionCones(zone)){
        const cone=constructionPoint(zone,along,offset);
        assert.ok(Math.min(...lane.map(p=>distance(p,cone)))>1.55,'the widest traffic clears the cone bases');
      }
    }
    if(!r.oneway){
      const reversed=[...points].reverse(),untouched=constructionLanePoints(r,reversed,3,[zone]);
      assert.equal(untouched.length,2,'opposing traffic does not take the merge');
      assert.ok(distance(untouched[0],constructionPoint(zone,((reversed[0][0]-zone.x)*Math.sin(zone.yaw)+(reversed[0][1]-zone.z)*Math.cos(zone.yaw)),-3))<1e-8);
    }
    assert.ok(CONSTRUCTION_APPROACH>=10,'drivers finish moving before reaching the first cone');
  }
});

test('real Boston layout provides separated, transit-free sites and every NPC footprint clears actual cones',async()=>{
  const data=await loadMetroCity({tiles:[]}),transit=readJson('transit.json');
  const zones=planConstructionZones(data,{seed:12345,transitRoutes:transit.routes});
  assert.ok(zones.length>=60,'Boston should have work sites throughout the metro, not one canned location');
  assert.ok(zones.some(zone=>Math.hypot(zone.x-data.spawn.x,zone.z-data.spawn.z)<500),'some construction should be discoverable in Back Bay');
  assert.ok(zones.some(zone=>Math.hypot(zone.x-data.spawn.x,zone.z-data.spawn.z)>5000),'the feature reaches beyond the starting district');
  const edges=roadGraph(data).edges,byRoad=new Map();
  for(const edge of edges){const list=byRoad.get(edge.road.id)??[];list.push(edge);byRoad.set(edge.road.id,list);}
  assert.ok(zones.some(zone=>isMotorway(zone.road)),'work zones also close lanes on the interstate');
  for(const zone of zones){
    // Highway work zones close a lane on the interstate decks; street sites never sit on a bridge or in a tunnel.
    if(isMotorway(zone.road))assert.ok(zone.road.bridge&&!zone.road.tunnel,'a highway site sits on an interstate deck');
    else{assert.ok(zone.pavedWidth>=(zone.road.oneway?7:13));assert.ok(!zone.road.bridge&&!zone.road.tunnel);}
    assert.ok(Math.hypot(zone.x-data.spawn.x,zone.z-data.spawn.z)>=65,'construction cannot materialize under the starting car');
    for(const edge of byRoad.get(zone.roadId)??[]){
      const points=lane(edge,zones),path=roundedPath(points,points.map(()=>edge.road));
      assertFootprintClearance(zone,path);
    }
  }
});

function assertFootprintClearance(zone,path){
  const at=s=>{
    let lo=0,hi=path.distances.length-1;while(lo+1<hi){const mid=(lo+hi)>>1;if(path.distances[mid]<s)lo=mid;else hi=mid;}
    const a=path.points[lo],b=path.points[hi],t=(s-path.distances[lo])/(path.distances[hi]-path.distances[lo]||1);return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  };
  const halfWidth=Math.max(...NPC_VEHICLES.map(v=>v.width))/2,halfLength=Math.max(...NPC_VEHICLES.map(v=>v.length))/2;
  const cones=constructionCones(zone).map(({along,offset})=>constructionPoint(zone,along,offset));
  for(let station=0;station<path.length-2;station+=.5){
    const p=at(station),ahead=at(station+2),along=(p[0]-zone.x)*Math.sin(zone.yaw)+(p[1]-zone.z)*Math.cos(zone.yaw);
    if(Math.abs(along)>zone.length/2+halfLength+3)continue;
    // Match pathYaw's two-metre heading lookahead and test the whole longest,
    // widest fleet rectangle, rather than just its centre or centreline.
    const yaw=Math.atan2(ahead[0]-p[0],ahead[1]-p[1]),fx=Math.sin(yaw),fz=Math.cos(yaw);
    for(const cone of cones){
      const dx=cone[0]-p[0],dz=cone[1]-p[1],x=dx*fz-dz*fx,z=dx*fx+dz*fz;
      const clearance=Math.hypot(Math.max(Math.abs(x)-halfWidth,0),Math.max(Math.abs(z)-halfLength,0));
      assert.ok(clearance>.35,`${zone.road.name}: full NPC rectangle clears the cone's 0.35m bounding circle (${clearance.toFixed(3)}m)`);
    }
  }
}
