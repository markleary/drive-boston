import assert from 'node:assert/strict';
import test from 'node:test';
import {routeGraph,anchorAt,destinationAnchors,planRoute,createNavigator,abbreviateStreet,streetName,classifyTurn,compass} from '../src/simulation/navigation.ts';
import {loadMetroCity} from './helpers/metro-city.mjs';

const road=(id,name,points,extra={})=>({id,name,points,width:10,oneway:0,...extra});
// A small grid, north up (north is -z). Main Street runs east along z=0 from a dead end at x=0,
// carried over the Harbor Bridge between x=300 and x=400. First and Third Streets run north-south;
// Second Street is one-way northbound. North and South Streets close the blocks at z=-200 and z=200.
// Sky Road crosses Main Street at x=150 on a deck 6 m up and shares its vertex there.
const grid=()=>({bounds:{minX:-50,maxX:550,minZ:-250,maxZ:250},spawn:{x:50,z:0,yaw:Math.PI/2},roads:[
  road('main','Main Street',[[0,0],[100,0],[150,0],[200,0],[300,0]]),
  road('bridge','Harbor Bridge',[[300,0],[400,0]]),
  road('main-east','Main Street',[[400,0],[500,0]]),
  road('first','First Street',[[100,-200],[100,-100],[100,0],[100,100],[100,200]]),
  road('second','Second Street',[[200,200],[200,0],[200,-200]],{oneway:1}),
  road('third','Third Street',[[300,-200],[300,-100],[300,0],[300,100],[300,200]]),
  road('north','North Street',[[100,-200],[200,-200],[300,-200]]),
  road('south','South Street',[[100,200],[200,200],[300,200]]),
  road('sky','Sky Road',[[150,-100],[150,0],[150,100]],{elevations:[6,6,6],bridge:{id:'sky',thickness:1,clearanceEstimated:true}}),
]});
const EAST=Math.PI/2,WEST=-Math.PI/2,NORTH=Math.PI;
const route=(city,from,to,options)=>planRoute(city,anchorAt(city,...from),destinationAnchors(city,...to),{target:to,...options});
const near=(plan,[x,z],within=1)=>plan.points.some(p=>Math.hypot(p[0]-x,p[1]-z)<within);

test('street names read the way a navigation display says them',()=>{
  assert.equal(abbreviateStreet('Boylston Street'),'Boylston St');
  assert.equal(abbreviateStreet('Massachusetts Avenue'),'Massachusetts Ave');
  assert.equal(abbreviateStreet('Monsignor O\'Brien Highway'),'Monsignor O\'Brien Hwy');
  assert.equal(abbreviateStreet('Harvard Bridge'),'Harvard Bridge');
  assert.equal(streetName({name:'I-93 North · O’Neill Tunnel · Zakim Bridge'}),'I-93 North');
  assert.equal(streetName({name:'Unnamed trunk ramp'}),null);
  assert.deepEqual([10,30,60,100,150,175].map(d=>classifyTurn(d*Math.PI/180)),['straight','slight-right','right','right','sharp-right','uturn']);
  assert.equal(classifyTurn(-Math.PI/2),'left');
  assert.deepEqual([compass(0,-1),compass(1,0),compass(0,1),compass(-1,-1)],['north','east','south','northwest']);
});

test('the route graph never joins a deck to the street beneath it',()=>{
  const city=grid(),graph=routeGraph(city),[main,,,,,,,,sky]=city.roads;
  assert.notEqual(graph.components.get(sky),graph.components.get(main));
  assert.equal(graph.components.get(main),graph.main);
});

test('a route turns where the streets meet and names each maneuver',()=>{
  const plan=route(grid(),[50,0],[305,-150],{heading:EAST});
  assert.ok(plan&&!plan.wrongWay);
  assert.ok(Math.abs(plan.length-400)<1,`length ${plan.length}`);
  assert.deepEqual(plan.steps.map(s=>s.text),['Head east on Main St','Turn left on Third St','Your destination is on the right']);
  assert.equal(plan.steps[1].turn,'left');
  assert.ok(Math.abs(plan.steps[1].at-250)<1);
  assert.deepEqual(plan.destination,[300,-150]);
});

test('a route keeps to one-way streets and asks for a U-turn when setting off backwards',()=>{
  // The south block of Second Street can only be entered from South Street.
  const plan=route(grid(),[250,0],[200,100],{heading:WEST});
  assert.ok(plan&&!plan.wrongWay);
  assert.ok(near(plan,[200,200]),'enters Second Street from South Street');
  assert.ok(!near(plan,[200,50],5),'never drives south down Second Street');
  assert.match(plan.steps.at(-2).text,/^Turn (left|right) on Second St$/);
  // Facing the dead end at the west end of Main Street, the route starts by turning around.
  const back=route(grid(),[50,0],[305,-150],{heading:WEST});
  assert.equal(back.steps[0].text,'Make a U-turn');
  assert.ok(!near(back,[0,0],5),'does not drive on to the dead end');
});

test('a bridge named apart from its street folds into it',()=>{
  const plan=route(grid(),[50,0],[480,12],{heading:EAST});
  assert.deepEqual(plan.steps.map(s=>s.text),['Head east on Main St','Your destination is on the right']);
});

test('the navigator follows progress, recalculates off the route, flies straight and arrives',()=>{
  const nav=createNavigator(grid()),state=(x,z,yaw,speed=10)=>({x,y:0,z,yaw,speed,steering:0});
  assert.equal(nav.setDestination(1000,1000,state(50,0,EAST),'drive',0),null,'nothing within reach of a street');
  assert.deepEqual(nav.setDestination(305,-150,state(50,0,EAST),'drive',0),[300,-150]);
  let g=nav.update(state(60,0,EAST),'drive',100);
  assert.equal(g.step.text,'Turn left on Third St');
  assert.ok(Math.abs(g.distance-240)<1&&Math.abs(g.remaining-390)<1);
  assert.ok(g.time>0&&!g.arrived);
  assert.ok(Math.abs(nav.remaining()[0][0]-60)<1e-6,'the drawn route starts at the car');
  g=nav.update(state(300,-60,NORTH),'drive',200);
  assert.match(g.step.text,/destination is on the right/);
  // Far off the route (as after a teleport), the next update recalculates from there.
  g=nav.update(state(200,180,NORTH),'drive',5000);
  assert.equal(nav.snapshot().reroutes,1);
  assert.ok(near(nav.plan,[200,180],1),'the new route starts where the car is');
  // Flying, the guidance is the destination's distance and bearing.
  g=nav.update(state(300,0,NORTH),'helicopter',6000);
  assert.equal(g.mode,'direct');assert.equal(g.heading,'north');
  assert.ok(Math.abs(g.distance-150)<1e-6&&Math.abs(g.bearing)<1e-6);
  assert.equal(nav.remaining().length,2);
  // Landing back on the street brings the road route back, and reaching the destination ends it.
  g=nav.update(state(300,-140,NORTH),'drive',7000);
  assert.equal(g.mode,'road');assert.ok(g.arrived);
  nav.clear();assert.equal(nav.active,false);assert.equal(nav.update(state(0,0,EAST),'drive',8000),null);
});

test('every landmark can be reached from the spawn without driving against a one-way street',async()=>{
  const city=await loadMetroCity({tiles:[]}),from=anchorAt(city,city.spawn.x,city.spawn.z);
  const failures=[];
  for(const landmark of city.landmarks){
    const plan=planRoute(city,from,destinationAnchors(city,...landmark.position),{heading:city.spawn.yaw,target:landmark.position});
    if(!plan||plan.wrongWay||plan.steps.at(-1).kind!=='arrive')failures.push(landmark.name);
  }
  assert.deepEqual(failures,[]);
});

test('a Back Bay route from the spawn to Fenway Park reads as turn-by-turn directions',async()=>{
  const city=await loadMetroCity({tiles:[]}),fenway=city.landmarks.find(l=>l.id==='fenway'||l.name==='Fenway Park');
  const plan=planRoute(city,anchorAt(city,city.spawn.x,city.spawn.z),destinationAnchors(city,...fenway.position),{heading:city.spawn.yaw,target:fenway.position});
  assert.ok(plan&&!plan.wrongWay);
  assert.ok(plan.length>1500&&plan.length<4000,`length ${plan.length}`);
  const texts=plan.steps.map(s=>s.text);
  assert.match(texts[0],/^Head (north|south|east|west|northeast|northwest|southeast|southwest) on /);
  assert.ok(texts.slice(1,-1).every(t=>/^(Turn|Bear|Continue|Make|Merge|Take) /.test(t)),texts.join(' | '));
  assert.ok(texts.some(t=>/ on Lansdowne St$/.test(t)),texts.join(' | '));
});
