import './helpers/npc-fleet.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {Ray} from '@dimforge/rapier3d-compat';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {createTraffic,roadGraph,MOTORWAY_CRUISE,RAMP_CRUISE} from '../src/simulation/traffic.ts';
import {motorwayLanes,stations,pointAtDistance,CLOSURE_SETBACK,SINK_BEYOND,LANE_WIDTH} from '../src/simulation/motorway.ts';
import {closedEndBarriers,laneMarkings,LANE_DASH,JERSEY} from '../src/simulation/road-surfaces.ts';
import {planConstructionZones,planMotorwayZones,constructionLocal,MOTORWAY_SPACING,MOTORWAY_WORK_LENGTH,MOTORWAY_TAPER_LENGTH} from '../src/simulation/construction-zones.ts';
import {routeGraph,anchorAt,destinationAnchors,planRoute,motorwayRamp} from '../src/simulation/navigation.ts';
import {closestRoad} from '../src/simulation/roads.ts';
import {resolveCity} from '../src/simulation/city-tiles.ts';
import {createMinimapLabeler} from '../src/ui/minimap-labels.ts';

// Synthetic I-93 records shaped as the data contract describes them (the real
// ones come from scripts/build-i93-north.py). North is -z. Decks stand 8 m up
// over flat ground; a lane is 3.65 m and a deck adds shoulders.
const DECK=8;
const line=(...corners)=>{const out=[corners[0]];for(let c=1;c<corners.length;c++){const a=corners[c-1],b=corners[c],n=Math.max(1,Math.round(Math.hypot(b[0]-a[0],b[1]-a[1])/50));for(let i=1;i<=n;i++)out.push([a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n]);}return out;};
const deck=(id,name,points,lanes,extra={})=>{const width=lanes*LANE_WIDTH+(lanes>1?4:3.4);return{id,name,kind:'motorway',points,width,oneway:1,lanes,elevations:points.map(()=>DECK),deckWidths:points.map(()=>width),bridge:{id:'i93',kind:'i93-north',thickness:1.2,clearanceEstimated:true},startLevel:1,endLevel:1,...extra};};
/** A one-lane ramp level with the carriageway for 120 m at its gore, then graded to the street. */
const ramp=(id,name,points,from,to)=>{const along=stations(points),total=along.at(-1),[a,b]=from>to?[120,total]:[0,total-120];return deck(id,name,points,1,{kind:'motorway_link',elevations:along.map(s=>from+(to-from)*Math.min(1,Math.max(0,(s-a)/(b-a))))});};
const street=(id,name,points,extra={})=>({id,name,points,width:12,oneway:0,kind:'secondary',...extra});
const fixture=(roads,bounds={minX:-600,maxX:700,minZ:-3000,maxZ:200},spawn={x:400,z:-100,yaw:0})=>({bounds,spawn,roads,buildings:[],signals:[],landmarks:[],sources:[]});
/** One northbound carriageway: a closed start at z=0, an exit and an entrance at Test
 * Street (z=-1500, both landing on an interior vertex of the street), a lane drop at
 * z=-2200 and a closed end at z=-2800. */
const corridor=()=>fixture([
  deck('nb-01','I-93 North · Southtown',line([0,0],[0,-1200]),3,{closed:'start'}),
  deck('nb-02','I-93 North · Midtown',line([0,-1200],[0,-1800]),3),
  deck('nb-03','I-93 North · Midtown',line([0,-1800],[0,-2200]),3),
  deck('nb-04','I-93 North · Northtown',line([0,-2200],[0,-2800]),2,{closed:'end'}),
  ramp('nb-exit-23','I-93 North · Exit 23 Test Street',[[0,-1200],[6,-1260],[20,-1340],[40,-1420],[60,-1500]],DECK,0),
  ramp('nb-entrance-23','I-93 North · Entrance from Test Street',[[60,-1500],[40,-1580],[20,-1660],[6,-1740],[0,-1800]],0,DECK),
  street('test-street','Test Street',[[-400,-1500],[-100,-1500],[60,-1500],[200,-1500],[500,-1500]]),
]);
const near=(p,q,within=.01)=>Math.hypot(p[0]-q[0],p[1]-q[1])<within;

test('the traffic graph splits a street where a ramp lands inside it and gives highway decks their lanes, sinks and sources',()=>{
  const city=corridor(),{nodes,edges}=roadGraph(city),of=id=>edges.filter(e=>e.road.id===id);
  assert.deepEqual(of('nb-01').map(e=>e.laneOffset),motorwayLanes(city.roads[0]));
  assert.deepEqual(of('nb-01').map(e=>e.laneOffset),[-LANE_WIDTH,0,LANE_WIDTH],'three lanes 3.65 m apart about the centreline');
  assert.deepEqual(of('nb-04').map(e=>e.laneOffset),[-LANE_WIDTH/2,LANE_WIDTH/2]);
  assert.deepEqual(edges.filter(e=>e.source).map(e=>e.road.id),['nb-01','nb-01','nb-01'],'every lane emerges from the closed start');
  assert.deepEqual(edges.filter(e=>e.sink).map(e=>e.road.id),['nb-04','nb-04'],'every lane vanishes into the closed end');
  // Test Street is one record; it is cut only at the vertex both ramps land on.
  const pieces=of('test-street');
  assert.equal(pieces.length,4,'two pieces, both directions');
  assert.ok(pieces.every(e=>near(nodes[e.start],[60,-1500])||near(nodes[e.end],[60,-1500])));
  assert.ok(!pieces.some(e=>near(nodes[e.start],[200,-1500])||near(nodes[e.end],[200,-1500])),'no cut where nothing lands');
  const [exit]=of('nb-exit-23'),[entrance]=of('nb-entrance-23');
  assert.equal(exit.start,of('nb-01')[0].end,'the exit leaves from the gore node');
  assert.equal(exit.start,of('nb-02')[0].start);
  assert.equal(exit.end,pieces.find(e=>near(nodes[e.end],[60,-1500])).end,'and lands on the street');
  assert.equal(entrance.end,of('nb-03')[0].start,'the entrance joins at the next gore');
  assert.equal(entrance.start,exit.end);
});

/** Raw footprint clearance (m) of two snapshot cars, negative when they overlap. */
function clearance(a,b){
  const dx=b.x-a.x,dz=b.z-a.z;let clear=-Infinity;
  for(const t of [a.yaw,a.yaw+Math.PI/2,b.yaw,b.yaw+Math.PI/2]){
    const ux=Math.sin(t),uz=Math.cos(t),extent=c=>Math.abs(c.halfLength*(Math.sin(c.yaw)*ux+Math.cos(c.yaw)*uz))+Math.abs(c.halfWidth*(Math.cos(c.yaw)*ux-Math.sin(c.yaw)*uz));
    clear=Math.max(clear,Math.abs(dx*ux+dz*uz)-extent(a)-extent(b));
  }
  return clear;
}
/** Runs the fleet for `seconds` around an observer on the deck at z, sampling every quarter second. */
async function watch(z,seconds,inspect){
  const city=corridor(),physics=await DrivingPhysics.create(city),traffic=createTraffic(new THREE.Scene(),city,physics);
  const player={x:400,y:.65,z:-100,yaw:0,speed:0,steering:0},observer={x:0,y:DECK+.6,z};
  physics.body.setTranslation(player,true);
  try{
    let previous=traffic.snapshot();
    for(let step=1;step<=seconds*60;step++){
      traffic.update(1/60,player,observer);physics.world.step();
      if(step%15)continue;
      const cars=traffic.snapshot();inspect(cars,previous,traffic.population(observer));previous=cars;
    }
  }finally{traffic.dispose();physics.dispose();}
}

test('highway traffic fills every lane at highway speed, takes the exit and merges without touching',async()=>{
  const lanes=[0,0,0],speeds=[];let taken=0,passed=0,merged=0,peak=0,worst=Infinity,knocked=0,rampTop=0;
  await watch(-1650,50,(cars,previous,population)=>{
    peak=Math.max(peak,population.motorway);
    cars.forEach((car,i)=>{
      const before=previous[i];if(car.parked)return;
      knocked+=car.knocked?1:0;
      if(car.road==='I-93 North · Midtown'&&car.z<-1350&&car.z>-1600)motorwayLanes(corridor().roads[1]).forEach((offset,k)=>{if(Math.abs(car.x-offset)<.3)lanes[k]++;});
      if(car.motorway===2)speeds.push(car.speed);
      if(car.road.includes('Exit 23')&&car.z<-1420)rampTop=Math.max(rampTop,car.speed);
      if(!before||before.parked)return;
      if(before.road==='I-93 North · Southtown'&&car.road!==before.road){passed++;if(car.road.includes('Exit 23'))taken++;}
      if(before.road.includes('Entrance')&&car.road==='I-93 North · Midtown')merged++;
    });
    for(let i=0;i<cars.length;i++)for(let j=0;j<i;j++){
      const a=cars[i],b=cars[j];if(a.parked||b.parked||!a.motorway||!b.motorway||Math.abs(a.y-b.y)>2)continue;
      worst=Math.min(worst,clearance(a,b));
    }
  });
  assert.ok(peak>=15,`the highway around a driver on it carries the densest traffic (${peak} cars within 500 m)`);
  assert.ok(lanes.every(n=>n>0),`every lane is used (${lanes.join(', ')} samples)`);
  assert.ok(Math.max(...speeds)<=MOTORWAY_CRUISE[1]+.05,`no car exceeds ${MOTORWAY_CRUISE[1]} m/s`);
  const mean=speeds.reduce((sum,v)=>sum+v,0)/speeds.length;assert.ok(mean>20,`highway cars cruise (${mean.toFixed(1)} m/s on average)`);
  assert.ok(rampTop>0&&rampTop<=RAMP_CRUISE[1]+.05,`the exit ramp runs at ramp speed toward the street (${rampTop.toFixed(1)} m/s)`);
  assert.ok(taken>=2&&taken/passed<.5,`some cars, not most, take the exit (${taken} of ${passed})`);
  assert.ok(merged>=1,`cars merge from the entrance (${merged})`);
  assert.ok(worst>0,`highway cars never overlap, at merges included (closest ${worst.toFixed(2)} m)`);
  assert.equal(knocked,0,'no car is knocked by another');
});

test('cars emerge from a closed start and vanish into a closed end, never driving on past its barrier',async()=>{
  let emerged=0;
  await watch(-150,25,(cars,previous)=>cars.forEach((car,i)=>{
    const before=previous[i];if(car.parked||car.road!=='I-93 North · Southtown'||car.z<-60)return;
    if(!before||before.parked||Math.hypot(before.x-car.x,before.z-car.z)>60)emerged++;
  }));
  assert.ok(emerged>=5,`cars come out of the barrier at the closed start (${emerged})`);
  let vanished=0,beyond=0;const sink=-2800+CLOSURE_SETBACK-SINK_BEYOND;
  await watch(-2550,35,(cars,previous)=>cars.forEach((car,i)=>{
    const before=previous[i];
    if(car.parked){if(before&&!before.parked&&before.z<-2700)vanished++;return;}
    if(car.road==='I-93 North · Northtown'&&car.z<sink-.5)beyond++;
  }));
  assert.ok(vanished>=5,`cars drive into the closed end and vanish (${vanished})`);
  assert.equal(beyond,0,'none is seen past the barrier');
});

test('a car on a survey trace is hidden while the survey mesh is not drawn, and drawn once it is',async()=>{
  // The middle carriageway piece as a trace over a survey mesh whose tile is built after ten seconds.
  const city=corridor(),trace=city.roads.splice(1,1)[0];Object.assign(trace,{name:'I-93 North · Zakim Bridge',surveyDeck:'BOS-SURVEY'});city.surveyRoads=[trace];
  let drawn=false;const asked=new Set(),physics=await DrivingPhysics.create(city),traffic=createTraffic(new THREE.Scene(),city,physics,[],{surveyDrawn:id=>{asked.add(id);return drawn;}});
  const player={x:400,y:.65,z:-100,yaw:0,speed:0,steering:0},observer={x:0,y:DECK+.6,z:-1500},seen={hidden:0,shown:0,elsewhere:0};
  physics.body.setTranslation(player,true);
  try{
    for(let step=1;step<=20*60;step++){
      if(step===10*60)drawn=true;
      traffic.update(1/60,player,observer);physics.world.step();
      if(step%15)continue;
      for(const car of traffic.snapshot()){
        if(car.parked)continue;
        const on=car.road==='I-93 North · Zakim Bridge';
        assert.equal(car.hidden,on&&!drawn,`a car ${on?'on':'off'} the trace is ${car.hidden?'hidden':'drawn'} while the mesh is ${drawn?'':'not '}drawn`);
        if(on)seen[drawn?'shown':'hidden']++;else seen.elsewhere++;
      }
    }
  }finally{traffic.dispose();physics.dispose();}
  assert.deepEqual([...asked],['BOS-SURVEY'],'only cars on the trace ask about its mesh');
  assert.ok(seen.hidden>0&&seen.shown>0&&seen.elsewhere>0,JSON.stringify(seen));
});

test('a closed end is a row of Jersey barriers across the whole deck, facing the open road, that a car cannot drive through',async()=>{
  const city=corridor(),[start,,,end]=city.roads;
  const row=closedEndBarriers(city,end);
  assert.equal(row.units.length,Math.ceil(end.width/JERSEY.length));
  assert.ok(Math.abs(row.z-(-2800+CLOSURE_SETBACK))<1e-6,'the row stands 5 m inside the closed end, as at the tunnel caps');
  const span=row.units.map(u=>[u.x-u.length/2,u.x+u.length/2]);
  assert.ok(span[0][0]<=-end.width/2+.03&&span.at(-1)[1]>=end.width/2-.03,'units reach both deck edges');
  assert.ok(span.every(([,hi],k)=>k===span.length-1||span[k+1][0]-hi<.05),'with no gap a car fits through');
  assert.ok(row.units.every(u=>Math.abs(u.y-DECK)<1e-9&&u.roll===0));
  assert.ok(Math.abs(Math.cos(row.face))>.999&&Math.cos(row.face)>0,'the face of a closed end looks back south at oncoming traffic');
  const open=closedEndBarriers(city,start);
  assert.ok(Math.abs(open.z-(-CLOSURE_SETBACK))<1e-6&&Math.cos(open.face)<-.999,'a closed start faces the road ahead');
  assert.equal(closedEndBarriers(city,city.roads[1]),undefined,'an open deck has none');
  const physics=await DrivingPhysics.create(city);
  try{
    for(const u of [...row.units,...open.units]){
      const hit=physics.world.castRay(new Ray({x:u.x,y:30,z:u.z},{x:0,y:-1,z:0}),40,true,undefined,undefined,physics.chassisCollider,physics.body);
      assert.ok(Math.abs(30-hit.timeOfImpact-(DECK+JERSEY.height-.02))<.02,`a barrier collider stands on the deck at ${u.x.toFixed(1)}, ${u.z}`);
    }
  }finally{physics.dispose();}
});

test('lane paint: dashed dividers, solid edges, a taper into the lane drop that meets the next deck, and a gap where the exit leaves',()=>{
  const city=corridor(),[,midtown,beforeDrop,afterDrop]=city.roads,lines=road=>laneMarkings(city,road);
  const plain=lines(afterDrop);
  assert.deepEqual(plain.filter(l=>l.kind!=='divider').map(l=>[l.kind,l.color]),[['left','yellow'],['right','white']]);
  const dashes=plain.filter(l=>l.kind==='divider');
  assert.ok(dashes.every(l=>Math.abs(stations(l.points).at(-1)-LANE_DASH[0])<1e-6),'3 m dashes');
  assert.ok(dashes.slice(1).every((l,k)=>Math.abs(dashes[k].points[0][1]-l.points[0][1]-LANE_DASH[1])<1e-6),'one every 12 m');
  assert.ok(dashes.every(l=>Math.abs(l.points[0][0])<1e-6),'between the two lanes, on the centreline');
  // Three lanes narrowing to two: each line of the wider deck ends where a line of the next one starts.
  const ends=lines(beforeDrop).filter(l=>l.kind!=='divider').map(l=>l.points.at(-1)),starts=plain.filter(l=>l.kind!=='divider').map(l=>l.points[0]);
  ends.forEach((p,k)=>assert.ok(near(p,starts[k]),`${['left','right'][k]} edge meets across the lane drop`));
  assert.ok(near(lines(beforeDrop).find(l=>l.kind==='left').points[0],[-1.5*LANE_WIDTH,-1800]),'and starts at the full width');
  // The exit ramp leaves level with the carriageway: the right edge breaks across its mouth, the left edge never.
  const right=lines(midtown).filter(l=>l.kind==='right'),left=lines(midtown).filter(l=>l.kind==='left');
  assert.equal(left.length,1);assert.ok(right.length>=2,'the right edge line is cut');
  const gap=[right[0].points.at(-1)[1],right[1].points[0][1]];
  assert.ok(gap[0]<-1200&&gap[0]>-1240&&gap[1]<gap[0]-20,`gap from z=${gap[0].toFixed(1)} to ${gap[1].toFixed(1)}`);
  const exit=lines(city.roads[4]);
  assert.ok(exit.every(l=>l.points[0][1]<-1220),'the ramp paints nothing inside the carriageway it leaves');
  assert.deepEqual(laneMarkings(city,city.roads[6]),[],'a street without lanes is left to the street painter');
});

test('highway work zones close the outside lane every 1.5 to 2.5 km of each direction, clear of closed ends, ramps and the spawn',()=>{
  // Twelve kilometres each way, in 2 km pieces, with an exit ramp off the northbound side.
  const roads=[];
  for(let k=0;k<6;k++){
    roads.push(deck(`nb-${k+1}`,'I-93 North · Test',line([0,-k*2000],[0,-(k+1)*2000]),k===5?2:3,k===0?{closed:'start'}:{}));
    roads.push(deck(`sb-${k+1}`,'I-93 South · Test',line([40,-12000+k*2000],[40,-12000+(k+1)*2000]),3,k===5?{closed:'end'}:{}));
  }
  roads.push(ramp('nb-exit','I-93 North · Exit 1 Test',[[0,-4000],[10,-4100],[30,-4300]],DECK,0));
  const city=fixture(roads,{minX:-500,maxX:500,minZ:-12500,maxZ:500},{x:0,z:-6000,yaw:Math.PI});
  const zones=planMotorwayZones(city,5);
  assert.deepEqual(planMotorwayZones(city,5),zones,'a seed always plans the same sites');
  assert.notDeepEqual(planMotorwayZones(city,6).map(z=>z.frame.station),zones.map(z=>z.frame.station));
  const chain=zone=>{const k=+zone.roadId.split('-')[1];return (k-1)*2000+zone.frame.station;};
  for(const direction of ['nb','sb']){
    const along=zones.filter(z=>z.roadId.startsWith(direction)).map(chain).sort((a,b)=>a-b);
    assert.ok(along.length>=3,`${direction}: ${along.length} sites over 12 km`);
    along.slice(1).forEach((s,k)=>assert.ok(s-along[k]>=MOTORWAY_SPACING[0]&&s-along[k]<=MOTORWAY_SPACING[1]+600,`${direction} sites ${Math.round(s-along[k])} m apart`));
  }
  const reach=(MOTORWAY_WORK_LENGTH+2*MOTORWAY_TAPER_LENGTH)/2;
  for(const zone of zones){
    const road=zone.road,length=stations(road.points).at(-1),lanes=motorwayLanes(road);
    assert.equal(road.kind,'motorway','never on a ramp');
    assert.ok(zone.frame.station>reach&&zone.frame.station<length-reach,'the whole merge lies on one piece');
    assert.equal(zone.laneOffset,lanes.at(-1),'the outside lane closes');
    assert.equal(zone.openOffset,lanes.at(-2),'into the next one over');
    const total=chain(zone);assert.ok(zone.roadId.startsWith('nb')?total>reach+150:12000-total>reach+150,'clear of the closed end');
    assert.ok(Math.hypot(zone.x-city.spawn.x,zone.z-city.spawn.z)>reach+60,'clear of the spawn');
    const local=constructionLocal(zone,zone.x,zone.z),{p}=pointAtDistance(road.points,zone.frame.station+30);
    assert.ok(Math.abs(local.along)<1e-6&&Math.abs(local.offset)<1e-6);
    assert.ok(Math.abs(constructionLocal(zone,...p).along-30)<1e-6,'the frame follows the deck');
  }
  assert.deepEqual(planConstructionZones(city,{seed:5}).filter(z=>z.frame),zones,'the street planner adds them on its own stream');
  const capped=planConstructionZones({...city,roads:[...roads,street('frontage','Frontage Road',[[300,-1000],[300,-3000]],{width:16,pavedWidth:14})]},{seed:5,maxZones:1});
  assert.equal(capped.filter(z=>!z.frame).length,1,'the street plan fills its cap');
  assert.deepEqual(capped.filter(z=>z.frame),zones,'and the highway keeps its sites on top (the metro streets always fill it)');
});

// A grid for routing: South and North Streets 3.4 km apart, joined by the slow
// Parallel Street and by the interstate between an entrance and an exit.
const gpsCity=()=>fixture([
  deck('n1','I-93 North · Southtown',line([0,0],[0,-600]),3),
  deck('n2','I-93 North · Midtown',line([0,-600],[0,-1500]),3),
  deck('n3','I-93 North · Riverside',line([0,-2000],[0,-3400]),3),
  deck('n4','I-93 North · Northtown',line([0,-3400],[0,-4000]),3),
  ramp('entrance','I-93 North · Entrance from South Street',[[80,-300],[60,-400],[30,-500],[0,-600]],0,DECK),
  ramp('exit','I-93 North · Exit 23 North Street',[[0,-3400],[30,-3500],[60,-3600],[80,-3700]],DECK,0),
  street('south','South Street',[[-500,-300],[80,-300],[300,-300],[500,-300]]),
  street('north','North Street',[[-500,-3700],[80,-3700],[300,-3700],[500,-3700]]),
  street('parallel','Parallel Street',[[300,-300],[300,-2000],[300,-3700]]),
],{minX:-600,maxX:600,minZ:-4200,maxZ:200},{x:-200,z:-300,yaw:Math.PI/2});
// The Charles River stretch is a trace over the drivable survey viaduct: GPS and traffic only.
const trace=()=>deck('i93-zakim-nb-01','I-93 North · Zakim Bridge',line([0,-1500],[0,-2000]),3,{surveyDeck:'BOS-SURVEY',bridge:{id:'i93',kind:'zakim-survey-trace',thickness:1.2,clearanceEstimated:true}});

test('GPS takes the interstate when it is faster, names the ramp and the exit, and never ends a trip on it',async()=>{
  const city=await resolveCity({...gpsCity(),roads:[...gpsCity().roads,trace()]},async()=>{throw new Error('no sidecars');});
  const from=anchorAt(city,-200,-300,.5),to=destinationAnchors(city,-200,-3700),plan=planRoute(city,from,to,{heading:Math.PI/2,target:[-200,-3700]});
  assert.ok(plan.points.some(p=>near(p,[0,-1000],1))&&plan.points.some(p=>near(p,[0,-1750],1)),'the route runs up the interstate, across the survey trace');
  const texts=plan.steps.map(s=>s.text);
  assert.deepEqual(texts,['Head east on South St','Turn left onto the ramp to I-93 North','Take exit 23 toward North Street','Turn left on North St','Arrive at your destination']);
  assert.equal(plan.steps[2].turn,'slight-right','the exit bears off to its side');
  const slow=planRoute({...city,surveyRoads:[]},anchorAt(city,-200,-300,.5),destinationAnchors(city,-200,-3700),{heading:Math.PI/2});
  assert.ok(!slow.points.some(p=>near(p,[0,-1000],1)),'without the trace the interstate is a dead end, and the route takes Parallel Street');
  assert.ok(plan.duration<slow.duration-60,`the interstate saves time (${plan.duration.toFixed(0)} s against ${slow.duration.toFixed(0)} s)`);
  // A click right beside the deck arrives on a street.
  const beside=destinationAnchors(city,6,-2500);
  assert.ok(beside.length&&beside.every(a=>routeGraph(city).edges[a.edge].road.lanes===undefined),'a motorway is never a destination');
  assert.deepEqual(motorwayRamp(city.roads[5]),{exit:'Exit 23 North Street'});
  assert.deepEqual(motorwayRamp(city.roads[4]),{onto:'I-93 North'});
  assert.deepEqual(motorwayRamp({name:'Government Center / Clinton Street · I-93 South exit',kind:'motorway_link',tunnel:{clearance:5},oneway:1,width:7,points:[],id:'x'}),{exit:'Exit toward Government Center / Clinton Street'});
  assert.deepEqual(motorwayRamp({name:'I-93 South entrance · New Chardon Street',kind:'motorway_link',tunnel:{clearance:5},oneway:1,width:7,points:[],id:'y'}),{onto:'I-93 South'});
  assert.equal(motorwayRamp(city.roads[6]),undefined,'a street is no ramp');
});

test('GPS names the direction an entrance signed only for the route divides into, and the side it keeps',async()=>{
  // West Street climbs onto "I-93 · Entrance from West Street", which divides at deck height into the
  // northbound entrance (left, over the southbound carriageway) and the southbound one (right).
  const link=(id,name,points)=>deck(id,name,points,1,{kind:'motorway_link'});
  const city=await resolveCity(fixture([
    deck('n1','I-93 North · Southtown',line([0,0],[0,-1200]),3),deck('n2','I-93 North · Midtown',line([0,-1200],[0,-2400]),3),
    deck('s1','I-93 South · Midtown',line([-40,-2400],[-40,-800]),3),deck('s2','I-93 South · Southtown',line([-40,-800],[-40,-300]),3),deck('s3','I-93 South · Harbor',line([-40,-300],[-40,0]),3),
    ramp('west','I-93 · Entrance from West Street',[[-400,-1000],[-300,-1000],[-200,-1000]],0,DECK),
    link('west-n','I-93 North · Entrance from West Street',[[-200,-1000],[-100,-1060],[-40,-1140],[0,-1200]]),
    link('west-s','I-93 South · Entrance from West Street',[[-200,-1000],[-120,-940],[-60,-870],[-40,-800]]),
    ramp('exit','I-93 South · Exit 1 Harbor Street',[[-40,-300],[-70,-200],[-100,-100],[-120,0]],DECK,0),
    street('west-street','West Street',[[-800,-1000],[-400,-1000]]),street('harbor','Harbor Street',[[-120,0],[-400,0],[-700,0]]),
  ],{minX:-900,maxX:300,minZ:-2600,maxZ:200},{x:-700,z:-1000,yaw:Math.PI/2}),async()=>{throw new Error('no sidecars');});
  const plan=planRoute(city,anchorAt(city,-700,-1000,.5),destinationAnchors(city,-500,0),{heading:Math.PI/2});
  assert.deepEqual(plan.steps.map(s=>s.text),['Head east on West St','Take the ramp onto I-93 South','Keep right toward I-93 South','Take exit 1 toward Harbor Street','Turn right on Harbor St','Arrive at your destination']);
});

test('survey traces join traffic, GPS and street names but no surface lookup, and no facade faces a motorway',async()=>{
  const city=await resolveCity({...gpsCity(),roads:[...gpsCity().roads,trace()]},async()=>{throw new Error('no sidecars');});
  assert.deepEqual(city.surveyRoads.map(r=>r.id),['i93-zakim-nb-01'],'resolveCity moves the trace aside');
  assert.ok(!city.roads.some(r=>r.surveyDeck),'out of every road consumer');
  assert.ok(roadGraph(city).edges.some(e=>e.road.surveyDeck),'traffic drives it');
  assert.ok(routeGraph(city).edges.some(e=>e.road.surveyDeck),'GPS routes over it');
  assert.equal(closestRoad(city,0,-1750,false,{height:DECK}).road.surveyDeck,undefined,'surface and recovery lookups never answer the trace');
  assert.equal(closestRoad(city,0,-1750,false,{height:DECK,survey:true}).road.id,'i93-zakim-nb-01','the street-name lookup does');
  assert.equal(routeGraph(city).edges[anchorAt(city,0,-1750,DECK+.5).edge].road.id,'i93-zakim-nb-01','a car on the viaduct anchors its route there');
  assert.equal(closestRoad(city,8,-1000,true).road.id,'parallel','a building beside the interstate faces the street');
  const labels=createMinimapLabeler([...city.roads,...city.surveyRoads])({center:[0,-1800],scale:.4,width:216,height:216,measureText:t=>t.length*5.6});
  assert.ok(labels.some(l=>l.name==='I-93 North'),'the map labels the route, not each piece');
  assert.ok(!labels.some(l=>/ · /.test(l.name)),labels.map(l=>l.name).join(', '));
});
