import assert from 'node:assert/strict';
import test from 'node:test';
import {RailPath,isRailData,nearestRail,railCells,railRuns,railStations} from '../src/simulation/rail-tracks.ts';

// A straight 400 m track running south (+z) from the origin, rising 4 m, with a bridge, a covered span, a level crossing and contact rail.
const track=(extra={})=>({
  id:'t1',line:'orange',name:'Test track',length:400,points:Array.from({length:101},(_,k)=>[0,k*4,k*.04]),ends:['portal','buffer'],
  bridges:[{start:100,end:140,piers:[120],kind:'deck',half:[2.2,2.2],walls:[1,1],over:['water']}],
  covered:[{start:200,end:230,kind:'underpass'}],crossings:[{start:300,end:310}],thirdRail:[[0,250,1]],...extra});
const doc=(tracks=[track()],extra={})=>({version:1,gauge:1.435,tracks,platforms:[],portals:[],crossings:[],bumpers:[],...extra});
const near=(a,b,tolerance=1e-9)=>Math.abs(a-b)<=tolerance;

test('isRailData accepts a version 1 document and rejects missing arrays, other versions and broken tracks',()=>{
  assert.ok(isRailData(doc()));
  assert.ok(!isRailData(undefined)&&!isRailData('<!doctype html>')&&!isRailData({...doc(),version:2}));
  const {platforms,...noPlatforms}=doc();assert.ok(!isRailData(noPlatforms),'every fixture list must be present');
  assert.ok(!isRailData(doc([track({points:[[0,0,0]]})])),'one sample is not a track');
  assert.ok(!isRailData(doc([track({points:[[0,0,0],[0,4,Number.NaN]]})])),'heights must be finite');
  assert.ok(!isRailData(doc([track({length:0})])));
});

test('RailPath samples position, tangent and grade by distance and clamps past the ends',()=>{
  const path=new RailPath(track());
  assert.equal(path.step,4);assert.equal(path.length,400);
  const p=path.sample(10);
  assert.ok(near(p.x,0)&&near(p.z,10)&&near(p.y,.1,1e-9)&&near(p.tx,0)&&near(p.tz,1)&&near(p.grade,.01,1e-9));
  assert.ok(near(path.sample(-5).z,0)&&near(path.sample(450).z,400)&&near(path.sample(450).y,4,1e-9));
  const out={x:0,y:0,z:0,tx:0,tz:0,grade:0};assert.equal(path.sample(20,out),out,'reuses the caller\'s sample');
});

test('RailPath reports the spans and the contact rail side at a distance',()=>{
  const path=new RailPath(track());
  assert.equal(path.bridge(120)?.kind,'deck');assert.equal(path.bridge(150),undefined);
  assert.equal(path.covered(215)?.kind,'underpass');assert.equal(path.covered(199),undefined);
  assert.ok(path.crossing(305)&&!path.crossing(311));
  assert.equal(path.thirdRailSide(100),1);assert.equal(path.thirdRailSide(260),0);
  assert.deepEqual(path.breaks(0,400),[100,140,200,230,300,310,250],'every span edge strictly inside the range, contact rail last');
  assert.deepEqual(path.breaks(100,140),[],'the range ends are not breaks');
});

test('railStations walks a range at the spacing and lands exactly on every span edge',()=>{
  const path=new RailPath(track()),stations=railStations(path,90,215,10);
  assert.equal(stations[0],90);assert.equal(stations[stations.length-1],215);
  for(const edge of [100,140,200])assert.ok(stations.includes(edge),`station at ${edge}`);
  for(let i=1;i<stations.length;i++){const gap=stations[i]-stations[i-1];assert.ok(gap>0&&gap<=10+1e-9,`gap ${gap}`);}
  assert.deepEqual(railStations(path,0,3,10),[0,3],'a short piece is one segment');
});

test('railRuns splits stations into open, bridge and covered runs that share their boundary stations',()=>{
  const path=new RailPath(track()),runs=railRuns(path,railStations(path,80,260,10));
  assert.deepEqual(runs.map(r=>r.kind),['open','bridge','open','covered','open']);
  assert.equal(runs[1].bridge,path.track.bridges[0],'the bridge run carries its bridge');
  assert.deepEqual([runs[1].stations[0],runs[1].stations.at(-1)],[100,140]);
  assert.deepEqual([runs[3].stations[0],runs[3].stations.at(-1)],[200,230]);
  for(let i=1;i<runs.length;i++)assert.equal(runs[i].stations[0],runs[i-1].stations.at(-1),'runs meet at a shared station');
});

test('railCells puts every track segment in exactly one cell and every fixture in the cell of its anchor',()=>{
  const second=track({id:'t2',points:Array.from({length:51},(_,k)=>[600-k*12,-100,1]),length:600,bridges:[],covered:[],crossings:[],thirdRail:[]});
  const data=doc([track(),second],{
    platforms:[{id:'p',name:'P',line:'orange',level:'orange',ring:[[2,10],[6,10],[6,90],[2,90]],top:1,edges:[3],canopy:null,island:false,covered:false}],
    portals:[{x:0,z:200,yaw:Math.PI,width:5,bottom:-1,top:4,tor:2,kind:'underpass',tracks:['t1']}],
    crossings:[{name:'Level Street',x:0,z:305,yaw:Math.PI/2,half:4,road:5,y:3,tracks:['t1']}],
    bumpers:[{x:0,z:400,yaw:0,y:4,track:'t1'}]});
  const cells=railCells(data,256);
  const covered=new Map();
  for(const cell of cells.values())for(const [t,from,to]of cell.pieces){
    assert.ok(to>from,'pieces run forward');
    const list=covered.get(t)??[];list.push([from,to]);covered.set(t,list);
    const mid=new RailPath(data.tracks[t]).sample((from+to)/2);
    assert.ok(Math.abs(mid.x-cell.cx)<=128+12&&Math.abs(mid.z-cell.cz)<=128+12,'a piece lies in or at the edge of its cell');
  }
  for(const [t,list]of covered){
    list.sort((a,b)=>a[0]-b[0]);assert.equal(list[0][0],0);assert.ok(near(list.at(-1)[1],data.tracks[t].length,1e-6));
    for(let i=1;i<list.length;i++)assert.ok(near(list[i][0],list[i-1][1],1e-6),'pieces tile the track without gaps or overlaps');
  }
  assert.equal(covered.get(0).length,2,'the 400 m track crosses one cell boundary at z=256');
  const find=key=>[...cells.values()].find(c=>c[key].length);
  assert.equal(find('platforms').key,'0,0');assert.equal(find('portals').key,'0,0');assert.equal(find('crossings').key,'0,1');assert.equal(find('bumpers').key,'0,1');
});

test('nearestRail finds the closest drawn track point and skips covered spans',()=>{
  const paths=[new RailPath(track())];
  const hit=nearestRail(paths,3,50);
  assert.equal(hit.track,'t1');assert.ok(near(hit.distance,3,1e-9)&&near(hit.s,50,1e-9)&&near(hit.y,.5,1e-9));
  assert.equal(nearestRail(paths,40,50),undefined,'beyond the reach');
  assert.equal(nearestRail(paths,1,215,5),undefined,'inside the covered span');
  assert.ok(nearestRail(paths,1,235,5),'just past it');
});
